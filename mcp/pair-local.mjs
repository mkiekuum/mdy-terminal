import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {relayUrl} from '../extension/mcp-bridge.js';
import {VERSION} from '../extension/core.js';

const fail = (code,message) => { throw Object.assign(Error(message),{code}); };
export async function localConfig(){
 const file=process.env.XUTU_PAIR_FILE||path.join(process.env.XUTU_HOME||path.join(homedir(),'.xutu-mcp'),'connection.json');
 let config;
 try{config=JSON.parse(await readFile(file,'utf8'));}catch(e){fail(e.code==='ENOENT'?'RELAY_NOT_CONFIGURED':'INVALID_LOCAL_PAIRING','Cannot read the local relay pairing.');}
 if(relayUrl(config.url)!==config.url||!/^[-a-zA-Z0-9_]{32,256}$/.test(config.clientToken))fail('INVALID_LOCAL_PAIRING','Invalid local relay pairing.');
 return config;
}

export async function approveLocalOffer(text,config,fetcher=fetch){
 const match=String(text).split(/\r?\n/).map(line=>/^MDY-PAIRING-OFFER: ([a-f0-9]{32})$/.exec(line.trim())).filter(Boolean);
 const id=match.length===1&&match[0][1];
 const url=relayUrl(config.url);
 const request=(endpoint,options={})=>fetcher(url+endpoint,{...options,redirect:'error',signal:AbortSignal.timeout(3000)});
 let response;
 try{response=await request('/pairing/info');}catch{fail('RELAY_OFFLINE','Configured relay is offline.');}
 let info;try{info=await response.json();}catch{info=null;}
 if(info?.protocol!=='xutu-pairing/v1')fail('PORT_CONFLICT_OR_OLD_RELAY','Configured port is occupied by an unrelated listener or an older relay.');
 if(info.relayVersion!==VERSION)fail('VERSION_MISMATCH','Extension, helper, and relay must run the same version.');
 if(!id)return {status:'no_offer',relayVersion:VERSION};
 const approved=await request('/pairing/approve',{method:'POST',headers:{Authorization:'Bearer '+config.clientToken,'X-Xutu-Pairing-Id':id}});
 if(approved.ok)return {status:'authorized',relayVersion:VERSION};
 if(approved.status===401)fail('CREDENTIAL_MISMATCH','The running relay rejected the local pairing (HTTP 401).');
 if(approved.status===409)fail('ANOTHER_BROWSER_CONNECTED','Another browser bridge is active. No connection was changed.');
 fail('OFFER_NOT_FOUND','The offer expired or belongs to a different instance. Nothing was changed.');
}

function clipboard(){
 const options={encoding:'utf8',timeout:2500,windowsHide:true,stdio:['ignore','pipe','ignore'],maxBuffer:2*1024*1024};
 const commands=process.platform==='win32'?[['powershell.exe','-NoProfile','-NonInteractive','-Command','Get-Clipboard -Raw']]:process.platform==='darwin'?[['pbpaste']]:[['wl-paste','--no-newline'],['xclip','-selection','clipboard','-o']];
 for(const [command,...args] of commands)try{return execFileSync(command,args,options);}catch{}
 fail('CLIPBOARD_UNAVAILABLE','Unable to read the local clipboard. The browser must authorize first.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const config=await localConfig();console.log(JSON.stringify(await approveLocalOffer(process.argv.includes('--check')?'':clipboard(),config)));}
 catch(e){console.error(JSON.stringify({status:'failed',code:e.code||'PAIRING_ERROR'}));process.exitCode=1;}
}
