jest.mock('../../utils/http', () => ({ ...jest.requireActual('../../utils/http'), userFromSession: jest.fn(), reqBody: request => request.body }));
const { userFromSession } = require('../../utils/http');
const { SystemSettings } = require('../../models/systemSettings');
const { adminEndpoints } = require('../../endpoints/admin');
const routes = new Map();
const register = method => (path,...handlers)=>routes.set(`${method} ${path}`,handlers.at(-1));
adminEndpoints({get:register('GET'),post:register('POST'),delete:register('DELETE'),put:register('PUT')});
const response=()=>{const res={status:jest.fn(),json:jest.fn(),sendStatus:jest.fn(),end:jest.fn()};res.status.mockReturnValue(res);res.sendStatus.mockReturnValue(res);return res;};
afterEach(()=>jest.restoreAllMocks());
it('returns the lightweight settings to admins',async()=>{
 userFromSession.mockResolvedValue({role:'admin'});
 jest.spyOn(SystemSettings,'get').mockImplementation(async({label})=>({value:label.endsWith('provider')?'generic-openai':'fast-model'}));
 const res=response();await routes.get('GET /admin/system-preferences-for')({query:{labels:'lightweight_model_provider,lightweight_model_name'}},res);
 expect(res.json).toHaveBeenCalledWith({settings:{lightweight_model_provider:'generic-openai',lightweight_model_name:'fast-model'}});
});
it('does not expose model configuration to managers',async()=>{
 userFromSession.mockResolvedValue({role:'manager'});
 const res=response();await routes.get('GET /admin/system-preferences-for')({query:{labels:'lightweight_model_provider,lightweight_model_name'}},res);
 expect(res.json).toHaveBeenCalledWith({settings:{}});
});
it('reports save failures instead of claiming success',async()=>{
 userFromSession.mockResolvedValue({role:'admin'});
 jest.spyOn(SystemSettings,'updateSettings').mockResolvedValue({success:false,error:'invalid model'});
 const res=response();await routes.get('POST /admin/system-preferences')({body:{lightweight_model_name:'bad'}},res);
 expect(res.status).toHaveBeenCalledWith(400);expect(res.json).toHaveBeenCalledWith({success:false,error:'invalid model'});
});
it('strips model changes from manager requests',async()=>{
 userFromSession.mockResolvedValue({role:'manager'});
 const update=jest.spyOn(SystemSettings,'updateSettings').mockResolvedValue({success:true,error:null});
 await routes.get('POST /admin/system-preferences')({body:{lightweight_model_name:'fast',lightweight_model_provider:'openai'}},response());
 expect(update).toHaveBeenCalledWith({});
});
it('validates and allows clearing the model selection',()=>{
 expect(SystemSettings.validations.lightweight_model_provider('')).toBe('');
 expect(SystemSettings.validations.lightweight_model_name(' fast ')).toBe('fast');
 expect(()=>SystemSettings.validations.lightweight_model_provider('unsupported')).toThrow();
 expect(()=>SystemSettings.validations.lightweight_model_name('bad\nname')).toThrow();
 expect(()=>SystemSettings.validations.lightweight_model_name('x'.repeat(201))).toThrow();
});
