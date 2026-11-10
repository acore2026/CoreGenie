/* eslint-env jest, node */
jest.mock("../../utils/middleware/validatedRequest", () => ({ validatedRequest: jest.fn() }));
jest.mock("../../utils/files/multer", () => ({ handleGlobalKnowledgeUpload: jest.fn() }));
jest.mock("../../models/globalDocuments", () => ({ GlobalDocument: { all: jest.fn(), get: jest.fn(), addDocuments: jest.fn(), delete: jest.fn() } }));
jest.mock("../../utils/prisma", () => ({ users: { findMany: jest.fn() } }));
jest.mock("fs/promises", () => ({ unlink: jest.fn(async () => {}) }));
const mockCollector = { online: jest.fn(), processDocument: jest.fn() };
jest.mock("../../utils/collectorApi", () => ({ CollectorApi: jest.fn(() => mockCollector) }));
jest.mock("../../utils/globalKnowledge", () => ({
  fallbackDownloadName: name => name + ".txt",
  getGlobalKnowledgeDownload: jest.fn(),
  preserveGlobalKnowledgeSource: jest.fn(async (_, name) => ({ storageName: "unique.md", originalName: name })),
  removeGlobalKnowledgeSource: jest.fn(async () => {}),
}));
const { GlobalDocument } = require("../../models/globalDocuments");
const prisma = require("../../utils/prisma");
const { validatedRequest } = require("../../utils/middleware/validatedRequest");
const { globalKnowledgeEndpoints } = require("../../endpoints/globalKnowledge");
const { getGlobalKnowledgeDownload, removeGlobalKnowledgeSource } = require("../../utils/globalKnowledge");
const routes = {};
globalKnowledgeEndpoints(Object.fromEntries(["get", "post", "delete"].map(method => [method, (path, middleware, handler) => {
  routes[method + " " + path] = { middleware, handler };
}])));
const route = (method, suffix = "") => routes[method + " /system/global-knowledge" + suffix];
function response(user = { id: 7, role: "default" }) {
  return { locals: { user, multiUserMode: true }, statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    set: jest.fn(), json: jest.fn(), attachment: jest.fn(), type: jest.fn(), send: jest.fn(), download: jest.fn(),
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockCollector.online.mockResolvedValue(true);
  prisma.users.findMany.mockResolvedValue([{ id: 7, displayName: "张三", username: "zhang" }]);
});

it("requires authentication for all routes; no administrator gate", () => {
  for (const { middleware } of Object.values(routes)) {
    expect(middleware[0]).toBe(validatedRequest);
    const next = jest.fn();
    middleware[1]({}, response(), next);
    expect(next).toHaveBeenCalled();
    const denied = response(null);
    middleware[1]({}, denied, jest.fn());
    expect(denied.statusCode).toBe(401);
  }
});

it.each(["default", "admin"])("lists all files with uploader-only controls for %s", async role => {
  GlobalDocument.all.mockResolvedValue([
    { id: 1, createdBy: 7, metadata: JSON.stringify({ title: "资料.md", secret: "internal" }) },
    { id: 2, createdBy: 8, metadata: "{}", filename: "other.md" },
    { id: 3, createdBy: null, metadata: "broken", filename: "legacy.md" },
  ]);
  const res = response({ id: 7, role });
  await route("get").handler({}, res);
  const docs = res.json.mock.calls[0][0].documents;
  expect(docs.map(doc => doc.canDelete)).toEqual([true, false, false]);
  expect(docs[0]).toMatchObject({ uploadedBy: "张三", title: "资料.md" });
  expect(JSON.stringify(docs)).not.toContain("internal");
});

it("downloads another user's document for a regular member", async () => {
  GlobalDocument.get.mockResolvedValue({ id: 2, createdBy: 8 });
  getGlobalKnowledgeDownload.mockResolvedValue({ kind: "text", filename: "资料.md", content: "shared" });
  const res = response();
  await route("get", "/:id/download").handler({ params: { id: "2" } }, res);
  expect(res.send).toHaveBeenCalledWith("shared");
});

it("uses the authenticated uploader and unique collector filename", async () => {
  mockCollector.processDocument.mockResolvedValue({ success: true, documents: [{ location: "parsed/a.json" }] });
  GlobalDocument.addDocuments.mockResolvedValue({ embedded: ["parsed/a.json"], failedToEmbed: [] });
  const res = response();
  await route("post", "/upload").handler({ body: { userId: 999 }, file: { path: "/tmp/unique.md", filename: "unique.md", originalname: "资料.md" } }, res);
  expect(mockCollector.processDocument).toHaveBeenCalledWith("unique.md", expect.objectContaining({ title: "资料.md" }));
  expect(GlobalDocument.addDocuments).toHaveBeenCalledWith(["parsed/a.json"], 7, expect.objectContaining({ originalName: "资料.md" }));
  expect(removeGlobalKnowledgeSource).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(201);
});

it("cleans failed uploads without disclosing parser diagnostics", async () => {
  mockCollector.processDocument.mockResolvedValue({ success: false, reason: "/root/private stack trace" });
  const res = response();
  jest.spyOn(console, "error").mockImplementation(() => {});
  await route("post", "/upload").handler({ file: { path: "/tmp/unique.md", filename: "unique.md", originalname: "资料.md" } }, res);
  expect(removeGlobalKnowledgeSource).toHaveBeenCalledWith("unique.md");
  expect(res.statusCode).toBe(422);
  expect(JSON.stringify(res.json.mock.calls)).not.toContain("/root/");
  console.error.mockRestore();
});

it("returns forbidden on ownership denial and does not trust a supplied owner", async () => {
  GlobalDocument.delete.mockRejectedValue({ code: "GLOBAL_DOCUMENT_FORBIDDEN" });
  const res = response();
  await route("delete", "/:id").handler({ params: { id: "2" }, body: { userId: 8 } }, res);
  expect(GlobalDocument.delete).toHaveBeenCalledWith(2, 7);
  expect(res.statusCode).toBe(403);
});
