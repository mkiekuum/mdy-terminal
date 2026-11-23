(()=>{
 if(globalThis.__xutuTerminalBridge==='4.6.1')return;globalThis.__xutuTerminalBridge='4.6.1';
 document.querySelectorAll('#xutu-theme-style,[data-xutu-component]').forEach(node=>node.remove());
 const error=code=>Object.assign(new Error(code),{code});
 chrome.runtime.onMessage.addListener((m,sender,reply)=>{if(sender.id!==chrome.runtime.id)return;(async()=>{
 if(m.kind==='inspect'){const ids=['new','nodeSubmit','edgeSubmit','rows','planOwner','planNumber','title'];return {origin:location.origin,anchors:Object.fromEntries(ids.map(id=>[id,document.querySelectorAll('#'+id).length])),planUrlValue:new URL(location.href).searchParams.get('plan'),activeTarget:{number:document.getElementById('planNumber')?.value||'',owner:document.getElementById('planOwner')?.value||''},auth:'use site.session for authoritative result'};}
 const workspaceRead=m.method==='GET' && /^\/api\/(?:plans|work-tasks(?:\/overdue-summary)?|number-claims(?:\/options)?|records\/(?:summary|list-summary|projects|tasks))(?:\?[A-Za-z0-9%&=+_.~-]*)?$/.test(m.path);
 const workspaceNodes=m.method==='GET' && /^\/api\/records\/projects\/[A-Za-z0-9_-]+\/nodes$/.test(m.path);
 const workspaceWrite=m.method==='POST' && /^\/api\/(?:number-claims|records\/tasks\/[A-Za-z0-9_-]+\/project-node)$/.test(m.path);
 if(m.kind!=='api'||!workspaceRead&&!workspaceNodes&&!workspaceWrite&&!/^\/api\/(session|plans(?:\/[^/?#]+(?:\/(change|import|trash|undelete|submit|review|restore|forecast-log))?)?|records\/(?:meta|projects|tasks|requests(?:\/[^/?#]+\/review)?|link)|trash|assignees|project-groups|visibility-groups|work-tasks(?:\/update)?)$/.test(m.path))throw error('PERMISSION_DENIED');
 try{const r=await fetch(m.path,{method:m.method,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:m.body?JSON.stringify(m.body):undefined,signal:AbortSignal.timeout(20000)});if(!r.ok){let detail;try{const payload=await r.json();detail=typeof payload.error==='string'?payload.error:typeof payload.message==='string'?payload.message:'';}catch{}return {ok:false,code:({400:'INVALID_SITE_DATA',401:'NOT_LOGGED_IN',403:'PERMISSION_DENIED',404:'TARGET_NOT_FOUND',409:'VERSION_CONFLICT',410:'TARGET_TRASHED'})[r.status]||'SERVER_ERROR',message:'服务器 HTTP '+r.status+(detail?'：'+detail.slice(0,500):'')};}return {ok:true,data:await r.json()};}catch{return {ok:false,code:'NETWORK_ERROR',message:'请求失败或超时；写入状态未知，先回读再处理'};}
 })().then(reply,e=>reply({ok:false,code:e.code||'DOM_DRIFT',message:e.message}));return true;});
})();
