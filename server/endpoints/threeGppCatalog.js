const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const catalog = require("../utils/threeGppCatalog");
const { createCatalog } = require("../utils/globalReferenceCatalog");

function threeGppCatalogEndpoints(app) {
  app.get(
    "/3gpp/catalog",
    [validatedRequest, flexUserRoleValid(ROLES.all)],
    async (request, response) => {
      const { group, meeting } = request.query;
      if (
        typeof group !== "string" ||
        !catalog.GROUPS.includes(group) ||
        (meeting !== undefined &&
          (typeof meeting !== "string" ||
            meeting.length > 200 ||
            !/^[\w. -]+$/.test(meeting)))
      )
        return response
          .status(400)
          .json({ error: "请选择有效的工作组和会议。" });
      try {
        const data = await createCatalog().read(group, meeting);
        return response.json(data);
      } catch (error) {
        console.warn("[3GPP catalog]", error.message);
        return response.status(502).json({
          error: "暂时无法读取 3GPP 官方资料，请稍后重试，也可以手动填写。",
        });
      }
    }
  );
}
module.exports = { threeGppCatalogEndpoints };
