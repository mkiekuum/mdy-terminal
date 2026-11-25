import {relayUrl} from './mcp-bridge.js';
import {VERSION} from './core.js';
// Import only the local relay credentials; never accept website sessions or arbitrary options.
export function parseConnection(text,tabId){
 if(!Number.isInteger(tabId)||tabId<=0)throw Error('请先选择MDY 计划站网页');
 if(typeof text!=='string'||text.length>4096)throw Error('连接文件过大或格式不正确');
 let c;try{c=JSON.parse(text);}catch{throw Error('请选择本机 MCP 生成的 connection.json');}
 if(!c||typeof c!=='object')throw Error('连接文件格式不正确');
 const url=relayUrl(c.url);
 for(const key of ['clientToken','bridgeToken'])if(typeof c[key]!=='string'||!/^[-_a-zA-Z0-9]{32,256}$/.test(c[key]))throw Error('连接文件密钥无效，请重新生成');
 if(c.clientToken===c.bridgeToken)throw Error('AI 密钥和浏览器密钥必须分开');
 return {url,token:c.bridgeToken,clientToken:c.clientToken,bridgeId:crypto.randomUUID(),tabId,enabled:true};
}

export function createConnection(tabId,previous){
 if(!Number.isInteger(tabId)||tabId<=0)throw Error('请先选择MDY 计划站网页');
 const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 const c=previous?.clientToken&&previous?.token?parseConnection(JSON.stringify({url:previous.url,clientToken:previous.clientToken,bridgeToken:previous.token}),tabId):parseConnection(JSON.stringify({url:'http://127.0.0.1:62924',clientToken:random(),bridgeToken:random()}),tabId);
 return {...c,bridgeId:previous?.bridgeId||c.bridgeId};
}

export const pairingPorts=Array.from({length:11},(_,i)=>62924+i);
const randomProof=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const error=(code,message)=>Object.assign(Error(message),{code});
function localRequest(fetcher,url,endpoint,headers={},method='POST'){
 return fetcher(relayUrl(url)+'/pairing/'+endpoint,{method,headers,signal:AbortSignal.timeout(1500),redirect:'error',cache:'no-store',credentials:'omit'});
}

export async function beginPairing(tabId,{previous,fetcher=fetch,ports=pairingPorts}={}){
 if(!Number.isInteger(tabId)||tabId<=0)throw Error('请先选择MDY 计划站网页');
 const urls=previous?.url?[relayUrl(previous.url)]:ports.map(port=>'http://127.0.0.1:'+port);
 const probes=await Promise.all(urls.map(async url=>{
  try{const response=await localRequest(fetcher,url,'info',{},'GET');
   const info=response.ok?await response.json().catch(()=>null):null;
   return {url,isRelay:info?.protocol==='xutu-pairing/v1',version:info?.relayVersion};
  }catch{return null;}
 }));
 const candidates=probes.filter(p=>p?.isRelay);
 if(candidates.length>1)throw error('MULTIPLE_INSTANCES','发现多个本机服务，未选择或更改任何实例。请只保留本次要接入的实例在线。');
 if(!candidates.length)throw probes.some(Boolean)?error(previous?'RELAY_INCOMPATIBLE':'PORT_CONFLICT','端口上的服务不是兼容的 MDY Terminal 5.1 服务；现有配对未更改。'):error('RELAY_OFFLINE','未发现指定的本机服务。请让 Agent 检查或启动同版便携服务后重试。');
 const {url,version}=candidates[0];
 if(version!==VERSION)throw error('VERSION_MISMATCH','浏览器扩展与本机服务版本不一致，请先升级两端。');
 const same=previous?.url===url,bridgeId=(same&&previous.bridgeId)||crypto.randomUUID();
 if(same&&previous.token){
  const probe=await localRequest(fetcher,url,'probe',{Authorization:'Bearer '+previous.token,'X-Xutu-Bridge-Id':bridgeId});
  if(probe.ok)return {connection:{...previous,enabled:true}};
  if(probe.status===409)throw error('ANOTHER_BROWSER_CONNECTED','该实例正在服务其他浏览器；未接管。');
  if(probe.status!==401)throw error('RELAY_INCOMPATIBLE','无法验证本机服务配对。');
 }
 const proof=randomProof(),headers={'X-Xutu-Pairing-Proof':proof,'X-Xutu-Bridge-Id':bridgeId};
 const response=await localRequest(fetcher,url,'request',headers);
 if(response.status!==202)throw error('PAIRING_REJECTED','本机服务未接受配对请求。');
 const {id}=await response.json();
 if(!/^[a-f0-9]{32}$/.test(id))throw error('PAIRING_PROTOCOL','本机服务返回无效的配对请求。');
 return {pending:{id,url,proof,bridgeId,tabId,expires:Date.now()+120000,mismatch:!!(same&&previous.token)}};
}

export async function claimPairing(pending,fetcher=fetch){
 if(pending.expires<=Date.now())throw error('PAIRING_EXPIRED','配对请求已过期，请重新点击连接。');
 const response=await localRequest(fetcher,pending.url,'claim',{'X-Xutu-Pairing-Id':pending.id,'X-Xutu-Pairing-Proof':pending.proof,'X-Xutu-Bridge-Id':pending.bridgeId});
 if(response.status===202)return null;
 if(response.status===409)throw error('ANOTHER_BROWSER_CONNECTED','该实例正在服务其他浏览器；未接管。');
 if(!response.ok)throw error('PAIRING_REJECTED','配对请求失效，请重新点击连接。');
 const {bridgeToken,relayVersion,protocol}=await response.json();
 if(protocol!=='xutu-pairing/v1'||relayVersion!==VERSION||!/^[-_a-zA-Z0-9]{32,256}$/.test(bridgeToken))throw error('PAIRING_PROTOCOL','本机服务返回无效的配对响应。');
 return {url:pending.url,token:bridgeToken,bridgeId:pending.bridgeId,tabId:pending.tabId,enabled:true};
}
