// Standard stdio transport. Pairing can rotate while this process is alive.
import readline from 'node:readline';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {relayUrl} from '../extension/mcp-bridge.js';

async function connection() {
  if (process.argv.includes('--paired')) {
    const file=process.env.XUTU_PAIR_FILE || path.join(process.env.XUTU_HOME || path.join(os.homedir(),'.xutu-mcp'),'connection.json');
    const config=JSON.parse(await readFile(file,'utf8'));
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

for await(const line of readline.createInterface({input:process.stdin})){
  let input;
  try{
    input=JSON.parse(line);
    const {url,token}=await connection();
    const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,
      'Content-Type':'application/json',Accept:'application/json, text/event-stream'},
      body:line,signal:AbortSignal.timeout(20000),redirect:'error'});
    if(!response.ok)throw Error('HTTP '+response.status);
    if(response.status!==202)console.log(JSON.stringify(await response.json()));
  }catch(error){
    if(input?.id!==undefined)console.log(JSON.stringify({jsonrpc:'2.0',id:input.id,
      error:{code:-32000,message:error.message}}));
  }
}
