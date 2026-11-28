const { z } = require("zod");
const { reqBody, userFromSession } = require("../../utils/http");
const { typedHandler } = require("../../utils/http/typedHandler.ts");
const { SlashCommandPresets } = require("../../models/slashCommandsPresets");
const { SystemPromptVariables } = require("../../models/systemPromptVariables");
const { VALID_COMMANDS } = require("../../utils/chats");
const { validatedRequest } = require("../../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../../utils/middleware/multiUserProtected");

const promptVariableBodySchema = z.object({
  key: z.string().min(1, "Key and value are required"),
  value: z.string().min(1, "Key and value are required"),
  description: z.string().nullable().optional().default(null),
});

function registerSystemPresetEndpoints(app: Record<string, any>) {
  app.get(
    "/system/slash-command-presets",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (_request: any, response: any) => {
      try {
        const presets = await SlashCommandPresets.getGlobalPresets();
        response.status(200).json({ presets });
      } catch (error) {
        console.error("Error fetching slash command presets:", error);
        response.status(500).json({ message: "Internal server error" });
      }
    }
  );

  app.post(
    "/system/slash-command-presets",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request: any, response: any) => {
      try {
        const { command, prompt, description } = reqBody(request);
        const formattedCommand = SlashCommandPresets.formatCommand(
          String(command)
        );

        if (Object.keys(VALID_COMMANDS).includes(formattedCommand)) {
          return response.status(400).json({
            message:
              "Cannot create a preset with a command that matches a system command",
          });
        }

        const presetData = {
          command: formattedCommand,
          prompt: String(prompt),
          description: String(description),
        };

        const preset = await SlashCommandPresets.create(null, presetData);
        if (!preset) {
          return response
            .status(500)
            .json({ message: "Failed to create preset" });
        }
        response.status(201).json({ preset });
      } catch (error) {
        console.error("Error creating slash command preset:", error);
        response.status(500).json({ message: "Internal server error" });
      }
    }
  );

  app.post(
    "/system/slash-command-presets/display-order",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request: any, response: any) => {
      try {
        await require("../../models/displayOrder").DisplayOrder.save(
          "commands",
          reqBody(request).ids
        );
        return response.json({ success: true });
      } catch (error) {
        return response
          .status(400)
          .json({ success: false, error: (error as Error).message });
      }
    }
  );

  app.post(
    "/system/slash-command-presets/:slashCommandId",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request: any, response: any) => {
      try {
        const { slashCommandId } = request.params;
        const { command, prompt, description } = reqBody(request);
        const formattedCommand = SlashCommandPresets.formatCommand(
          String(command)
        );

        if (Object.keys(VALID_COMMANDS).includes(formattedCommand)) {
          return response.status(400).json({
            message:
              "Cannot update a preset to use a command that matches a system command",
          });
        }

        const globalPreset = await SlashCommandPresets.get({
          uid: 0,
          id: Number(slashCommandId),
        });
        if (!globalPreset)
          return response.status(404).json({ message: "Preset not found" });

        const updates = {
          command: formattedCommand,
          prompt: String(prompt),
          description: String(description),
        };

        const preset = await SlashCommandPresets.update(
          Number(slashCommandId),
          updates
        );
        if (!preset) return response.sendStatus(422);
        response.status(200).json({ preset: { ...globalPreset, ...updates } });
      } catch (error) {
        console.error("Error updating slash command preset:", error);
        response.status(500).json({ message: "Internal server error" });
      }
    }
  );

  app.delete(
    "/system/slash-command-presets/:slashCommandId",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request: any, response: any) => {
      try {
        const { slashCommandId } = request.params;
        const globalPreset = await SlashCommandPresets.get({
          uid: 0,
          id: Number(slashCommandId),
        });
        if (!globalPreset)
          return response
            .status(403)
            .json({ message: "Failed to delete preset" });

        await SlashCommandPresets.delete(Number(slashCommandId));
        response.sendStatus(204);
      } catch (error) {
        console.error("Error deleting slash command preset:", error);
        response.status(500).json({ message: "Internal server error" });
      }
    }
  );

  app.get(
    "/system/prompt-variables",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request: any, response: any) => {
      try {
        const user = await userFromSession(request, response);
        const variables = await SystemPromptVariables.getAll(user?.id);
        response.status(200).json({ variables });
      } catch (error) {
        console.error("Error fetching system prompt variables:", error);
        response.status(500).json({
          success: false,
          error: `Failed to fetch system prompt variables: ${(error as Error).message}`,
        });
      }
    }
  );

  app.post(
    "/system/prompt-variables",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    typedHandler(
      { body: promptVariableBodySchema },
      async (
        {
          raw: request,
          body: { key, value, description },
        }: {
          raw: any;
          body: { key: string; value: string; description: string | null };
        },
        response: any
      ) => {
        try {
          const user = await userFromSession(request, response);
          const variable = await SystemPromptVariables.create({
            key,
            value,
            description,
            userId: user?.id || null,
          });

          response.status(200).json({
            success: true,
            variable,
          });
        } catch (error) {
          console.error("Error creating system prompt variable:", error);
          response.status(500).json({
            success: false,
            error: `Failed to create system prompt variable: ${(error as Error).message}`,
          });
        }
      }
    )
  );

  app.put(
    "/system/prompt-variables/:id",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    typedHandler(
      { body: promptVariableBodySchema },
      async (
        {
          params: { id },
          body: { key, value, description },
        }: {
          params: { id: string };
          body: { key: string; value: string; description: string | null };
        },
        response: any
      ) => {
        try {
          const variable = await SystemPromptVariables.update(Number(id), {
            key,
            value,
            description,
          });

          if (!variable) {
            return response.status(404).json({
              success: false,
              error: "Variable not found",
            });
          }

          response.status(200).json({
            success: true,
            variable,
          });
        } catch (error) {
          console.error("Error updating system prompt variable:", error);
          response.status(500).json({
            success: false,
            error: `Failed to update system prompt variable: ${(error as Error).message}`,
          });
        }
      }
    )
  );

  app.delete(
    "/system/prompt-variables/:id",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request: any, response: any) => {
      try {
        const { id } = request.params;
        const success = await SystemPromptVariables.delete(Number(id));

        if (!success) {
          return response.status(404).json({
            success: false,
            error: "System prompt variable not found or could not be deleted",
          });
        }

        response.status(200).json({
          success: true,
        });
      } catch (error) {
        console.error("Error deleting system prompt variable:", error);
        response.status(500).json({
          success: false,
          error: `Failed to delete system prompt variable: ${(error as Error).message}`,
        });
      }
    }
  );
}

module.exports = { registerSystemPresetEndpoints };
