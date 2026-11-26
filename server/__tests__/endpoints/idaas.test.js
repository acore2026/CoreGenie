jest.mock("../../utils/prisma", () => ({}));
jest.mock("../../models/systemSettings", () => ({ SystemSettings: {} }));
jest.mock("../../utils/http", () => ({
  makeJWT: jest.fn(claims => JSON.stringify(claims)),
  decodeJWT: jest.fn(token => { try { return JSON.parse(token); } catch { return {}; } }),
}));
const { idaasEndpoints, oauthPolicy, safeReturnTo } = require("../../endpoints/idaas");

function fixture(options = {}) {
  let time = 1000;
  const routes = {};
  const config = { clientId: "client", clientSecret: "private-secret", origin: "https://genie.example.test", redirectUri: "https://genie.example.test/api/auth/idaas/callback", baseUrl: "https://uniportal.huawei.com" };
  const db = { users: { findUnique: jest.fn(async () => ({ id: 7, username: "opaque", displayName: "张三", oauthSubject: "private-id" })) }, oauth_sessions: { create: jest.fn(), deleteMany: jest.fn() } };
  const fetch = jest.fn(async url => ({ ok: true, json: async () => url.endsWith("accesstoken") ? { access_token: "secret-token" } : { uuid: "u", displayNameCn: "张三" } }));
  const resolveUser = jest.fn(async () => ({ id: 7 }));
  idaasEndpoints({ get: (p,h) => routes["GET "+p] = h, post: (p,h) => routes["POST "+p] = h }, { enabled: () => true, config: () => config, prisma: db, fetch, resolveUser, multiUser: async () => true, now: () => time, ...options });
  function response() { return { statusCode: 200, headers: {}, set(value) { Object.assign(this.headers,value); return this; }, status(code) { this.statusCode=code;return this; }, send(body) { this.body=body;return this; }, json(body) { this.body=body;return this; }, sendStatus(code) { this.statusCode=code; return this; }, cookie(name,value,opts) { this.cookie=name+"="+value;this.cookieOptions=opts; }, clearCookie() {}, redirect(code,url) { this.statusCode=code;this.location=url; } }; }
  async function call(method,path,req={}) { const res=response();await routes[method+" "+path]({headers:{},query:{},socket:{remoteAddress:"127.0.0.1"},...req},res);return res; }
  async function start() { const res=await call("GET","/auth/idaas/start",{query:{returnTo:"/workspace/research"}});return { cookie:res.cookie, state:new URL(res.location).searchParams.get("state"),res }; }
  async function callback(s) { return call("GET","/auth/idaas/callback",{headers:{cookie:s.cookie},query:{state:s.state,code:"single-code"}}); }
  const headers = s => ({cookie:s.cookie,origin:config.origin,"x-coregenie-oauth":"1"});
  return { call,start,callback,headers,db,fetch,resolveUser,config,advance:ms=>time+=ms,response };
}

