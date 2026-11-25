import {beginPairing} from './mcp-connection.js';
const permission={origins:['http://127.0.0.1/*']};
export async function authorizePairing(chrome,{port,discover=beginPairing}={}){
 if(!await chrome.permissions.request(permission))throw Object.assign(Error('未获准连接本机服务'),{code:'BROWSER_PERMISSION_DENIED'});
 const {mcpConnection:previous,mcpPairingPending:waiting}=await chrome.storage.local.get(['mcpConnection','mcpPairingPending']);
 if(waiting?.expires>Date.now()&&(port===undefined||waiting.url==='http://127.0.0.1:'+port))return {pending:waiting};
 const result=await discover({previous,port});
 if(result.pending)await chrome.storage.local.set({mcpPairingPending:result.pending});
 if(result.connection&&JSON.stringify(result.connection)!==JSON.stringify(previous))await chrome.storage.local.set({mcpConnection:result.connection,mcpPairingPending:null});
 return result;
}
export function setupAutoPairing(button,chrome,port,message,clipboard){
 button.onclick=async()=>{
  button.disabled=true;
  try{
   const {pending}=await authorizePairing(chrome,{port:port()});
   if(pending)await clipboard('MDY-PAIRING-OFFER: '+pending.id);
   message(pending?(pending.mismatch?'配对凭据不一致（HTTP 401）。已复制一次性编号，交给本机 Agent 恢复。':'已复制一次性配对编号，交给本机 Agent 完成连接。'):'已复用本机配对。');
  }catch(error){message(error.message,true);}finally{button.disabled=false;}
 };
}
