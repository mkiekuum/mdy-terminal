import assert from 'node:assert/strict';
import test from 'node:test';
import {ApiAdapter} from '../extension/api.js';
import {verifySaved} from '../extension/recovery.js';
import {site,envelope} from './v25-helpers.js';

test('网站新建时补回 visualIgnore:false，确认新计划而不误报失败或重发',async()=>{
 const web=site();
 const api=new ApiAdapter(async(path,method,body)=>{
  const r=await web.request(path,method,body);
  if(path==='/api/plans'&&method==='POST')web.records.get(body.id).current.edges[0].visualIgnore=false;
  return r;
 });
 const s={id:'create',op:'plan.create',params:{title:'测试草稿',number:'SYNTHETIC-NEW',nodes:[{id:'1',name:'开始验收'},{id:'2',name:'验收完成'}],edges:[{fromNodeId:'1',toNodeId:'2',estimateDays:{minimum:1,likely:1,maximum:1}}]}};
 const r=await api.run(s,envelope([s]));
 assert(r.serverVerified);
 assert.equal(r.verification.defaultedEdgeVisualIgnore,1);
 assert.equal(web.calls.filter(x=>x.method==='POST').length,1);
});
test('回读仍能发现真实显示设置、工期或任意意外字段变化',()=>{
 const web=site();web.add('P');const expected=web.records.get('P').current;
 function rejects(change){
  const after=structuredClone(expected);change(after.edges[0]);assert.throws(()=>verifySaved(expected,after),{code:'SERVER_NOT_CONFIRMED'});
 }
 rejects(e=>e.visualIgnore=true);
 rejects(e=>{e.visualIgnore=false;e.upper='1-1-1';});
 rejects(e=>e.unexpected=false);
 const explicit=structuredClone(expected);explicit.edges[0].visualIgnore=true;
 const after=structuredClone(explicit);after.edges[0].visualIgnore=false;
 assert.throws(()=>verifySaved(explicit,after),{code:'SERVER_NOT_CONFIRMED'});
});
