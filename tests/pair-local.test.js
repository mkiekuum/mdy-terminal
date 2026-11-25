import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import {createRelay} from '../mcp/relay.mjs';
import {approveLocalOffer} from '../mcp/pair-local.mjs';
import {beginPairing,claimPairing} from '../extension/mcp-connection.js';

test('loopback pairing requires local approval, rejects mismatched credentials and reuses pairing',async t=>{
 const secret=()=>randomBytes(32).toString('hex');
 const clientToken=secret(),bridgeToken=secret();
 const {server}=createRelay({clientToken,bridgeToken});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const port=server.address().port,url='http://127.0.0.1:'+port;
 const browserFetch=(resource,options)=>fetch(resource,{...options,
  headers:{...options.headers,Origin:'chrome-extension://'+'a'.repeat(32)}});
 const {pending}=await beginPairing(1,{ports:[port],fetcher:browserFetch});
 assert.equal(await claimPairing(pending,browserFetch),null);
 const offer='MDY-PAIRING-OFFER: '+pending.id;
 await assert.rejects(approveLocalOffer(offer,{url,clientToken:secret()}),{code:'CREDENTIAL_MISMATCH'});
 assert.equal((await approveLocalOffer(offer,{url,clientToken})).status,'authorized');
 const connection=await claimPairing(pending,browserFetch);
 assert.equal(connection.token,bridgeToken);
 const next=await beginPairing(2,{previous:connection,fetcher:browserFetch});
 assert.equal(next.connection.bridgeId,connection.bridgeId);
});
