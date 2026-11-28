const { z } = require("zod");
const { reqBody, multiUserMode, userFromSession } = require("../../utils/http");
const { typedHandler } = require("../../utils/http/typedHandler.ts");
const { Workspace } = require("../../models/workspace");
const { Document } = require("../../models/documents");
const { DocumentVectors } = require("../../models/vectors");
const { getVectorDbClass } = require("../../utils/helpers");
const { handleFileUpload } = require("../../utils/files/multer");
const { validatedRequest } = require("../../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../../utils/middleware/multiUserProtected");
const { EventLogs } = require("../../models/eventLogs");
const { validWorkspaceSlug } = require("../../utils/middleware/validWorkspace");
const { CollectorApi } = require("../../utils/collectorApi");
const { purgeDocument } = require("../../utils/files/purgeDocument");

const deleteEmbedQueueBodySchema = z.object({
  filename: z.string().min(1, "Missing filename"),
});

function registerWorkspaceDocumentEndpoints(app: Record<string, any>): void {
  app.post(
    "/workspace/:slug/upload",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      handleFileUpload,
    ],
    async function (
      request: Record<string, any>,
      response: Record<string, any>
    ) {
      try {
        const Collector = new CollectorApi();
        const { originalname } = request.file;
        const processingOnline = await Collector.online();

        if (!processingOnline) {
          response
            .status(500)
            .json({
              success: false,
              error: `Document processing API is not online. Document ${originalname} will not be processed automatically.`,
            })
            .end();
          return;
        }

        const { success, reason } =
          await Collector.processDocument(originalname);
        if (!success) {
          response.status(500).json({ success: false, error: reason }).end();
          return;
        }

        Collector.log(
          `Document ${originalname} uploaded processed and successfully. It is now available in documents.`
        );
        await EventLogs.logEvent(
          "document_uploaded",
          {
            documentName: originalname,
          },
          response.locals?.user?.id
        );
        response.status(200).json({ success: true, error: null });
      } catch (e: unknown) {
        const err = e as Error;
        console.error(err.message, err);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/workspace/:slug/upload-link",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request: Record<string, any>, response: Record<string, any>) => {
      try {
        const Collector = new CollectorApi();
        const { link = "" } = reqBody(request);
        const processingOnline = await Collector.online();

        if (!processingOnline) {
          response
            .status(500)
            .json({
              success: false,
              error: `Document processing API is not online. Link ${link} will not be processed automatically.`,
            })
            .end();
          return;
        }

        const { success, reason } = await Collector.processLink(link);
        if (!success) {
          response.status(500).json({ success: false, error: reason }).end();
          return;
        }

        Collector.log(
          `Link ${link} uploaded processed and successfully. It is now available in documents.`
        );
        await EventLogs.logEvent(
          "link_uploaded",
          { link },
          response.locals?.user?.id
        );
        response.status(200).json({ success: true, error: null });
      } catch (e: unknown) {
        const err = e as Error;
        console.error(err.message, err);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/workspace/:slug/update-embeddings",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request: Record<string, any>, response: Record<string, any>) => {
      try {
        const user = await userFromSession(request, response);
        const { slug = null } = request.params;
        const { adds = [], deletes = [] } = reqBody(request);
        const currWorkspace = multiUserMode(response)
          ? await Workspace.getWithUser(user, { slug })
          : await Workspace.get({ slug });

        if (!currWorkspace) {
          response.sendStatus(400).end();
          return;
        }

        await Document.removeDocuments(
          currWorkspace,
          deletes,
          response.locals?.user?.id
        );

        const {
          isNativeEmbedder,
          embedFiles,
        } = require("../../utils/EmbeddingWorkerManager");

        if (isNativeEmbedder() && adds.length > 0) {
          await embedFiles(
            currWorkspace.slug,
            adds,
            currWorkspace.id,
            response.locals?.user?.id ?? null
          );
          const updatedWorkspace = await Workspace.get({
            id: currWorkspace.id,
          });
          response
            .status(200)
            .json({ workspace: updatedWorkspace, message: null });
          return;
        }

        const { failedToEmbed = [], errors = [] } = await Document.addDocuments(
          currWorkspace,
          adds,
          response.locals?.user?.id
        );
        const updatedWorkspace = await Workspace.get({ id: currWorkspace.id });
        response.status(200).json({
          workspace: updatedWorkspace,
          message:
            failedToEmbed.length > 0
              ? `${failedToEmbed.length} documents failed to add.\n\n${errors
                  .map((msg: unknown) => `${msg}`)
                  .join("\n\n")}`
              : null,
        });
      } catch (e: unknown) {
        const err = e as Error;
        console.error(err.message, err);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/workspace/:slug/reset-vector-db",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
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

        await DocumentVectors.deleteForWorkspace(workspace.id);
        await Document.delete({ workspaceId: Number(workspace.id) });

        await EventLogs.logEvent(
          "workspace_vectors_reset",
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

  app.post(
    "/workspace/:slug/update-pin",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      validWorkspaceSlug,
    ],
    async (request: Record<string, any>, response: Record<string, any>) => {
      try {
        const { docPath, pinStatus = false } = reqBody(request);
        const workspace = response.locals.workspace;

        const document = await Document.get({
          workspaceId: workspace.id,
          docpath: docPath,
        });
        if (!document) return response.sendStatus(404).end();

        await Document.update(document.id, { pinned: pinStatus });
        return response.status(200).end();
      } catch (error) {
        console.error("Error processing the pin status update:", error);
        return response.status(500).end();
      }
    }
  );

  app.post(
    "/workspace/:slug/upload-and-embed",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      handleFileUpload,
    ],
    async function (
      request: Record<string, any>,
      response: Record<string, any>
    ) {
      try {
        const { slug = null } = request.params;
        const user = await userFromSession(request, response);
        const currWorkspace = multiUserMode(response)
          ? await Workspace.getWithUser(user, { slug })
          : await Workspace.get({ slug });

        if (!currWorkspace) {
          response.sendStatus(400).end();
          return;
        }

        const Collector = new CollectorApi();
        const { originalname } = request.file;
        const processingOnline = await Collector.online();

        if (!processingOnline) {
          response
            .status(500)
            .json({
              success: false,
              error: `Document processing API is not online. Document ${originalname} will not be processed automatically.`,
            })
            .end();
          return;
        }

        const { success, reason, documents } =
          await Collector.processDocument(originalname);
        if (!success || documents?.length === 0) {
          response.status(500).json({ success: false, error: reason }).end();
          return;
        }

        Collector.log(
          `Document ${originalname} uploaded processed and successfully. It is now available in documents.`
        );
        await EventLogs.logEvent(
          "document_uploaded",
          {
            documentName: originalname,
          },
          response.locals?.user?.id
        );

        const document = documents[0];
        const { failedToEmbed = [], errors = [] } = await Document.addDocuments(
          currWorkspace,
          [document.location],
          response.locals?.user?.id
        );

        if (failedToEmbed.length > 0) {
          return response
            .status(200)
            .json({ success: false, error: errors?.[0], document: null });
        }

        response.status(200).json({
          success: true,
          error: null,
          document: { id: document.id, location: document.location },
        });
      } catch (e: unknown) {
        const err = e as Error;
        console.error(err.message, err);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/workspace/:slug/remove-and-unembed",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      handleFileUpload,
    ],
    async function (
      request: Record<string, any>,
      response: Record<string, any>
    ) {
      try {
        const { slug = null } = request.params;
        const body = reqBody(request);
        const user = await userFromSession(request, response);
        const currWorkspace = multiUserMode(response)
          ? await Workspace.getWithUser(user, { slug })
          : await Workspace.get({ slug });

        if (!currWorkspace || !body.documentLocation)
          return response.sendStatus(400).end();

        await purgeDocument(body.documentLocation);
        response.status(200).end();
      } catch (e: unknown) {
        const err = e as Error;
        console.error(err.message, err);
        response.sendStatus(500).end();
      }
    }
  );

  app.get(
    "/workspace/:slug/embed-progress",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      validWorkspaceSlug,
    ],
    async (request: Record<string, any>, response: Record<string, any>) => {
      try {
        const workspace = response.locals.workspace;
        const {
          addSSEConnection,
          removeSSEConnection,
        } = require("../../utils/EmbeddingWorkerManager");

        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Content-Type", "text/event-stream");
        response.setHeader("Access-Control-Allow-Origin", "*");
        response.setHeader("Connection", "keep-alive");
        response.flushHeaders();
        addSSEConnection(workspace.slug, response);
        request.on("close", () => {
          removeSSEConnection(workspace.slug, response);
        });
      } catch (e: unknown) {
        const err = e as Error;
        console.error(err.message, err);
        response.status(500).end();
      }
    }
  );

  app.delete(
    "/workspace/:slug/embed-queue",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      validWorkspaceSlug,
    ],
    typedHandler(
      {
        body: deleteEmbedQueueBodySchema,
      },
      async (
        { body }: { body: { filename: string } },
        response: Record<string, any>
      ) => {
        try {
          const workspace = response.locals.workspace;
          const {
            removeQueuedFile,
          } = require("../../utils/EmbeddingWorkerManager");
          const sent = removeQueuedFile(workspace.slug, body.filename);
          response.status(200).json({ success: sent });
        } catch (e: unknown) {
          const err = e as Error;
          console.error(err.message, err);
          response.status(500).json({ success: false, error: err.message });
        }
      }
    )
  );
}

module.exports = { registerWorkspaceDocumentEndpoints };
