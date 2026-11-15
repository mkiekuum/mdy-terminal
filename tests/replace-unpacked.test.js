import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {replaceUnpacked} from '../tools/replace-unpacked.mjs';

async function fixture(t){
 const folder=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'xutu-install-')));
 t.after(()=>fs.rm(folder,{force:true,recursive:true}));
 const dirs=Object.fromEntries(['install','previous','candidate'].map(k=>[k,path.join(folder,k)]));
 async function packageDir(target,version,permissions=['storage']){
  await fs.mkdir(target,{recursive:true});
  await fs.writeFile(path.join(target,'manifest.json'),JSON.stringify({manifest_version:3,name:'序图终端',version,permissions,background:{service_worker:'background.js'}}));
  await fs.writeFile(path.join(target,'background.js'),'// '+version);
 }
 await packageDir(dirs.previous,'3.1.2');await fs.writeFile(path.join(dirs.previous,'old.js'),'obsolete');
 await fs.cp(dirs.previous,dirs.install,{recursive:true});await fs.writeFile(path.join(dirs.install,'user-note.txt'),'retain');
 await packageDir(dirs.candidate,'3.2.0');
 return {dirs,packageDir};
}

test('替换同一路径，移除旧受管理文件、保留用户文件并留下备份；预览不写',async t=>{
 const {dirs}=await fixture(t),p=await replaceUnpacked(dirs);
 assert.deepEqual(p.removed,['old.js']);assert.equal(await fs.readFile(path.join(dirs.install,'old.js'),'utf8'),'obsolete');
 const result=await replaceUnpacked({...dirs,apply:true});
 assert.equal(result.install,dirs.install);assert.equal(result.status,'files_replaced');assert(result.reloadRequired);
 assert.equal(await fs.readFile(path.join(dirs.install,'background.js'),'utf8'),'// 3.2.0');
 assert.equal(await fs.readFile(path.join(dirs.install,'user-note.txt'),'utf8'),'retain');
 assert.equal(await fs.readFile(path.join(result.backup,'old.js'),'utf8'),'obsolete');
 await assert.rejects(fs.stat(path.join(dirs.install,'old.js')),e=>e.code==='ENOENT');
});
test('已修改安装、权限扩大、用户文件冲突都不会覆盖原目录',async t=>{
 const {dirs,packageDir}=await fixture(t);
 await fs.writeFile(path.join(dirs.install,'background.js'),'// local change');
 await assert.rejects(replaceUnpacked({...dirs,apply:true}),/本地修改/);
 await fs.copyFile(path.join(dirs.previous,'background.js'),path.join(dirs.install,'background.js'));
 await packageDir(dirs.candidate,'3.2.0',['storage','debugger']);
 await assert.rejects(replaceUnpacked({...dirs,apply:true}),/权限变化/);
 await packageDir(dirs.candidate,'3.2.0');
 await fs.writeFile(path.join(dirs.candidate,'user-note.txt'),'would overwrite');
 await assert.rejects(replaceUnpacked({...dirs,apply:true}),/用户文件冲突/);
 assert.equal(await fs.readFile(path.join(dirs.install,'user-note.txt'),'utf8'),'retain');
});


test('从 macOS 样式的目录别名运行更新入口，确实替换并回读版本',{skip:process.platform==='win32'},async t=>{
 const {dirs}=await fixture(t),folder=path.dirname(dirs.install);
 const tools=fileURLToPath(new URL('../tools/',import.meta.url));
 const alias=path.join(folder,'tools-alias');
 await fs.symlink(tools,alias,'dir');
 const entry=path.join(alias,'replace-unpacked.mjs'),run=promisify(execFile);
 const preview=await run(process.execPath,[entry,dirs.install,dirs.previous,dirs.candidate]);
 assert.equal(JSON.parse(preview.stdout).status,'preview');
 assert.equal(JSON.parse(await fs.readFile(path.join(dirs.install,'manifest.json'),'utf8')).version,'3.1.2');
 const applied=await run(process.execPath,[entry,dirs.install,dirs.previous,dirs.candidate,'--apply']);
 assert.equal(JSON.parse(applied.stdout).status,'files_replaced');
 assert.equal(JSON.parse(await fs.readFile(path.join(dirs.install,'manifest.json'),'utf8')).version,'3.2.0');
});
