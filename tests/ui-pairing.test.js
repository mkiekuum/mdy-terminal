import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizePairing} from '../extension/ui-pairing.js';

test('denied browser permission stops before discovery',async()=>{
 const browser={permissions:{request:async()=>false}};
 await assert.rejects(authorizePairing(browser,()=>2),{code:'BROWSER_PERMISSION_DENIED'});
});

test('valid pairing follows the selected replacement tab',async()=>{
 const previous={enabled:true,tabId:1};
 let saved;
 const browser={permissions:{request:async()=>true},storage:{local:{
  get:async()=>({mcpConnection:previous}),set:async value=>{saved=value;}
 }}};
 await authorizePairing(browser,()=>2,async(id,{previous:connection})=>({connection}));
 assert.deepEqual(saved,{mcpConnection:{...previous,tabId:2}});
});
