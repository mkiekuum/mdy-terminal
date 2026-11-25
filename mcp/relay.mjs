import http from 'node:http';import {timingSafeEqual,randomBytes,createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
import {requestJob} from './job-queue.mjs';
import {VERSION} from '../extension/core.js';
import {RELEASE_PAGE,releaseFromResponse} from '../extension/updates.js';

export async function requireCurrentRelease(fetcher=fetch){
 let release;
 try{
  const options={method:'HEAD',cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(8000)};
  let response=await fetcher(RELEASE_PAGE,options);
  if([405,501].includes(response.status)){
   response=await fetcher(RELEASE_PAGE,{...options,method:'GET'});
   await response.body?.cancel();
  }
  release=releaseFromResponse(response);
 }catch{throw Error('无法确认 GitHub 最新正式版，请检查网络后重试。');}
 if(release.version!==VERSION)throw Error('当前 MCP '+VERSION+'，GitHub 最新正式版 '+release.version+'。请升级扩展、客户端和中继后重连。');
}

const object=properties=>({type:'object',properties,additionalProperties:false});
export function createRelay({clientToken,bridgeToken,origins=[],now=()=>Date.now(),pairingNonceTtlMs=120000,checkRelease}){
 if(!clientToken||!bridgeToken||clientToken.length<32||bridgeToken.length<32||clientToken===bridgeToken)throw Error('需要两枚不同的至少32字符密钥');
 const jobs=new Map();let lastBridge=null,activeBridge=null,leaseAt=null,bridgeProtocol=null,extensionVersion=null;
 const another=peer=>activeBridge&&activeBridge!==peer&&now()-leaseAt<90000;
 const offers=new Map(),digest=s=>createHash('sha256').update(s).digest('hex');
 const auth=(req,token)=>{const got=Buffer.from(req.headers.authorization||''),want=Buffer.from('Bearer '+token);return got.length===want.length&&timingSafeEqual(got,want);};
 const tools=[
  {name:'xutu_status',description:'检查本机服务、扩展版本、自动选中的MDY 计划站页、会话与自动登录开关。在线时按 jobId 取结果。',inputSchema:object({})},
  {name:'xutu_login',description:'在自动选中的MDY 计划站页使用浏览器已保存的账号登录。无参数，随后用 xutu_result 核实会话。',inputSchema:object({})},
  {name:'xutu_read',description:'无参读取当前计划摘要；传 planId（稳定 ID）读取计划分支、归属和当前权限。可传 tabId 指定标签页，或 command 执行完整 xutu.command/v1。按 jobId 取结果。',inputSchema:object({planId:{type:'string',minLength:1},tabId:{type:'integer',minimum:1},command:{type:'object'}})},{name:'xutu_preview',description:'预览一次写入，展示完整变更给用户；不会保存网站。',inputSchema:{...object({command:{type:'object'}}),required:['command']}},{name:'xutu_execute',description:'仅在用户明确同意已展示的预览后调用。approval必须是用户本次同意原文，不能编造。',inputSchema:{...object({previewJobId:{type:'string'},approval:{type:'string'}}),required:['previewJobId','approval']}},{name:'xutu_result',description:'获取任务状态。大回执可用 path 选字段、limit 分页，按 nextOffset 继续。dispatched/unknown 时不要重放写入。',inputSchema:{...object({jobId:{type:'string'},path:{type:'array',items:{type:'string'},description:'Relative to result; array indexes are strings.'},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:16000}}),required:['jobId']}}];
 const server=http.createServer(async(req,res)=>{
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try{
   const extensionOrigin=req.headers.origin&&new RegExp("^chrome-extension://[a-p]{32}$").test(req.headers.origin);
   if(req.headers.origin&&!origins.includes(req.headers.origin)&&!extensionOrigin)return json(403,{error:'ORIGIN_DENIED'});
   if(req.headers.host!=='127.0.0.1:'+server.address()?.port)return json(403,{error:'LOOPBACK_HOST_REQUIRED'});
   if(req.url?.startsWith('/pairing/')){
    for(const [id,entry] of offers)if(entry.expires<=now())offers.delete(id);
    if(req.method==='GET'&&req.url==='/pairing/info')return json(200,{protocol:'xutu-pairing/v1',relayVersion:VERSION});
    if(req.method!=='POST')return json(405,{error:'METHOD_NOT_ALLOWED'});
    if(req.url==='/pairing/approve'){
     if(req.headers.origin||!auth(req,clientToken))return json(401,{error:'UNAUTHORIZED'});
     const entry=offers.get(req.headers['x-xutu-pairing-id']);
     if(!entry)return json(404,{error:'PAIRING_EXPIRED'});
     if(another(entry.peer))return json(409,{error:'ANOTHER_BROWSER_CONNECTED'});
     entry.approved=true;return json(200,{status:'authorized'});
    }
    if(req.url==='/pairing/probe'){
     if(!auth(req,bridgeToken))return json(401,{error:'CREDENTIAL_MISMATCH'});
     const peer=req.headers['x-xutu-bridge-id'];
     if(another(peer))return json(409,{error:'ANOTHER_BROWSER_CONNECTED'});
     return json(200,{protocol:'xutu-pairing/v1',relayVersion:VERSION});
    }
    const proof=req.headers['x-xutu-pairing-proof'],peer=req.headers['x-xutu-bridge-id'];
    if(!extensionOrigin||typeof proof!=='string'||!/^[a-f0-9]{64}$/.test(proof)||typeof peer!=='string'||!/^[-a-zA-Z0-9]{8,80}$/.test(peer))return json(403,{error:'PAIRING_BROWSER_REQUIRED'});
    if(req.url==='/pairing/request'){
     if(offers.size>=16)return json(429,{error:'PAIRING_BUSY'});
     const id=randomBytes(16).toString('hex');
     offers.set(id,{proof:digest(proof),peer,origin:req.headers.origin,expires:now()+pairingNonceTtlMs});
     return json(202,{id});
    }
    if(req.url==='/pairing/claim'){
     const id=req.headers['x-xutu-pairing-id'],entry=offers.get(id);
     if(!entry||entry.peer!==peer||entry.origin!==req.headers.origin||!timingSafeEqual(Buffer.from(entry.proof,'hex'),Buffer.from(digest(proof),'hex')))return json(403,{error:'PAIRING_PROOF_INVALID'});
     if(!entry.approved)return json(202,{status:'waiting'});
     if(another(peer))return json(409,{error:'ANOTHER_BROWSER_CONNECTED'});
     if(activeBridge!==peer){lastBridge=null;bridgeProtocol=null;extensionVersion=null;}
     activeBridge=peer;leaseAt=now();
     offers.delete(id);return json(200,{bridgeToken,protocol:'xutu-pairing/v1',relayVersion:VERSION});
    }
    return json(404,{error:'NOT_FOUND'});
   }
   const bridge=req.url?.startsWith('/bridge/');if(!auth(req,bridge?bridgeToken:clientToken))return json(401,{error:'UNAUTHORIZED'});
   if(bridge){const peer=req.headers['x-xutu-bridge-id'];if(typeof peer!=='string'||!/^[-a-zA-Z0-9]{8,80}$/.test(peer))return json(400,{error:'BRIDGE_ID_REQUIRED'});if(another(peer))return json(409,{error:'ANOTHER_BROWSER_CONNECTED'});if(req.url==='/bridge/next'&&req.headers['x-xutu-extension-version']&&req.headers['x-xutu-extension-version']!==VERSION)return json(426,{error:'VERSION_MISMATCH'});activeBridge=peer;leaseAt=now();}
   if(req.method==='GET'&&req.url==='/bridge/next'){
    lastBridge=now();bridgeProtocol=req.headers['x-xutu-bridge-protocol'];extensionVersion=req.headers['x-xutu-extension-version']||null;for(const j of jobs.values())if(j.status==='queued'){j.status='dispatched';j.bridgeId=activeBridge;return json(200,j);}return json(200,null);
   }
   if(req.method!=='POST')return json(405,{error:'METHOD_NOT_ALLOWED'});
   const maxBytes=req.url==='/bridge/result'?16*1024*1024:2*1024*1024;
   let size=0;const chunks=[];for await(const part of req){size+=part.length;if(size>maxBytes)return json(413,{error:'BODY_TOO_LARGE'});chunks.push(part);}
   const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(req.url==='/bridge/result'){
    const j=jobs.get(body.id);if(!j||j.bridgeId!==activeBridge)return json(409,{error:'JOB_STATE'});
    if(j.status==='completed')return json(200,{ok:true});
    if(j.status!=='dispatched')return json(409,{error:'JOB_STATE'});j.status='completed';j.result=j.kind==='status'&&body.result?.extensionVersion?{...body.result,relayVersion:VERSION,bridge:'connected'}:body.result;return json(200,{ok:true});
   }
   if(req.url!=='/mcp')return json(404,{error:'NOT_FOUND'});
   if(body.jsonrpc!=='2.0'||typeof body.method!=='string'||Array.isArray(body))return json(400,{error:'INVALID_REQUEST'});
   if(body.id===undefined){res.writeHead(202);return res.end();}
   const rpc=result=>json(200,{jsonrpc:'2.0',id:body.id,result});
   if(body.method==='initialize')return rpc({protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'xutu-terminal',version:VERSION}});
   if(body.method==='ping')return rpc({});if(body.method==='tools/list')return rpc({tools});
   if(body.method!=='tools/call')return json(200,{jsonrpc:'2.0',id:body.id,error:{code:-32601,message:'Method not found'}});
   try{
    const {name,arguments:a={}}=body.params||{};let result;
    if(name!=='xutu_result'){
     const online = lastBridge !== null && now()-lastBridge <= 90000;
     const browserTool = name === 'xutu_status' || name === 'xutu_login';
     if (browserTool && (a === null || typeof a !== 'object' || Array.isArray(a) || Object.keys(a).length)) throw Error('此工具不接受参数。');
     if (name === 'xutu_status' && (!online || bridgeProtocol !== '2')) {
      return rpc({content:[{type:'text',text:JSON.stringify({relayVersion:VERSION,extensionVersion:online ? extensionVersion : null,bridge:online ? 'reload_extension' : 'offline'})}]});
     }
     if (!online) throw Error('浏览器桥未连接，请检查插件的 MCP 连接。');
     if (browserTool && bridgeProtocol !== '2') throw Error('请在扩展管理页重新加载新版MDY Terminal。');
    }
    if(checkRelease&&['xutu_login','xutu_read','xutu_preview','xutu_execute'].includes(name)){
     if(extensionVersion!==VERSION)throw Error('浏览器桥版本未核实，请重新加载同版扩展。');
     await checkRelease();
    }
    result=requestJob(jobs,name,a,now());
    return rpc({content:[{type:'text',text:JSON.stringify(result)}]});
   }catch(e){return rpc({isError:true,content:[{type:'text',text:e.message}]});}
  }catch{json(400,{error:'INVALID_REQUEST'});}
 });return {server,jobs};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const {server}=createRelay({checkRelease:requireCurrentRelease,clientToken:process.env.XUTU_MCP_TOKEN,bridgeToken:process.env.XUTU_BRIDGE_TOKEN,origins:(process.env.XUTU_ALLOWED_ORIGINS||'').split(',').filter(Boolean)});server.listen(Number(process.env.PORT||62924),'127.0.0.1',()=>console.log('MCP relay listening on loopback; no public deployment.'));}
