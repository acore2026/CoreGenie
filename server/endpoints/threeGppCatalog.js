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
const {
  listOfficialBaselineVersions,
  downloadOfficialBaselineDocx,
} = require("../utils/threeGppBaselineSpec");
const { createCatalog } = require("../utils/globalReferenceCatalog");
const multer = require("multer");
const { reqBody } = require("../utils/http");
const docAssistant = require("../utils/threeGppDocAssistant");

const batchExcelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function createAbortGuard(res, timeoutMs = 90_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
    if (res.headersSent && !res.writableEnded && !res.destroyed)
      res.end(JSON.stringify({ error: "查询超时，请缩小范围后重试。" }) + "\n");
    else if (!res.destroyed && !res.headersSent)
      res.status(504).json({ error: "查询超时，请缩小范围后重试。" });
  }, timeoutMs);
  const onClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on("close", onClose);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      res.off("close", onClose);
    },
  };
}

function threeGppCatalogEndpoints(app) {
  const {
    resolveProtocol,
    convertProtocolMember,
    getProtocolMemberStatus,
  } = require("../utils/protocolFinder");
  const {
    verifySignedPdf,
    startCacheMaintenance,
  } = require("../utils/protocolFinderPdf");
  startCacheMaintenance();

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
          error:
            error.publicMessage ||
            "暂时无法读取 ETSI 或 3GPP 目录，请稍后重试。",
        });
      }
    }
  );

  app.post(
    "/3gpp/protocol-finder/convert",
    [validatedRequest, flexUserRoleValid(ROLES.all)],
    async (req, res) => {
      try {
        const body = reqBody(req);
        const params =
          body && typeof body === "object" && Object.keys(body).length
            ? body
            : req.query;
        res
          .set("Cache-Control", "no-store")
          .json(await convertProtocolMember(params));
      } catch (error) {
        res.status(error.status || 502).json({
          error:
            error.publicMessage ||
            "暂时无法启动 Word 转 PDF 任务，请稍后重试。",
        });
      }
    }
  );

  app.get(
    "/3gpp/protocol-finder/convert",
    [validatedRequest, flexUserRoleValid(ROLES.all)],
    async (req, res) => {
      try {
        res
          .set("Cache-Control", "no-store")
          .json(await getProtocolMemberStatus(req.query));
      } catch (error) {
        res.status(error.status || 502).json({
          error: error.publicMessage || "暂时无法查询转换进度，请稍后重试。",
        });
      }
    }
  );

  app.get("/3gpp/protocol-finder/pdf/:hash", async (req, res) => {
    try {
      const { filePath, filename } = await verifySignedPdf({
        hash: req.params.hash,
        name: req.query.name,
        exp: req.query.exp,
        sig: req.query.sig,
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
      );
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, max-age=1800");
      return res.sendFile(filePath);
    } catch (error) {
      return res
        .status(error.status || 404)
        .type("text/plain; charset=utf-8")
        .send(
          error.publicMessage || "PDF 预览链接已失效，请返回页面重新打开。"
        );
    }
  });
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
    "/3gpp/baseline-spec",
    [validatedRequest, flexUserRoleValid(ROLES.all)],
    async (request, response) => {
      const { spec, release, version, mode } = request.query;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 70000);
      const close = () => controller.abort();
      response.on("close", close);
      try {
        const result =
          mode === "list"
            ? await listOfficialBaselineVersions(spec, release, {
                signal: controller.signal,
              })
            : await downloadOfficialBaselineDocx(spec, release, version, {
                signal: controller.signal,
              });
        if (response.destroyed) return;
        response.set("Cache-Control", "no-store");
        return response.json(result);
      } catch (error) {
        if (response.destroyed) return;
        console.warn("[3GPP baseline spec]", error.message);
        return response.status(error.status || 502).json({
          error:
            error.publicMessage ||
            "暂时无法从 3GPP 官方归档下载基线规范，请稍后重试或手动上传。",
        });
      } finally {
        clearTimeout(timer);
        response.off("close", close);
      }
    }
  );
  app.get(
    "/3gpp/doc-assistant/config",
    [validatedRequest, flexUserRoleValid(ROLES.all)],
    (_req, res) => {
      res
        .set("Cache-Control", "no-store")
        .json(docAssistant.getAssistantConfig());
    }
  );

  app.get(
    "/3gpp/doc-assistant/lookup",
    [validatedRequest, flexUserRoleValid(ROLES.all)],
    async (req, res) => {
      const guard = createAbortGuard(res, 90_000);
      const stream =
        req.accepts(["json", "application/x-ndjson"]) ===
        "application/x-ndjson";
      const send = (event) => {
        if (res.destroyed || res.writableEnded) return;
        if (!res.headersSent)
          res.set("Cache-Control", "no-store").type("application/x-ndjson");
        res.write(JSON.stringify(event) + "\n");
      };
      try {
        const result = await docAssistant.lookupDocument({
          q: req.query.q,
          hint: req.query.hint,
          refresh: req.query.refresh,
          signal: guard.signal,
          onProgress: stream ? (progress) => send({ progress }) : undefined,
        });
        if (res.destroyed || res.writableEnded) return;
        if (stream) {
          send({ result });
          res.end();
        } else res.set("Cache-Control", "no-store").json(result);
      } catch (error) {
        if (res.destroyed || res.writableEnded) return;
        const message =
          error.publicMessage || "暂时无法读取官方资料，请稍后重试。";
        if (stream && res.headersSent) {
          send({ error: message });
          res.end();
        } else res.status(error.status || 502).json({ error: message });
      } finally {
        guard.cleanup();
      }
    }
  );

  app.get(
    "/3gpp/doc-assistant/meetings",
    [validatedRequest, flexUserRoleValid(ROLES.all)],
    async (req, res) => {
      const guard = createAbortGuard(res, 45_000);
      try {
        const result = await docAssistant.listWgMeetings({
          group: req.query.group,
          refresh: req.query.refresh === "1",
          signal: guard.signal,
        });
        if (res.destroyed || res.headersSent) return;
        res.set("Cache-Control", "no-store").json(result);
      } catch (error) {
        if (res.destroyed || res.headersSent || error.status === 499) return;
        res.status(error.status || 502).json({
          error: error.publicMessage || "暂时无法读取会议列表，请稍后重试。",
        });
      } finally {
        guard.cleanup();
      }
    }
  );

  app.get(
    "/3gpp/doc-assistant/agenda",
    [validatedRequest, flexUserRoleValid(ROLES.all)],
    async (req, res) => {
      const guard = createAbortGuard(res, 60_000);
      try {
        const result = await docAssistant.resolveAgendaAndNotes({
          group: req.query.group,
          meeting: req.query.meeting,
          chair: req.query.chair,
          signal: guard.signal,
        });
        if (res.destroyed || res.headersSent) return;
        res.set("Cache-Control", "no-store").json(result);
      } catch (error) {
        if (res.destroyed || res.headersSent || error.status === 499) return;
        res.status(error.status || 502).json({
          error:
            error.publicMessage ||
            "暂时无法读取该会议的议程与主席纪要，请稍后重试。",
        });
      } finally {
        guard.cleanup();
      }
    }
  );

  app.get(
    "/3gpp/doc-assistant/cr-search",
    [validatedRequest, flexUserRoleValid(ROLES.all)],
    async (req, res) => {
      const guard = createAbortGuard(res, 90_000);
      try {
        const result = await docAssistant.searchChangeRequests({
          spec: req.query.spec,
          release: req.query.release,
          wgStatus: req.query.wgStatus,
          tsgStatus: req.query.tsgStatus,
          meeting: req.query.meeting,
          workItem: req.query.workItem,
          includeWithdrawn: req.query.includeWithdrawn === "1",
          page: req.query.page,
          signal: guard.signal,
        });
        if (res.destroyed || res.headersSent) return;
        res.set("Cache-Control", "no-store").json(result);
      } catch (error) {
        if (res.destroyed || res.headersSent || error.status === 499) return;
        res.status(error.status || 502).json({
          error:
            error.publicMessage ||
            "暂时无法查询 3GPP Portal 的 CR 列表，请稍后重试。",
        });
      } finally {
        guard.cleanup();
      }
    }
  );

  app.get(
    "/3gpp/doc-assistant/batch-list",
    [validatedRequest, flexUserRoleValid(ROLES.all)],
    async (req, res) => {
      const guard = createAbortGuard(res, 60_000);
      try {
        const result = await docAssistant.listBatchItems({
          mode: req.query.mode,
          url: req.query.url,
          group: req.query.group,
          meeting: req.query.meeting,
          signal: guard.signal,
        });
        if (res.destroyed || res.headersSent) return;
        res.set("Cache-Control", "no-store").json(result);
      } catch (error) {
        if (res.destroyed || res.headersSent || error.status === 499) return;
        res.status(error.status || 502).json({
          error:
            error.publicMessage || "暂时无法读取目录文件列表，请稍后重试。",
        });
      } finally {
        guard.cleanup();
      }
    }
  );

  app.post(
    "/3gpp/doc-assistant/batch-excel",
    [
      validatedRequest,
      flexUserRoleValid(ROLES.all),
      (req, res, next) =>
        batchExcelUpload.single("file")(req, res, (err) => {
          if (!err) return next();
          const tooLarge = err.code === "LIMIT_FILE_SIZE";
          return res.status(tooLarge ? 413 : 400).json({
            error: tooLarge
              ? "请上传小于 10 MB 的 Excel 表格。"
              : "无法读取上传的表格，请重新选择文件。",
          });
        }),
    ],
    async (req, res) => {
      try {
        if (!req.file?.buffer) {
          return res
            .status(400)
            .json({ error: "请上传包含 TDoc 编号的 Excel 文件（.xlsx）。" });
        }
        const result = await docAssistant.parseBatchExcelBuffer(
          req.file.buffer
        );
        return res.set("Cache-Control", "no-store").json(result);
      } catch (error) {
        return res.status(error.status || 400).json({
          error: error.publicMessage || "解析 Excel 文件失败，请检查文件格式。",
        });
      }
    }
  );

  app.post(
    "/3gpp/doc-assistant/batch-download",
    [validatedRequest, flexUserRoleValid(ROLES.all)],
    async (req, res) => {
      const guard = createAbortGuard(res, 300_000);
      try {
        const body = reqBody(req);
        const result = await docAssistant.buildBatchArchive({
          items: body?.items,
          meetingHint: body?.meetingHint,
          signal: guard.signal,
        });
        if (res.destroyed || res.headersSent) return;
        res.setHeader("Content-Type", "application/zip");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${result.filename}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`
        );
        res.setHeader(
          "X-Batch-Summary",
          encodeURIComponent(
            JSON.stringify({
              succeeded: result.succeeded,
              failed: result.failed,
              total: result.total,
            })
          )
        );
        res.setHeader("Access-Control-Expose-Headers", "X-Batch-Summary");
        res.setHeader("Cache-Control", "no-store");
        return res.send(result.buffer);
      } catch (error) {
        if (res.destroyed || res.headersSent || error.status === 499) return;
        return res.status(error.status || 502).json({
          error: error.publicMessage || "批量打包下载失败，请稍后重试。",
        });
      } finally {
        guard.cleanup();
      }
    }
  );

  app.post(
    "/3gpp/doc-assistant/convert",
    [validatedRequest, flexUserRoleValid(ROLES.all)],
    async (req, res) => {
      try {
        const body = reqBody(req);
        res
          .set("Cache-Control", "no-store")
          .json(await docAssistant.convertDocFile(body || {}));
      } catch (error) {
        res.status(error.status || 502).json({
          error:
            error.publicMessage ||
            "暂时无法启动 Word 转 PDF 任务，请稍后重试。",
        });
      }
    }
  );

  app.get(
    "/3gpp/doc-assistant/convert",
    [validatedRequest, flexUserRoleValid(ROLES.all)],
    async (req, res) => {
      try {
        res
          .set("Cache-Control", "no-store")
          .json(await docAssistant.getDocConvertStatus(req.query || {}));
      } catch (error) {
        res.status(error.status || 502).json({
          error: error.publicMessage || "暂时无法查询转换进度，请稍后重试。",
        });
      }
    }
  );

  app.get(
    "/3gpp/doc-assistant/file",
    [validatedRequest, flexUserRoleValid(ROLES.all)],
    async (req, res) => {
      const guard = createAbortGuard(res, 90000);
      try {
        const buffer = await docAssistant.downloadDocument(req.query.url, {
          signal: guard.signal,
        });
        if (!res.headersSent && !res.destroyed)
          res
            .attachment("document")
            .set("Cache-Control", "no-store")
            .send(buffer);
      } catch (error) {
        if (!res.headersSent && !res.destroyed)
          res.status(error.status || 502).json({
            error: error.publicMessage || "无法下载源文件，请稍后重试。",
          });
      } finally {
        guard.cleanup();
      }
    }
  );

  app.get(
    "/3gpp/doc-assistant/extract",
    [validatedRequest, flexUserRoleValid(ROLES.all)],
    async (req, res) => {
      const guard = createAbortGuard(res, 120_000);
      try {
        const { buffer, filename } = await docAssistant.extractDocMember({
          zipUrl: req.query.zipUrl,
          member: req.query.member,
          signal: guard.signal,
        });
        if (res.destroyed || res.headersSent) return;
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
        );
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "no-store");
        return res.send(buffer);
      } catch (error) {
        if (res.destroyed || res.headersSent || error.status === 499) return;
        return res.status(error.status || 502).json({
          error:
            error.publicMessage || "解压提取该文档失败，请直接下载原压缩包。",
        });
      } finally {
        guard.cleanup();
      }
    }
  );

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
