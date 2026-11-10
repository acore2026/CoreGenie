const { validatedRequest } = require("../utils/middleware/validatedRequest");
const { userFromSession, reqBody } = require("../utils/http");
const { SidebarPreferences } = require("../models/sidebarPreferences");
const { GlobalWorkspaceGroups } = require("../models/globalWorkspaceGroups");

function sidebarPreferenceEndpoints(app) {
  for (const method of ["get", "post", "put"]) {
    app[method](
      "/user/sidebar-preferences",
      [validatedRequest],
      async (request, response) => {
        response.set("Cache-Control", "no-store");
        try {
          const user = await userFromSession(request, response);
          if (response.locals.multiUserMode && !user?.id)
            return response.sendStatus(401);
          const body = method === "get" ? null : reqBody(request);
          if (method === "put" && body?.type === "global-group") {
            if (response.locals.multiUserMode && user?.role !== "admin")
              return response.sendStatus(403);
            await GlobalWorkspaceGroups.change(user?.id, body);
            return response.json({
              preferences: await SidebarPreferences.get(user?.id),
              globalGroups: (await GlobalWorkspaceGroups.read()).groups,
            });
          }
          const preferences =
            method === "get"
              ? await SidebarPreferences.get(user?.id)
              : method === "post"
                ? await SidebarPreferences.initialize(
                    user?.id,
                    reqBody(request)
                  )
                : await SidebarPreferences.change(user?.id, reqBody(request));
          return response.json({
            preferences,
            globalGroups: (await GlobalWorkspaceGroups.read()).groups,
          });
        } catch {
          return response
            .status(400)
            .json({ error: "分组和收藏未能同步，请稍后重试。" });
        }
      }
    );
  }
}
module.exports = { sidebarPreferenceEndpoints };
