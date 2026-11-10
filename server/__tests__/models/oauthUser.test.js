jest.mock("../../utils/prisma",()=>({$transaction:jest.fn(),oauth_sessions:{findUnique:jest.fn()}}));
const prisma=require("../../utils/prisma");
const {identityFromProfile,resolveOAuthUser}=require("../../models/oauthUser");
const {validOAuthSession}=require("../../utils/idaas/sessions");
const config={environment:"production",clientId:"client"};
const profile={tenantId:"5",uuid:"uuid-1",displayNameCn:" 张三 ",displayNameEn:"Zhang San",employeeNumber:"1234"};
describe("OAuth identity and session persistence",()=>{
 afterEach(()=>{jest.clearAllMocks();delete process.env.COREGENIE_AUTH_MODE;});
 test("display name is separate from stable, tenant-scoped identity",()=>{
  const first=identityFromProfile(profile,config);expect(first.displayName).toBe("张三");
  expect(identityFromProfile({...profile,displayNameCn:"新姓名",employeeNumber:"5678"},config).subject).toBe(first.subject);
  expect(identityFromProfile({...profile,tenantId:"6"},config).subject).not.toBe(first.subject);
  expect(identityFromProfile({...profile,displayNameCn:""},config).displayName).toBe("Zhang San");
  expect(()=>identityFromProfile({...profile,uuid:""},config)).toThrow("INVALID_PROFILE");
 });
 test("creates ordinary users without guessing existing accounts by name or employee number",async()=>{
  const users={findUnique:jest.fn(async()=>null),create:jest.fn(async({data})=>({id:9,...data}))};prisma.$transaction.mockImplementation(fn=>fn({users}));
  const user=await resolveOAuthUser(profile,config);expect(user.role).toBe("default");expect(user.displayName).toBe("张三");expect(user.username).toMatch(/^idaas_/);expect(users.findUnique).toHaveBeenCalledTimes(1);expect(users.findUnique.mock.calls[0][0].where).toHaveProperty("oauthSubject");
 });
 test("returning login refreshes names without changing role and rejects suspension",async()=>{
  const users={findUnique:jest.fn(async()=>({id:2,role:"admin",suspended:0})),update:jest.fn(async({data})=>({id:2,role:"admin",...data}))};prisma.$transaction.mockImplementation(fn=>fn({users}));
  expect((await resolveOAuthUser(profile,config)).role).toBe("admin");expect(users.update.mock.calls[0][0].data).toEqual({displayName:"张三",employeeNumber:"1234"});
  users.findUnique.mockResolvedValue({id:2,suspended:1});await expect(resolveOAuthUser(profile,config)).rejects.toThrow("ACCOUNT_SUSPENDED");
 });
 test("explicit binding is tenant-scoped and never overwrites an existing binding",async()=>{
  const users={findUnique:jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({id:1,suspended:0,oauthSubject:null}),updateMany:jest.fn(async()=>({count:1})),update:jest.fn(async()=>({id:1,role:"admin"}))};
  prisma.$transaction.mockImplementation(fn=>fn({users}));const binding={tenantId:"5",employeeNumber:"1234",username:"old-admin"};
  expect((await resolveOAuthUser(profile,{...config,bindings:[binding]})).id).toBe(1);expect(users.findUnique).toHaveBeenLastCalledWith({where:{username:"old-admin"}});
  users.findUnique.mockReset().mockResolvedValueOnce(null).mockResolvedValueOnce({id:1,oauthSubject:"different"});await expect(resolveOAuthUser(profile,{...config,bindings:[binding]})).rejects.toThrow("ACCOUNT_BINDING_FAILED");
 });
 test("revoked and expired sessions fail, legacy tokens rejected only in OAuth deployment",async()=>{
  expect(await validOAuthSession({id:1})).toBe(true);process.env.COREGENIE_AUTH_MODE="idaas";expect(await validOAuthSession({id:1})).toBe(false);
  const claims={id:1,authProvider:"idaas",sid:"session"};prisma.oauth_sessions.findUnique.mockResolvedValue(null);expect(await validOAuthSession(claims)).toBe(false);
  prisma.oauth_sessions.findUnique.mockResolvedValue({userId:1,expiresAt:new Date(Date.now()+60000)});expect(await validOAuthSession(claims)).toBe(true);
  prisma.oauth_sessions.findUnique.mockResolvedValue({userId:1,expiresAt:new Date(0)});expect(await validOAuthSession(claims)).toBe(false);
 });
});
