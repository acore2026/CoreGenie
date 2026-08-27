const { EventLogs } = require("../models/eventLogs");
const { Invite } = require("../models/invite");
const { User } = require("../models/user");
const { reqBody, userFromSession } = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  simpleSSOLoginDisabledMiddleware,
} = require("../utils/middleware/simpleSSOEnabled");
const {
  publicRegistrationRateLimit,
} = require("../utils/middleware/publicRegistrationRateLimit");

function inviteEndpoints(app) {
  if (!app) return;

  app.get("/invite/:code", async (request, response) => {
    try {
      const { code } = request.params;
      const invite = await Invite.get({ code });
      if (!invite) {
        response.status(200).json({ invite: null, error: "Invite not found." });
        return;
      }

      if (!Invite.isActive(invite)) {
        response
          .status(200)
          .json({ invite: null, error: "Invite is no longer valid." });
        return;
      }

      const workspaces = await Invite.workspaceDetails(invite);
      response.status(200).json({
        invite: { code, status: "pending", workspaces },
        error: null,
      });
    } catch (e) {
      console.error(e);
      response.sendStatus(500).end();
    }
  });

  app.post(
    "/invite/:code",
    [simpleSSOLoginDisabledMiddleware, publicRegistrationRateLimit],
    async (request, response) => {
      try {
        const { code } = request.params;
        const { username, password } = reqBody(request);
        const invite = await Invite.get({ code });
        if (!Invite.isActive(invite)) {
          response
            .status(200)
            .json({ success: false, error: "Invite not found or is invalid." });
          return;
        }

        const { user, error } = await User.create({
          username,
          password,
          role: "default",
        });
        if (!user) {
          console.error("Accepting invite:", error);
          response.status(200).json({ success: false, error });
          return;
        }

        const assignment = await Invite.applyToUser(invite.id, user);
        if (!assignment.success) {
          await User.delete({ id: user.id });
          response.status(200).json({
            success: false,
            error: assignment.error || "Invite is no longer valid.",
          });
          return;
        }
        await EventLogs.logEvent(
          "invite_accepted",
          {
            username: user.username,
          },
          user.id
        );

        response.status(200).json({
          success: true,
          workspaces: await Invite.workspaceDetails(invite),
          error: null,
        });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/invite/:code/join",
    [validatedRequest],
    async (request, response) => {
      try {
        const { code } = request.params;
        const invite = await Invite.get({ code });
        if (!Invite.isActive(invite)) {
          response.status(200).json({
            success: false,
            error: "Invite not found or is invalid.",
          });
          return;
        }

        const user = await userFromSession(request, response);
        if (!user) {
          response.status(401).json({
            success: false,
            error: "Sign in before joining this workspace.",
          });
          return;
        }

        const assignment = await Invite.applyToUser(invite.id, user);
        if (!assignment.success) {
          response.status(200).json(assignment);
          return;
        }

        const workspaces = await Invite.workspaceDetails(invite);
        await EventLogs.logEvent(
          "workspace_invite_joined",
          {
            username: user.username,
            workspaceIds: workspaces.map(({ id }) => id),
          },
          user.id
        );
        response.status(200).json({ success: true, workspaces, error: null });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );
}

module.exports = { inviteEndpoints };
