import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelay} from '../mcp/relay.mjs';
import {startMcpBridge} from '../extension/mcp-bridge.js';
import {VERSION} from '../extension/core.js';

test('MCP resolves one target per job, supports saved sign-in, and invalidates a preview after switching tabs', async t => {
  const clientToken = 'c'.repeat(32), bridgeToken = 'b'.repeat(32);
  let now = Date.now(), tabId = 41, loggedIn = false, writes = 0;
  const {server} = createRelay({clientToken, bridgeToken, now: () => now});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port;
  const values = {mcpConnection: {url, tabId: 999, token: bridgeToken, bridgeId: 'qa-bridge', enabled: true}};
  const storage = {
    get: async key => ({[key]: values[key]}), set: async patch => Object.assign(values, patch),
    remove: async key => {delete values[key];}
  };
  const bridge = startMcpBridge({
    storage, resolveTarget: async () => ({tab: tabId ? {id: tabId} : null, selection: tabId ? 'selected' : 'ambiguous'}),
    browserStatus: async (target, login) => {
      if (login && target.tab) loggedIn = true;
      return {extensionVersion: VERSION, selection: target.selection, loggedIn};
    },
    identity: async config => config.tabId + ':actor',
    run: async (command, config) => {
      if (command.mode === 'execute' && command.steps[0].op === 'plan.update') writes++;
      return {status: 'success', steps: [{data: {tabId: config.tabId}}]};
    }
  });
  async function call(name, args = {}) {
    const response = await fetch(url + '/mcp', {method: 'POST',
      headers: {Authorization: 'Bearer ' + clientToken, 'Content-Type': 'application/json'},
      body: JSON.stringify({jsonrpc:'2.0', id:1, method:'tools/call', params:{name, arguments:args}})});
    const {result} = await response.json();
    if (result.isError) throw Error(result.content[0].text);
    return JSON.parse(result.content[0].text);
  }
  async function job(name, args) {
    const queued = await call(name, args);
    await bridge.tick();
    const result = await call('xutu_result', {jobId:queued.jobId});
    assert.equal(result.status, 'completed');
    return result.result;
  }
  assert.equal((await call('xutu_status')).bridge, 'offline');
  await fetch(url + '/bridge/next', {headers: {Authorization:'Bearer '+bridgeToken,'X-Xutu-Bridge-Id':'qa-bridge'}});
  assert.equal((await call('xutu_status')).bridge, 'reload_extension');
  await assert.rejects(call('xutu_login'), /重新加载/);
  await bridge.tick();
  assert.equal((await job('xutu_status')).relayVersion, VERSION);
  await assert.rejects(call('xutu_login', {password:'sample'}), /不接受参数/);
  assert.equal((await job('xutu_login')).loggedIn, true);
  const command = op => ({protocol:'xutu.command/v1',requestId:crypto.randomUUID(),steps:[{id:'s',op,
    ...(op==='plan.update'?{target:{id:'P',version:1},params:{set:{title:'new'}}}:{})}]});
  assert.equal((await job('xutu_read', {command:command('system.version')})).steps[0].data.tabId, 41);
  const preview = await job('xutu_preview', {command:command('plan.update')});
  tabId = 42;
  assert.equal((await job('xutu_execute', {previewJobId:preview.previewJobId, approval:'测试'})).status, 'failed');
  assert.equal(writes, 0);
  tabId = null;
  assert.equal((await job('xutu_status')).selection, 'ambiguous');
  assert.equal((await job('xutu_read', {command:command('system.version')})).status, 'failed');
  now += 91_000;
  assert.equal((await call('xutu_status')).bridge, 'offline');
});

test('revoked loopback permission leaves queued work untouched', async () => {
 let requested = false, status;
 const bridge = startMcpBridge({
  storage: {get:async()=>({mcpConnection:{enabled:true}}),set:async v=>{status=v.mcpBridgeStatus;}},
  hasPermission:async()=>false,fetcher:async()=>{requested=true;}
 });
 await bridge.tick();
 assert.equal(requested,false);
 assert.equal(status.state,'error');
});
