const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { userFromSession, reqBody } = require("../utils/http");
const { Announcement, AnnouncementError } = require("../models/announcement");

function announcementEndpoints(app) {
  const admin = [validatedRequest, flexUserRoleValid([ROLES.admin])];
  const handler = (action) => async (request, response) => {
    response.set("Cache-Control", "no-store");
    try {
      const user = await userFromSession(request, response);
      if (response.locals.multiUserMode && !user?.id)
        return response.sendStatus(401);
      return response.json(await action(request, user));
    } catch (error) {
      if (error instanceof AnnouncementError)
        return response.status(error.status).json({ error: error.message });
      if (["P2025", "P2003"].includes(error.code))
        return response.status(404).json({ error: "公告不存在或已删除。" });
      console.error("[Announcements] Request failed:", error.message);
      return response.status(500).json({ error: "公告操作失败，请稍后重试。" });
    }
  };
  app.get(
    "/announcements",
    [validatedRequest],
    handler(async (_, user) => ({
      announcements: await Announcement.list(user?.id),
    }))
  );
  app.post(
    "/announcements/:id/read",
    [validatedRequest],
    handler(async (req, user) => Announcement.markRead(req.params.id, user?.id))
  );
  app.get(
    "/admin/announcements",
    admin,
    handler(async (_, user) => ({
      announcements: await Announcement.list(user?.id, { admin: true }),
    }))
  );
  app.post(
    "/admin/announcements",
    admin,
    handler(async (req) => ({
      announcement: await Announcement.create(reqBody(req)),
    }))
  );
  app.put(
    "/admin/announcements/:id",
    admin,
    handler(async (req) => ({
      announcement: await Announcement.update(req.params.id, reqBody(req)),
    }))
  );
  app.delete(
    "/admin/announcements/:id",
    admin,
    handler(async (req) => {
      await Announcement.delete(req.params.id);
      return { success: true };
    })
  );
}

module.exports = { announcementEndpoints };
