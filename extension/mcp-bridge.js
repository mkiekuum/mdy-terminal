import {VERSION} from './core.js';
import {McpGate} from './mcp-policy.js';

export function relayUrl(value) {
  const url = new URL(value);
  if (url.origin !== 'http://127.0.0.1' + (url.port ? ':' + url.port : '') ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw Error('仅使用 http://127.0.0.1 的本机服务根地址；跨电脑通过私有隧道');
  }
  return url.origin;
}

function previewStorage(storage) {
  async function entries() {
    return (await storage.get('mcpPreviews')).mcpPreviews || {};
  }
  return {
    get: async id => (await entries())[id],
    async save(id, value) {
      const valid = Object.entries(await entries()).filter(([,p]) => p.expires > Date.now());
      await storage.set({mcpPreviews:{...Object.fromEntries(valid.slice(-49)), [id]:value}});
    },
    async remove(id) {
      const previews = await entries();
      delete previews[id];
      await storage.set({mcpPreviews:previews});
    }
  };
}

export function startMcpBridge({run, identity, storage, resolveTarget, browserStatus,
                               hasPermission, fetcher = fetch, schedule}) {
  const previews = previewStorage(storage);
  let targetConfig;
  const gate = new McpGate(command => run(command, targetConfig),
    () => identity(targetConfig), Date.now, previews);
  let running = false;
  let timer;
  let pendingReceipt;

  async function dispatch(job, config) {
    const current = (await storage.get('mcpConnection')).mcpConnection;
    if (JSON.stringify(current) !== JSON.stringify(config)) throw Error('连接设置已变化，未执行');
    const command = job.kind === 'execute'
      ? (await previews.get(job.previewJobId))?.command : job.command;
    const target = resolveTarget ? await resolveTarget(command?.tabId) :
      {tab:{id:config.tabId}, selection:'selected'};
    if (job.kind === 'status' || job.kind === 'login') {
      return browserStatus(target, job.kind === 'login');
    }
    if (!target.tab) throw Error(target.selection === 'ambiguous'
      ? '请指定命令的 tabId 或切到目标计划站页。' : '请打开 MDY网页。');
    targetConfig = {...config, tabId:target.tab.id};
    return gate.handle(job);
  }

  async function tick() {
    if (running) return;
    running = true;
    clearTimeout(timer);
    let delay;
    try {
      const config = (await storage.get('mcpConnection')).mcpConnection;
      if (!config?.enabled) return;
      if (hasPermission && !await hasPermission()) throw Error('请使用“复制给 MCP AI”授予本机连接权限。');
      const base = relayUrl(config.url);
      const headers = {'X-Xutu-Bridge-Id':config.bridgeId, 'X-Xutu-Bridge-Protocol':'2',
        'X-Xutu-Extension-Version':VERSION, Authorization:'Bearer ' + config.token,
        'Content-Type':'application/json'};
      const options = () => ({headers, signal:AbortSignal.timeout(15000), redirect:'error'});
      const postReceipt = async receipt => {
        const post = value => fetcher(base + '/bridge/result', {...options(), method:'POST',
          body:JSON.stringify({id:receipt.id, result:value})});
        let posted = await post(receipt.result);
        if (posted.status === 413) {
          posted = await post({status:'failed', code:'RESULT_TOO_LARGE',
            outcome:receipt.kind === 'execute' ? 'unconfirmed' : undefined,
            message:'回执超过本机服务上限。读取时请缩小查询；已派发写入须先核对网站。'});
        }
        if (posted.ok || posted.status === 409) pendingReceipt = undefined;
        if (!posted.ok) throw Error('结果尚未确认，请查询原请求');
      };
      if (pendingReceipt) {
        if (pendingReceipt.config === JSON.stringify(config)) await postReceipt(pendingReceipt);
        else pendingReceipt = undefined;
      }
      const response = await fetcher(base + '/bridge/next', options());
      if (!response.ok) throw Error('连接失败 HTTP ' + response.status);
      const job = await response.json();
      delay = job ? 0 : 3000;
      if (job) {
        let result;
        try { result = await dispatch(job, config); }
        catch (error) { result = {status:'failed', code:error.code, message:error.message}; }
        pendingReceipt = {id:job.id, kind:job.kind, result, config:JSON.stringify(config)};
        await postReceipt(pendingReceipt);
      }
      const prior = (await storage.get('mcpBridgeStatus')).mcpBridgeStatus;
      if (prior?.state !== 'connected' || Date.now() - prior.at >= 30000) {
        await storage.set({mcpBridgeStatus:{state:'connected', at:Date.now()}});
      }
    } catch (error) {
      delay = undefined; // A Chrome alarm retries when the service or permission returns.
      await storage.set({mcpBridgeStatus:{state:'error', message:error.message, at:Date.now()}});
    } finally {
      running = false;
      if (schedule && delay !== undefined) timer = schedule(tick, delay);
    }
  }
  return {tick, async reset() {
    clearTimeout(timer);
    gate.previews.clear();
    await storage.remove('mcpPreviews');
  }};
}
