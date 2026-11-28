const { v4 } = require("uuid");
const { updateENV } = require("../../utils/helpers/updateENV");
const {
  reqBody,
  makeJWT,
  userFromSession,
  multiUserMode,
} = require("../../utils/http");
const { SystemSettings } = require("../../models/systemSettings");
const { User } = require("../../models/user");
const { validatedRequest } = require("../../utils/middleware/validatedRequest");
const { WorkspaceChats } = require("../../models/workspaceChats");
const {
  flexUserRoleValid,
  ROLES,
  isMultiUserSetup,
} = require("../../utils/middleware/multiUserProtected");
const { EventLogs } = require("../../models/eventLogs");
const {
  recoverAccount,
  resetPassword,
  generateRecoveryCodes,
} = require("../../utils/PasswordRecovery");
const { SlashCommandPresets } = require("../../models/slashCommandsPresets");
const { EncryptionManager } = require("../../utils/EncryptionManager");
const {
  simpleSSOEnabled,
  simpleSSOLoginDisabled,
  simpleSSOLoginDisabledMiddleware,
} = require("../../utils/middleware/simpleSSOEnabled");
const {
  publicRegistrationRateLimit,
} = require("../../utils/middleware/publicRegistrationRateLimit");
const { TemporaryAuthToken } = require("../../models/temporaryAuthToken");
const { AgentSkillWhitelist } = require("../../models/agentSkillWhitelist");
const { Memory } = require("../../models/memory");

