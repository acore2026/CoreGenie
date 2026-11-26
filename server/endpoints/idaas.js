const { randomBytes, createHash, timingSafeEqual } = require("node:crypto");
const { oauthOnly, getConfig } = require("../utils/idaas/config");
const { resolveOAuthUser } = require("../models/oauthUser");
const { makeJWT, decodeJWT } = require("../utils/http");
const { User } = require("../models/user");
const prisma = require("../utils/prisma");
const { SystemSettings } = require("../models/systemSettings");

const COOKIE = "coregenie_oauth";
const HANDOFF_TTL_MS = 5 * 60_000;
const digest = (value) =>
  createHash("sha256")
    .update(String(value || ""))
    .digest();
const same = (a, b) => timingSafeEqual(digest(a), digest(b));
function safeReturnTo(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    /[\\\s]/.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    return "/";
  try {
    const url = new URL(value, "https://local.invalid");
    if (
      url.origin !== "https://local.invalid" ||
      /^\/(api|login|register|oauth)(\/|$)/.test(url.pathname)
    )
      return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}

function oauthPolicy(request, response, next) {
  if (!oauthOnly()) return next();
  const path = request.path.toLowerCase().replace(/\/+$/, "");
  const blocked = [
    "/request-token",
    "/request-token/sso/simple",
    "/system/register",
    "/system/recover-account",
    "/system/reset-password",
    "/system/update-password",
  ];
  if (
    blocked.includes(path) ||
    (request.method === "POST" && /^\/invite\/[^/]+$/.test(path))
  )
    return response
      .status(403)
      .json({ success: false, valid: false, error: "请使用华为账号登录。" });
  if (path === "/system/public-registration")
    return response.status(request.method === "GET" ? 200 : 403).json({
      enabled: false,
      error: request.method === "GET" ? undefined : "当前使用华为账号登录。",
    });
  next();
}

function idaasEndpoints(app, dependencies = {}) {
  const enabled = dependencies.enabled || oauthOnly;
  const configFor = dependencies.config || getConfig;
  const fetchImpl = dependencies.fetch || global.fetch;
  const resolveUser = dependencies.resolveUser || resolveOAuthUser;
  const database = dependencies.prisma || prisma;
  const multiUser =
    dependencies.multiUser || (() => SystemSettings.isMultiUserMode());
  const now = dependencies.now || Date.now;
  const flows = new Map();
  const limits = new Map();
  const cookieOptions = (config) => ({
    httpOnly: true,
    sameSite: "lax",
    secure: config.origin.startsWith("https:"),
    path: "/api/auth/idaas",
  });
  function cleanup() {
    for (const [key, value] of flows)
      if (value.expiresAt <= now()) flows.delete(key);
    for (const [key, value] of limits)
      if (value.expiresAt <= now()) limits.delete(key);
  }
  function browserKey(req) {
    return String(req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(COOKIE + "="))
      ?.slice(COOKIE.length + 1);
  }
  function flowFor(req) {
    const cookie = browserKey(req);
    return cookie ? flows.get(digest(cookie).toString("hex")) : null;
  }
  function guard(req, res) {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    cleanup();
    if (!enabled()) {
      res.sendStatus(404);
      return null;
    }
    try {
      return configFor();
    } catch {
      res.status(503).json({ error: "统一登录暂时不可用，请联系管理员。" });
      return null;
    }
  }
  const localRequest = (req, config) =>
    req.headers.origin === config.origin &&
    req.headers["x-coregenie-oauth"] === "1";
  app.get("/auth/config", (_req, res) =>
    res
      .set("Cache-Control", "no-store")
      .json({ provider: enabled() ? "idaas" : "local" })
  );
  app.get("/auth/idaas/start", async (req, res) => {
    const config = guard(req, res);
    if (!config) return;
    try {
      if (!(await multiUser())) throw Error("Multi-user mode required");
      const ip = req.socket?.remoteAddress || "unknown";
      const rate = limits.get(ip) || { count: 0, expiresAt: now() + 60_000 };
      if (rate.count >= 30 || flows.size >= 1000)
        return res.status(429).send("请求过于频繁，请稍后重试。");
      rate.count++;
      limits.set(ip, rate);
      const browser = randomBytes(32).toString("hex");
      const state = randomBytes(32).toString("hex");
      const old = browserKey(req);
      if (old) flows.delete(digest(old).toString("hex"));
      const flow = {
        state,
        returnTo: safeReturnTo(req.query.returnTo),
        expiresAt: now() + 600_000,
        used: false,
      };
      // Enable only when this IDaaS client has confirmed S256 support.
      if (config.pkce === true)
        flow.verifier = randomBytes(32).toString("base64url");
      flows.set(digest(browser).toString("hex"), flow);
      res.cookie(COOKIE, browser, {
        ...cookieOptions(config),
        maxAge: 600_000,
      });
      const url = new URL(config.baseUrl + "/saaslogin1/oauth2/authorize");
      url.search = new URLSearchParams({
        client_id: config.clientId,
        response_type: "code",
        redirect_uri: config.redirectUri,
        scope: "base.profile",
        display: "page",
        state,
      });
      if (flow.verifier) {
        url.searchParams.set(
          "code_challenge",
          digest(flow.verifier).toString("base64url")
        );
        url.searchParams.set("code_challenge_method", "S256");
      }
      res.redirect(303, url.href);
    } catch {
      res.redirect(303, "/login?oauthError=unavailable");
    }
  });
  async function post(config, endpoint, body) {
    const result = await fetchImpl(
      config.baseUrl + "/saaslogin1/oauth2/" + endpoint,
      {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 CoreGenie",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      }
    );
    const data = await result.json();
    if (!result.ok || !data || data.error || data.errorCode)
      throw Error("IDAAS_REQUEST_FAILED");
    return data;
  }
  app.get("/auth/idaas/callback", async (req, res) => {
    const config = guard(req, res);
    if (!config) return;
    const flow = flowFor(req);
    if (
      !flow ||
      flow.used ||
      typeof req.query.state !== "string" ||
      !same(flow.state, req.query.state)
    )
      return res.redirect(303, "/login?oauthError=expired");
    flow.used = true;
    try {
      if (
        req.query.error ||
        typeof req.query.code !== "string" ||
        !req.query.code
      )
        throw Error("AUTHORIZATION_FAILED");
      const token = await post(config, "accesstoken", {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
        code: req.query.code,
        ...(flow.verifier ? { code_verifier: flow.verifier } : {}),
      });
      if (typeof token.access_token !== "string" || !token.access_token)
        throw Error("INVALID_TOKEN");
      const profile = await post(config, "userinfo", {
        client_id: config.clientId,
        access_token: token.access_token,
        scope: "base.profile",
      });
      const user = await resolveUser(profile, config);
      flow.userId = user.id;
      flow.expiresAt = now() + HANDOFF_TTL_MS;
      // Keep the browser cookie alive for the full handoff window, even after
      // a long provider login.
      res.cookie(COOKIE, browserKey(req), {
        ...cookieOptions(config),
        maxAge: HANDOFF_TTL_MS,
      });
      res.redirect(303, "/oauth/complete");
    } catch (error) {
      flows.delete(digest(browserKey(req)).toString("hex"));
      res.clearCookie(COOKIE, cookieOptions(config));
      const reason =
        error.message === "ACCOUNT_SUSPENDED" ? "suspended" : "failed";
      // Never log authorization codes, tokens, profiles, or provider response bodies.
      console.warn("IDaaS login failed: " + reason);
      res.redirect(303, "/login?oauthError=" + reason);
    }
  });
  app.post("/auth/idaas/session", async (req, res) => {
    const config = guard(req, res);
    if (!config) return;
    if (!localRequest(req, config)) return res.sendStatus(403);
    const flow = flowFor(req);
    if (!flow?.userId)
      return res.status(401).json({ error: "登录已过期，请重新登录。" });
    flows.delete(digest(browserKey(req)).toString("hex"));
    res.clearCookie(COOKIE, cookieOptions(config));
    try {
      const user = await database.users.findUnique({
        where: { id: flow.userId },
      });
      if (!user || user.suspended) return res.sendStatus(403);
      const sid = randomBytes(32).toString("hex");
      const expiresAt = new Date(now() + 8 * 60 * 60 * 1000);
      await database.oauth_sessions.deleteMany({
        where: { expiresAt: { lt: new Date(now()) } },
      });
      await database.oauth_sessions.create({
        data: { id: sid, userId: user.id, expiresAt },
      });
      const token = makeJWT(
        { id: user.id, username: user.username, authProvider: "idaas", sid },
        "8h"
      );
      res.json({
        valid: true,
        token,
        user: User.filterFields(user),
        returnTo: flow.returnTo,
      });
    } catch {
      res.status(503).json({ error: "登录暂时不可用，请重试。" });
    }
  });
  app.post("/auth/idaas/logout", async (req, res) => {
    const config = guard(req, res);
    if (!config) return;
    if (!localRequest(req, config)) return res.sendStatus(403);
    const token = String(req.headers.authorization || "").replace(
      /^Bearer /,
      ""
    );
    const claims = decodeJWT(token);
    try {
      if (claims.authProvider === "idaas" && typeof claims.sid === "string")
        await database.oauth_sessions.deleteMany({
          where: { id: claims.sid, userId: claims.id },
        });
      res.clearCookie(COOKIE, cookieOptions(config));
      res.json({ success: true });
    } catch {
      res.sendStatus(503);
    }
  });
}

module.exports = { idaasEndpoints, oauthPolicy, safeReturnTo };
