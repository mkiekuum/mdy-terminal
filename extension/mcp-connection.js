import {relayUrl} from './mcp-bridge.js';
import {VERSION} from './core.js';
export const pairingPorts=Array.from({length:11},(_,i)=>62924+i);
const randomProof=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const error=(code,message)=>Object.assign(Error(message),{code});
function localRequest(fetcher,url,endpoint,headers={},method='POST'){
 return fetcher(relayUrl(url)+'/pairing/'+endpoint,{method,headers,signal:AbortSignal.timeout(1500),redirect:'error',cache:'no-store',credentials:'omit'});
}

export async function beginPairing({previous,fetcher=fetch,ports=pairingPorts,port}={}){
 if(port!==undefined&&(!Number.isInteger(port)||port<1024||port>65535))throw error('INVALID_PORT','本机端口须在 1024–65535 之间。');
 if(port!==undefined&&previous?.url&&relayUrl(previous.url)!=='http://127.0.0.1:'+port)throw error('DIFFERENT_INSTANCE','现有配对仍保留；如确需改用另一实例，请先核对在途请求，再明确断开当前配对。');
 const urls=port!==undefined?['http://127.0.0.1:'+port]:previous?.url?[relayUrl(previous.url)]:ports.map(number=>'http://127.0.0.1:'+number);
 const probes=await Promise.all(urls.map(async url=>{
  try{const response=await localRequest(fetcher,url,'info',{},'GET');
   const info=response.ok?await response.json().catch(()=>null):null;
   return {url,isRelay:info?.protocol==='xutu-pairing/v1',version:info?.relayVersion};
  }catch{return null;}
 }));
 const relays=probes.filter(p=>p?.isRelay);
 const candidates=relays.filter(p=>p.version===VERSION);
 if(relays.length&&!candidates.length)throw error('VERSION_MISMATCH','浏览器扩展与本机服务版本不一致，请先升级两端。');
 if(candidates.length>1)throw error('MULTIPLE_INSTANCES','发现多个同版本服务。请在设置的「指定实例」中选择目标端口。');
 if(!candidates.length)throw probes.some(Boolean)?error('PORT_OCCUPIED_OR_OLD_RELAY','端口上有响应，但不是支持配对的 MDY Terminal 服务；现有配对未更改。'):error('RELAY_UNREACHABLE','未发现指定的本机服务。请检查同版便携服务是否已启动，以及实际端口。');
 const {url}=candidates[0];
 const same=previous?.url===url,bridgeId=(same&&previous.bridgeId)||crypto.randomUUID();
 if(same&&previous.token){
  const probe=await localRequest(fetcher,url,'probe',{Authorization:'Bearer '+previous.token,'X-Xutu-Bridge-Id':bridgeId});
  if(probe.ok)return {connection:{url,token:previous.token,bridgeId,enabled:true}};
  if(probe.status===409)throw error('ANOTHER_BROWSER_CONNECTED','该实例正在服务其他浏览器；未接管。');
  if(probe.status!==401)throw error('RELAY_INCOMPATIBLE','无法验证本机服务配对。');
 }
 const proof=randomProof(),headers={'X-Xutu-Pairing-Proof':proof,'X-Xutu-Bridge-Id':bridgeId};
 const response=await localRequest(fetcher,url,'request',headers);
 if(response.status!==202)throw error('PAIRING_REJECTED','本机服务未接受配对请求。');
 const {id}=await response.json();
 if(!/^[a-f0-9]{32}$/.test(id))throw error('PAIRING_PROTOCOL','本机服务返回无效的配对请求。');
 return {pending:{id,url,proof,bridgeId,expires:Date.now()+120000,mismatch:!!(same&&previous.token)}};
}

export async function claimPairing(pending,fetcher=fetch){
 if(pending.expires<=Date.now())throw error('PAIRING_EXPIRED','配对请求已过期，请重新点击连接。');
 const response=await localRequest(fetcher,pending.url,'claim',{'X-Xutu-Pairing-Id':pending.id,'X-Xutu-Pairing-Proof':pending.proof,'X-Xutu-Bridge-Id':pending.bridgeId});
 if(response.status===202)return null;
 if(response.status===409)throw error('ANOTHER_BROWSER_CONNECTED','该实例正在服务其他浏览器；未接管。');
 if(!response.ok)throw error('PAIRING_REJECTED','配对请求失效，请重新点击连接。');
 const {bridgeToken,relayVersion,protocol}=await response.json();
 if(protocol!=='xutu-pairing/v1'||relayVersion!==VERSION||!/^[-_a-zA-Z0-9]{32,256}$/.test(bridgeToken))throw error('PAIRING_PROTOCOL','本机服务返回无效的配对响应。');
 return {url:pending.url,token:bridgeToken,bridgeId:pending.bridgeId,enabled:true};
}
