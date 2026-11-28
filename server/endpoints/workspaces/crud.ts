const { z } = require("zod");
const { reqBody, multiUserMode, userFromSession } = require("../../utils/http");
const { typedHandler } = require("../../utils/http/typedHandler.ts");
const { Workspace } = require("../../models/workspace");
const { Document } = require("../../models/documents");
const { DocumentVectors } = require("../../models/vectors");
const { WorkspaceChats } = require("../../models/workspaceChats");
const { getVectorDbClass } = require("../../utils/helpers");
const { validatedRequest } = require("../../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../../utils/middleware/multiUserProtected");
const { EventLogs } = require("../../models/eventLogs");
const { validWorkspaceSlug } = require("../../utils/middleware/validWorkspace");
const { Invite } = require("../../models/invite");
const {
  simpleSSOLoginDisabledMiddleware,
} = require("../../utils/middleware/simpleSSOEnabled");
const { searchWorkspaceAndThreads } = require("../../utils/helpers/search");
const {
  workspaceDeletionProtection,
} = require("../../utils/middleware/workspaceDeletionProtection");

const createWorkspaceBodySchema = z.object({
  name: z.string().trim().min(1).max(255),
  accessMode: z
    .enum(["private", "public_readonly", "public_collaborative"])
    .default("private"),
  memberIds: z.array(z.union([z.number(), z.string()])).default([]),
  groupId: z.union([z.string(), z.number()]).default(""),
  groupName: z.string().default(""),
  groupGlobal: z.boolean().default(false),
});

const searchWorkspaceBodySchema = z.object({
  searchTerm: z.string().optional().default(""),
});

