const {
  meetingCatalog,
  meetingWorkbook,
  meetingError,
} = require("../contracts/meetingLists.mts");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const catalog = require("../utils/threeGppCatalog");
const { downloadMeetingList } = require("../utils/threeGppMeetingList");
const { createCatalog } = require("../utils/globalReferenceCatalog");

function threeGppCatalogEndpoints(app) {
  const { resolveProtocol } = require("../utils/protocolFinder");
  app.get(
    "/3gpp/protocol-finder",
    [validatedRequest, flexUserRoleValid(ROLES.all)],
    async (req, res) => {
      try {
        res
          .set("Cache-Control", "no-store")
          .json(await resolveProtocol(req.query));
      } catch (error) {
        res.status(error.status || 502).json({
          error: error.publicMessage || "暂时无法读取 ETSI 目录，请稍后重试。",
        });
      }
    }
  );
  for (const path of ["/3gpp/meeting-lists", "/3gpp/meeting-list"]) {
    app.get(
      path,
      [validatedRequest, flexUserRoleValid(ROLES.all)],
      async (request, response) => {
        const { group, meeting } = request.query;
        if (
          typeof group !== "string" ||
          !catalog.GROUPS.includes(group) ||
          (path.endsWith("meeting-list") &&
            (typeof meeting !== "string" ||
              meeting.length > 200 ||
              !meeting.trim() ||
              [...meeting].some(
                (character) =>
                  character.charCodeAt(0) < 32 ||
                  character === "/" ||
                  character === "\\"
              )))
        )
          return response
            .status(400)
            .json(meetingError.parse({ error: "请选择有效的工作组和会议。" }));
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60000);
        const close = () => controller.abort();
        response.on("close", close);
        try {
          const cancelled = new Promise((_, reject) => {
            controller.signal.addEventListener(
              "abort",
              () => reject(new Error("request_cancelled")),
              { once: true }
            );
          });
          const lookup = path.endsWith("meeting-lists")
            ? catalog
                .meetings(group)
                .then((data) => ({ ...data, groups: catalog.GROUPS }))
            : downloadMeetingList(group, meeting, controller.signal);
          const data = await Promise.race([lookup, cancelled]);
          response.set("Cache-Control", "no-store");
          const schema = path.endsWith("meeting-lists")
            ? meetingCatalog
            : meetingWorkbook;
          return response.json(schema.parse(data));
        } catch (error) {
          if (response.destroyed) return;
          console.warn("[3GPP meeting list]", error.message);
          return response.status(502).json(
            meetingError.parse({
              error:
                "暂时无法下载官方清单。请稍后重试，或手动上传 Excel 清单。",
            })
          );
        } finally {
          clearTimeout(timer);
          response.off("close", close);
        }
      }
    );
  }
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
