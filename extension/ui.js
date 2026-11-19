import {setupAppearance} from './appearance.js';
import {setupRecordsPanel} from './ui-records.js';
import {setupToolPanels} from './ui-panels.js';
import {mcpPrompt} from './mcp-policy.js';
import {createConnection} from './mcp-connection.js';
import {flowFeedback} from './flow-check.js';
import {projectGroupMode} from './prompt-context.js';
import {businessDiff} from './history.js';
import {helpPackage,readableDiff} from './assistance.js';
import {compactPlanEdits} from './batch-input.js';
import {prepareCommand,buildPrompt,summarize,commandSummary,stableRequestId} from './terminal.js';
import {formatCompatibility} from './compatibility.js';
import {VERSION} from './core.js';
import {buildAgentUpdatePrompt} from './updates.js';
import {setupHistory,setupExport} from './ui-workflows.js';
const $=id=>document.getElementById(id);let openingTabId,selectedPlanTab,lastRequestId='',compatibilityReport=null,compatibilityGeneration=0,refreshGeneration=0;
if (chrome.extension?.getViews({type: 'popup'}).includes(window)) {
 document.documentElement.classList.add('popup');
}
setupAppearance(document,chrome.storage.local).catch(()=>message('外观设置读取失败',true));
let loginGeneration = 0;
setupToolPanels(document, panel => {
 closeLogin();
 if (panel === 'moreDetails') loadLoginStatus(false).catch(e => message(e.message, true));
});
let updateReport=null,lastCommand=null,lastResult=null,pendingAction=null;
function review(notice,details,action){$('reviewPanel').hidden=false;$('reviewNotice').textContent=notice;$('reviewDiff').textContent=typeof details==='string'?details:JSON.stringify(details,null,2);const selected=openingTabId;pendingAction=async()=>{const target=await send({kind:'currentPlanTab'});if(selected!==target.tabId)throw Error('网页选择已变化，请重新核对影响。');await action();};}
$('cancelAction').onclick=()=>{pendingAction=null;$('reviewPanel').hidden=true;message('已保留网站现状。');};
$('confirmAction').onclick=()=>busy('confirmAction',async()=>{const action=pendingAction;pendingAction=null;$('reviewPanel').hidden=true;if(action)await action();});
chrome.runtime.onMessage.addListener((m,sender)=>{if(sender.id===chrome.runtime.id&&m.kind==='executionPhase'&&m.requestId===lastRequestId&&$('execute').disabled){const labels={checking:'正在检查网站最新内容…',submitting:'正在提交修改，请勿重复执行…',verifying:'网站已响应，正在回读核对…'};if(labels[m.phase])message(labels[m.phase]);}});
const tabId=()=>selectedPlanTab||undefined;
const message=(text,error=false)=>{$('message').textContent=text;$('message').dataset.error=String(error);};
const send=async input=>{const result=await chrome.runtime.sendMessage(input);if(!result)throw Error('插件未响应，请重新加载插件。');return result;};
const updatePromise=(async()=>{
 try{const result=await send({kind:'updates'});if(!['available','current','ahead','unknown'].includes(result.status))throw Error('UPDATE_UNAVAILABLE');updateReport=result;}
 catch{updateReport={status:'unknown',currentVersion:VERSION,reason:'请确认已重新加载插件，并检查网络后重新打开。'};}
 $('updateStatus').textContent='v'+VERSION+' · '+({available:'新版 v'+updateReport.latestVersion,current:'已是最新版',ahead:'高于当前正式版',unknown:'暂无法检查更新'}[updateReport.status]);
 if(updateReport.status==='available'&&updateReport.releaseUrl?.startsWith('https://github.com/mkiekuum/xutu-control-terminal/releases/')){$('updateAdvice').textContent='建议更新至 v'+updateReport.latestVersion;$('updateBanner').hidden=false;$('installUpdate').href=updateReport.releaseUrl;$('installUpdate').hidden=false;}
 $('moreLabel').textContent=updateReport.status==='available'?'设置 · 新版':'设置';$('moreLabel').dataset.update=String(updateReport.status==='available');
})();
const envelope=(op,target)=>({protocol:'xutu.command/v1',requestId:crypto.randomUUID(),...(tabId()?{tabId:tabId()}:{}),steps:[{id:'read',op,...(target?{target}:{})}]});
function data(result){if(result.status!=='success')throw Error(summarize(result));return result.steps[0].data;}
async function busy(id,action){const button=$(id);button.disabled=true;try{await action();}catch(e){message(e.message,true);}finally{button.disabled=button.dataset.locked==='true';}}
async function clipboard(text){try{await navigator.clipboard.writeText(text);$('manualCopy').hidden=true;$('manualCopyText').value='';}catch{$('manualCopy').hidden=false;$('manualCopy').open=true;$('manualCopyText').value=text;throw Error('未能写入剪贴板，请在下方“手动复制内容”中复制完整文本。');}}
$('copyUpdate').onclick=()=>busy('copyUpdate',async()=>{await updatePromise;await clipboard(buildAgentUpdatePrompt(updateReport,{currentVersion:VERSION,extensionId:chrome.runtime.id}));message('更新指令已复制，交给能操作本机的 AI Agent 执行；尚未更新软件。');});
function showCompatibility(report){$('compatibilityDetails').hidden=!report;compatibilityReport=report;$('compatibilityStatus').textContent=report?.status==='ok'?'基础只读检查通过；业务写入仍由服务器判定。':report?.status==='limited'?'部分检查待核对，展开下方报告查看。':'尚未完成网页兼容性检查。';$('compatibilityOutput').textContent=formatCompatibility(report);}
async function checkCompatibility(){const generation=++compatibilityGeneration,selected=tabId();let report;
 try{report=selected?data(await send({kind:'run',command:envelope('site.compatibility')})):null;}
 catch{report={status:'unavailable',checkedAt:new Date().toISOString(),checks:[{id:'connection',status:'fail',message:'无法读取兼容性报告，请确认插件已重新加载且序图网页已打开。'}],scope:'未执行业务写入。'};}
 if(generation===compatibilityGeneration&&selected===tabId())showCompatibility(report);return report;
}
const recordContext=setupRecordsPanel(document,async op=>data(await send({kind:'run',command:envelope(op)})));
async function readContext(projectGroups='selected'){if($('workDomain').value!=='plan')return recordContext();if(!tabId())return {complete:false,plan:null,warnings:['未打开序图网页，先根据需求提问，不猜测已有计划。']};try{const command=envelope('site.context');command.steps[0].params={projectGroups};const context=data(await send({kind:'run',command}));if(context.compatibility)showCompatibility(context.compatibility);return context;}catch{return {complete:false,plan:null,warnings:['本次计划上下文读取失败；请先核对登录、目标网页及兼容性，不得假设当前计划内容。'],compatibility:compatibilityReport};}}
$('checkCompatibility').onclick=()=>busy('checkCompatibility',checkCompatibility);
$('copyCompatibility').onclick=()=>busy('copyCompatibility',async()=>{const report=await checkCompatibility();await clipboard(formatCompatibility(report));message('兼容状态已复制，可交给维护者；不含计划内容。');});
async function refresh(){
 const generation=++refreshGeneration;
 const found=await send({kind:'currentPlanTab'});
 if(generation!==refreshGeneration)return;
 selectedPlanTab=Number(found.tabId)||undefined;
 openingTabId=selectedPlanTab;
 if(!tabId()){$('connection').textContent='请切到序图页';document.querySelector('.connection-strip').dataset.state='error';++compatibilityGeneration;showCompatibility(null);return;}
 const session=await send({kind:'run',command:envelope('site.session')});if(generation!==refreshGeneration)return;$('connection').textContent=session.status==='success'?'已连接当前页':'请检查网站登录';document.querySelector('.connection-strip').dataset.state=session.status==='success'?'connected':'error';await checkCompatibility();
}
$('openSite').onclick=()=>busy('openSite',async()=>{await send({kind:'openSite'});});
$('copyPrompt').onclick=()=>busy('copyPrompt',async()=>{
 const selected=tabId(),requestText=$('request').value,context=await readContext(projectGroupMode(requestText));
 if(selected!==tabId()||requestText!==$('request').value)throw Error('操作选择或需求已变化，请重新复制以获取对应资料。');
 await clipboard(buildPrompt(requestText,context,selected));message('普通 AI 提示词已复制。');
});
function mergeWarnings(result) {
 return (result.steps || []).flatMap(step => (step.data?.changes?.redundantEdges || []).map(edge =>
  '重复连线 ' + edge.from + ' → ' + edge.to + '，已有间接路径 ' + edge.alternatePath.join(' → ') + '。' + edge.message
 )).join('\n');
}
function showResult(result,command){lastResult=result;if(command)lastCommand=command;$('output').textContent=JSON.stringify(result,null,2);$('resultDetails').hidden=false;$('recoveryActions').hidden=result.status==='success';$('helpPrivacy').hidden=result.status==='success';message([summarize(result),mergeWarnings(result),flowFeedback(result)].filter(Boolean).join('\n'),result.status!=='success');if(result.status!=='success')$('resultDetails').open=true;}
async function execute(command){let result;try{result=await send({kind:'run',command});}catch{result={requestId:command.requestId,status:'failed',code:'TIMEOUT_RESULT_UNKNOWN',message:'连接中断，执行结果尚未确认。请只读核对，不要重新提交。'};}showResult(result,command);if(result.code==='HISTORY_SNAPSHOT_INCOMPLETE'||result.steps?.some(x=>x.code==='HISTORY_SNAPSHOT_INCOMPLETE'))await historyUI.inspectPending();}
function highImpact(command){return command.steps.some(s=>['plan.delete','plan.archive','plan.replace','plan.restore','plan.restoreSnapshot','history.restore'].includes(s.op)||s.op==='task.merge'||s.op==='node.remove'||s.op==='edge.remove'||s.op==='plan.batch'&&s.params.changes.some(c=>['task.merge','node.remove','edge.remove'].includes(c.op)));}
$('execute').onclick=()=>busy('execute',async()=>{
 lastRequestId=await stableRequestId($('editor').value);
 const command=compactPlanEdits(prepareCommand($('editor').value,tabId(),lastRequestId));
 $('changeSummary').textContent=commandSummary(command);lastCommand=command;
 if(command.mode!=='execute'){message('正在只读检查，尚未提交网站…');await execute(command);return;}
 const historyStep=command.steps.find(s=>['history.undo','history.redo','history.restorePoint'].includes(s.op));
 if(historyStep){if(command.steps.length!==1)throw Error('恢复历史请单独执行，先查看实际差异。');const direction=historyStep.op==='history.undo'?'undo':historyStep.op==='history.redo'?'redo':'point';const check=envelope('history.preview');check.steps[0].params={direction,...Object.fromEntries(Object.entries(historyStep.params||{}).filter(([k])=>k!=='reviewToken'))};const preview=data(await send({kind:'run',command:check}));if(!preview.canRestore)throw Error(preview.errors.map(e=>e.message).join('；'));historyStep.params={...historyStep.params,reviewToken:preview.reviewToken};review(preview.conflicts.length?'同字段发生冲突，请核对原值、网站现值和恢复值。':preview.notice,readableDiff(preview.changes),()=>execute(command));return;}
 if(highImpact(command)){
  const preview=await send({kind:'run',command:{...command,mode:'preview'}});if(preview.status!=='success'||preview.steps.some(s=>s.data?.flowCheck?.canSubmit===false)){showResult(preview,command);return;}
  // Pin every previewed target to its read version. A concurrent edit must stop execution.
  for(const step of command.steps){const info=preview.steps.find(x=>x.id===step.id)?.data;if(step.target&&!step.target.versionFrom&&Number.isInteger(info?.revision))step.target.version=info.revision;}
  review([mergeWarnings(preview),'请核对实际差异，确认后执行。'].filter(Boolean).join('\n'),readableDiff(preview.steps.map(s=>({targetId:command.steps.find(c=>c.id===s.id)?.target?.id,lifecycle:!s.data?.after,diff:businessDiff(s.data?.before,s.data?.after)}))),()=>execute(command));return;
 }
 message('格式校验通过，正在核对网站最新内容并执行…');await execute(command);
});
$('copyHelp').onclick=()=>busy('copyHelp',async()=>{await clipboard(helpPackage(lastResult,lastCommand));message('求助资料已复制，包含相关计划字段与回读差异；请仅发送给可信 AI。');});
$('diagnoseRequest').onclick=()=>busy('diagnoseRequest',async()=>{if(!lastResult?.requestId)throw Error('没有可核对的请求。');const c=envelope('system.status');c.steps[0].params={requestId:lastResult.requestId};const status=data(await send({kind:'run',command:c}));const pending=await historyUI.inspectPending();$('output').textContent=JSON.stringify({original:lastResult,requestStatus:status,pending},null,2);message('已只读检查原请求与历史；没有重发任何写入。');});
$('editor').addEventListener('input',()=>{pendingAction=null;$('reviewPanel').hidden=true;try{$('changeSummary').textContent=commandSummary(prepareCommand($('editor').value,tabId(),'preview-only'));}catch{$('changeSummary').textContent=$('editor').value.trim()?'指令格式待补全':'';}});
$('copyResult').onclick=event=>{event.preventDefault();busy('copyResult',async()=>{await clipboard($('output').textContent);message('结果已复制。');});};
const helpers={$,tabId,send,message,busy,clipboard,envelope,data,attachDiagnosis:report=>{if(lastResult)lastResult={...lastResult,pendingDiagnosis:report};}};
const historyUI=setupHistory(helpers);setupExport(helpers);
window.addEventListener('unhandledrejection',event=>message(event.reason?.message||'连接异常，请重新打开插件。',true));
refresh().catch(e=>{$('connection').textContent='暂未连接';document.querySelector('.connection-strip').dataset.state='error';message(e.message,true);});

