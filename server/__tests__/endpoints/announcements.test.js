/* eslint-env jest, node */
jest.mock("../../utils/middleware/validatedRequest", () => ({
  validatedRequest: jest.fn(),
}));
jest.mock("../../models/systemSettings", () => ({
  SystemSettings: { isMultiUserMode: jest.fn() },
}));
jest.mock("../../utils/http", () => ({
  userFromSession: jest.fn(async (_, response) => response.locals.user),
  reqBody: (request) => request.body,
}));
jest.mock("../../models/announcement", () => {
  class AnnouncementError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }
  return {
    AnnouncementError,
    Announcement: {
      list: jest.fn(),
      markRead: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
});
const { Announcement } = require("../../models/announcement");
const { announcementEndpoints } = require("../../endpoints/announcements");
const { validatedRequest } = require("../../utils/middleware/validatedRequest");
const routes = {};
announcementEndpoints(
  Object.fromEntries(
    ["get", "post", "put", "delete"].map((method) => [
      method,
      (path, middleware, handler) => {
        routes[`${method} ${path}`] = { middleware, handler };
      },
    ])
  )
);
function response(user = { id: 7, role: "default" }) {
  return {
    locals: { multiUserMode: true, user },
    statusCode: 200,
    set: jest.fn(),
    json: jest.fn(),
    status(code) {
      this.statusCode = code;
      return this;
    },
    sendStatus(code) {
      this.statusCode = code;
      return this;
    },
    end: jest.fn(),
  };
}
beforeEach(() => jest.clearAllMocks());
it("authenticates all routes and rejects ordinary users and managers from every admin action", async () => {
  for (const [path, route] of Object.entries(routes)) {
    expect(route.middleware[0]).toBe(validatedRequest);
    if (!path.includes("/admin/")) continue;
    for (const role of ["default", "manager"]) {
      const res = response({ id: 7, role });
      const next = jest.fn();
      await route.middleware[1]({}, res, next);
      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    }
    const next = jest.fn();
    await route.middleware[1]({}, response({ id: 1, role: "admin" }), next);
    expect(next).toHaveBeenCalled();
  }
});
it("takes the reader identity from the session, never the request", async () => {
  const res = response();
  await routes["post /announcements/:id/read"].handler(
    { params: { id: "1" }, body: { userId: 99, readerKey: "user:99" } },
    res
  );
  expect(Announcement.markRead).toHaveBeenCalledWith("1", 7);
  expect(res.set).toHaveBeenCalledWith("Cache-Control", "no-store");
});
it("does not fall back to shared read state for a missing multi-user session", async () => {
  const res = response(null);
  await routes["get /announcements"].handler({}, res);
  expect(res.statusCode).toBe(401);
  expect(Announcement.list).not.toHaveBeenCalled();
});
it("maps concurrent deletion to 404", async () => {
  Announcement.markRead.mockRejectedValueOnce({ code: "P2003" });
  const res = response();
  await routes["post /announcements/:id/read"].handler(
    { params: { id: "1" } },
    res
  );
  expect(res.statusCode).toBe(404);
});
it("does not expose database errors", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  Announcement.list.mockRejectedValueOnce(new Error("private database detail"));
  const res = response();
  await routes["get /announcements"].handler({}, res);
  expect(res.statusCode).toBe(500);
  expect(res.json).toHaveBeenCalledWith({
    error: "公告操作失败，请稍后重试。",
  });
  log.mockRestore();
});
