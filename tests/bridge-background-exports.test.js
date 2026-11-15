import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {createRelay} from '../mcp/relay.mjs';
import {envelope,site} from './v25-helpers.js';

test('MCP 实际 HTTP 到扩展后台：读当前 DOM，保存图与双 CSV，版本改变不落盘',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'xutu-bridge-background-'));
 const clientToken='a'.repeat(40),bridgeToken='b'.repeat(40);
 const {server,jobs}=createRelay({clientToken,bridgeToken,exportRoot:root});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 const name='Synthetic P',web=site();web.add('P');
 const dom=new JSDOM(`<input id="planNumber" value="P"><input id="planOwner" value="USER_A"><input id="title" value="${name}"><input id="csrfToken" value="not-in-output"><svg id="graph" viewBox="0 0 100 50"><text x="10" y="15">1</text><text x="90" y="15">2</text></svg>`,{url:'https://plan.fpgabbs.cn/?plan=P',runScripts:'outside-only'});
 const store={mcpConnection:{enabled:true,tabId:8,url,token:bridgeToken,bridgeId:'synthetic-main'}};
 let onAlarm,drift=false;
 globalThis.indexedDB=new IDBFactory();
 globalThis.chrome={
  runtime:{onMessage:{addListener(){}},onInstalled:{addListener(){}}},
  tabs:{get:async id=>({id,url:dom.window.location.href}),sendMessage:async(id,msg)=>{
   assert.equal(id,8);assert.equal(msg.kind,'api');
   return {ok:true,data:await web.request(msg.path,msg.method,msg.body)};
  }},
  scripting:{executeScript:async ({target,world,func,args})=>{
   assert.equal(target.tabId,8);assert.equal(world,'ISOLATED');
   const result=dom.window.eval(`(${func.toString()})`)(...args);
   if(drift&&func.name==='captureRenderedPlan')web.records.get('P').revision++;
   return [{result}];
  }},
  storage:{local:{get:async key=>({[key]:store[key]}),set:async x=>Object.assign(store,x)}},
  alarms:{create(){},onAlarm:{addListener:fn=>onAlarm=fn}}
 };
 const rpc=async(name,args)=>{
  const reply=await fetch(url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+clientToken,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
  const result=(await reply.json()).result;
  assert.equal(result.isError,undefined,JSON.stringify(result.content));
  return JSON.parse(result.content[0].text);
 };
 const tick=()=>onAlarm({name:'xutu-mcp'});
 const until=async check=>{for(let i=0;i<80;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw Error('浏览器桥轮询超时');};
 const readJob=async(name,args)=>{
  const {jobId}=await rpc(name,args);tick();await until(()=>jobs.get(jobId).status==='completed');return (await rpc('xutu_result',{jobId})).result;
 };
 try{
  await import('../extension/background.js');
  tick();await until(()=>store.mcpBridgeStatus?.state==='connected');
  const domRead=await readJob('xutu_read',{command:envelope([{id:'d',op:'site.dom.read'}])});
  assert.match(domRead.steps[0].data.content,/Synthetic P/);
  assert.doesNotMatch(domRead.steps[0].data.content,/csrfToken|not-in-output/);
  assert(!Object.keys(store).some(k=>k.startsWith('job:')));
  const artifact=await readJob('xutu_export',{planId:'P',version:1,directory:'verified',formats:['csv','svg','html']});
  assert.equal(artifact.status,'success',JSON.stringify(artifact));assert.equal(artifact.files.length,4);
  const svg=artifact.files.find(x=>x.name==='网络图.svg');
  assert.match(await readFile(svg.path,'utf8'),/viewBox="0 0 100 50"/);
  const nodes=artifact.files.find(x=>x.name==='节点.csv');
  assert.match(await readFile(nodes.path,'utf8'),/需求确定/);
  drift=true;
  const output=await readJob('xutu_export',{planId:'P',version:1,directory:'must-not-exist',formats:['csv','svg']});
  assert.equal(output.status,'failed');assert.match(output.message,/网站版本变化/);
  await assert.rejects(readFile(path.join(root,'must-not-exist','节点.csv')),e=>e.code==='ENOENT');
  assert.equal(web.calls.filter(x=>x.method==='POST').length,0);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  dom.window.close();delete globalThis.chrome;delete globalThis.indexedDB;
  await rm(root,{recursive:true,force:true});
 }
});
