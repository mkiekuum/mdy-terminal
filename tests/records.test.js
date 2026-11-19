import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiAdapter} from '../extension/api.js';
import {McpGate} from '../extension/mcp-policy.js';
import {integrated,site,envelope} from './v25-helpers.js';

function fixture(){
 const web=site(), requests=[], projects=[{id:'P',kind:'internal',referenceNumber:'JH-QA',shortName:'QA',owner:'USER_A',planId:''}],meta={reviewer:false,types:['硬件'],statuses:['等待','已完成'],users:['USER_A']};
 const base=web.request,posts=[];
 let alter=false, reject=false;
 web.request=async(path,method='GET',body)=>{
  if(path==='/api/records/meta')return structuredClone(meta);
  if(path==='/api/records/projects')return structuredClone(projects);
  if(path==='/api/records/requests'&&method==='GET')return structuredClone(requests);
  if(path==='/api/records/tasks')return [];
  if(path.startsWith('/api/records/')&&method==='POST'){
   posts.push(structuredClone(body));
   if(reject)throw Object.assign(Error('denied'),{code:'PERMISSION_DENIED'});
   if(path==='/api/records/link'){projects[0].planId=body.planId;return {};}
   if(path.endsWith('/review')){requests[0].status=body.decision==='reject'?'rejected':'approved';requests[0].payload=structuredClone(body.payload);return requests[0];}
   const row={...structuredClone(body),id:'R'+requests.length,status:body.direct?'approved':'pending'};
   requests.push(row);
   if(alter)row.payload.shortName='Unexpected';
   return {id:row.id,status:row.status};
  }
  return base(path,method,body);
 };
 const system=integrated(web),gate=new McpGate(c=>system.executor.run(c),async()=>web.actor);
 const command=(op,params)=>envelope([{id:'r',op,params}]);
 return {web,gate,system,meta,requests,projects,posts,command,api:new ApiAdapter(web.request),set alter(v){alter=v;},set reject(v){reject=v;}};
}
const payload={kind:'internal',referenceNumber:'JH-QA',shortName:'QA',owner:'USER_A'};
test('MCP new project remains pending, reads back and request replay does not write twice',async()=>{
 const f=fixture(),c=f.command('records.submit',{kind:'project',action:'create',payload});
 const preview=await f.gate.handle({kind:'preview',id:'preview',command:c});
 assert.equal(preview.result.steps[0].data.expectedStatus,'pending');assert.equal(f.posts.length,0);
 const result=await f.gate.handle({kind:'execute',previewJobId:'preview',approval:'提交隔离申请'});
 assert.equal(result.status,'success');assert.equal(result.steps[0].data.status,'pending');assert(result.steps[0].serverVerified);
 const again=await f.system.executor.run({...c,mode:'execute'});
 assert.equal(again.status,'success');assert.equal(f.posts.length,1);
});
test('review permission, update basis and readback mismatch are enforced',async()=>{
 for(const op of ['records.review','records.link']){
  const f=fixture(),p=op==='records.review'?{requestId:'R',before:{},decision:'approve',payload}:{kind:'project',targetId:'P',before:f.projects[0],planId:''};
  await assert.rejects(f.api.run({id:'r',op,params:p},{mode:'preview'}),{code:'PERMISSION_DENIED'});
 }
 const f=fixture();await assert.rejects(f.api.run({id:'r',op:'records.submit',params:{kind:'project',action:'update',targetId:'P',before:{},payload}},{mode:'execute'}),{code:'VERSION_CONFLICT'});assert.equal(f.posts.length,0);
 f.alter=true;await assert.rejects(f.api.run({id:'r',op:'records.submit',params:{kind:'project',action:'create',payload}},{mode:'execute'}),{code:'SERVER_NOT_CONFIRMED',outcome:'unconfirmed'});
});
test('reviewers still submit new records for approval and can review and link',async()=>{
 const f=fixture();f.meta.reviewer=true;
 await assert.rejects(f.api.run({id:'r',op:'records.submit',params:{kind:'project',action:'create',direct:true,payload}},{mode:'preview'}),{code:'INVALID_SCHEMA'});
 await f.api.run({id:'r',op:'records.submit',params:{kind:'project',action:'create',payload}},{mode:'execute'});
 const before=structuredClone(f.requests[0]);
 const r=await f.api.run({id:'review',op:'records.review',params:{requestId:before.id,before,decision:'approve',payload}},{mode:'execute'});
 assert.equal(r.data.status,'approved');assert(r.serverVerified);
 const link=await f.api.run({id:'link',op:'records.link',params:{kind:'project',targetId:'P',before:f.projects[0],planId:''}},{mode:'execute'});
 assert(link.serverVerified);
});
