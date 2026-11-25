import {authorizePairing} from './ui-pairing.js';
import {buildPrompt} from './terminal.js';
import {mcpPrompt} from './mcp-policy.js';
import {assembleExport} from './html-export.js';
import {setupToolPanels} from './ui-panels.js';

const $=id=>document.getElementById(id);
const message=(text,error=false)=>{ $('message').textContent=text; $('message').dataset.error=String(error); };
const send=async input=>{
 const result=await chrome.runtime.sendMessage(input);
 if(!result||result.status==='failed')throw Error(result?.message||'扩展未响应');
 return result;
};
let selectedPlanTab,loginGeneration=0;
const tabId=()=>selectedPlanTab;
async function currentTab(){selectedPlanTab=(await send({kind:'currentPlanTab'})).tabId||undefined;return selectedPlanTab;}
async function busy(id,action){$(id).disabled=true;try{await action();}catch(e){message(e.message,true);}finally{$(id).disabled=false;}}
if(chrome.extension?.getViews({type:'popup'}).includes(window))document.documentElement.classList.add('popup');

async function preparePlanCopy(create){
 let pairing={},diagnostic='';
 try{pairing=await authorizePairing(chrome);}
 catch(error){
  if(!['VERSION_MISMATCH','PORT_OCCUPIED_OR_OLD_RELAY','RELAY_UNREACHABLE','MULTIPLE_INSTANCES','DIFFERENT_INSTANCE','ANOTHER_BROWSER_CONNECTED'].includes(error.code))throw error;
  diagnostic=error.code;
 }
 const selected=create?undefined:await currentTab();
 let context=null;
 if(selected){
  try{
   const response=await send({kind:'run',command:{protocol:'xutu.command/v1',requestId:crypto.randomUUID(),tabId:selected,steps:[{id:'context',op:'site.context',params:{projectGroups:'selected'}}]}});
   context=response.steps[0].data;
  }catch{context={complete:false,warnings:['尚未取得当前计划，连接后须按稳定 ID 核对目标。']};}
  if(await currentTab()!==selected)throw Error('目标网页已变化，请重新选择修改计划。');
 }
 const prompt=buildPrompt(create?'新建独立计划，具体需求在聊天中确认。':'修改已有计划，具体变更在聊天中确认。',context,selected,create?{intent:'create'}:undefined);
 const rules='已有项目沿用正式业务编号。模板裁图按直接连线核对并行和汇合，节点负责人与连线执行人分别确认。保存草稿、提交审核、群内提报、工作机登记分别查证，预览不能当作提交回执。代设任务关联节点按网站权限提交给任务负责人审核，批准前保留原关联。';
 const recovery=diagnostic?'连接诊断 '+diagnostic+'：先核对官方最新正式版与本机三端，保留原配对和其他服务，连通后回读目标再操作。':'';
 return {text:(pairing.pending?'MDY-PAIRING-OFFER: '+pairing.pending.id+'\n':'')+mcpPrompt(prompt)+'\n'+rules+'\n'+recovery,notice:diagnostic?'已复制计划指令，附连接诊断。':pairing.pending?'已复制，等待本机 Agent 完成配对。':'已复制到剪贴板。'};
}
async function copyPlan(create){
 const prepared=preparePlanCopy(create);
 message('正在准备复制…');
 if(typeof ClipboardItem==='function'&&navigator.clipboard.write){
  // Start the clipboard operation during the click. Site reads may outlive transient activation.
  const blob=prepared.then(({text})=>new Blob([text],{type:'text/plain'}));
  await Promise.all([navigator.clipboard.write([new ClipboardItem({'text/plain':blob})]),blob]);
 }else{
  await navigator.clipboard.writeText((await prepared).text);
 }
 message((await prepared).notice);
}
$('copyMcpPrompt').onclick=()=>busy('copyMcpPrompt',()=>copyPlan(false));
$('newPlanPrompt').onclick=()=>busy('newPlanPrompt',()=>copyPlan(true));
$('copyDom').onclick=()=>busy('copyDom',async()=>{
 const tab=await currentTab();
 if(!tab)throw Error('请先打开目标计划站网页。');
 const call=(action,params)=>send({kind:'export',tabId:tab,action,params});
 const meta=await call('begin',{kind:'raw'});
 try{
  const html=await assembleExport(meta,offset=>call('chunk',{exportId:meta.exportId,offset}));
  if(await currentTab()!==tab)throw Error('目标网页已变化，请重新复制。');
  await navigator.clipboard.writeText(html);message('网页 DOM 已复制。');
 }finally{await call('release',{exportId:meta.exportId}).catch(()=>{});}
});
async function refreshStatus(){
 const {mcpConnection,mcpBridgeStatus:s,mcpPairingPending:p,hideSidebar}=await chrome.storage.local.get(['mcpConnection','mcpBridgeStatus','mcpPairingPending','hideSidebar']);
 $('hideSidebar').checked=!!hideSidebar;
 $('mcpState').textContent=p?.expires>Date.now()?'MCP 等待配对':!mcpConnection?.enabled?'MCP 未连接':s?.state==='connected'&&Date.now()-s.at<90000?'MCP 已连接':s?.state==='error'?'MCP 连接失败':'MCP 等待连接';
}
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local')refreshStatus();});
refreshStatus();
setInterval(refreshStatus,30000);
setupToolPanels(document,panel=>{closeLogin();message('');if(panel)loadLoginStatus(false).catch(e=>message(e.message,true));});
$('hideSidebar').onchange=async()=>{
 try{
  await chrome.storage.local.set({hideSidebar:$('hideSidebar').checked});
  try{
   const tabs=await send({kind:'tabs'});
   await Promise.all(tabs.map(tab=>chrome.scripting.executeScript({target:{tabId:tab.id},files:['sidebar-loader.js']})));
   message('旧计划栏设置已保存。');
  }catch{message('设置已保存，刷新计划页后生效。');}
 }catch(error){message(error.message,true);}
};
function displayLogin(info) {
 if (typeof info?.enabled !== 'boolean') throw Error('无法读取自动登录设置。');
 $('loginState').textContent = info.enabled ? '已启用' : '未启用';
 $('loginAccount').value = info.account || '';
 $('loginPassword').value = '';
 $('forgetLogin').hidden = !info.enabled;
 $('loginStatus').textContent = '密码仅保存在本浏览器。';
}
async function loadLoginStatus(expand) {
 const generation = ++loginGeneration;
 const info = await send({kind: 'loginStatus'});
 if (generation !== loginGeneration || $('moreDetails').hidden) return;
 displayLogin(info);
 if (!expand) return;
 $('loginSettings').hidden = false;
 $('editLogin').setAttribute('aria-expanded', 'true');
 $('editLogin').textContent = '收起';
 $('loginAccount').focus();
}
function closeLogin() {
 ++loginGeneration;
 $('loginSettings').hidden = true;
 $('loginPassword').value = '';
 $('editLogin').setAttribute('aria-expanded', 'false');
 $('editLogin').textContent = '设置';
}
$('editLogin').onclick = () => busy('editLogin', async () => {
 if ($('loginSettings').hidden) await loadLoginStatus(true);
 else closeLogin();
});
async function saveLogin(){const account=$('loginAccount').value,password=$('loginPassword').value;const result=await send({kind:'loginSave',account,password});displayLogin(result);closeLogin();message('MDY 自动登录已启用。');}
$('loginSettings').onsubmit=event=>{event.preventDefault();return busy('rememberLogin',saveLogin);};
$('forgetLogin').onclick=()=>busy('forgetLogin',async()=>{const result=await send({kind:'loginClear'});if(result.status==='failed')throw Error(result.message);displayLogin(result);});
