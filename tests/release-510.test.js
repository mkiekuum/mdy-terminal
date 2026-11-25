import assert from 'node:assert/strict';
import test from 'node:test';
import {McpGate} from '../extension/mcp-policy.js';
import {recoverPlanTab} from '../extension/mcp-target.js';
import {ApiAdapter} from '../extension/api.js';
import {envelope,integrated,site} from './v25-helpers.js';

const make=(number='QA-NEW')=>envelope([{id:'new',op:'plan.create',params:{number,title:'合成新建',startDate:'2026-11-22',priority:'P2',nodes:[{id:'1',name:'开始'},{id:'2',name:'验收'}],edges:[{fromNodeId:'1',toNodeId:'2',executor:'USER_A',estimateDays:{minimum:1,likely:2,maximum:3}}]}}]);
const posts=web=>web.calls.filter(c=>c.method==='POST');
const approved=(id='p')=>({kind:'execute',previewJobId:id,approval:'仅同意本次隔离测试'});

test('independent plan creation from the signed-in home, one approved write and independent MCP readback',async()=>{
 const web=site(),{executor}=integrated(web),command=make();
 const gate=new McpGate((...args)=>executor.run(...args),async()=>({tabId:41,account:web.actor,operation:'plan.create'}));
 const preview=await gate.handle({kind:'preview',id:'p',command});
 const {before,after,validation,plannedTargetId}=preview.result.steps[0].data;
 assert.equal(before,null);assert.equal(after.planNumber,'QA-NEW');assert.equal(after.planOwner,'USER_A');
 assert.equal(after.edges[0].upper,'1-2-3');assert.equal(after.start,'2026-11-22');
 assert.equal(validation.localStructure,'passed');assert.equal(validation.website.write,'not_attempted');
 assert.equal(posts(web).length,0);
 await assert.rejects(gate.handle({...approved(),approval:''}));
 const created=await gate.handle(approved()),step=created.steps[0];
 assert(step.serverVerified);assert.equal(step.targetId,plannedTargetId);assert.equal(step.websiteState.reviewStatus,'draft');assert(step.websiteState.label.includes('已保存'));
 await assert.rejects(gate.handle(approved()),{code:'PREVIEW_EXPIRED'});
 const read=await gate.handle({kind:'read',command:envelope([{id:'get',op:'plan.get',target:{id:step.targetId}}])});
 assert.deepEqual(read.steps[0].data.current,after);
 assert.equal(posts(web).length,1);assert.equal(posts(web)[0].path,'/api/plans');
 const duplicate=await gate.handle({kind:'preview',id:'q',command:make()});
 assert.equal(duplicate.steps[0].code,'PLAN_NUMBER_CONFLICT');
 assert.equal(posts(web).length,1);
});

test('number occupied after preview stops before POST; unknown creation finds original ID and does not repeat',async()=>{
 const web=site(),{executor}=integrated(web);
 const gate=new McpGate((...args)=>executor.run(...args),async()=>({tabId:41,account:web.actor}));
 await gate.handle({kind:'preview',id:'p',command:make('QA-RACE')});
 web.add('QA-RACE');
 const occupied=(await gate.handle(approved())).steps[0];
 assert.equal(occupied.code,'PLAN_NUMBER_CONFLICT');assert.equal(posts(web).length,0);
 const lost=site(),request=lost.request;
 lost.request=async(...args)=>{
  const response=await request(...args);
  if(args[0]==='/api/plans'&&args[1]==='POST')throw Object.assign(Error('lost receipt'),{code:'NETWORK_ERROR'});
  return response;
 };
 const run=integrated(lost),command=make('QA-UNKNOWN');
 const uncertain=await run.executor.run(command),step=uncertain.steps[0];
 assert.equal(step.outcome,'unconfirmed');assert.equal(step.diagnostic.latest.id,step.targetId);
 assert.deepEqual(await run.executor.run(command),uncertain);assert.equal(posts(lost).length,1);
 const pending=await run.history.diagnosePending(lost.actor);
 assert.equal(pending.latest[step.targetId].record.current.planNumber,'QA-UNKNOWN');
});

