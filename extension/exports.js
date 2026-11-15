// Each function is serialized by chrome.scripting; do not capture module state.
export function captureSafeDocument({selector='body',format='html',maxChars=240000}={}){
 if(location.origin!=='https://plan.fpgabbs.cn')throw Error('EXPORT_ORIGIN_DENIED');
 const matches=document.querySelectorAll(selector);
 if(matches.length!==1)throw Error('DOM_SELECTOR_MUST_MATCH_ONE');
 const source=matches[0];
 const omit='script,style,meta,link,base,iframe,frame,object,embed,noscript,template, input[type="hidden"], input[type="password"], #cloudLoginForm, [autocomplete="current-password"], [autocomplete="new-password"]';
 if(source.closest(omit))throw Error('DOM_SENSITIVE_SCOPE');
 const sensitive=el=>/(password|token|cookie|secret|csrf|authorization|credential|密码|密钥|令牌|验证码)/i.test(['id','name','aria-label','autocomplete','placeholder'].map(k=>el.getAttribute(k)||'').join(' '));
 const copy=source.cloneNode(true);
 const originals=[source,...source.querySelectorAll('*')],clones=[copy,...copy.querySelectorAll('*')];
 for(let i=0;i<originals.length;i++){
  const from=originals[i],to=clones[i];
  if(from.matches(omit)||(from.matches('input,textarea,select')&&sensitive(from))){if(from===source)throw Error('DOM_SENSITIVE_SCOPE');to.remove();continue;}
  for(const a of [...to.attributes]){
   const k=a.name.toLowerCase(),v=a.value;
   if(k.startsWith('on')||k.startsWith('data-')||/^(src|srcset|href|action|formaction|background|poster|style|integrity|nonce|form|ping|contenteditable)$/.test(k)||/token|password|secret|cookie|authorization/i.test(k)||k==='xlink:href'||/url\(\s*[^#]/i.test(v))to.removeAttribute(a.name);
  }
  if(from.matches('input')){to.setAttribute('value',from.value);to.toggleAttribute('checked',from.checked);}
  if(from.matches('textarea'))to.textContent=from.value;
  if(from.matches('option'))to.toggleAttribute('selected',from.selected);
  if(from.matches('input,textarea,select,button'))to.setAttribute('disabled','');
 }
 copy.setAttribute('inert','');
 let content=format==='text'?copy.textContent:copy.outerHTML;
 if(content.length>maxChars)throw Error('DOM_TOO_LARGE_SELECT_SMALLER_REGION');
 const page=new URL(location.href);page.search='';page.hash='';
 return {format,selector,title:document.title,url:page.href,content,characters:content.length,sanitized:true,scope:'top document; no scripts, resources, shadow roots or credentials'};
}
export function captureRenderedPlan(expected){
 if(location.origin!=='https://plan.fpgabbs.cn')throw Error('EXPORT_ORIGIN_DENIED');
 const url=new URL(location.href),get=id=>document.getElementById(id)?.value??'';
 if(url.searchParams.get('plan')!==expected.id||get('planNumber')!==expected.planNumber||get('planOwner')!==expected.planOwner||get('title')!==expected.title)throw Error('OPEN_MATCHING_PLAN_BEFORE_EXPORT');
 const graph=document.querySelector('#graph');
 if(graph?.namespaceURI!=='http://www.w3.org/2000/svg')throw Error('NATIVE_GRAPH_NOT_FOUND');
 const copy=graph.cloneNode(true);
 const permitted=new Set(['svg','g','defs','marker','clippath','mask','pattern','lineargradient','radialgradient','stop','rect','circle','ellipse','line','path','polyline','polygon','text','tspan','title','desc','use']);
 for(const el of [copy,...copy.querySelectorAll('*')]){
  if(!permitted.has(el.localName.toLowerCase())){el.remove();continue;}
  for(const attr of [...el.attributes]){
   const k=attr.name.toLowerCase(),v=attr.value;
   if(k.startsWith('on')||k.startsWith('data-')||['width','height','style'].includes(k)&&el===copy||['src','srcset'].includes(k)||['href','xlink:href'].includes(k)&&!/^#[\w:.-]+$/.test(v)||/url\(|@import|expression\(/i.test(v)&&(/url\(\s*[^#]/i.test(v)||/@import|expression\(/i.test(v)))el.removeAttribute(attr.name);
  }
 }
 const box=copy.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
 if(box?.length!==4||box.some(x=>!Number.isFinite(x))||box[2]<=0||box[3]<=0)throw Error('INVALID_GRAPH_VIEWBOX');
 copy.setAttribute('xmlns','http://www.w3.org/2000/svg');
 const svg=copy.outerHTML;
 if(svg.length>1500000)throw Error('GRAPH_TOO_LARGE');
 const nodeText=[...copy.querySelectorAll('text')].filter(t=>/^\d+$/.test(t.textContent.trim()));
 const nodePoints=nodeText.filter(t=>t.hasAttribute('x')&&t.hasAttribute('y')).map(t=>({id:t.textContent.trim(),x:Number(t.getAttribute('x')),y:Number(t.getAttribute('y'))})).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
 return {svg,viewBox:box,nodeLabels:nodeText.map(t=>t.textContent.trim()),nodePoints,source:'site-rendered-svg'};
}