function registerSystemAuthEndpoints(app: Record<string, any>) {
  app.get(
    "/system/check-token",
    [validatedRequest],
    async (request: any, response: any) => {
      try {
        if (multiUserMode(response)) {
          const user = await userFromSession(request, response);
          if (!user || user.suspended) {
            response.sendStatus(403).end();
            return;
          }

          response.sendStatus(200).end();
          return;
        }

        response.sendStatus(200).end();
      } catch (e) {
        console.error((e as Error).message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.get(
    "/system/refresh-user",
    [validatedRequest],
    async (request: any, response: any) => {
      try {
        if (!multiUserMode(response))
          return response
            .status(200)
            .json({ success: true, user: null, message: null });

        const user = await userFromSession(request, response);
        if (!user)
          return response.status(200).json({
            success: false,
            user: null,
            message: "Session expired or invalid.",
          });

        if (user.suspended)
          return response.status(200).json({
            success: false,
            user: null,
            message: "User is suspended.",
          });

        return response.status(200).json({
          success: true,
          user: User.filterFields(user),
          message: null,
        });
      } catch (e) {
        return response.status(500).json({
          success: false,
          user: null,
          message: (e as Error).message,
        });
      }
    }
  );

  app.post("/request-token", async (request: any, response: any) => {
    try {
      const bcrypt = require("bcryptjs");

      if (await SystemSettings.isMultiUserMode()) {
        if (simpleSSOLoginDisabled()) {
          response.status(403).json({
            user: null,
            valid: false,
            token: null,
            message:
              "[005] Login via credentials has been disabled by the administrator.",
          });
          return;
        }

        const { username, password } = reqBody(request);
        const existingUser = await User._get({ username: String(username) });

        if (!existingUser) {
          await EventLogs.logEvent(
            "failed_login_invalid_username",
            {
              ip: request.ip || "Unknown IP",
              username: username || "Unknown user",
            },
            existingUser?.id
          );
          response.status(200).json({
            user: null,
            valid: false,
            token: null,
            message: "[001] Invalid login credentials.",
          });
          return;
        }

        if (!bcrypt.compareSync(String(password), existingUser.password)) {
          await EventLogs.logEvent(
            "failed_login_invalid_password",
            {
              ip: request.ip || "Unknown IP",
              username: username || "Unknown user",
            },
            existingUser?.id
          );
          response.status(200).json({
            user: null,
            valid: false,
            token: null,
            message: "[002] Invalid login credentials.",
          });
          return;
        }

        if (existingUser.suspended) {
          await EventLogs.logEvent(
            "failed_login_account_suspended",
            {
              ip: request.ip || "Unknown IP",
              username: username || "Unknown user",
            },
            existingUser?.id
          );
          response.status(200).json({
            user: null,
            valid: false,
            token: null,
            message: "[004] Account suspended by admin.",
          });
          return;
        }

        await EventLogs.logEvent(
          "login_event",
          {
            ip: request.ip || "Unknown IP",
            username: existingUser.username || "Unknown user",
          },
          existingUser?.id
        );

        const sessionToken = makeJWT(
          { id: existingUser.id, username: existingUser.username },
          process.env.JWT_EXPIRY
        );
        if (!existingUser.seen_recovery_codes) {
          const plainTextCodes = await generateRecoveryCodes(existingUser.id);
          response.status(200).json({
            valid: true,
            user: User.filterFields(existingUser),
            token: sessionToken,
            message: null,
            recoveryCodes: plainTextCodes,
          });
          return;
        }

        response.status(200).json({
          valid: true,
          user: User.filterFields(existingUser),
          token: sessionToken,
          message: null,
        });
        return;
      } else {
        const { password } = reqBody(request);
        if (
          !bcrypt.compareSync(
            password,
            bcrypt.hashSync(process.env.AUTH_TOKEN, 10)
          )
        ) {
          await EventLogs.logEvent("failed_login_invalid_password", {
            ip: request.ip || "Unknown IP",
            multiUserMode: false,
          });
          response.status(401).json({
            valid: false,
            token: null,
            message: "[003] Invalid password provided",
          });
          return;
        }

        await EventLogs.logEvent("login_event", {
          ip: request.ip || "Unknown IP",
          multiUserMode: false,
        });
        response.status(200).json({
          valid: true,
          token: makeJWT(
            { p: new EncryptionManager().encrypt(password) },
            process.env.JWT_EXPIRY
          ),
          message: null,
        });
      }
    } catch (e) {
      console.error((e as Error).message, e);
      response.sendStatus(500).end();
    }
  });

  app.get("/system/public-registration", async (_: any, response: any) => {
    try {
      const enabled =
        !simpleSSOLoginDisabled() &&
        (await SystemSettings.publicRegistrationEnabled());
      response.status(200).json({ enabled });
    } catch (e) {
      console.error((e as Error).message, e);
      response.status(200).json({ enabled: false });
    }
  });

  app.post(
    "/system/register",
    [simpleSSOLoginDisabledMiddleware, publicRegistrationRateLimit],
    async (request: any, response: any) => {
      try {
        if (!(await SystemSettings.publicRegistrationEnabled())) {
          response.status(403).json({
            success: false,
            error: "Public registration is disabled.",
          });
          return;
        }

        const { username, password, confirmPassword } = reqBody(request);
        if (String(password || "") !== String(confirmPassword || "")) {
          response.status(400).json({
            success: false,
            error: "Passwords do not match.",
          });
          return;
        }

        const { user, error } = await User.create({
          username,
          password,
          role: ROLES.default,
        });
        if (!user) {
          response.status(400).json({ success: false, error });
          return;
        }

        await EventLogs.logEvent(
          "public_user_registered",
          {
            ip: request.ip || "Unknown IP",
            username: user.username,
          },
          user.id
        );
        response.status(201).json({ success: true, error: null });
      } catch (e) {
        console.error((e as Error).message, e);
        response.status(500).json({
          success: false,
          error: "Registration failed. Please try again.",
        });
      }
    }
  );

  app.post(
    "/system/public-registration",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request: any, response: any) => {
      try {
        if (!multiUserMode(response)) {
          response.status(400).json({
            success: false,
            error: "Multi-user mode must be enabled.",
          });
          return;
        }

        const { enabled } = reqBody(request);
        const registrationEnabled =
          enabled === true || String(enabled) === "true";
        const { success, error } = await SystemSettings.updateSettings({
          public_registration_enabled: registrationEnabled,
        });
        await EventLogs.logEvent(
          "public_registration_updated",
          { enabled: registrationEnabled },
          response.locals?.user?.id
        );
        response.status(success ? 200 : 500).json({ success, error });
      } catch (e) {
        console.error((e as Error).message, e);
        response
          .status(500)
          .json({ success: false, error: (e as Error).message });
      }
    }
  );

  app.get(
    "/request-token/sso/simple",
    [simpleSSOEnabled],
    async (request: any, response: any) => {
      const { token: tempAuthToken } = request.query;
      const { sessionToken, token, error } =
        await TemporaryAuthToken.validate(tempAuthToken);

      if (error) {
        await EventLogs.logEvent("failed_login_invalid_temporary_auth_token", {
          ip: request.ip || "Unknown IP",
          multiUserMode: true,
        });
        return response.status(401).json({
          valid: false,
          token: null,
          message: `[001] An error occurred while validating the token: ${error}`,
        });
      }

      await EventLogs.logEvent(
        "login_event",
        {
          ip: request.ip || "Unknown IP",
          username: token.user.username || "Unknown user",
        },
        token.user.id
      );

      response.status(200).json({
        valid: true,
        user: User.filterFields(token.user),
        token: sessionToken,
        message: null,
      });
    }
  );

  app.post(
    "/system/recover-account",
    [isMultiUserSetup],
    async (request: any, response: any) => {
      try {
        const { username, recoveryCodes } = reqBody(request);
        const { success, resetToken, error } = await recoverAccount(
          username,
          recoveryCodes
        );

        if (success) {
          response.status(200).json({ success, resetToken });
        } else {
          response.status(400).json({ success, message: error });
        }
      } catch (error) {
        console.error("Error recovering account:", error);
        response
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    }
  );

  app.post(
    "/system/reset-password",
    [isMultiUserSetup],
    async (request: any, response: any) => {
      try {
        const { token, newPassword, confirmPassword } = reqBody(request);
        const { success, message, error } = await resetPassword(
          token,
          newPassword,
          confirmPassword
        );

        if (success) {
          response.status(200).json({ success, message });
        } else {
          response.status(400).json({ success, error });
        }
      } catch (error) {
        console.error("Error resetting password:", error);
        response
          .status(500)
          .json({ success: false, message: (error as Error).message });
      }
    }
  );

  app.post(
    "/system/update-password",
    [validatedRequest],
    async (request: any, response: any) => {
      try {
        if (multiUserMode(response)) {
          response.sendStatus(401).end();
          return;
        }

        let error = null;
        const { usePassword, newPassword } = reqBody(request);
        if (!usePassword) {
          process.env.AUTH_TOKEN = "";
          process.env.JWT_SECRET = "";
        } else {
          const updated = await updateENV(
            {
              AuthToken: newPassword,
              JWTSecret: v4(),
            },
            true
          );
          error = updated?.error;
        }
        response.status(200).json({ success: !error, error });
      } catch (e) {
        console.error((e as Error).message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/system/enable-multi-user",
    [validatedRequest],
    async (request: any, response: any) => {
      try {
        if (response.locals.multiUserMode) {
          response.status(200).json({
            success: false,
            error: "Multi-user mode is already enabled.",
          });
          return;
        }

        const { username, password } = reqBody(request);
        const { user, error } = await User.create({
          username,
          password,
          role: ROLES.admin,
        });

        if (error || !user) {
          response.status(400).json({
            success: false,
            error: error || "Failed to enable multi-user mode.",
          });
          return;
        }

        await SystemSettings._updateSettings({
          multi_user_mode: true,
        });
        await Memory.migrateToMultiUser(user.id);
        await WorkspaceChats.migrateToMultiUser(user.id);
        await SlashCommandPresets.migrateToMultiUser(user.id);
        await AgentSkillWhitelist.clearSingleUserWhitelist();
        await updateENV(
          {
            JWTSecret: process.env.JWT_SECRET || v4(),
          },
          true
        );
        await EventLogs.logEvent("multi_user_mode_enabled", {}, user?.id);
        response.status(200).json({ success: !!user, error });
      } catch (e) {
        await User.delete({});
        await SystemSettings._updateSettings({
          multi_user_mode: false,
        });

        console.error((e as Error).message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.get("/system/multi-user-mode", async (_: any, response: any) => {
    try {
      const isMultiUser = await SystemSettings.isMultiUserMode();
      response.status(200).json({ multiUserMode: isMultiUser });
    } catch (e) {
      console.error((e as Error).message, e);
      response.sendStatus(500).end();
    }
  });

  app.post(
    "/system/user",
    [validatedRequest],
    async (request: any, response: any) => {
      try {
        const sessionUser = await userFromSession(request, response);
        const { username, password, bio, systemPrompt } = reqBody(request);
        const id = Number(sessionUser.id);

        if (!id) {
          response
            .status(400)
            .json({ success: false, error: "Invalid user ID" });
          return;
        }

        const updates: Record<string, string> = {};
        if (username !== undefined && username !== sessionUser.username)
          updates.username = User.validations.username(String(username));
        if (password) updates.password = String(password);
        if (bio !== undefined) updates.bio = String(bio);
        if (systemPrompt !== undefined)
          updates.systemPrompt = String(systemPrompt);

        if (Object.keys(updates).length === 0) {
          response
            .status(400)
            .json({ success: false, error: "No updates provided" });
          return;
        }

        const { success, error } = await User.update(id, updates);
        response.status(200).json({ success, error });
      } catch (e) {
        console.error(e);
        response.status(500).json({
          success: false,
          error: (e as Error).message || "Internal server error",
        });
      }
    }
  );
}

module.exports = { registerSystemAuthEndpoints };
