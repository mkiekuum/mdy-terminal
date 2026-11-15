// Offline replacement of an already verified developer-loaded extension directory.
// Download and checksum verification are deliberately kept outside this file.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {compareVersions} from '../extension/updates.js';

const check=(v,message)=>{if(!v)throw Error(message);};
async function dir(value){
 check(typeof value==='string'&&path.isAbsolute(value),'需要经核实的绝对目录');
 const r=await fs.realpath(value);
 check((await fs.lstat(value)).isDirectory()&&path.dirname(r)!==r,'目录无效或为链接');
 return r;
}
const digest=b=>createHash('sha256').update(b).digest('hex');
async function tree(root,{pack=false}={}){
 const files=new Map(),folders=[];let bytes=0;
 async function visit(relative){
  const contents=await fs.readdir(path.join(root,relative),{withFileTypes:true});
  for(const ent of contents){
   const p=path.join(relative,ent.name);
   check(!ent.isSymbolicLink()&&(ent.isDirectory()||ent.isFile()),'不接受链接或特殊文件：'+p);
   if(pack)check(!['.git','node_modules','.env','chrome-profile','manifest.json.bak'].includes(ent.name),'发现非扩展文件：'+p);
   if(ent.isDirectory()){folders.push(p);await visit(p);}
   else{const entry=path.join(root,p),size=(await fs.stat(entry)).size;bytes+=size;check(files.size<1500&&bytes<=64*1024**2,'目录超出大小限制');files.set(p,{hash:digest(await fs.readFile(entry)),file:entry});}
  }
 }
 await visit('');return {files,folders};
}
async function manifest(root){
 const p=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
 check(p.name==='序图终端'&&p.manifest_version===3&&p.background?.service_worker==='background.js','不是序图终端的扩展根目录');
 return p;
}
function privilege(m){
 const keys=['permissions','host_permissions','optional_permissions','optional_host_permissions'];
 return JSON.stringify([m.key||'',...keys.map(k=>[...(m[k]||[])].sort()),m.content_scripts?.map(c=>[...c.matches].sort()),m.externally_connectable??null,m.web_accessible_resources?.map(c=>[...c.matches].sort())]);
}
export async function replaceUnpacked({install,previous,candidate,apply=false}){
 const [dest,old,newer]=await Promise.all([dir(install),dir(previous),dir(candidate)]);
 const disjoint=(a,b)=>{const r=path.relative(a,b);return !!r&&(r==='..'||r.startsWith('..'+path.sep)||path.isAbsolute(r));};
 check([[dest,old],[dest,newer],[old,newer]].every(([a,b])=>disjoint(a,b)&&disjoint(b,a)),'安装目录和两份解压目录不能是同一个或互相包含');
 const [d,o,n]=await Promise.all([manifest(dest),manifest(old),manifest(newer)]);
 check(d.version===o.version,'已装版本与旧版基线不一致');
 check(compareVersions(n.version,d.version)>0,'候选版本未提高；不重复覆盖或降级');
 check(privilege(d)===privilege(o)&&privilege(d)===privilege(n),'扩展密钥、网站范围或权限变化，需要单独处理');
 const [live,prev,next]=await Promise.all([tree(dest),tree(old,{pack:true}),tree(newer,{pack:true})]);
 for(const [f,a] of prev.files)check(live.files.get(f)?.hash===a.hash,'已装受管理文件缺失或有本地修改：'+f);
 for(const f of next.files.keys())if(!prev.files.has(f))check(!live.files.has(f)&&!live.folders.includes(f),'新文件与用户文件冲突：'+f);
 const removed=[...prev.files.keys()].filter(f=>!next.files.has(f));
 const result={status:apply?'prepared':'preview',install:dest,oldVersion:d.version,newVersion:n.version,removed,preserved:[...live.files.keys()].filter(f=>!prev.files.has(f)),reloadRequired:true};
 if(!apply)return result;
 const parent=path.dirname(dest),backupRoot=await fs.mkdtemp(path.join(parent,'.xutu-before-update-')),backup=path.join(backupRoot,path.basename(dest)),stage=await fs.mkdtemp(path.join(parent,'.xutu-update-'));
 try{
  for(const f of live.folders)await fs.mkdir(path.join(stage,f),{recursive:true});
  for(const f of removed){const r=path.join(stage,f);check(!live.folders.includes(f),'不替换用户目录：'+r);}
  const planned=new Map([...live.files].filter(([f])=>!prev.files.has(f)).concat([...next.files]));
  for(const [f,entry] of planned){
   const target=path.join(stage,f);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(entry.file,target);
   check(digest(await fs.readFile(target))===entry.hash,'候选文件复制不一致：'+f);
  }
  check((await manifest(stage)).version===n.version,'候选目录版本不对');
  const reread=await tree(dest);
  check(reread.files.size===live.files.size&&[...live.files].every(([f,a])=>reread.files.get(f)?.hash===a.hash),'安装目录在更新期间变化，已停止');
  await fs.rename(dest,backup);
  try{await fs.rename(stage,dest);}catch(e){await fs.rename(backup,dest);throw e;}
  return {...result,status:'files_replaced',backup,notice:'文件已替换，请到扩展管理页点重新加载；浏览器中的运行版本尚未核对。'};
 }catch(e){try{await fs.rmdir(backupRoot);}catch{}throw e;}finally{await fs.rm(stage,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [install,previous,candidate,mode,extra]=process.argv.slice(2);
 if(!candidate||mode&&mode!=='--apply'||extra)throw Error('用法：node tools/replace-unpacked.mjs INSTALL_ABS OLD_VERIFIED_ABS NEW_VERIFIED_ABS [--apply]');
 try{console.log(JSON.stringify(await replaceUnpacked({install,previous,candidate,apply:mode==='--apply'}),null,2));}
 catch(e){console.error(e.message);process.exitCode=1;}
}
