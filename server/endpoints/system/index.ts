process.env.NODE_ENV === "development"
  ? require("dotenv").config({ path: `.env.${process.env.NODE_ENV}` })
  : require("dotenv").config();

const { updateENV, dumpENV } = require("../../utils/helpers/updateENV");
const { reqBody } = require("../../utils/http");
const { SystemSettings } = require("../../models/systemSettings");
const { validatedRequest } = require("../../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../../utils/middleware/multiUserProtected");
const { registerSystemAuthEndpoints } = require("./auth.ts");
const { registerSystemAssetEndpoints } = require("./assets.ts");
const { registerSystemDocumentEndpoints } = require("./documents.ts");
const { registerSystemLogsAndKeysEndpoints } = require("./logsAndKeys.ts");
const { registerSystemPresetEndpoints } = require("./presets.ts");

function systemEndpoints(app: Record<string, any>) {
  if (!app) return;

  app.get("/ping", (_: any, response: any) => {
    response.status(200).json({ online: true });
  });

  app.get("/migrate", async (_: any, response: any) => {
    response.sendStatus(200);
  });

  app.get("/env-dump", async (_: any, response: any) => {
    if (process.env.NODE_ENV !== "production")
      return response.sendStatus(200).end();
    dumpENV();
    response.sendStatus(200).end();
  });

  app.get("/onboarding", async (_: any, response: any) => {
    try {
      const results = await SystemSettings.isOnboardingComplete();
      response.status(200).json({ onboardingComplete: results });
    } catch (e) {
      console.error((e as Error).message, e);
      response.sendStatus(500).end();
    }
  });

  app.post("/onboarding", [validatedRequest], async (_: any, response: any) => {
    try {
      const completed = await SystemSettings.markOnboardingComplete();
      response.sendStatus(completed ? 200 : 500).end();
    } catch (e) {
      console.error((e as Error).message, e);
      response.sendStatus(500).end();
    }
  });

  app.get("/setup-complete", async (_: any, response: any) => {
    try {
      const results = await SystemSettings.currentSettings();
      response.status(200).json({ results });
    } catch (e) {
      console.error((e as Error).message, e);
      response.sendStatus(500).end();
    }
  });

  app.post(
    "/system/update-env",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request: any, response: any) => {
      try {
        const body = reqBody(request);
        const { newValues, error } = await updateENV(
          body,
          false,
          response?.locals?.user?.id
        );
        response.status(200).json({ newValues, error });
      } catch (e) {
        console.error((e as Error).message, e);
        response.sendStatus(500).end();
      }
    }
  );

  registerSystemAuthEndpoints(app);
  registerSystemDocumentEndpoints(app);
  registerSystemAssetEndpoints(app);
  registerSystemLogsAndKeysEndpoints(app);
  registerSystemPresetEndpoints(app);
}

module.exports = { systemEndpoints };
