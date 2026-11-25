import assert from 'node:assert/strict';
import test from 'node:test';
import {ApiAdapter} from '../extension/api.js';
import {collectContext} from '../extension/context.js';
import {site,envelope} from './v25-helpers.js';

test('assistant can repair multiple legacy dashed edges in one verified write', async () => {
 const web = site();
 web.add('P');
 const record = web.records.get('P');
 web.actor = 'USER_B';
 record.assistants = ['USER_B'];
 const first = record.current.edges[0];
 first.dashed = true;
 record.current.nodes.push({id:'3',name:'Next',content:'',owner:''});
 const second = {...first,from:'2',to:'3'};
 record.current.edges.push(second);
 const original = structuredClone(record.current);
 const api = new ApiAdapter(async (path,...args) => {
  const result = await web.request(path,...args);
  return path === '/api/plans' && Array.isArray(result)
   ? result.map(item => ({...item,assistantEditable:true})) : result;
 });
 const changes = [first,second].map(edge => ({
  op:'edge.update',
  params:{fromNodeId:edge.from,toNodeId:edge.to,dashed:false}
 }));
 const step = {id:'repair',op:'plan.batch',target:{id:'P',version:record.revision},params:{changes}};
 const command = envelope([step]);
 const posts = () => web.calls.filter(call => call.method === 'POST');
 await assert.rejects(api.run({...step,params:{changes:changes.slice(0,1)}},command),{code:'INVALID_SCHEMA'});
 assert.equal(posts().length,0);
 const expected = structuredClone(original);
 for (const edge of expected.edges) edge.dashed = false;
 const preview = await api.run(step,{...command,mode:'preview'});
 assert.deepEqual(preview.data.after,expected);
 assert.equal(posts().length,0);
 const saved = await api.run(step,command);
 assert.equal(saved.serverVerified,true);
 assert.equal(posts().length,1);
 assert.deepEqual(saved.data.current,expected);
});

for (const access of ['assistant','collaborator','viewer']) {
 test(access+' permission is scoped to editing the selected plan',async()=>{
  const web=site();
  web.add('P');
  web.actor='USER_B';
  if (access==='assistant') web.records.get('P').assistants=['USER_B'];
  if (access==='collaborator') web.records.get('P').collaborators=['USER_B'];
  const request=async(path,...args)=>{
   const result=await web.request(path,...args);
   return path==='/api/plans'&&Array.isArray(result)
    ? result.map(item=>({...item,assistantEditable:access==='assistant'})) : result;
  };
  const api=new ApiAdapter(request);
  const context=await collectContext(request,{id:'P'});
  assert.equal(context.permissions.canRequestPlanEdit,access!=='viewer');
  assert.equal(context.permissions.canSubmitReview,false);
  const run=(op,params={})=>{
   const step={id:'edit',op,target:{id:'P',version:web.records.get('P').revision},params};
   return api.run(step,envelope([step]));
  };
  await assert.rejects(run('plan.delete'),{code:'PERMISSION_DENIED'});
  await assert.rejects(run('plan.create',{title:'Demo',number:'NEW',owner:'USER_A'}),{code:'PERMISSION_DENIED'});
  const batch={changes:[{op:'node.update',params:{id:'1',set:{name:'Edited'}}},{op:'plan.update',params:{set:{title:'Updated'}}}]};
  if(access==='viewer') await assert.rejects(run('plan.batch',batch),{code:'PERMISSION_DENIED'});
  else assert.equal((await run('plan.batch',batch)).data.current.title,'Updated');
  const writes=web.calls.filter(c=>c.method==='POST');
  assert.deepEqual(writes.map(c=>[c.path,c.body.baseRevision]),access==='viewer'?[]:[['/api/plans/P/change',1]]);
  if(access!=='viewer') assert.equal(web.records.get('P').current.nodes[0].name,'Edited');
 });
}