describe("IDaaS login", () => {
  afterEach(() => { delete process.env.COREGENIE_AUTH_MODE; jest.restoreAllMocks(); });
  test("local deployment advertises local auth and cannot start OAuth", async () => {
    const f=fixture({enabled:()=>false});expect((await f.call("GET","/auth/config")).body.provider).toBe("local");
    expect((await f.call("GET","/auth/idaas/start")).statusCode).toBe(404);
  });
  test("backend code exchange keeps tokens out of redirects, consumes browser-bound handoff once", async () => {
    const f=fixture();const s=await f.start();expect(s.res.cookieOptions).toMatchObject({httpOnly:true,secure:true,sameSite:"lax"});
    const done=await f.callback(s);expect(done.location).toBe("/oauth/complete");
    expect(JSON.parse(f.fetch.mock.calls[0][1].body)).toMatchObject({client_id:"client",client_secret:"private-secret",code:"single-code",redirect_uri:f.config.redirectUri});
    expect(JSON.parse(f.fetch.mock.calls[1][1].body)).toEqual({client_id:"client",access_token:"secret-token",scope:"base.profile"});
    const response=await f.call("POST","/auth/idaas/session",{headers:f.headers(s)});
    expect(response.body.user).toMatchObject({displayName:"张三",authProvider:"idaas"});expect(response.body.user.oauthSubject).toBeUndefined();expect(response.body.returnTo).toBe("/workspace/research");
    expect(response.body.token).not.toContain("secret-token");expect(f.db.oauth_sessions.create).toHaveBeenCalledTimes(1);
    expect((await f.call("POST","/auth/idaas/session",{headers:f.headers(s)})).statusCode).toBe(401);
    expect((await f.callback(s)).location).toContain("expired");expect(f.fetch).toHaveBeenCalledTimes(2);
  });
  test("rejects wrong browser, wrong state, expiry and cross-origin handoff", async () => {
    const f=fixture();const s=await f.start();
    expect((await f.callback({...s,cookie:"different"})).location).toContain("expired");
    expect((await f.callback({...s,state:"wrong"})).location).toContain("expired");expect(f.fetch).not.toHaveBeenCalled();
    await f.callback(s);
    expect((await f.call("POST","/auth/idaas/session",{headers:{...f.headers(s),origin:"https://evil.test"}})).statusCode).toBe(403);
    f.advance(300000);expect((await f.call("POST","/auth/idaas/session",{headers:f.headers(s)})).statusCode).toBe(401);
    const s2=await f.start();f.advance(600001);expect((await f.callback(s2)).location).toContain("expired");
  });
  test.each([61_000, 299_999])(
    "allows a slow handoff after %i ms and renews the cookie after a long login",
    async (delay) => {
      const f = fixture();
      const s = await f.start();
      f.advance(599_000);
      const callback = await f.callback(s);
      expect(callback.location).toBe("/oauth/complete");
      expect(callback.cookie).toBe(s.cookie);
      expect(callback.cookieOptions).toMatchObject({
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/api/auth/idaas",
        maxAge: 300_000,
      });
      f.advance(delay);
      const response = await f.call("POST", "/auth/idaas/session", {
        headers: f.headers(s),
      });
      expect(response.statusCode).toBe(200);
      expect(response.body.valid).toBe(true);
      expect(f.db.oauth_sessions.create).toHaveBeenCalledTimes(1);
      expect((await f.call("POST", "/auth/idaas/session", {
        headers: f.headers(s),
      })).statusCode).toBe(401);
    }
  );
  test("denies suspended users and provider errors without revealing responses", async () => {
    jest.spyOn(console,"warn").mockImplementation(()=>{});
    const f=fixture({resolveUser:async()=>{throw Error("ACCOUNT_SUSPENDED");}});expect((await f.callback(await f.start())).location).toBe("/login?oauthError=suspended");
    const g=fixture({fetch:async()=>({ok:true,json:async()=>({errorCode:"E_10003",errorDesc:"private-secret"})})});
    expect((await g.callback(await g.start())).location).toBe("/login?oauthError=failed");expect(g.resolveUser).not.toHaveBeenCalled();
  });
  test("logout revokes only the authenticated session", async () => {
    const f=fixture();const s=await f.start();await f.callback(s);
    const r=await f.call("POST","/auth/idaas/session",{headers:f.headers(s)});
    await f.call("POST","/auth/idaas/logout",{headers:{...f.headers(s),authorization:"Bearer "+r.body.token}});
    expect(f.db.oauth_sessions.deleteMany).toHaveBeenLastCalledWith({where:{id:JSON.parse(r.body.token).sid,userId:7}});
  });
  test("OAuth-only policy blocks password registration, recovery and alternate simple SSO", () => {
    const f=fixture();const next=jest.fn();process.env.COREGENIE_AUTH_MODE="idaas";
    for(const path of ["/request-token","/request-token/sso/simple","/system/register","/system/recover-account","/system/reset-password","/system/update-password","/invite/token"]){const r=f.response();oauthPolicy({method:"POST",path},r,next);expect(r.statusCode).toBe(403);}
    const status=f.response();oauthPolicy({method:"GET",path:"/system/public-registration"},status,next);expect(status.body.enabled).toBe(false);
    oauthPolicy({method:"POST",path:"/workspace/a/chat"},f.response(),next);expect(next).toHaveBeenCalledTimes(1);
    delete process.env.COREGENIE_AUTH_MODE;oauthPolicy({method:"POST",path:"/request-token"},f.response(),next);expect(next).toHaveBeenCalledTimes(2);
  });
  test("redirect allowlist prevents external URLs and authentication loops", () => {
    for(const value of ["//evil.test","/\\evil.test","https://evil.test","/login","/api/auth/idaas/start","/oauth/complete","/\nevil.test"] ) expect(safeReturnTo(value)).toBe("/");
    expect(safeReturnTo("/workspace/demo?tab=files")).toBe("/workspace/demo?tab=files");
  });
});
