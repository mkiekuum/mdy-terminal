import test from 'node:test';
import assert from 'node:assert/strict';
import {resultView, makeRoom} from '../mcp/job-results.mjs';
import {pagePlanTarget} from '../extension/page-plan-target.js';
import {startMcpBridge} from '../extension/mcp-bridge.js';

test('page links resolve display IDs before editable identity fields', async () => {
  const page = {planUrlValue:'00041', activeTarget:{number:'old'}};
  assert.deepEqual(await pagePlanTarget(page, async () => [{displayId:'00041',id:'stable'}]),{id:'stable'});
  await assert.rejects(pagePlanTarget(page, async () => []), {code:'TARGET_NOT_FOUND'});
  assert.deepEqual(await pagePlanTarget({activeTarget:page.activeTarget}),page.activeTarget);
});

test('overview and field paging retain the complete original receipt', () => {
  const value = {plan:{current:{nodes:[{}],edges:[],title:'计划📝'}},complete:true};
  const job = {id:'j',status:'completed',overview:true,command:{},approval:'private',
    result:{status:'success',steps:[{status:'success',data:value}]}};
  assert.equal(resultView(job,{}).result.nodes,1);
  const path = ['steps','0','data','plan'];
  let offset = 0, serialized = '';
  do {
    const part = resultView(job,{path,offset,limit:3});
    serialized += part.jsonText;
    offset = part.nextOffset;
  } while (offset !== null);
  assert.deepEqual(JSON.parse(serialized),value.plan);
  assert.throws(() => resultView(job,{path:['__proto__']}));
  assert.equal(resultView(job,{}).approval,undefined);
});

test('cache pressure preserves receipts for writes and pending jobs', () => {
  const jobs = new Map(Array.from({length:1000},(_,i)=>[i,{kind:'execute',status:'completed',createdAt:0}]));
  assert.throws(()=>makeRoom(jobs,400000));
  jobs.set(0,{kind:'read',status:'dispatched',createdAt:0});
  jobs.set(1,{kind:'read',status:'completed',createdAt:0});
  makeRoom(jobs,400000);
  assert(jobs.has(0));
  assert(!jobs.has(1));
});

test('a lost response retries only the receipt and honors explicit page selection', async () => {
  const values = {mcpConnection:{enabled:true,url:'http://127.0.0.1:62924',bridgeId:'test-browser'}};
  const storage = {get:async key=>({[key]:values[key]}),set:async patch=>Object.assign(values,patch)};
  const job = {id:'test',kind:'read',command:{protocol:'xutu.command/v1',requestId:'read',
    tabId:42,steps:[{id:'s',op:'site.session'}]}};
  let runs=0, pulls=0;
  const receipts=[];
  const bridge=startMcpBridge({storage,resolveTarget:async command=>({tab:{id:command.tabId}}),
    run:async (_,config)=>{assert.equal(config.tabId,42);runs++;return {status:'success'};},
    fetcher:async (url,options)=>{
      if(url.endsWith('/next')) return Response.json(++pulls===1?job:null);
      receipts.push(options.body);
      if(receipts.length===1)throw Error('connection interrupted');
      return Response.json({ok:true});
    }});
  await bridge.tick();
  assert.equal(values.mcpBridgeStatus.state,'error');
  await bridge.tick();
  assert.equal(runs,1);
  assert.equal(receipts.length,2);
  assert.equal(receipts[0],receipts[1]);
});
