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
 let pairing;
 try{pairing=await authorizePairing(chrome);}
 catch(error){
  if(!['VERSION_MISMATCH','PORT_OCCUPIED_OR_OLD_RELAY','RELAY_UNREACHABLE','MULTIPLE_INSTANCES','DIFFERENT_INSTANCE'].includes(error.code))throw error;
  return {text:'请先检查官方最新正式版 https://github.com/mkiekuum/mdy-terminal/releases/latest ，核实本机扩展、MCP 客户端和中继版本，复用当前配对并完成升级重连。保留其他 MCP 实例。诊断：'+error.code+'。连接后继续'+(create?'新建':'修改')+'计划，具体内容在聊天中确认。',notice:'已复制连接修复指令，请交给本机 Agent。'};
 }
 const selected=create?undefined:await currentTab();
 let context=null;
 if(selected){
  const response=await send({kind:'run',command:{protocol:'xutu.command/v1',requestId:crypto.randomUUID(),tabId:selected,steps:[{id:'context',op:'site.context',params:{projectGroups:'selected'}}]}});
  context=response.steps[0].data;
  if(await currentTab()!==selected)throw Error('目标网页已变化，请重新选择修改计划。');
 }
 const prompt=buildPrompt(create?'新建独立计划，具体需求在聊天中确认。':'修改已有计划，具体变更在聊天中确认。',context,selected,create?{intent:'create'}:undefined);
 return {text:(pairing.pending?'MDY-PAIRING-OFFER: '+pairing.pending.id+'\n':'')+mcpPrompt(prompt),notice:pairing.pending?'已复制，等待本机 Agent 完成配对。':'已复制到剪贴板。'};
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
setupToolPanels(document,panel=>{closeLogin();if(panel)loadLoginStatus(false).catch(e=>message(e.message,true));});
$('hideSidebar').onchange=async()=>{
 try{
  await chrome.storage.local.set({hideSidebar:$('hideSidebar').checked});
  for(const tab of await send({kind:'tabs'}))await chrome.scripting.executeScript({target:{tabId:tab.id},files:['sidebar-loader.js']});
  message('旧计划栏设置已保存。');
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
$('rememberLogin').onclick=()=>busy('rememberLogin',async()=>{const account=$('loginAccount').value,password=$('loginPassword').value;$('loginPassword').value='';const result=await send({kind:'loginSave',tabId:tabId(),account,password});if(result.status==='failed')throw Error(result.message);displayLogin(result);closeLogin();message('MDY 自动登录已启用。');});
$('forgetLogin').onclick=()=>busy('forgetLogin',async()=>{const result=await send({kind:'loginClear'});if(result.status==='failed')throw Error(result.message);displayLogin(result);});
