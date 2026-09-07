const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const sync = require("../config-sync");

function configSyncEndpoints(app) {
  const middleware = [validatedRequest, flexUserRoleValid([ROLES.admin])];
  app.get("/admin/config-sync", middleware, (_request, response) =>
    response.json(sync.status())
  );
  app.get(
    "/admin/config-sync/detail",
    middleware,
    async (request, response) => {
      try {
        response.json(await sync.detail(request.query.key));
      } catch (error) {
        response.status(400).json({ error: error.message });
      }
    }
  );
  app.post(
    "/admin/config-sync/reconcile",
    middleware,
    async (_request, response) => {
      try {
        response.json(await sync.reconcile());
      } catch (error) {
        response.status(400).json({ error: error.message });
      }
    }
  );
  app.post(
    "/admin/config-sync/resolve",
    middleware,
    async (request, response) => {
      try {
        const { key, side, fileHash, databaseHash } = request.body || {};
        if (!sync.enabled()) throw new Error("尚未启用配置同步。");
        require("../config-sync/files").validKey(key);
        if (!["file", "database"].includes(side))
          throw new Error("请选择文件版本或数据库版本。");
        const result = await sync.reconcile({
          key,
          side,
          fileHash,
          databaseHash,
        });
        const item = result.items.find((entry) => entry.key === key);
        if (item?.status === "error")
          return response.status(409).json({ error: item.error });
        response.json(result);
      } catch (error) {
        response.status(400).json({ error: error.message });
      }
    }
  );
}

module.exports = { configSyncEndpoints };
