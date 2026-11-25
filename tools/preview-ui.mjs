// Local UI fixture. Preview actions never contact the plan site or persist credentials.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../extension/', import.meta.url));
function previewBrowser(version) {
  const settings = {mcpConnection:{url:'http://127.0.0.1:62924',enabled:true,token:'fixture-only',bridgeId:'synthetic-browser'}};
  // Exercise the actual popup without sending anything to a local relay or the OS clipboard.
  const request=window.fetch.bind(window);
  window.fetch=(url,options)=>String(url).startsWith('http://127.0.0.1:62924/pairing/')
    ? Promise.resolve(Response.json({protocol:'xutu-pairing/v1',relayVersion:'4.7.0'})) : request(url,options);
  Object.defineProperty(navigator,'clipboard',{value:{write:async([item])=>{
    const text=await (await item.getType('text/plain')).text();
    if(!/新建独立计划|修改已有计划/.test(text)||!text.includes('VERSION_MISMATCH'))throw Error('合成复制内容缺失计划意图或诊断');
  }}});
  let loginEnabled = false;
  const listeners = new Set();
  async function sendMessage(message) {
    switch (message.kind) {
      case 'updates': return {status: 'current', latestVersion: version};
      case 'currentPlanTab': return {tabId: 123};
      case 'loginSave': loginEnabled = true; break;
      case 'loginClear': loginEnabled = false; break;
      case 'loginStatus': break;
      case 'tabs': return [{id: 123}];
      case 'run': {
        const op = message.command.steps[0].op;
        const reports = {
          'site.session': {actor: '预览'},
          'site.compatibility': {status: 'ok', checks: []},
          'history.list': {count: 0, entries: []}
        };
        if (reports[op]) return {status: 'success', steps: [{data: reports[op]}]};
        return {status: 'failed', message: '预览中无法执行此指令。'};
      }
      default: throw Error('此操作需要在扩展内使用。');
    }
    return {enabled: loginEnabled, account: loginEnabled ? 'preview' : ''};
  }
  function notify(key, value) {
    for (const listener of listeners) listener({[key]: {newValue: value}}, 'local');
  }
  globalThis.chrome = {
    runtime: {id: 'a'.repeat(32), sendMessage, onMessage: {addListener() {}}},
    storage: {
      local: {
        get: async () => ({...settings}),
        set: async obj => { for (const [key, value] of Object.entries(obj)) { settings[key] = value; notify(key, value); } },
        remove: async keys => { for (const key of keys) { delete settings[key]; notify(key); } }
      },
      onChanged: {addListener: listener => listeners.add(listener)}
    },
    scripting: {executeScript: async () => []},
    permissions: {request: async () => true}
  };
}
const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css'};
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const name = pathname === '/' ? 'ui.html' : pathname.slice(1);
  if (!/^[\w-]+\.(?:js|css|html)$/.test(name)) return res.writeHead(404).end();
  try {
    let body = await fs.readFile(path.join(root, name), 'utf8');
    if (name === 'ui.html') {
      const stub = '<script>(' + previewBrowser.toString() + ')(' + JSON.stringify(manifest.version) + ')</script>';
      body = body.replace('<script type="module"', stub + '<script type="module"');
    }
    res.setHeader('Content-Type', types[path.extname(name)] + '; charset=utf-8');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port));
