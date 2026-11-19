import assert from 'node:assert/strict';
import test from 'node:test';
import {McpGate} from '../extension/mcp-policy.js';
import {envelope, integrated, site} from './v25-helpers.js';

const planId = 'QA-PROGRESS', path = '/api/plans/' + planId;
const date = '2026-11-02';

function isolated(access = 'assistants', op = 'progress.update') {
 const web = site();
 web.add(planId);
 const record = web.records.get(planId);
 record.current.start = '2026-11-01';
 record.current.nodes.push({id:'3', name:'验收', owner:'USER_A', content:''});
 record.current.edges[0].completedAt = record.current.start;
 record.current.edges.push({...record.current.edges[0], from:'2', to:'3', completedAt:''});
 record.current.baseline = structuredClone(record.current);
 record.review = {status:'approved'};
 web.actor = 'USER_B';
 if (access) record[access] = [web.actor];
 const {executor} = integrated(web);
 const command = envelope([{id:'progress', op, target:{id:planId,version:1},
  params:{fromNodeId:'2',toNodeId:'3',actualCompleteDate:date}}]);
 const gate = new McpGate(c => executor.run(c), async () => web.actor);
 const preview = () => gate.handle({kind:'preview', id:'p', command});
 const execute = () => gate.handle({kind:'execute', previewJobId:'p', approval:'确认更新隔离计划'});
 const posts = () => web.calls.filter(c => c.method === 'POST');
 return {web, record, preview, execute, posts, command};
}

for (const [access,op] of [['assistants','progress.update'],['collaborators','progress.complete']]) {
 test(op+' previews and reads back the authorized plan editor’s change',async()=>{
  const f=isolated(access,op), result=await f.preview();
  assert.equal(result.result.steps[0].data.after.edges[1].completedAt,date);
  assert.equal(f.posts().length,0);
  const saved=await f.execute();
  assert.equal(saved.status,'success');
  assert.equal(saved.steps[0].serverVerified,true);
  assert.equal(saved.steps[0].afterVersion,2);
  assert.equal(saved.steps[0].data.current.edges[1].completedAt,date);
  const [post]=f.posts();
  assert.equal(f.posts().length,1);
  assert.equal(post.path,path+'/change');
  assert.equal(post.body.baseRevision,1);
  assert.ok(post.body.operation);
  assert.ok(f.web.calls.slice(f.web.calls.indexOf(post)+1).some(c=>c.method==='GET'&&c.path===path));
  assert.ok(!f.web.calls.some(c=>c.path.startsWith('/api/work-tasks')));
 });
}

test('viewer is refused and revocation after preview prevents execution',async()=>{
 const viewer=isolated(null);
 const denied=await viewer.preview();
 assert.equal(denied.steps[0].code,'PERMISSION_DENIED');
 assert.equal(denied.steps[0].outcome,'not_executed');
 assert.equal(viewer.posts().length,0);
 const f=isolated();
 assert.equal((await f.preview()).previewJobId,'p');
 f.record.assistants=[];
 assert.equal((await f.execute()).steps[0].code,'PERMISSION_DENIED');
 assert.equal(f.posts().length,0);
});

for (const race of ['permission','revision','readback']) {
 test('server '+race+' change cannot produce a false success',async()=>{
  const f=isolated();
  await f.preview();
  f.web.beforePost=(endpoint,body)=>{
   assert.equal(endpoint,path+'/change');
   if(race==='permission') f.record.assistants=[];
   if(race==='revision') f.record.revision++;
   if(race==='readback') body.current.edges[1].completedAt='';
  };
  const result=await f.execute();
  assert.equal(result.steps[0].code,{permission:'PERMISSION_DENIED',revision:'VERSION_CONFLICT',readback:'SERVER_NOT_CONFIRMED'}[race]);
  assert.equal(f.posts().length,1);
  assert.equal(f.record.current.edges[1].completedAt,'');
 });
}

test('preview enforces date picker availability and predecessor dates',async()=>{
 for (const change of [f=>{f.record.review.status='submitted';},f=>{f.record.current.baseline=null;},
  f=>{f.record.current.edges[0].completedAt='';},f=>{f.record.current.edges[0].completedAt='2026-11-03';}]) {
  const f=isolated();
  change(f);
  assert.equal((await f.preview()).steps[0].code,'INVALID_SCHEMA');
  assert.equal(f.posts().length,0);
 }
 const f=isolated();
 f.record.current.edges[1].completedAt=date;
 f.command.steps[0].params.actualCompleteDate='';
 await f.preview();
 assert.equal((await f.execute()).steps[0].data.current.edges[1].completedAt,'');
});
