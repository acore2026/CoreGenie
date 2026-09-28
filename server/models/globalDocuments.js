const { v4: uuidv4 } = require("uuid");
const prisma = require("../utils/prisma");
const { getVectorDbClass } = require("../utils/helpers");
const { fileData } = require("../utils/files");
const { EventLogs } = require("./eventLogs");
const {
  GLOBAL_KNOWLEDGE_NAMESPACE,
  removeGlobalKnowledgeSource,
} = require("../utils/globalKnowledge");

const GlobalDocument = {
  all: async function () {
    return prisma.global_documents.findMany({ orderBy: { createdAt: "desc" } });
  },

  get: async function (clause = {}) {
    return prisma.global_documents.findFirst({ where: clause });
  },

  addDocuments: async function (
    additions = [],
    userId = null,
    sourceFile = null
  ) {
    const VectorDb = getVectorDbClass();
    const embedded = [];
    const failedToEmbed = [];
    const errors = new Set();

    for (const docpath of additions) {
      if (await this.get({ docpath })) {
        embedded.push(docpath);
        continue;
      }
      const data = await fileData(docpath);
      if (!data) {
        failedToEmbed.push(docpath);
        errors.add("无法读取处理后的文档。");
        continue;
      }

      const docId = uuidv4();
      const { pageContent: _pageContent, ...metadata } = data;
      const globalData = {
        ...data,
        ragScope: "global",
        docSource: data.docSource || "global-knowledge",
      };
      const { vectorized, error } = await VectorDb.addDocumentToNamespace(
        GLOBAL_KNOWLEDGE_NAMESPACE,
        { ...globalData, docId },
        docpath
      );
      if (!vectorized) {
        failedToEmbed.push(metadata?.title || docpath);
        errors.add(error || "文档嵌入失败。");
        continue;
      }

      try {
        await prisma.global_documents.create({
          data: {
            docId,
            filename: docpath.split(/[/\\]/).pop(),
            docpath,
            metadata: JSON.stringify({
              ...metadata,
              ragScope: "global",
              ...(sourceFile ? { sourceFile } : {}),
            }),
            createdBy: userId,
          },
        });
        embedded.push(docpath);
      } catch (error) {
        await VectorDb.deleteDocumentFromNamespace(
          GLOBAL_KNOWLEDGE_NAMESPACE,
          docId
        );
        await prisma.document_vectors.deleteMany({ where: { docId } });
        failedToEmbed.push(metadata?.title || docpath);
        errors.add(error.message);
      }
    }

    await EventLogs.logEvent(
      "global_documents_added",
      { numberOfDocumentsAdded: embedded.length },
      userId
    );
    return { failedToEmbed, errors: [...errors], embedded };
  },

  delete: async function (id, userId = null) {
    const document = await this.get({ id: Number(id) });
    if (!document) return false;
    let sourceFile = null;
    try {
      sourceFile = JSON.parse(document.metadata || "{}").sourceFile || null;
    } catch {}
    const VectorDb = getVectorDbClass();
    const removed = await VectorDb.deleteDocumentFromNamespace(
      GLOBAL_KNOWLEDGE_NAMESPACE,
      document.docId
    );
    if (removed === false) throw new Error("无法从公共知识库移除文档向量。");
    await prisma.$transaction([
      prisma.document_vectors.deleteMany({ where: { docId: document.docId } }),
      prisma.global_documents.delete({ where: { id: document.id } }),
    ]);
    if (sourceFile?.storageName) {
      const sourceStillUsed = (await this.all()).some((item) => {
        try {
          return (
            JSON.parse(item.metadata || "{}").sourceFile?.storageName ===
            sourceFile.storageName
          );
        } catch {
          return false;
        }
      });
      if (!sourceStillUsed)
        await removeGlobalKnowledgeSource(sourceFile.storageName).catch(
          (error) =>
            console.error(
              "Failed to remove global knowledge source:",
              error.message
            )
        );
    }
    await EventLogs.logEvent(
      "global_document_removed",
      { documentName: document.filename },
      userId
    );
    return true;
  },
};

module.exports = { GlobalDocument };
