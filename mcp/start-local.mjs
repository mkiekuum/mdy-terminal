import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {createRelay} from './relay.mjs';
import {relayUrl} from '../extension/mcp-bridge.js';

if(process.argv.includes('--help')){
  console.log('Start-MCP [--new-instance]: run a paired local relay; use --new-instance for an independent port and pairing file.');
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
  try{await listen(isolated?0:port);}
  catch(error){
    if(error.code!=='EADDRINUSE')throw error;
    if(!first)throw Error('Port in use. Reuse the running relay or start with --new-instance for an independent pairing.');
    await listen(0);
  }
  try{
    if(first){
      cfg.url='http://127.0.0.1:'+server.address().port;
      const tmp=path.join(dir,'.pair-'+randomUUID());
      fs.writeFileSync(tmp,JSON.stringify(cfg,null,2),{mode:0o600,flag:'wx'});
      try{fs.linkSync(tmp,file);}finally{fs.unlinkSync(tmp);}
    }
    console.log('Local MCP ready: '+cfg.url+'/mcp\nPairing file: '+file);
  }catch(error){server.close();throw error;}
}
start().catch(error=>{
  console.error(error instanceof SyntaxError?'Invalid connection.json':error.code||error.message);
  process.exitCode=1;
});
