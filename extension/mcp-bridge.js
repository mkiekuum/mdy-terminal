import {VERSION,fail,equivalent} from './core.js';
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
  const gate = new McpGate((command,guard) => run(command,targetConfig,guard), async command => {
    const current=(await storage.get('mcpConnection')).mcpConnection;
    if(!equivalent(current,targetConfig.connection))fail('CONNECTION_CHANGED','本机连接已变化，请重新配对或预览。');
    if(hasPermission&&!await hasPermission())fail('BROWSER_PERMISSION_DENIED','本机访问授权已撤销，未写入。');
    return identity(targetConfig,command);
  }, Date.now, previews);
  let running = false;
  let timer;
  let pendingReceipt;

  async function dispatch(job, config) {
    const current = (await storage.get('mcpConnection')).mcpConnection;
    if (!equivalent(current,config)) fail('CONNECTION_CHANGED','连接设置已变化，未执行');
    const previous = job.kind === 'execute' ? await previews.get(job.previewJobId) : null;
    const command = previous?.command || job.command;
    if(job.kind==='execute'&&(!previous||previous.expires<=Date.now()))fail('PREVIEW_EXPIRED','预览不存在或已过期。请重新读取并预览。');
    const target = resolveTarget ? await resolveTarget(command,previous?.actor) :
      {tab:{id:config.tabId}, selection:'selected'};
    if (job.kind === 'status' || job.kind === 'login') {
      return browserStatus(target, job.kind === 'login');
    }
    if (!target.tab) fail(target.selection==='ambiguous'?'TARGET_AMBIGUOUS':'TARGET_CHANGED',target.selection==='ambiguous'
      ? '多个网页可能匹配。请切到目标计划站页或重新读取标签页。' : '找不到指定计划站页。请打开目标页面并重新读取。');
    targetConfig = {...config, tabId:target.tab.id,connection:config};
    if(previous&&previous.command.tabId!==undefined&&target.tab.id!==previous.command.tabId){
      await previews.remove(job.previewJobId);
      gate.previews.delete(job.previewJobId);
      fail('TARGET_CHANGED','已按账号和计划 ID 找到替代标签页 '+target.tab.id+'；请在该页重新读取、预览并取得确认。');
    }
    return gate.handle(command&&job.kind!=='execute'?{...job,command:{...command,tabId:target.tab.id}}:job);
  }

  async function tick() {
    if (running) return;
    running = true;
    clearTimeout(timer);
    let delay;
    try {
      const config = (await storage.get('mcpConnection')).mcpConnection;
      if (!config?.enabled) return;
      if (hasPermission && !await hasPermission()) fail('BROWSER_PERMISSION_DENIED','本机访问未获浏览器授权。请使用“连接本机服务”。');
      const base = relayUrl(config.url);
      const headers = {'X-Xutu-Bridge-Id':config.bridgeId, 'X-Xutu-Bridge-Protocol':'2',
        'X-Xutu-Extension-Version':VERSION, Authorization:'Bearer ' + config.token,
        'Content-Type':'application/json'};
      const options = () => ({headers, signal:AbortSignal.timeout(15000), redirect:'error',credentials:'omit',cache:'no-store'});
      function connectionError(response){
        const detail={401:['CREDENTIAL_MISMATCH','本机服务在线，但浏览器配对凭据不一致（HTTP 401）。请选择“连接本机服务”恢复。'],
          409:['ANOTHER_BROWSER_CONNECTED','本机服务已有其他浏览器桥在线，未接管其他实例。'],
          404:['RELAY_INCOMPATIBLE','端口上的服务不支持浏览器桥协议。'],
          426:['VERSION_MISMATCH','扩展与服务版本不同，请升级并重新加载两端。']}[response.status];
        fail(...(detail||['RELAY_HTTP_ERROR','本机服务返回 HTTP '+response.status]));
      }
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
        if (!posted.ok) connectionError(posted);
      };
      if (pendingReceipt) {
        if (equivalent(pendingReceipt.config,config)) await postReceipt(pendingReceipt);
        else pendingReceipt = undefined;
      }
      const response = await fetcher(base + '/bridge/next', options());
      if (!response.ok) connectionError(response);
      const job = await response.json();
      delay = job ? 0 : 3000;
      if (job) {
        let result;
        try { result = await dispatch(job, config); }
        catch (error) { result = {status:'failed', code:error.code, message:error.message}; }
        pendingReceipt = {id:job.id, kind:job.kind, result, config};
        await postReceipt(pendingReceipt);
      }
      const prior = (await storage.get('mcpBridgeStatus')).mcpBridgeStatus;
      if (prior?.state !== 'connected' || Date.now() - prior.at >= 30000) {
        await storage.set({mcpBridgeStatus:{state:'connected', at:Date.now()}});
      }
    } catch (error) {
      delay = undefined; // A Chrome alarm retries when the service or permission returns.
      const code=error.code||(/Failed to fetch|NetworkError|fetch failed|timeout|timed out/i.test(error.message)?'RELAY_UNREACHABLE':'MCP_CONNECTION_ERROR');
      await storage.set({mcpBridgeStatus:{state:'error',code,message:code==='RELAY_UNREACHABLE'?'无法访问本机服务。请检查服务是否已启动及端口是否正确。':error.message,at:Date.now()}});
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
