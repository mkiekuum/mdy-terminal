// Isolated synthetic QA only: a new headless Chrome profile, never the user's browser.
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';import {pathToFileURL} from 'node:url';import http from 'node:http';import assert from 'node:assert/strict';
import {fixture} from '../tests/export-fixture.js';import {assembleExport} from '../extension/html-export.js';
const root=path.resolve(import.meta.dirname,'..'),chrome=process.argv[2],out=path.resolve(process.argv[3]||path.join(os.tmpdir(),'xutu-v25-browser-evidence'));
if(!chrome)throw Error('Usage: node tools/verify-browser.mjs ABSOLUTE_CHROME_PATH PRIVATE_OUTPUT_DIR');
await fs.mkdir(out,{recursive:true});const profile=await fs.mkdtemp(path.join(os.tmpdir(),'xutu-v25-isolated-'));
const sample=await fixture(),raw=await sample.capture('raw'),meta=await sample.capture('offline'),html=await assembleExport(meta,o=>sample.chunk(meta.exportId,o));sample.dom.window.close();
const snapshot=path.join(out,'synthetic-offline.html');await fs.writeFile(snapshot,html.replace('</body>','<script>document.body.dataset.unsafe="ran";fetch("https://example.invalid/write",{method:"POST"})</script></body>'));
const child=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-default-apps','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ws,server,id=0;const pending=new Map(),events=[];
try{
 let portInfo;for(let i=0;i<300;i++){if(child.exitCode!==null)throw Error("Isolated Chrome exited: "+child.exitCode);try{portInfo=await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8');break;}catch{await sleep(100);}}if(!portInfo)throw Error('Isolated Chrome did not start');
 const [port,endpoint]=portInfo.trim().split(/\r?\n/);ws=new WebSocket('ws://127.0.0.1:'+port+endpoint);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}else events.push(m);};
 const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error('CDP timeout: '+method));},15000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params,...(sessionId?{sessionId}:{})}));});
 const version=await call('Browser.getVersion'),target=await call('Target.createTarget',{url:'about:blank'}),{sessionId}=await call('Target.attachToTarget',{targetId:target.targetId,flatten:true});const send=(method,params)=>call(method,params,sessionId);
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 await send('Page.enable');await send('Network.enable');await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});await send('Page.navigate',{url:pathToFileURL(snapshot).href});
 for(let i=0;i<50;i++){if(await evaluate("document.readyState==='complete'&&document.title==='合成离线验收'"))break;await sleep(100);}
 const offline=await evaluate(`({title:document.title,table:document.querySelector('table')?.innerText,svg:document.querySelector('svg')?.getBoundingClientRect().width,dialog:document.querySelector('dialog')?.open,shadow:document.querySelector('#shadow')?.shadowRoot?.textContent,input:document.querySelector('#input')?.value,disabled:document.querySelector('button')?.disabled,inert:document.querySelector('form')?.inert,unsafe:document.body.dataset.unsafe||null,csp:document.querySelector('meta[http-equiv]')?.content})`);
 assert.equal(offline.title,'合成离线验收');assert(offline.table.includes('验收完成'));assert(offline.svg>0);assert(offline.dialog);assert(offline.shadow.includes('影子树内文'));assert.equal(offline.input,'仅property中的新值');assert(offline.disabled&&offline.inert);assert.equal(offline.unsafe,null);
 const writes=events.filter(e=>e.method==='Network.requestWillBeSent'&&e.params.request.method==='POST');assert.equal(writes.length,0);
 const boot=`import {site} from '/tests/v25-helpers.js';const web=site();web.add('P');const baseRequest=web.request;web.request=async(path,...args)=>{if(path==='/api/records/meta')return {users:['USER_A'],reviewer:false,types:['硬件'],statuses:['等待']};if(path==='/api/records/projects')return [{id:'QA-PROJECT',shortName:'隔离项目',owner:'USER_A',status:'已启动'}];if(path==='/api/records/tasks')return [{id:'QA-TASK',title:'硬件-QA',owner:'USER_A',status:'等待'}];if(path==='/api/records/requests')return [{id:'QA-REQUEST',payload:{shortName:'隔离申请'},status:'pending'}];return baseRequest(path,...args);};window.qaSite=web;Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('test manual-copy fallback')}}});let listeners=[];const local={};window.chrome={permissions:{request:async()=>true},runtime:{id:'a'.repeat(32),getURL:f=>location.origin+'/'+f,onInstalled:{addListener:f=>{window.qaInstalled=f}},onMessage:{addListener:f=>listeners.push(f)},sendMessage:m=>new Promise(resolve=>listeners.forEach(listener=>listener(m,{id:'a'.repeat(32),url:location.origin+'/ui.html'},resolve)))},storage:{local:{get:async k=>({[k]:local[k]}),set:async obj=>Object.assign(local,obj),remove:async k=>{delete local[k]}}},tabs:{get:async id=>({id,url:'https://plan.fpgabbs.cn/'}),query:async()=>[{id:123,title:'合成验收网页',url:'https://plan.fpgabbs.cn/',active:true}],sendMessage:async(id,m)=>{if(m.kind==='inspect')return {origin:'https://plan.fpgabbs.cn',anchors:{},activeTarget:{id:'P'}};try{return {ok:true,data:await web.request(m.path,m.method,m.body)};}catch(e){return {ok:false,code:e.code,message:e.message};}}},scripting:{executeScript:async options=>[{result:{available:false}}]},userScripts:{getScripts:async()=>[]}};window.fetch=async()=>({status:200,url:'https://github.com/mkiekuum/xutu-control-terminal/releases/tag/v99.0.0',body:null});await import('/extension/background.js');await import('/extension/ui.js');window.qaReady=true;`;
 server=http.createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname;if(name==='/boot.js'){res.setHeader('Content-Type','text/javascript');res.end(boot);return;}if(name==='/ui.html'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end((await fs.readFile(path.join(root,'extension/ui.html'),'utf8')).replace('href="ui.css"','href="/extension/ui.css"').replace('src="ui.js"','src="/boot.js"'));return;}if(!/^\/(extension|tests)\/[\w.-]+\.(js|css)$/.test(name)){res.writeHead(404).end();return;}res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');res.end(await fs.readFile(path.join(root,name.slice(1))));}catch{res.writeHead(500).end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});await send('Emulation.setDeviceMetricsOverride',{width:460,height:800,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/ui.html'});
 for(let i=0;i<50;i++){if(await evaluate('window.qaReady===true'))break;await sleep(100);}await sleep(150);
 for (const width of [280,400,880]) {
  await send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
  for (const theme of ['light','dark']) {
   await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
   const layout=await evaluate(`(()=>{
    const by=id=>document.getElementById(id);
    const rect=id=>by(id).getBoundingClientRect();
    const mcp=rect('copyMcpPrompt'),ordinary=rect('copyPrompt'),request=rect('request');
    const details=by('editor').closest('details');
    const closed=!details.open && !by('editor').checkVisibility();
    details.open=true;
    const editor=rect('editor'),execute=rect('execute');
    details.open=false;
    function fills(panel, ids) {
     const group=by(panel);
     group.hidden=false;
     const bounds=by(ids[0]).parentElement.getBoundingClientRect();
     const buttons=ids.map(rect);
     const ok=Math.abs(buttons[0].left-bounds.left)<1 && Math.abs(buttons.at(-1).right-bounds.right)<1 && buttons.every(b=>Math.abs(b.width-buttons[0].width)<1 && b.top===buttons[0].top);
     group.hidden=true;
     return ok;
    }
    const lowerPanels=fills('historyBody',['copyHistory']) && fills('pageToolsPanel',['copyDom','saveOffline']);
    return {closed,lowerPanels,aligned:mcp.left===request.left&&mcp.top===ordinary.top&&mcp.right<ordinary.left&&Math.abs(mcp.width-ordinary.width)<=1&&mcp.height===ordinary.height,editorAligned:editor.left===request.left&&editor.width===request.width&&execute.left===mcp.left&&execute.height===mcp.height&&Math.abs(execute.width-editor.width)<1,overflow:document.documentElement.scrollWidth>innerWidth};
   })()`);
   assert.deepEqual(layout,{closed:true,lowerPanels:true,aligned:true,editorAligned:true,overflow:false},width+'px '+theme);
  }
 }
 await send('Emulation.setDeviceMetricsOverride',{width:460,height:800,deviceScaleFactor:1,mobile:false});
 await send('Emulation.setEmulatedMedia',{features:[]});
 const upgrade=await evaluate(`(async()=>{
  const keep={xutuThemes:{mode:'stored'},xutuThemeUndo:['previous'],optimizeSidebar:true,hideSidebar:true,terminalAppearance:{theme:'dark',density:'compact'},customPreference:'unchanged'};
  await chrome.storage.local.set({...keep,releaseCheck:{stale:true}});
  await window.qaInstalled({reason:'update'});
  for(const [key,value] of Object.entries(keep)){
   if(JSON.stringify((await chrome.storage.local.get(key))[key])!==JSON.stringify(value))return false;
  }
  return !(await chrome.storage.local.get('releaseCheck')).releaseCheck;
 })()`);
 assert(upgrade,'updating must preserve user settings');
 const appearanceUI=await evaluate(`(async()=>{
  const {setupAppearance}=await import('/extension/appearance.js');
  await setupAppearance(document,chrome.storage.local);
  if(document.documentElement.dataset.theme!=='dark'||document.documentElement.dataset.density!=='compact')return false;
  document.getElementById('themeChoice').value='light';await document.getElementById('themeChoice').onchange();
  document.getElementById('densityChoice').value='comfortable';await document.getElementById('densityChoice').onchange();
  const saved=(await chrome.storage.local.get('terminalAppearance')).terminalAppearance;
  return saved.theme==='light'&&saved.density==='comfortable';
 })()`);
 assert(appearanceUI,'appearance settings persist after upgrade');
 const hiddenSidebar=await evaluate(`(async()=>{
  const {installSidebarUI}=await import('/extension/sidebar-ui.js');
  const host=document.createElement('aside');host.id='fileSidebar';host.innerHTML='<button id="fileSidebarToggle">计划</button>';document.body.append(host);
  const ui=installSidebarUI(document,{hidden:true});
  const hidden=getComputedStyle(host).display==='none';
  document.getElementById('xutu-sidebar-restore').click();
  const shown=getComputedStyle(host).display!=='none';
  document.getElementById('xutu-sidebar-hide').click();
  const hiddenAgain=getComputedStyle(host).display==='none';
  ui.destroy();host.remove();return hidden&&shown&&hiddenAgain;
 })()`);
 assert(hiddenSidebar,'sidebar can be completely hidden and restored');
 const sidebarModes=await evaluate(`(async()=>{
  const select=document.getElementById('sidebarMode');
  for(const mode of ['native','overlay','hidden']){
   select.value=mode;await select.onchange();
   const hidden=(await chrome.storage.local.get('hideSidebar')).hideSidebar;
   const overlay=(await chrome.storage.local.get('optimizeSidebar')).optimizeSidebar;
   if(hidden!==(mode==='hidden')||overlay!==(mode!=='native'))return false;
  }
  return true;
 })()`);
 assert(sidebarModes,'sidebar selector preserves compatible settings');
 await evaluate(`document.getElementById('moreToggle').onclick()`);
 await send('Emulation.setDeviceMetricsOverride',{width:460,height:1250,deviceScaleFactor:1,mobile:false});
 for(const theme of ['light','dark']){
  await evaluate(`(async()=>{document.getElementById('themeChoice').value='${theme}';await document.getElementById('themeChoice').onchange();})()`);
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await fs.writeFile(path.join(out,'settings-'+theme+'.png'),Buffer.from(shot.data,'base64'));
 }
 await evaluate(`(async()=>{document.getElementById('moreToggle').onclick();document.getElementById('themeChoice').value='light';await document.getElementById('themeChoice').onchange();})()`);
 await send('Emulation.setDeviceMetricsOverride',{width:460,height:800,deviceScaleFactor:1,mobile:false});
 const initialShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(out,'initial-ui.png'),Buffer.from(initialShot.data,'base64'));
 const ui=await evaluate(`({ready:window.qaReady,compactHelp:!document.querySelector('#usageHelp'),width:document.documentElement.scrollWidth,cli:!!document.querySelector('#testCli'),request:!!document.querySelector('#request')})`);assert(ui.ready&&ui.compactHelp&&ui.request&&!ui.cli);assert(ui.width<=460);
 const banner=await evaluate(`({visible:!document.getElementById('updateBanner').hidden,version:document.getElementById('updateAdvice').textContent,url:document.getElementById('installUpdate').href,collapsed:!document.getElementById('editor').closest('details').open})`);
 assert(banner.visible&&banner.version.includes('99.0.0')&&banner.url.endsWith('/tag/v99.0.0')&&banner.collapsed);
 const loginUI=await evaluate(`(async()=>{
  const $=id=>document.getElementById(id);
  $('moreToggle').click();
  const initial=$('loginSettings').hidden&&$('editLogin').getAttribute('aria-expanded')==='false';
  await $('editLogin').onclick();
  const expanded=!$('loginSettings').hidden&&$('editLogin').getAttribute('aria-expanded')==='true';
  $('loginAccount').value='synthetic-user';
  $('loginPassword').value='synthetic-password';
  await $('rememberLogin').onclick();
  const saved=$('loginSettings').hidden&&$('loginPassword').value===''&&$('message').textContent.includes('已启用');
  await $('editLogin').onclick();
  const privateOnReopen=$('loginAccount').value==='synthetic-user'&&$('loginPassword').value==='';
  await $('forgetLogin').onclick();
  const cleared=$('loginAccount').value===''&&$('loginState').textContent.includes('未启用');
  await $('editLogin').onclick();
  return {initial,expanded,saved,privateOnReopen,cleared,closed:$('loginSettings').hidden};
 })()`);
 for(const value of Object.values(loginUI))assert.equal(value,true,JSON.stringify(loginUI));

 await evaluate(`(async()=>{document.querySelector('#request').value='模拟复杂产品计划，20个节点';await document.querySelector('#copyPrompt').onclick();})()`);
 const emptyPrompts=await evaluate(`(async()=>{
  const request=document.getElementById('request');
  request.value='   ';
  for(const id of ['copyPrompt','copyMcpPrompt']){
   await document.getElementById(id).onclick();
   const text=document.getElementById('manualCopyText').value;
   if(!text.includes('尚未填写需求')||!text.includes('最近一组未回答选项'))return false;
   if(text.includes('Authorization: Bearer')!==(id==='copyMcpPrompt'))return false;
  }
  return true;
 })()`);
 assert(emptyPrompts);
 const questions=await evaluate(`({count:document.querySelectorAll('#intakeQuestions fieldset').length,hidden:!!document.querySelector('#intakePanel'),message:document.querySelector('#message').textContent})`);assert.equal(questions.count,0);assert.equal(questions.hidden,false);
 const promptScope=await evaluate(`(async()=>{const before=qaSite.calls.filter(c=>c.path==='/api/project-groups').length;document.querySelector('#request').value='新建并分配到项目组';await document.querySelector('#copyPrompt').onclick();return {unrelatedGroupReads:before,groupReads:qaSite.calls.filter(c=>c.path==='/api/project-groups').length,hasRequestedGroups:document.querySelector('#manualCopyText').value.includes('Synthetic group')};})()`);
 assert.equal(promptScope.groupReads-promptScope.unrelatedGroupReads,1);assert.equal(promptScope.hasRequestedGroups,true,JSON.stringify(promptScope));
 const mcpCopy=await evaluate(`(async()=>{const c={url:'http://127.0.0.1:62924',clientToken:'SYNTHETIC_CLIENT_TOKEN'.repeat(3),token:'SYNTHETIC_BRIDGE_TOKEN'.repeat(3),bridgeId:'synthetic-browser',tabId:123,enabled:true};await chrome.storage.local.set({mcpConnection:c});await document.querySelector('#copyMcpPrompt').onclick();const text=document.querySelector('#manualCopyText').value;const result={client:text.includes(c.clientToken),setupBridge:text.includes(c.token),need:text.includes(document.querySelector('#request').value)};await document.querySelector('#copyPrompt').onclick();result.ordinaryNoKey=!document.querySelector('#manualCopyText').value.includes(c.clientToken);return result;})()`);assert(mcpCopy.client&&mcpCopy.setupBridge&&mcpCopy.need&&mcpCopy.ordinaryNoKey);
 const execution=await evaluate(`(async()=>{const c={protocol:'xutu.command/v1',requestId:'synthetic-batch-ui',steps:[{id:'a',op:'node.batchUpdate',target:{id:'P',version:1},params:{updates:[{id:'1',set:{name:'确认名称'}}]}},{id:'b',op:'plan.update',target:{id:'P',versionFrom:'a'},dependsOn:['a'],params:{set:{title:'Synthetic batch'}}}]};document.querySelector('#editor').value=JSON.stringify(c);await document.querySelector('#execute').onclick();return {message:document.querySelector('#message').textContent,summary:document.querySelector('#changeSummary').textContent,result:JSON.parse(document.querySelector('#output').textContent).status,posts:window.qaSite.calls.filter(c=>c.method==='POST').length,revision:window.qaSite.records.get('P').revision};})()`);
 assert.equal(execution.result,'success');assert.equal(execution.posts,1);assert.equal(execution.revision,2);assert(execution.message.includes('已回读确认'));assert(execution.summary.includes('一次提交'));
 const mergeUI=await evaluate(`(async()=>{
  qaSite.add('MERGE');
  const current=qaSite.records.get('MERGE').current;
  current.nodes=['1','2','3','4'].map(id=>({id,name:'阶段'+id,owner:'USER_A',content:''}));
  current.edges=[['1','2'],['2','3'],['1','4'],['4','3']].map(([from,to])=>({...current.edges[0],from,to}));
  const step={id:'m',op:'task.merge',target:{id:'MERGE',version:1},params:{nodeIds:['1','2','3'],name:'综合设计'}};
  const check=async(mode,output)=>{
   document.getElementById('editor').value=JSON.stringify({protocol:'xutu.command/v1',mode,steps:[step]});
   await document.getElementById('execute').onclick();
   return document.getElementById(output).textContent.includes('重复连线 1 → 3，已有间接路径 1 → 4 → 3');
  };
  const before=qaSite.calls.filter(c=>c.method==='POST').length;
  const preview=await check('preview','message'),review=await check('execute','reviewNotice');
  const pending=!document.getElementById('reviewPanel').hidden;
  await document.getElementById('cancelAction').onclick();
  return preview&&review&&pending&&qaSite.calls.filter(c=>c.method==='POST').length===before;
 })()`);
 assert.equal(mergeUI,true,'merge preview displays direct and indirect paths before saving');
 const recordsUI=await evaluate(`(async()=>{
  const domain=document.getElementById('workDomain');
  for(const value of ['projects','tasks','requests']){
   domain.value=value;domain.onchange();await document.getElementById('refreshRecords').onclick();
   if(document.getElementById('recordChoice').options.length!==2)throw Error('Records selector failed');
   document.getElementById('recordChoice').selectedIndex=1;
   await document.getElementById('copyPrompt').onclick();
   const copied=document.getElementById('manualCopyText').value;
   if(!copied.includes('records.submit')||!copied.includes('QA-'))throw Error('Records prompt missing context');
  }
  domain.value='plan';domain.onchange();return document.getElementById('recordsPanel').hidden;
 })()`);
 assert.equal(recordsUI,true);
 const flowUI=await evaluate(`(async()=>{
  const $=id=>document.getElementById(id),posts=()=>qaSite.calls.filter(c=>c.method==='POST').length,revision=qaSite.records.get('P').revision,original=qaSite.records.get('P').current.title;
  const preview={protocol:'xutu.command/v1',requestId:'synthetic-explicit-preview',mode:'preview',steps:[{id:'u',op:'plan.update',target:{id:'P',version:revision},params:{set:{title:'Must not save'}}}]};
  const count=posts();$('editor').value=JSON.stringify(preview);await $('execute').onclick();const previewReadOnly=posts()===count&&qaSite.records.get('P').current.title===original&&$('message').textContent.includes('尚未写入');
  const current=qaSite.records.get('P').current,reference={nodes:current.nodes.map((n,i)=>({id:n.id,name:n.name,content:n.content||'',kind:i?'outcome':'event'})),dependencies:[{from:'1',to:'2'}],works:[{id:'work',fromNodeId:'1',toNodeId:'2',estimateDays:{minimum:1,likely:2,maximum:3}}]};
  const c={protocol:'xutu.command/v1',requestId:'synthetic-flow-rejected',steps:[{id:'b',op:'plan.batch',target:{id:'P',version:revision},params:{flowCheck:reference,changes:[{op:'node.update',params:{id:'1',set:{name:'Unapproved name'}}}]}}]};
  $('editor').value=JSON.stringify(c);await $('execute').onclick();const result=JSON.parse($('output').textContent),rejected=posts()===count&&result.steps[0].code==='FLOW_CHECK_FAILED'&&$('message').textContent.includes('未保存')&&result.steps[0].flowCheck.diff.names.length===1;
  return {previewReadOnly,rejected,detailsAvailable:!$('resultDetails').hidden,helpAvailable:!$('recoveryActions').hidden};
 })()`);
 for(const [check,value] of Object.entries(flowUI))assert.equal(value,true,check);
 const recoveryUI=await evaluate(`(async()=>{
  const $=id=>document.getElementById(id),posts=()=>qaSite.calls.filter(c=>c.method==='POST').length;
  qaSite.records.get('P').current.deadline='2026-12-01';qaSite.records.get('P').revision++;
  const before=posts();
  $('historyToggle').onclick();
  if ($('historyBody').hidden || !$('moreDetails').hidden || !$('pageToolsPanel').hidden) throw Error('history panel did not open exclusively');
  await $('copyHistory').onclick();
  const copied=$('manualCopyText').value;
  const history=JSON.parse(copied.slice(copied.indexOf('\\n')+1));
  const entry=history.entries.at(-1);
  const historyCopy=!!entry?.before?.P&&!!entry?.after?.P&&posts()===before;
  async function restore(point){
   $('editor').value=JSON.stringify({protocol:'xutu.command/v1',steps:[{id:'restore',op:'history.restorePoint',params:{historyId:entry.historyId,point}}]});
   await $('execute').onclick();
  }
  await restore('before');const undoReview=!$('reviewPanel').hidden&&posts()===before;await $('confirmAction').onclick();
  const undone=qaSite.records.get('P').current.title==='Synthetic P'&&qaSite.records.get('P').current.deadline==='2026-12-01';
  await restore('after');await $('confirmAction').onclick();const redone=qaSite.records.get('P').current.title==='Synthetic batch';
  $('editor').value=JSON.stringify({protocol:'xutu.command/v1',requestId:'synthetic-delete-ui',steps:[{id:'d',op:'plan.delete',target:{id:'P',version:qaSite.records.get('P').revision},params:{}}]});const deleteBefore=posts();await $('execute').onclick();const deleteReview=!$('reviewPanel').hidden&&posts()===deleteBefore;await $('cancelAction').onclick();
  qaSite.beforePost=()=>{throw Object.assign(Error('timeout'),{code:'TIMEOUT_RESULT_UNKNOWN'});};$('editor').value=JSON.stringify({protocol:'xutu.command/v1',requestId:'synthetic-lost-ui',steps:[{id:'u',op:'plan.update',target:{id:'P',version:qaSite.records.get('P').revision},params:{set:{title:'Unknown'}}}]});await $('execute').onclick();const unknown=$('message').textContent.includes('尚未确认');const unknownPosts=posts();await $('diagnoseRequest').onclick();const diagnosed=JSON.parse($('output').textContent).pending.pending&&posts()===unknownPosts;
  await $('copyHelp').onclick();const helpCopy=$('manualCopyText').value.includes('system.status')||$('message').textContent.includes('求助资料已复制');
  return {undoReview,undone,redone,historyCopy,deleteReview,unknown,diagnosed,helpCopy};
 })()`);
 for(const [check,value] of Object.entries(recoveryUI))assert.equal(value,true,check);
 let nativeSidebarCode='';if(process.argv[4]){const source=await fs.readFile(process.argv[4],'utf8');const begin=source.indexOf(" const fileSidebar=document.getElementById('fileSidebar')"),end=source.indexOf(" const sidebar=document.getElementById('historySidebar')",begin);if(begin<0||end<0)throw Error('Native sidebar source anchors changed');nativeSidebarCode=source.slice(begin,end);}
 const sidebarUI=await evaluate(`(async()=>{const host=document.createElement('section');host.innerHTML='<aside id="fileSidebar" class="is-collapsed"><button id="fileSidebarToggle">计划文件</button><button id="fileSidebarPin">固定</button><div>合成列表</div></aside><div id="sidebarOutside">外部空白</div>';document.body.append(host);${nativeSidebarCode?('(()=>{'+nativeSidebarCode+'})();'):''}const {installSidebarUI}=await import('/extension/sidebar-ui.js');const p=document.getElementById('fileSidebar'),t=document.getElementById('fileSidebarToggle'),ui=installSidebarUI();p.dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}));p.dispatchEvent(new PointerEvent('pointermove',{pointerType:'mouse',bubbles:true}));const noHover=p.classList.contains('is-collapsed');const close=[];for(let i=0;i<4;i++){t.click();const opened=!p.classList.contains('is-collapsed');if(i===0)t.click();if(i===1)document.getElementById('sidebarOutside').click();if(i===2)document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));if(i===3)document.getElementById('xutu-sidebar-close').click();close.push(opened&&p.classList.contains('is-collapsed'));}ui.destroy();const restored=!document.documentElement.classList.contains('xutu-sidebar-optimized');host.remove();return {noHover,close,restored};})()`);
 assert(sidebarUI.noHover&&sidebarUI.close.every(Boolean)&&sidebarUI.restored);
 // Synthetic UI evidence, never a screenshot of the user's website.
 const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(out,'synthetic-ui.png'),Buffer.from(screenshot.data,'base64'));
 const report={browser:version.product,isolatedProfile:true,siteLogin:false,offlineEmulation:true,rawBytes:raw.bytes,offlineBytes:meta.bytes,missingResources:meta.missingResources,offline,networkWrites:writes.length,ui,questions,promptScope,mcpCopy,execution,flowUI,recoveryUI,sidebarUI,nativeSidebarSource:!!nativeSidebarCode,loginUI,scope:'合成数据：真实Chrome离线渲染及网页模式UI；未安装扩展，未登录真实网站，未验证生产写入或系统剪贴板'};await fs.writeFile(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await call('Browser.close');
}finally{if(ws?.readyState===1)ws.close();for(const p of pending.values())clearTimeout(p.timer);if(server)await new Promise(resolve=>server.close(resolve));if(child.exitCode===null)child.kill();}
