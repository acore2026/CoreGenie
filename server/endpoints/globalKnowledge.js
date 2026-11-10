const fs = require("fs/promises");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const { handleGlobalKnowledgeUpload } = require("../utils/files/multer");
const { GlobalDocument } = require("../models/globalDocuments");
const { CollectorApi } = require("../utils/collectorApi");
const prisma = require("../utils/prisma");
const { canDeleteGlobalDocument } = require("../utils/globalKnowledgeAccess");
const {
  fallbackDownloadName,
  getGlobalKnowledgeDownload,
  preserveGlobalKnowledgeSource,
  removeGlobalKnowledgeSource,
} = require("../utils/globalKnowledge");

function validId(request, response, next) {
  if (
    !/^[1-9]\d*$/.test(request.params.id) ||
    !Number.isSafeInteger(Number(request.params.id))
  )
    return response.status(400).json({ error: "无效的资料编号。" });
  next();
}

function globalKnowledgeEndpoints(app) {
  const authenticated = [
    validatedRequest,
    (_request, response, next) => {
      response.set("Cache-Control", "no-store");
      if (response.locals.multiUserMode !== false && !response.locals.user?.id)
        return response.status(401).json({ error: "请先登录。" });
      next();
    },
  ];

  app.get(
    "/system/global-knowledge",
    authenticated,
    async (_request, response) => {
      try {
        const documents = await GlobalDocument.all();
        const users = await prisma.users.findMany({
          where: {
            id: {
              in: [
                ...new Set(
                  documents.map((doc) => doc.createdBy).filter(Number.isInteger)
                ),
              ],
            },
          },
          select: { id: true, username: true, displayName: true },
        });
        const names = new Map(
          users.map((user) => [user.id, user.displayName || user.username])
        );
        response.json({
          documents: documents.map((document) => {
            let metadata = {};
            try {
              metadata = JSON.parse(document.metadata || "{}") || {};
            } catch {}
            const name =
              metadata.sourceFile?.originalName ||
              metadata.title ||
              document.filename;
            return {
              id: document.id,
              title: name,
              downloadName:
                metadata.sourceFile?.originalName || fallbackDownloadName(name),
              createdAt: document.createdAt,
              uploadedBy: names.get(document.createdBy) || null,
              canDelete: canDeleteGlobalDocument(
                document,
                response.locals.user?.id,
                response.locals.multiUserMode
              ),
            };
          }),
        });
      } catch (error) {
        console.error("Global knowledge list:", error);
        response
          .status(500)
          .json({ error: "无法读取公共知识库，请稍后重试。" });
      }
    }
  );

  app.post(
    "/system/global-knowledge/upload",
    [...authenticated, handleGlobalKnowledgeUpload],
    async (request, response) => {
      let sourceFile = null;
      let sourceInUse = false;
      try {
        if (!request.file)
          return response.status(400).json({ error: "请选择要上传的文件。" });
        const collector = new CollectorApi();
        if (!(await collector.online()))
          return response
            .status(503)
            .json({ error: "文档处理服务暂不可用，请稍后上传。" });
        sourceFile = await preserveGlobalKnowledgeSource(
          request.file.path,
          request.file.originalname
        );
        const parsed = await collector.processDocument(request.file.filename, {
          title: request.file.originalname,
          docSource: "global-knowledge",
          ragScope: "global",
        });
        if (!parsed?.success || !parsed.documents?.length) {
          console.error("Global knowledge parse:", parsed?.reason);
          return response
            .status(422)
            .json({ error: "文件无法解析，请检查内容或换一种格式。" });
        }
        const result = await GlobalDocument.addDocuments(
          parsed.documents.map((document) => document.location),
          response.locals.user?.id || null,
          sourceFile
        );
        sourceInUse = result.embedded.length > 0;
        if (result.failedToEmbed.length) {
          console.error("Global knowledge indexing:", result.errors);
          return response.status(422).json({
            error: sourceInUse
              ? "部分内容已加入，剩余内容未能处理。请检查资料列表。"
              : "资料未能加入知识库，请稍后重试。",
            embedded: result.embedded.length,
          });
        }
        response
          .status(201)
          .json({ success: true, embedded: result.embedded.length });
      } catch (error) {
        console.error("Global knowledge upload:", error);
        response
          .status(500)
          .json({ error: "资料未能加入知识库，请稍后重试。" });
      } finally {
        if (sourceFile && !sourceInUse)
          await removeGlobalKnowledgeSource(sourceFile.storageName).catch(
            (error) => console.error("Global source cleanup:", error)
          );
        if (request.file?.path)
          await fs.unlink(request.file.path).catch((error) => {
            if (error.code !== "ENOENT")
              console.error("Global upload cleanup:", error);
          });
      }
    }
  );

  app.get(
    "/system/global-knowledge/:id/download",
    [...authenticated, validId],
    async (request, response) => {
      try {
        const document = await GlobalDocument.get({
          id: Number(request.params.id),
        });
        if (!document)
          return response.status(404).json({ error: "没有找到该资料。" });
        const download = await getGlobalKnowledgeDownload(document);
        if (!download)
          return response
            .status(404)
            .json({ error: "该资料没有可下载的内容。" });
        if (download.kind === "file")
          return response.download(download.path, download.filename);
        response.attachment(download.filename);
        response.type("text/plain; charset=utf-8");
        response.send(download.content);
      } catch (error) {
        console.error("Global knowledge download:", error);
        response.status(500).json({ error: "下载失败，请稍后重试。" });
      }
    }
  );

  app.delete(
    "/system/global-knowledge/:id",
    [...authenticated, validId],
    async (request, response) => {
      try {
        const removed = await GlobalDocument.delete(
          Number(request.params.id),
          response.locals.user?.id || null
        );
        if (!removed)
          return response.status(404).json({ error: "没有找到该资料。" });
        response.json({ success: true });
      } catch (error) {
        if (error.code === "GLOBAL_DOCUMENT_FORBIDDEN")
          return response
            .status(403)
            .json({ error: "只能删除自己上传的资料。" });
        console.error("Global knowledge delete:", error);
        response.status(500).json({ error: "资料未能删除，请稍后重试。" });
      }
    }
  );
}

module.exports = { globalKnowledgeEndpoints };
