import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const exec=promisify(execFile);
const allowed=['csv','pdf','png','svg','html'];
const printKeys=['graph','nodeTable','edgeTable','nodeNames','inlineScore','scoreTable','paper','landscape','marginMm','scale'];
const unsafeKey=/(^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)|[<>:"\\|?*\u0000-\u001f]|[. ]$)/iu;
const htmlGuard="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; base-uri 'none'; form-action 'none'";
const err=(code,msg)=>Object.assign(Error(msg),{code});
const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const requireValue=(condition,message)=>{if(!condition)throw err('INVALID_EXPORT',message);};
const validDir=s=>typeof s==='string'&&s.length<=200&&s.split('/').every(p=>p.length>0&&p.length<=90&&!['.','..'].includes(p)&&!unsafeKey.test(p));

export function exportRequest(a={}){
 requireValue(a&&typeof a==='object'&&!Array.isArray(a)&&Object.keys(a).every(k=>['planId','version','directory','formats','print','region'].includes(k)),'导出参数不受支持');
 requireValue(typeof a.planId==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(a.planId)&&Number.isSafeInteger(a.version)&&a.version>=0,'需要稳定计划 ID 与已读网站版本');
 requireValue(validDir(a.directory),'指定授权输出根目录下的相对路径，不接受上级路径或链接');
 const formats=a.formats??['csv','pdf'];
 requireValue(Array.isArray(formats)&&formats.length>0&&new Set(formats).size===formats.length&&formats.every(x=>allowed.includes(x)),'格式仅支持 csv/pdf/png/svg/html');
 const print=a.print??{};
 requireValue(a.print===undefined||formats.includes('pdf'),'打印设置仅用于 PDF');
 requireValue(print&&typeof print==='object'&&!Array.isArray(print)&&Object.keys(print).every(k=>printKeys.includes(k)),'未知 PDF 设置');
 for(const k of ['graph','nodeTable','edgeTable','nodeNames','inlineScore','scoreTable','landscape'])requireValue(print[k]===undefined||typeof print[k]==='boolean','PDF 布尔设置无效：'+k);
 requireValue(print.paper===undefined||['A4','A3','Letter','Legal'].includes(print.paper),'无效纸型');
 requireValue(print.marginMm===undefined||Number.isFinite(print.marginMm)&&print.marginMm>=0&&print.marginMm<=35,'页边距必须在 0–35 mm');
 requireValue(print.scale===undefined||Number.isFinite(print.scale)&&print.scale>=0.5&&print.scale<=1.5,'比例必须在 0.5–1.5');
 const options={graph:true,nodeTable:true,edgeTable:true,nodeNames:false,inlineScore:false,scoreTable:false,paper:'A4',landscape:true,marginMm:8,scale:1,...print};
 requireValue(options.graph||options.nodeTable||options.edgeTable||options.inlineScore||options.scoreTable,'PDF 至少选择一个内容');
 requireValue(!options.nodeNames||options.graph,'图中序号名称需要网络图');
 requireValue(!options.inlineScore||options.graph,'同页评分需要网络图');
 const region=a.region;
 if(region!==undefined){
  requireValue(formats.includes('png')||formats.includes('svg'),'区域坐标只用于 PNG 与 SVG');
  requireValue(region&&typeof region==='object'&&Object.keys(region).length===4&&['x','y','width','height'].every(k=>Number.isFinite(region[k])&&Math.abs(region[k])<=50000)&&region.width>0&&region.height>0,'区域须为网络图坐标 x/y/width/height');
 }
 return {directory:a.directory,capture:{planId:a.planId,version:a.version,formats,print:options,region}};
}

function sanitizeNativeSvg(s){
 requireValue(typeof s==='string'&&s.length<1500000&&/^<svg\b/.test(s)&&s.endsWith('</svg>'),'网络图无效');
 requireValue(!/<(?:script|foreignobject|iframe|object|embed|style|image|animate|set)\b|<!|\s(?:on[a-z]+|src|srcset)\s*=|(?:xlink:)?href\s*=\s*["'](?!#)|@import|url\(\s*[^#]|javascript:/i.test(s),'网络图含不允许的外部资源或主动内容');
 return s;
}
function svgFor(graph,region){
 const s=sanitizeNativeSvg(graph?.svg);
 const box=graph.viewBox;
 requireValue(Array.isArray(box)&&box.length===4&&box.every(Number.isFinite)&&box[2]>0&&box[3]>0,'网络图视框无效');
 const actual=/\bviewBox="([^"]+)"/.exec(s)?.[1]?.trim().split(/[\s,]+/).map(Number);
 requireValue(actual?.length===4&&box.every((v,i)=>v===actual[i]),'网络图视框与元数据不一致');
 if(!region)return {svg:s,box};
 const {x,y,width,height}=region;
 requireValue(x>=box[0]&&y>=box[1]&&x+width<=box[0]+box[2]&&y+height<=box[1]+box[3],'截图区域超出网络图视框');
 return {svg:s.replace(/\bviewBox="[^"]+"/,'viewBox="'+[x,y,width,height].join(' ')+'"'),box:[x,y,width,height]};
}
const csv=rows=>'\ufeff'+rows.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';
function estimate(edge){const values=String(edge.upper??'').split('-').filter(x=>x.trim()).map(Number);if(values.length===1&&Number.isFinite(values[0]))return values[0];const [a,b,c]=values;if(values.length===3&&[a,b,c].every(Number.isFinite))return Number(((a+b*4+c)/6).toFixed(6));return '';}
const hTable=(title,headers,rows)=>'<section><h2>'+escape(title)+'（'+rows.length+'）</h2><table><thead><tr>'+headers.map(x=>'<th>'+escape(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+escape(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></section>';
export function tables(current){
 const nodes=current.nodes.map(n=>[n.id,n.name,n.content,n.owner,current.positions?.[n.id]?.x,current.positions?.[n.id]?.y,JSON.stringify(n)]);
 const edges=current.edges.map(e=>[e.from,e.to,...String(e.upper??'').split('-').concat(['','','']).slice(0,3),e.dashed===true?'虚线':'实线',e.executor,e.completedAt,e.lower,e.visualIgnore===true?'是':e.visualIgnore===false?'否':'',estimate(e),JSON.stringify(e)]);
 return {nodes:csv([['序号','名称','具体内容','责任人','布局X','布局Y','原始字段JSON'],...nodes]),edges:csv([['起点','终点','最小','最可能','最大','线型','执行人','实际完成日期','附注','视觉忽略','平均用时','原始字段JSON'],...edges])};
}
export function printHtml(source,p){
 const plan=source.current,analysis=source.analysis?.calculation||{},score=source.analysis?.score;
 const title=plan.title+' · 项目信息';
 const sheet={A4:[210,297],A3:[297,420],Letter:[215.9,279.4],Legal:[215.9,355.6]}[p.paper];
 const graphMax=Math.max(45,Math.floor(sheet[p.landscape?0:1]-2*p.marginMm-48));
 const labels=plan.nodes.map(n=>[n.id,n.name]);
 const map=analysis.nodeCompletion||{};
 const schedule=Array.isArray(analysis.schedule)?analysis.schedule:[];
 const rates=Array.isArray(score?.findings)?score.findings.map(f=>[f.rule??f.type??f.code??f.category,f.message??f.detail??f.title??f.label??(typeof f==='string'?f:JSON.stringify(f))]):[];
 requireValue(!(p.inlineScore||p.scoreTable)||score&&Array.isArray(score.findings),'网站没有返回可打印的评分细项');
 const max=(n)=>Number.isFinite(n)?n:'';
 const date=(days)=>{if(!plan.start||!Number.isFinite(days))return '';const d=new Date(plan.start+'T00:00:00Z');if(!Number.isFinite(+d))return '';d.setUTCDate(d.getUTCDate()+Math.floor(days));return d.toISOString().slice(0,10);};
 const nodeRows=plan.nodes.map(n=>{const days=map[n.id]?.days??map[n.id]?.time??max(map[n.id]);return [n.id,n.name,n.owner,days,map[n.id]?.date??date(days),n.content];});
 const edgeRows=plan.edges.map((e,i)=>{const s=schedule.find(x=>String(x.from)===String(e.from)&&String(x.to)===String(e.to))??schedule[i]??{};return [e.from+'→'+e.to+(e.dashed?'（虚线）':''),e.upper,estimate(e),s.te??s.earlyStart??s.earliestStart,s.tl??s.lateStart??s.latestStart,s.slack??s.float,s.finishDate??s.completionDate,e.executor,e.completedAt];});
 let graph='';
 if(p.graph){
  let {svg,box}=svgFor(source.graph);
  if(p.nodeNames){const points=new Map((source.graph.nodePoints||[]).filter(pt=>Number.isFinite(pt.x)&&Number.isFinite(pt.y)).map(pt=>[pt.id,pt]));
   requireValue(labels.every(([id])=>points.has(id)),'网站网络图未提供全部序号的坐标，无法显示图中名称');
   const annotations=labels.map(([id,name])=>{const pt=points.get(id);return '<text x="'+pt.x+'" y="'+(pt.y-23)+'" text-anchor="middle" font-size="12" fill="#173a2b">'+escape(name)+'</text>';}).join('');
   svg=svg.replace(/<\/svg>$/,'<g aria-label="图中序号名称">'+annotations+'</g></svg>');
  }
  graph='<section class="chart"><h2>计划网络图</h2><div class="diagram" style="aspect-ratio:'+box[2]+'/'+box[3]+'">'+svg+'</div>'+
  (p.inlineScore?hTable('图中评分项',['评分项','内容'],rates):'')+'</section>';
 }
 const info=[['计划名称',plan.title],['计划负责人',plan.planOwner],['计划编号',plan.planNumber],['开始日期',plan.start],['必须完成日期',plan.deadline],['网站版本',source.revision],['总工期（天）',analysis.totalDays],['节点／连线',plan.nodes.length+'／'+plan.edges.length]];
 return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+htmlGuard+'"><title>'+escape(title)+'</title><style>@page{size:'+p.paper+(p.landscape?' landscape':' portrait')+';margin:'+p.marginMm+'mm}*{box-sizing:border-box}body{margin:0;color:#183028;font-family:"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif;font-size:'+10*p.scale+'pt}h1{font-size:1.6em;margin:0 0 .5em}h2{font-size:1.22em;margin:.85em 0 .28em;break-after:avoid}header{background:#eef4ef;padding:9px;border:1px solid #dbe7de;display:grid;grid-template-columns:repeat(4,1fr);gap:6px 12px}small{display:block;color:#3e554d}table{border-collapse:collapse;width:100%;table-layout:auto}td,th{border:1px solid #c5d4cb;padding:.34em .50em;text-align:left;overflow-wrap:anywhere}th{background:#e4eee7}thead{display:table-header-group}tr,.diagram{break-inside:avoid}.diagram{width:100%;position:relative;max-height:'+graphMax+'mm}.diagram svg{width:100%;height:100%;display:block}.standalone{break-before:page}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style><h1>'+escape(title)+'</h1><header>'+info.map(([k,v])=>'<div><small>'+escape(k)+'</small>'+escape(v)+'</div>').join('')+'</header>'+graph+
 (p.nodeTable?hTable('序号定义表',['序号','阶段名称','责任人','预计完成时间（天）','预计完成日期','具体内容'],nodeRows):'')+
 (p.edgeTable?hTable('连线定义表',['起点→终点','最小－最可能－最大','平均用时','最早开工 TE','最迟开工 TL','时差','预计完成日期','执行人','实际完成日期'],edgeRows):'')+
 (p.scoreTable?'<div class="standalone">'+hTable('独立评分表',['评分项','内容'],rates)+'</div>':'')+'</html>';
}
async function destination(root,relative){
 requireValue(root&&path.isAbsolute(root),'先配置本机绝对输出根目录 XUTU_EXPORT_ROOT');
 const base=await fs.realpath(root);
 requireValue((await fs.stat(base)).isDirectory(),'输出根目录不是目录');
 let current=base;
 for(const part of relative.split('/')){
  const next=path.join(current,part);
  try{await fs.mkdir(next);}catch(e){if(e.code!=='EEXIST')throw e;}
  const stat=await fs.lstat(next);
  requireValue(stat.isDirectory()&&!stat.isSymbolicLink()&&await fs.realpath(next)===next,'输出目录不能经过符号链接或其他文件');
  current=next;
 }
 return current;
}
async function renderer({type,file,html,chromePath,width,height}){
 const normal=process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':process.platform==='win32'?path.join(process.env.PROGRAMFILES||'C:\\Program Files','Google','Chrome','Application','chrome.exe'):'/usr/bin/google-chrome';
 const app=chromePath||normal;
 const d=await fs.mkdtemp(path.join(os.tmpdir(),'xutu-render-'));
 try{
  await fs.chmod(d,0o700);const htmlPath=path.join(d,'page.html');
  await fs.writeFile(htmlPath,html,{mode:0o600});
  const args=['--headless=new','--disable-extensions','--disable-gpu','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--no-default-browser-check','--host-resolver-rules=MAP * ~NOTFOUND','--user-data-dir='+path.join(d,'profile')];
  if(type==='pdf')args.push('--no-pdf-header-footer','--print-to-pdf='+file);
  else args.push('--hide-scrollbars','--force-device-scale-factor=1','--window-size='+width+','+height,'--screenshot='+file);
  args.push(pathToFileURL(htmlPath).href);
  try{await exec(app,args,{timeout:30000,maxBuffer:256*1024,windowsHide:true});}catch(e){throw err('RENDER_FAILED','本机 Chromium 未生成 '+type.toUpperCase()+'：'+(e.code||'检查本机浏览器配置'));}
 }finally{await fs.rm(d,{recursive:true,force:true});}
}
export async function saveExport({root,chromePath},request,source,{render=renderer}={}){
 const {directory,capture}=request,p=source?.current;
 requireValue(source?.id===capture.planId&&source?.revision===capture.version&&Array.isArray(p?.nodes)&&Array.isArray(p.edges),'浏览器返回的计划及版本与请求不一致');
 const actualFolder=await destination(root,directory),stage=await fs.mkdtemp(path.join(actualFolder,'.xutu-stage-'));
 const pending=[],created=[];
 async function file(name,data){const target=path.join(stage,name);if(data!==undefined)await fs.writeFile(target,data,{mode:0o600});pending.push({name,target});return target;}
 try{
  await fs.chmod(stage,0o700);
  if(capture.formats.includes('csv')){const t=tables(p);await file('节点.csv',t.nodes);await file('箭头.csv',t.edges);}
  if(capture.formats.includes('html')){
   requireValue(source.document?.sanitized&&typeof source.document.content==='string','浏览器未返回经筛除敏感字段的 DOM');
   requireValue(!/<(?:script|iframe|object|embed|link|meta|base|style)\b|(?:\s(?:on[a-z]+|src|srcset|href|formaction|action)\s*=)/i.test(source.document.content),'DOM 含未移除的主动内容');
   await file('网页结构.html','<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+htmlGuard+'">'+source.document.content);
  }
  if(capture.formats.includes('svg')||capture.formats.includes('png')){
   const cropped=svgFor(source.graph,capture.region);
   if(capture.formats.includes('svg'))await file(capture.region?'区域网络图.svg':'网络图.svg',cropped.svg);
   if(capture.formats.includes('png')){
    const [, ,w,h]=cropped.box,ratio=Math.min(2,2600/Math.max(w,h));
    const width=Math.max(1,Math.round(w*ratio)),height=Math.max(1,Math.round(h*ratio));
    const t=await file(capture.region?'区域网络图.png':'网络图.png');
    await render({type:'png',file:t,chromePath,width,height,html:'<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+htmlGuard+'"><style>html,body{margin:0;background:#fff}svg{display:block;width:'+width+'px;height:'+height+'px}</style>'+cropped.svg});
   }
  }
  if(capture.formats.includes('pdf')){
   const t=await file('计划网络图.pdf');
   await render({type:'pdf',file:t,chromePath,html:printHtml(source,capture.print)});
  }
  const receipt=[];
  for(const {name,target} of pending){
   const bytes=await fs.readFile(target);
   requireValue(bytes.length>0&&(!name.endsWith('.pdf')||bytes.subarray(0,5).toString()==='%PDF-')&&(!name.endsWith('.png')||bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a'),'无效的导出文件：'+name);
   const dest=path.join(actualFolder,name);
   try{await fs.link(target,dest);}catch(e){if(e.code==='EEXIST')throw err('DESTINATION_EXISTS','文件已存在，未覆盖：'+name);throw e;}
   created.push(dest);receipt.push({name,path:dest,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  return {status:'success',planId:source.id,version:source.revision,owner:p.planOwner,number:p.planNumber,files:receipt,visualSource:'site SVG and native calculation, local PDF/PNG render'};
 }catch(e){for(const f of created)await fs.unlink(f);throw e;}finally{await fs.rm(stage,{recursive:true,force:true});}
}
