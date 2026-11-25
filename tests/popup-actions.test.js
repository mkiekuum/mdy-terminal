import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {VERSION} from '../extension/core.js';

test('popup buttons produce distinct MCP prompts; creation reads no business plan',async t=>{
 const dom=new JSDOM(await readFile('extension/ui.html','utf8'));
 t.after(()=>dom.window.close());
 const writes=[],messages=[];
 const local={mcpConnection:{url:'http://127.0.0.1:62924',token:'synthetic',bridgeId:'fixture',enabled:true}};
 const mock=(key,value)=>t.mock.method(globalThis,key,value);
 const globals={document:dom.window.document,chrome:{permissions:{request:async()=>true},
  storage:{local:{get:async()=>local,set:async v=>Object.assign(local,v)},onChanged:{addListener(){}}},
  runtime:{sendMessage:async m=>{messages.push(m);return m.kind==='currentPlanTab'?{tabId:31}:{status:'success',steps:[{data:{complete:false,plan:null}}]};}}}};
 for(const [k,v] of Object.entries(globals)){globalThis[k]=v;t.after(()=>delete globalThis[k]);}
 let reserved=0;
 globalThis.ClipboardItem=class {constructor(parts){this.parts=parts;}};
 t.after(()=>delete globalThis.ClipboardItem);
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async([item])=>{
  reserved++;
  writes.push(await (await item.parts['text/plain']).text());
 }}});
 t.after(()=>delete navigator.clipboard);
 mock('setInterval',()=>0);
 mock('fetch',async url=>url.endsWith('/info')?Response.json({protocol:'xutu-pairing/v1',relayVersion:VERSION}):Response.json({ok:true}));
 await import('../extension/ui.js');
 const firstClick=document.querySelector('#newPlanPrompt').onclick();
 assert.equal(reserved,1,'clipboard must be reserved before any asynchronous result');
 await firstClick;
 assert.equal(messages.length,0);
 assert.match(writes[0],/新建独立计划/);
 await document.querySelector('#copyMcpPrompt').onclick();
 assert(messages.some(m=>m.command?.steps[0].op==='site.context'));
 assert.match(writes[1],/修改已有计划/);
 globalThis.fetch=async()=>Response.json({protocol:'xutu-pairing/v1',relayVersion:'4.7.0'});
 await document.querySelector('#copyMcpPrompt').onclick();
 assert.equal(reserved,3);
 assert.match(writes[2],/VERSION_MISMATCH/);
 assert.doesNotMatch(writes[2],/Authorization: Bearer/);
});
