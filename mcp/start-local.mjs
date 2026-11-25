import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {createRelay} from './relay.mjs';
import {relayUrl} from '../extension/mcp-bridge.js';

if(process.argv.includes('--help')){
  console.log('Start-MCP [--new-instance]: run a paired local relay. MDY Terminal discovers the pairing after browser authorization; no file import is required.');
  process.exit(0);
}
if(process.argv.slice(2).some(arg=>arg!=='--new-instance'))throw Error('Unknown option. Run with --help.');
const isolated=process.argv.includes('--new-instance');
const root=path.resolve(process.env.XUTU_HOME || path.join(os.homedir(),'.xutu-mcp'));
fs.mkdirSync(root,{recursive:true,mode:0o700});
const dir=isolated ? fs.mkdtempSync(path.join(root,'instance-')) : root;
const file=path.join(dir,'connection.json');
const first=!fs.existsSync(file);
const token=()=>randomBytes(32).toString('hex');
async function start(){
  const cfg=first?{url:'http://127.0.0.1:62924',clientToken:token(),bridgeToken:token()}:
    JSON.parse(fs.readFileSync(file,'utf8'));
  const port=Number(new URL(relayUrl(cfg.url)).port || 80);
  const {server}=createRelay({...cfg,origins:(process.env.XUTU_ALLOWED_ORIGINS||'').split(',').filter(Boolean)});
  function listen(number){
    return new Promise((resolve,reject)=>{
      const failed=error=>{server.off('listening',ready);reject(error);};
      const ready=()=>{server.off('error',failed);resolve();};
      server.once('error',failed).once('listening',ready).listen(number,'127.0.0.1');
    });
  }
  const preferredPorts=isolated?[0]:first?[port,...Array.from({length:10},(_,i)=>port+i+1)]:[port];
  let selectedPort;
  for(const candidate of preferredPorts){
   try{await listen(candidate);selectedPort=candidate;break;}
   catch(error){if(error.code!=='EADDRINUSE')throw error;}
  }
  if(selectedPort===undefined)throw Error(first?'No available loopback port in the MDY Terminal range. Reuse the running relay or start with --new-instance.':'Port in use for the configured MDY Terminal instance. Reuse the running relay or start with --new-instance.');
  try{
    if(first){
      cfg.url='http://127.0.0.1:'+server.address().port;
      const tmp=path.join(dir,'.pair-'+randomUUID());
      fs.writeFileSync(tmp,JSON.stringify(cfg,null,2),{mode:0o600,flag:'wx'});
      try{fs.linkSync(tmp,file);}finally{fs.unlinkSync(tmp);}
    }
    console.log('Local MCP ready: '+cfg.url+'/mcp\nIn the extension choose Settings > Connect local service. No file import.');
    if(isolated)console.log('For this independent instance only, set XUTU_PAIR_FILE in its local Agent/stdio process environment: '+file);
  }catch(error){server.close();throw error;}
}
start().catch(error=>{
  console.error(error instanceof SyntaxError?'Invalid connection.json':error.code||error.message);
  process.exitCode=1;
});