function registerWorkspaceCrudEndpoints(app: Record<string, any>): void {
  app.get(
    "/workspace/new/members",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request: Record<string, any>, response: Record<string, any>) => {
      response.set("Cache-Control", "no-store");
      const user = await userFromSession(request, response);
      if (multiUserMode(response) && !user?.id) return response.sendStatus(401);
      if (!user?.id) return response.json({ users: [] });
      try {
        const { creationMembers } = require("../../models/workspaceCreation");
        return response.json({ users: await creationMembers(user.id) });
      } catch {
        return response
          .status(500)
          .json({ message: "成员列表加载失败，请重试。" });
      }
    }
  );

  app.post(
    "/workspace/new",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request: Record<string, any>, response: Record<string, any>) => {
      try {
        const user = await userFromSession(request, response);
        if (multiUserMode(response) && !user?.id)
          return response.sendStatus(401);
        const parsed = createWorkspaceBodySchema.safeParse(reqBody(request));
        if (
          !parsed.success ||
          !Workspace.VALID_ACCESS_MODES.includes(parsed.data.accessMode)
        ) {
          return response.status(400).json({
            workspace: null,
            message: "请填写工作区名称，并选择有效的工作区类型。",
          });
        }
        const { name, accessMode, memberIds, groupId, groupName, groupGlobal } =
          parsed.data;
        if (
          groupGlobal &&
          multiUserMode(response) &&
          user?.role !== ROLES.admin
        ) {
          return response
            .status(403)
            .json({ workspace: null, message: "只有管理员可以创建全局分组。" });
        }
        const { workspace, message } = await Workspace.new(
          name,
          user?.id,
          { accessMode },
          { memberIds, groupId, groupName, groupGlobal }
        );
        if (!workspace)
          return response.status(400).json({ workspace: null, message });

        await EventLogs.logEvent(
          "workspace_created",
          {
            workspaceName: workspace?.name || "Unknown Workspace",
            workspaceId: workspace?.id,
          },
          user?.id
        );
        response.status(200).json({
          workspace: workspace
            ? { ...workspace, viewerRelation: user?.id ? "creator" : "other" }
            : workspace,
          message,
        });
      } catch (e: unknown) {
        const err = e as Error;
        console.error(err.message, err);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/workspace/:slug/invite",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.all]),
      validWorkspaceSlug,
      simpleSSOLoginDisabledMiddleware,
    ],
    async (request: Record<string, any>, response: Record<string, any>) => {
      try {
        const user = await userFromSession(request, response);
        if (!user) {
          response.status(400).json({
            invite: null,
            error: "Workspace invitations require multi-user mode.",
          });
          return;
        }

        const workspace = response.locals.workspace;
        const { invite, error } = await Invite.getOrCreateWorkspaceInvite({
          createdByUserId: user.id,
          workspaceId: workspace.id,
        });
        if (!invite) {
          response.status(200).json({ invite: null, error });
          return;
        }

        await EventLogs.logEvent(
          "workspace_invite_created",
          { workspaceName: workspace.name },
          user.id
        );
        response.status(200).json({
          invite: { code: invite.code, workspace: { name: workspace.name } },
          error: null,
        });
      } catch (e: unknown) {
        const err = e as Error;
        console.error(err.message, err);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/workspace/:slug/update",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request: Record<string, any>, response: Record<string, any>) => {
      try {
        const user = await userFromSession(request, response);
        const { slug = null } = request.params;
        const data = reqBody(request);
        const currWorkspace = multiUserMode(response)
          ? await Workspace.getWithUser(user, { slug })
          : await Workspace.get({ slug });

        if (!currWorkspace) {
          response.sendStatus(400).end();
          return;
        }

        await Workspace.trackChange(currWorkspace, data, user);
        const { workspace, message } = await Workspace.update(
          currWorkspace.id,
          data
        );
        response.status(200).json({ workspace, message });
      } catch (e: unknown) {
        const err = e as Error;
        console.error(err.message, err);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/workspace/:slug",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      workspaceDeletionProtection,
    ],
    async (request: Record<string, any>, response: Record<string, any>) => {
      try {
        const { slug = "" } = request.params;
        const user = await userFromSession(request, response);
        const VectorDb = getVectorDbClass();
        const workspace = multiUserMode(response)
          ? await Workspace.getWithUser(user, { slug })
          : await Workspace.get({ slug });

        if (!workspace) {
          response.sendStatus(400).end();
          return;
        }

        await WorkspaceChats.delete({ workspaceId: Number(workspace.id) });
        await DocumentVectors.deleteForWorkspace(workspace.id);
        await Document.delete({ workspaceId: Number(workspace.id) });
        await Workspace.delete({ id: Number(workspace.id) });

        await EventLogs.logEvent(
          "workspace_deleted",
          {
            workspaceName: workspace?.name || "Unknown Workspace",
          },
          response.locals?.user?.id
        );

        try {
          await VectorDb["delete-namespace"]({ namespace: slug });
        } catch (e: unknown) {
          console.error((e as Error).message);
        }
        response.sendStatus(200).end();
      } catch (e: unknown) {
        const err = e as Error;
        console.error(err.message, err);
        response.sendStatus(500).end();
      }
    }
  );

  app.get(
    "/workspaces",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request: Record<string, any>, response: Record<string, any>) => {
      try {
        const user = await userFromSession(request, response);
        const workspaces = multiUserMode(response)
          ? await Workspace.whereAccessibleWithUser(user)
          : await Workspace.where();

        response.status(200).json({
          workspaces:
            await require("../../models/workspaceListRelation").withWorkspaceListRelation(
              workspaces,
              user
            ),
        });
      } catch (e: unknown) {
        const err = e as Error;
        console.error(err.message, err);
        response.sendStatus(500).end();
      }
    }
  );

  app.get(
    "/workspace/:slug",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request: Record<string, any>, response: Record<string, any>) => {
      try {
        const { slug } = request.params;
        const user = await userFromSession(request, response);
        const workspace = multiUserMode(response)
          ? await Workspace.getAccessibleWithUser(user, { slug })
          : await Workspace.get({ slug });

        response.status(200).json({
          workspace: workspace
            ? {
                ...workspace,
                showAgentCommand:
                  await Workspace.isAgentCommandAvailable(workspace),
              }
            : null,
        });
      } catch (e: unknown) {
        const err = e as Error;
        console.error(err.message, err);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/workspace/search",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    typedHandler(
      { body: searchWorkspaceBodySchema },
      async (
        { body }: { body: { searchTerm: string } },
        response: Record<string, any>
      ) => {
        try {
          const searchResults = await searchWorkspaceAndThreads(
            body.searchTerm,
            response.locals?.user
          );
          response.status(200).json(searchResults);
        } catch (error) {
          console.error("Error searching for workspaces:", error);
          response.sendStatus(500).end();
        }
      }
    )
  );

  app.get(
    "/workspace/:slug/is-agent-command-available",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (_: Record<string, any>, response: Record<string, any>) => {
      try {
        response.status(200).json({
          showAgentCommand: await Workspace.isAgentCommandAvailable(
            response.locals.workspace
          ),
        });
      } catch (error) {
        console.error("Error checking if agent command is available:", error);
        response.status(500).json({ showAgentCommand: true });
      }
    }
  );
}

module.exports = { registerWorkspaceCrudEndpoints };