$('copyMcpPrompt').onclick = () => busy('copyMcpPrompt', async () => {
 const text = $('request').value, selected = tabId();
 let connection;
 if (selected) {
  const allowed = await chrome.permissions.request({origins:['http://127.0.0.1/*']});
  if (!allowed) throw Error('需允许访问本机服务才能连接 MCP');
  const {mcpConnection:previous} = await chrome.storage.local.get('mcpConnection');
  connection = createConnection(selected, previous);
  await chrome.storage.local.set({mcpConnection:connection});
 }
 const context = await readContext(projectGroupMode(text));
 if (selected !== tabId() || text !== $('request').value) throw Error('需求或目标变化，请重新复制');
 await clipboard(mcpPrompt(buildPrompt(text, context, selected), connection));
 message(selected ? '已复制 MCP 提示词。' : '已复制提示词。打开序图页后可配对 MCP。');
});
async function refreshMcpSettings() {
 const {mcpConnection, mcpBridgeStatus, optimizeSidebar, hideSidebar} = await chrome.storage.local.get(['mcpConnection', 'mcpBridgeStatus', 'optimizeSidebar', 'hideSidebar']);
 $('optimizeSidebar').checked = !!optimizeSidebar;
 $('hideSidebar').checked = !!hideSidebar;
 const state = mcpBridgeStatus?.state;
 let label = 'MCP 未连接';
 if (mcpConnection?.enabled) {
  const recent = Date.now() - mcpBridgeStatus?.at <= 90000;
  label = state === 'connected' && recent ? 'MCP 已连接' : state === 'error' ? 'MCP 连接失败' : 'MCP 等待连接';
 }
 $('mcpState').textContent = label;
 $('mcpState').title = mcpBridgeStatus?.message || '';
 $('disconnectMcp').hidden = !mcpConnection;
}
refreshMcpSettings();
$('optimizeSidebar').onchange=async()=>{try{await chrome.storage.local.set({optimizeSidebar:$('optimizeSidebar').checked});for(const t of await send({kind:'tabs'}))await chrome.scripting.executeScript({target:{tabId:t.id},files:['sidebar-loader.js']});message('网页侧栏设置已保存；只影响界面，不修改计划。');}catch(e){message(e.message,true);}};
$('hideSidebar').onchange=async()=>{try{await chrome.storage.local.set({hideSidebar:$('hideSidebar').checked});for(const t of await send({kind:'tabs'}))await chrome.scripting.executeScript({target:{tabId:t.id},files:['sidebar-loader.js']});message('侧栏设置已保存，网页左侧“计划”按钮可恢复。');}catch(e){message(e.message,true);}};
$('disconnectMcp').onclick=()=>busy('disconnectMcp',async()=>{await chrome.storage.local.remove(['mcpConnection','mcpBridgeStatus','mcpPreviews']);$('mcpState').textContent='已断开，清除本机连接密钥。';});

chrome.storage.onChanged?.addListener((changes, area) => {
 if (area === 'local' && (changes.mcpConnection || changes.mcpBridgeStatus || changes.optimizeSidebar || changes.hideSidebar)) refreshMcpSettings();
});

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
$('rememberLogin').onclick=()=>busy('rememberLogin',async()=>{const account=$('loginAccount').value,password=$('loginPassword').value;$('loginPassword').value='';const result=await send({kind:'loginSave',tabId:tabId(),account,password});if(result.status==='failed')throw Error(result.message);displayLogin(result);closeLogin();message('序图自动登录已启用。');});
$('forgetLogin').onclick=()=>busy('forgetLogin',async()=>{const result=await send({kind:'loginClear'});if(result.status==='failed')throw Error(result.message);displayLogin(result);});
