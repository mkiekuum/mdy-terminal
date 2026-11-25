import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizePairing} from '../extension/ui-pairing.js';

test('denied browser permission stops before discovery',async()=>{
 const browser={permissions:{request:async()=>false}};
 await assert.rejects(authorizePairing(browser,{discover:()=>assert.fail('discovery after denial')}),{code:'BROWSER_PERMISSION_DENIED'});
});

test('unchanged pairing is reused without resetting connection or needing a plan tab',async()=>{
 const previous={enabled:true,bridgeId:'qa-browser'};
 const browser={permissions:{request:async()=>true},storage:{local:{
  get:async()=>({mcpConnection:previous}),set:async()=>assert.fail('unnecessary settings write')
 }}};
 const actual=await authorizePairing(browser,{discover:async({previous:connection})=>({connection})});
 assert.deepEqual(actual,{connection:previous});
});
