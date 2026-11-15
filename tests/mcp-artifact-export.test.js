import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {JSDOM} from 'jsdom';
import {captureSafeDocument,captureRenderedPlan} from '../extension/exports.js';
import {rememberedLogin,triggerLogin} from '../extension/remember-login.js';
import {createRelay} from '../mcp/relay.mjs';
import {exportRequest,printHtml,saveExport,tables} from '../mcp/export-files.mjs';
import {McpGate,checked} from '../extension/mcp-policy.js';
import {ApiAdapter} from '../extension/api.js';
import {site,envelope,memory} from './v25-helpers.js';

const browser=(html,url='https://plan.fpgabbs.cn/?plan=P')=>new JSDOM(html,{url,runScripts:'outside-only'});
function example(){
 const web=site();web.add('P');
 const record=web.records.get('P');
 return {...record,graph:{svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120"><line x1="70" y1="65" x2="245" y2="65" stroke="#173a2b"></line><text x="65" y="65">1</text><text x="251" y="65">2</text></svg>',viewBox:[0,0,320,120],nodePoints:[{id:'1',x:65,y:65},{id:'2',x:251,y:65}]},analysis:{available:true,calculation:{totalDays:2,nodeCompletion:{'1':0,'2':2},schedule:[{te:0,tl:0,slack:0}]},score:{findings:[{rule:'测试',message:'建议内容'}]}},document:{sanitized:true,content:'<main inert><p>完整业务输入</p></main>'}};
}
const req=(over={})=>exportRequest({planId:'P',version:1,directory:'计划管理/P',...over});
const fakeRender=async({file,type})=>fs.writeFile(file,type==='pdf'?Buffer.from('%PDF-1.7 example'):Buffer.from('89504e470d0a1a0a00','hex'));
async function temp(t){const r=await fs.mkdtemp(path.join(os.tmpdir(),'xutu-export-test-'));t.after(()=>fs.rm(r,{recursive:true,force:true}));return r;}

test('DOM 保留当前编辑字段和序图 HTML，同时排除脚本、登录输入、隐含密钥及网络动作',()=>{
 const dom=browser('<input id="main" aria-label="阶段"><input id="secret" value="PRIVATE"><input type="password" value="NOPE"><input type="hidden" value="HIDDEN"><button onclick="steal()">检查</button><script>MY_TOKEN</script><a href="https://outside.test/?token=SECRET">来源</a><textarea id="notes"></textarea><iframe src="https://outside.test"></iframe>');
 dom.window.document.querySelector('#main').value='已输入字段';
 dom.window.document.querySelector('#notes').value='实际内容';
 const func=dom.window.eval('('+captureSafeDocument.toString()+')');
 const r=func({selector:'body'});assert.match(r.content,/已输入字段/);assert.match(r.content,/实际内容/);assert.doesNotMatch(r.content,/PRIVATE|NOPE|HIDDEN|MY_TOKEN|SECRET|onclick|iframe|https:\/\/outside/);assert.equal(r.url,'https://plan.fpgabbs.cn/');
 assert.throws(()=>func({selector:'#secret'}),/DOM_SENSITIVE_SCOPE/);assert.throws(()=>func({selector:'body',maxChars:5}),/DOM_TOO_LARGE/);
 dom.window.close();
});
test('SVG 只针对打开且身份一致的计划；移除外链及活动元素',()=>{
 const dom=browser('<input id="planNumber" value="P"><input id="planOwner" value="USER_A"><input id="title" value="计划"><svg id="graph" viewBox="0 0 200 160"><script>bad</script><rect onclick="bad()" fill="url(https://example.test/image)" width="5" height="5"/><text x="10" y="12">1</text></svg>');
 const func=dom.window.eval('('+captureRenderedPlan.toString()+')');
 const target={id:'P',planNumber:'P',planOwner:'USER_A',title:'计划'};
 const r=func(target);assert.deepEqual(JSON.parse(JSON.stringify(r.nodePoints)),[{id:'1',x:10,y:12}]);assert.doesNotMatch(r.svg,/onclick|script|example/);assert.throws(()=>func({...target,id:'Q'}),/OPEN_MATCHING_PLAN/);dom.window.close();
});
test('PDF 选项、节点和连线原始内容互不混淆；输出可读中文',()=>{
 const e=example(),p=req().capture.print,s=printHtml(e,p);
 assert.match(s,/计划网络图/);assert.match(s,/序号定义表（2）/);assert.match(s,/连线定义表（1）/);assert.doesNotMatch(s,/独立评分表|图中序号名称/);
 const custom=printHtml(e,req({formats:['pdf'],print:{graph:true,nodeNames:true,edgeTable:false,nodeTable:false,scoreTable:true,paper:'A3',landscape:false}}).capture.print);
 assert.match(custom,/size:A3 portrait/);assert.match(custom,/图中序号名称/);assert.match(custom,/独立评分表/);assert.doesNotMatch(custom,/连线定义表|序号定义表/);
 assert.match(tables(e.current).edges,/"1","2","1","2","3"/);assert.match(tables(e.current).nodes,/型号 A12/);
});
test('文件组有校验值、不会覆盖、拒绝跨目录、链接和不完整写入',async t=>{
 const root=await fs.realpath(await temp(t)),source=example();
 const request=req({formats:['csv','pdf','svg','png','html'],region:{x:20,y:10,width:100,height:80}});
 const r=await saveExport({root},request,source,{render:fakeRender});
 assert.equal(r.files.length,6);
 assert(r.files.every(f=>f.sha256.length===64&&path.dirname(f.path)===path.join(root,'计划管理','P')));
 assert.match(await fs.readFile(r.files.find(f=>f.name.endsWith('.svg')).path,'utf8'),/viewBox="20 10 100 80"/);
 await assert.rejects(saveExport({root},request,source,{render:fakeRender}),/未覆盖/);
 for(const d of ['../逃逸','a/../b','/tmp','C:/tmp','AUX','路径\\越界'])assert.throws(()=>req({directory:d}),/相对路径/);
 if(process.platform!=='win32'){await fs.symlink(os.tmpdir(),path.join(root,'link'));await assert.rejects(saveExport({root},req({directory:'link/unsafe',formats:['csv']}),source),/符号链接/);}
 const failed=req({directory:'rollback',formats:['csv','pdf']});await assert.rejects(saveExport({root},failed,source,{render:async()=>{throw Error('synthetic render failed');}}),/render failed/);assert.deepEqual(await fs.readdir(path.join(root,'rollback')),[]);
});
test('MCP 浏览器桥返回结果后在授权目录落盘；只读令牌不接触源载荷',async t=>{
 const root=await temp(t),clientToken='x'.repeat(40),bridgeToken='y'.repeat(40),{server}=createRelay({clientToken,bridgeToken,exportRoot:root});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 const client=(name,args)=>fetch(base+'/mcp',{method:'POST',headers:{authorization:'Bearer '+clientToken,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}).then(r=>r.json()).then(r=>JSON.parse(r.result.content[0].text));
 const headers={authorization:'Bearer '+bridgeToken,'x-xutu-bridge-id':'test-browser','content-type':'application/json'};
 const poll=()=>fetch(base+'/bridge/next',{headers}).then(r=>r.json());
 assert.equal(await poll(),null);const queued=await client('xutu_export',{planId:'P',version:1,directory:'project',formats:['csv']});
 const job=await poll();assert.equal(job.id,queued.jobId);assert.equal(job.directory,undefined);
 const gate=new McpGate(()=>{throw Error('not a command');},async()=> 'bound');
 gate.exportArtifacts=async payload=>{assert.equal(payload.planId,'P');return example();};
 const returned=await gate.handle(job);
 assert.equal((await fetch(base+'/bridge/result',{method:'POST',headers,body:JSON.stringify({id:job.id,result:returned})})).status,200);
 const final=await client('xutu_result',{jobId:queued.jobId});assert.equal(final.result.files.length,2);assert.equal(final.result.current,undefined);
});
test('复制到目标图仅提交一次，保护两个版本并不修改来源；区域边界关系明示',async()=>{
 const web=site();web.add('P');web.add('Q'); const api=new ApiAdapter(web.request);
 const step={id:'copy',op:'plan.copyGraph',target:{id:'Q',version:1},params:{source:{id:'P',version:1},nodeIds:['1']}};
 checked(envelope([step]));const preview=await api.run(step,envelope([step],{mode:'preview'}));
 assert.equal(web.calls.filter(c=>c.method==='POST').length,0);assert.equal(preview.data.changes.addedNodes,1);assert.equal(preview.data.changes.omittedBoundaryEdges.length,1);
 const first=await api.run(step,envelope([step]));assert.equal(first.afterVersion,2);assert.equal(first.data.current.nodes.length,3);assert.equal(web.records.get('P').revision,1);assert.equal(web.calls.filter(c=>c.method==='POST').length,1);
 await assert.rejects(api.run({...step,target:{id:'Q',version:2},params:{source:{id:'P',version:8}}},envelope([step])),/来源图已变化/);
 web.records.get('Q').current.planOwner='USER_B';
 await assert.rejects(api.run({...step,target:{id:'Q',version:2}},envelope([step])),/PERMISSION_DENIED/);
});
test('记住账号只在准确的网站登出后自动尝试；不回显密码及重试轰炸',async()=>{
 let submits=0,session='logged_out';
 const auth=rememberedLogin(memory(),{inspectSession:async()=>session,submit:async()=>{submits++;return 'attempted';},now:()=>12});
 assert.deepEqual(await auth.save('test-account','private-pass'),{enabled:true,account:'test-account'});
 assert.equal((await auth.status()).password,undefined);assert.equal(await auth.onPage({id:4,url:'https://different.example/'}),'wrong_origin');
 assert.equal(await auth.onPage({id:1,url:'https://plan.fpgabbs.cn/'}),'attempted');assert.equal(await auth.onPage({id:2,url:'https://plan.fpgabbs.cn/'}),'already_attempted');assert.equal(submits,1);
 session='already_logged_in';assert.equal(await auth.onPage({id:1,url:'https://plan.fpgabbs.cn/'}),session);await auth.clear();assert.equal(await auth.onPage({id:1,url:'https://plan.fpgabbs.cn/'}),'disabled');
});
test('自动登录只填真正的同站表单，并让正常网站事件提交；验证码不尝试',()=>{
 const dom=browser('<form id="cloudLoginForm"><input type="text"><input type="password"><button>登录</button></form>');
 const f=dom.window.document.querySelector('form');f.getClientRects=()=>[{x:0}];
 const fields=f.querySelectorAll('input');let observed;
 f.addEventListener('submit',e=>{observed=[fields[0].value,fields[1].value];e.preventDefault();});
 const func=dom.window.eval('('+triggerLogin.toString()+')');
 assert.equal(func({account:'qa',password:'test'}),'attempted');assert.deepEqual(observed,['qa','test']);assert.equal(fields[1].value,'');
 f.append(Object.assign(dom.window.document.createElement('input'),{autocomplete:'one-time-code'}));assert.equal(func({account:'qa',password:'test'}),'manual_verification');
 dom.window.close();
});
test('新建测试图和可恢复删除分别用已确认的预览；正式记录不变',async()=>{
 const web=site();web.add('P');const before=JSON.stringify(web.records.get('P'));const api=new ApiAdapter(web.request);
 const run=async e=>({status:'success',steps:[{id:e.steps[0].id,status:'success',...await api.run(e.steps[0],e)}]});
 const gate=new McpGate(run,()=>web.actor);
 const create=envelope([{id:'new',op:'plan.create',params:{number:'QA-MCP',title:'仅用于验收',nodes:[{id:'1',name:'待验证'}]}}]);
 const preview=await gate.handle({id:'create',kind:'preview',command:create});assert.equal(web.records.size,1);
 await assert.rejects(gate.handle({kind:'execute',previewJobId:preview.previewJobId,approval:''}),/缺少用户/);
 const executed=await gate.handle({kind:'execute',previewJobId:preview.previewJobId,approval:'合成验收：确认新建'});
 const job=executed.steps[0];assert(job.serverVerified&&job.targetId!=='P');
 const cleanup=envelope([{id:'trash',op:'plan.delete',target:{id:job.targetId,version:job.afterVersion},params:{permanent:false}}]);
 const trash=await gate.handle({id:'trash',kind:'preview',command:cleanup});assert.equal(web.records.size,2);
 const removed=await gate.handle({kind:'execute',previewJobId:trash.previewJobId,approval:'合成验收：确认移到垃圾桶'});
 assert(removed.steps[0].data.recoverable);assert.equal(web.records.size,1);assert.equal(JSON.stringify(web.records.get('P')),before);
});