test('stale tab recovery matches a stable plan in the current page and the original account',async()=>{
 const tabs=[{id:1},{id:2},{id:3}],accounts=['A','B','A'],active=['00041','00041','00042'];
 const options={tabs,planId:'Q',actor:'A',session:async t=>({actor:accounts[t.id-1]}),
  inspect:async t=>({planUrlValue:active[t.id-1]}),list:async()=>[{displayId:'00041',id:'Q'},{displayId:'00042',id:'R'}]};
 assert.deepEqual(await recoverPlanTab(options),{tab:tabs[0],selection:'stable_target'});
 active[2]='00041';assert.equal((await recoverPlanTab(options)).selection,'ambiguous');
 accounts[0]='B';accounts[2]='B';assert.equal((await recoverPlanTab(options)).selection,'no_target');
});

for(const [name,delta,code] of [['version',{revision:2},'VERSION_CONFLICT'],['review',{review:'submitted'},'REVIEW_STATUS_CHANGED'],['account',{account:'B'},'TARGET_CHANGED'],['tab',{tabId:42},'TARGET_CHANGED'],['expiry',{},'PREVIEW_EXPIRED']]){
 test(`${name} change invalidates approval and cannot write`,async()=>{
  let now=1000,identity={account:'A',id:'QA',pagePlanId:'QA',revision:1,review:'draft',tabId:41};
  const gate=new McpGate(async c=>{assert.equal(c.mode,'preview');return {status:'success',steps:[]};},async()=>identity,()=>now);
  const command=envelope([{id:'edit',op:'plan.update',target:{id:'QA',version:1},params:{set:{title:'合成'}}}]);
  await gate.handle({kind:'preview',id:'p',command});
  identity={...identity,...delta};if(name==='expiry')now+=300000;
  await assert.rejects(gate.handle(approved()),{code});
  await assert.rejects(gate.handle(approved()),{code:'PREVIEW_EXPIRED'});
 });
}

test('template repair reports direct edges and independently verifies both sides of the join after save',async()=>{
 const web=site();web.add('QA');const record=web.records.get('QA');
 record.review={status:'submitted'};record.current.edges[0].completedAt='2026-11-20';
 record.current.nodes.push(...['3','4'].map(id=>({id,name:'合成 '+id,owner:'',content:''})));
 const edge={...record.current.edges[0],completedAt:''};
 record.current.edges.push({...edge,from:'2',to:'4'},{...edge,from:'1',to:'4'});
 const change=(op,fromNodeId,toNodeId)=>({op,params:{fromNodeId,toNodeId,...(op==='edge.create'?{executor:'USER_A',estimateDays:{minimum:1,likely:2,maximum:3}}:{})}});
 const batch={id:'batch',op:'plan.batch',target:{id:'QA',version:1},params:{changes:[change('edge.remove','1','4'),change('edge.create','1','3'),change('edge.create','3','4')]}};
 const api=new ApiAdapter(web.request),command=envelope([batch]);
 const preview=await api.run(batch,{...command,mode:'preview'}),{directEdges}=preview.data.changes;
 assert.equal(preview.data.validation.website.reviewStatus,'submitted');assert.equal(preview.data.changes.renamedNodes,0);
 const pairs=edges=>edges.map(({from,to})=>from+to);
 assert.deepEqual(pairs(directEdges.added),['13','34']);assert.deepEqual(pairs(directEdges.removed),['14']);
 assert.deepEqual(pairs(directEdges.retained),['12','24']);
 assert(directEdges.retained.every(e=>e.executorPreserved&&e.durationPreserved&&e.completionPreserved));
 assert.equal(posts(web).length,0);
 const saved=await api.run(batch,command);assert(saved.serverVerified);assert.equal(saved.websiteState.label,'待审核');
 const read=await api.run({id:'verify',op:'plan.get',target:{id:'QA'}},envelope([]));
 const edges=read.data.current.edges;
 assert.deepEqual(pairs(edges.filter(e=>e.to==='4')),['24','34']);
 assert.equal(edges.find(e=>e.from==='1'&&e.to==='2').completedAt,'2026-11-20');
 assert.deepEqual(posts(web).map(p=>p.path),['/api/plans/QA/import']);
});