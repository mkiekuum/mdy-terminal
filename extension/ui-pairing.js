import {beginPairing} from './mcp-connection.js';
const permission={origins:['http://127.0.0.1/*']};
export async function authorizePairing(chrome,tabId,discover=beginPairing){
 const selected=tabId();
 if(!selected)throw Error('请先打开 MDY 计划站网页');
 if(!await chrome.permissions.request(permission))throw Object.assign(Error('未获准连接本机服务'),{code:'BROWSER_PERMISSION_DENIED'});
 const {mcpConnection:previous}=await chrome.storage.local.get('mcpConnection');
 const result=await discover(selected,{previous});
 if(selected!==tabId())throw Error('目标网页已变化，请重新连接');
 if(result.pending)await chrome.storage.local.set({mcpPairingPending:result.pending});
 if(result.connection)await chrome.storage.local.set({mcpConnection:{...result.connection,tabId:selected}});
 return result;
}
export function setupAutoPairing(button,chrome,tabId,message,clipboard){
 button.onclick=async()=>{
  try{
   const {pending}=await authorizePairing(chrome,tabId);
   if(pending)await clipboard('MDY-PAIRING-OFFER: '+pending.id);
   message(pending?(pending.mismatch?'检测到旧配对不一致，等待本机 Agent 核准恢复。':'等待本机 Agent 核准连接。'):'已复用本机配对。');
  }catch(error){message(error.message,true);}
 };
}
