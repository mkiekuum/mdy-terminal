import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import {createRelay} from '../mcp/relay.mjs';
import {approveLocalOffer} from '../mcp/pair-local.mjs';
import {beginPairing,claimPairing} from '../extension/mcp-connection.js';
import {startMcpBridge} from '../extension/mcp-bridge.js';
import {envelope,integrated,site} from './v25-helpers.js';
import {VERSION} from '../extension/core.js';

const secret=()=>randomBytes(32).toString('hex');
async function listen(t,server){
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 return server.address().port;
}
const browserFetch=(url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:'chrome-extension://'+'a'.repeat(32)}});

test('first pairing and upgrade/mismatch recovery need the exact locally approved offer, no import',async t=>{
 const clientToken=secret(),bridgeToken=secret();
 const port=await listen(t,createRelay({clientToken,bridgeToken}).server),url='http://127.0.0.1:'+port;
 const options={ports:[port],fetcher:browserFetch};
 const {pending}=await beginPairing(options);
 assert.equal(await claimPairing(pending,browserFetch),null);
 const offer='MDY-PAIRING-OFFER: '+pending.id;
 await assert.rejects(approveLocalOffer(offer,{url,clientToken:secret()}),{code:'CREDENTIAL_MISMATCH'});
 await assert.rejects(claimPairing({...pending,proof:secret()},browserFetch),{code:'PAIRING_REJECTED'});
 assert.equal((await approveLocalOffer(offer,{url,clientToken})).status,'authorized');
 const connection=await claimPairing(pending,browserFetch);
 assert.equal(connection.token,bridgeToken);
 assert.equal(connection.clientToken,undefined);
 await assert.rejects(claimPairing(pending,browserFetch),{code:'PAIRING_REJECTED'});
 const old={...connection,clientToken,tabId:99};
 assert.deepEqual(await beginPairing({...options,previous:old}),{connection});
 const values={mcpConnection:{...connection,token:secret()}};
 const bridge=startMcpBridge({storage:{get:async k=>({[k]:values[k]}),set:async patch=>Object.assign(values,patch)}});
 await bridge.tick();
 assert.equal(values.mcpBridgeStatus.code,'CREDENTIAL_MISMATCH');
 const recovery=(await beginPairing({...options,previous:values.mcpConnection})).pending;
 assert(recovery.mismatch);
 await approveLocalOffer('MDY-PAIRING-OFFER: '+recovery.id,{url,clientToken});
 values.mcpConnection=await claimPairing(recovery,browserFetch);
 await bridge.tick();
 assert.equal(values.mcpBridgeStatus.state,'connected');
 const newcomer=(await beginPairing(options)).pending;
 await assert.rejects(approveLocalOffer('MDY-PAIRING-OFFER: '+newcomer.id,{url,clientToken}),{code:'ANOTHER_BROWSER_CONNECTED'});
});

test('diagnoses occupied port, incompatible versions and multiple instances; explicit port does not overwrite a pairing',async t=>{
 const relay=()=>createRelay({clientToken:secret(),bridgeToken:secret()}).server;
 const [one,two,other,old]=await Promise.all([
  listen(t,relay()),listen(t,relay()),listen(t,http.createServer((_,res)=>res.writeHead(404).end())),
  listen(t,http.createServer((_,res)=>res.end(JSON.stringify({protocol:'xutu-pairing/v1',relayVersion:'5.0.0'}))))
 ]);
 await assert.rejects(beginPairing({ports:[one,two],fetcher:browserFetch}),{code:'MULTIPLE_INSTANCES'});
 await assert.rejects(beginPairing({port:other,fetcher:browserFetch}),{code:'PORT_OCCUPIED_OR_OLD_RELAY'});
 await assert.rejects(beginPairing({port:old,fetcher:browserFetch}),{code:'VERSION_MISMATCH'});
 assert((await beginPairing({port:one,fetcher:browserFetch})).pending);
 await assert.rejects(beginPairing({port:two,previous:{url:'http://127.0.0.1:'+one}}),{code:'DIFFERENT_INSTANCE'});
});

test('a newly paired browser can verify the session and read a synthetic plan through the real loopback relay',async t=>{
 const clientToken=secret(),bridgeToken=secret();
 const port=await listen(t,createRelay({clientToken,bridgeToken}).server),url='http://127.0.0.1:'+port;
 const {pending}=await beginPairing({port,fetcher:browserFetch});
 await approveLocalOffer('MDY-PAIRING-OFFER: '+pending.id,{url,clientToken});
 const values={mcpConnection:await claimPairing(pending,browserFetch)};
 const web=site();web.add('QA-PAIR-READ');const {executor}=integrated(web);
 const bridge=startMcpBridge({storage:{get:async k=>({[k]:values[k]}),set:async patch=>Object.assign(values,patch)},
  hasPermission:async()=>true,resolveTarget:async()=>({tab:{id:41}}),run:c=>executor.run(c),
  browserStatus:async()=>({session:(await web.request('/api/session')).actor?'already_logged_in':'logged_out',extensionVersion:VERSION}),fetcher:browserFetch});
 await bridge.tick();
 const call=async(name,args={})=>{
  const {result}=await fetch(url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+clientToken,'Content-Type':'application/json'},
   body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}).then(r=>r.json());
  assert(!result.isError);return JSON.parse(result.content[0].text);
 };
 const job=async(...args)=>{const {jobId}=await call(...args);await bridge.tick();return (await call('xutu_result',{jobId})).result;};
 const status=await job('xutu_status');
 assert.equal(status.session,'already_logged_in');assert.equal(status.relayVersion,status.extensionVersion);
 const result=await job('xutu_read',{command:envelope([{id:'get',op:'plan.get',target:{id:'QA-PAIR-READ'}}])});
 assert.equal(result.steps[0].data.current.planNumber,'QA-PAIR-READ');assert(result.steps[0].serverVerified);
 assert(web.calls.every(x=>x.method==='GET'));
});