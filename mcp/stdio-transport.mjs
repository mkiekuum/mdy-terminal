// Standard stdio transport. Pairing can rotate while this process is alive.
import {parentPort, workerData} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {relayUrl} from '../extension/mcp-bridge.js';
import {VERSION} from '../extension/core.js';

async function connection() {
  if (workerData.paired) {
    const file=process.env.XUTU_PAIR_FILE || path.join(process.env.XUTU_HOME || path.join(os.homedir(),'.xutu-mcp'),'connection.json');
    let config;
    try { config=JSON.parse(await readFile(file,'utf8')); }
    catch(error) { throw Error(error.code==='ENOENT' ? 'PAIRING_MISSING: 请检查当前客户端绑定的本机实例。' : 'PAIRING_UNREADABLE: 无法读取当前实例配对。'); }
    if(relayUrl(config.url)!==config.url || !/^[-a-zA-Z0-9_]{32,256}$/.test(config.clientToken))
      throw Error('Invalid local pairing');
    return {url:config.url+'/mcp',token:config.clientToken};
  }
  const url=process.env.XUTU_MCP_URL||'http://127.0.0.1:62924/mcp';
  const token=process.env.XUTU_MCP_TOKEN;
  const destination=new URL(url);
  if(!token||destination.protocol!=='http:'||destination.hostname!=='127.0.0.1')
    throw Error('Local MCP address and token required');
  return {url,token};
}

const {input}=workerData;
try{
  const {url,token}=await connection();
  if(input.method==='tools/call'&&['xutu_login','xutu_read','xutu_preview','xutu_execute'].includes(input.params?.name)){
    const info=await fetch(new URL('/pairing/info',url),{redirect:'error',signal:AbortSignal.timeout(3000)});
    const peer=info.ok?await info.json().catch(()=>null):null;
    if(peer?.protocol!=='xutu-pairing/v1')throw Error('PORT_CONFLICT: 配置端口未返回序图服务标识。');
    if(peer.relayVersion!==VERSION)throw Error('VERSION_MISMATCH: 客户端与本机中继版本不一致。请核对正在运行的实例并升级重连。');
  }
  const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,
    'Content-Type':'application/json',Accept:'application/json, text/event-stream'},
    body:JSON.stringify(input),signal:AbortSignal.timeout(20000),redirect:'error'});
  if(response.status===401)throw Error('CREDENTIAL_MISMATCH: 当前实例拒绝了已有配对。');
  if(!response.ok)throw Error('HTTP '+response.status);
  const body=response.status===202 ? null : await response.json();
  if(input.params?.name==='xutu_status' && !body?.result?.isError && body?.result?.content?.[0]?.type==='text') {
    const item=body.result.content[0];
    item.text=JSON.stringify({...JSON.parse(item.text),clientVersion:VERSION});
  }
  parentPort.postMessage(body);
}catch(error){
  let message=error.message;
  if(error.cause?.code==='ECONNREFUSED') message='RELAY_OFFLINE: 客户端 '+VERSION+' 的配对端口没有服务监听。同版便携客户端已连通时，请重载宿主 MCP 配置并在原聊天核验。';
  else if(error.name==='TimeoutError'||message==='fetch failed') message='RELAY_UNREACHABLE: 客户端 '+VERSION+' 未收到中继回执。执行结果未知时先查询原请求和网站状态。';
  parentPort.postMessage(input?.id===undefined ? null : {jsonrpc:'2.0',id:input.id,error:{code:-32000,message}});
}
