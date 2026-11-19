import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {setupAppearance} from '../extension/appearance.js';
import {installSidebarUI} from '../extension/sidebar-ui.js';

test('appearance restores saved preferences while preserving other storage',async()=>{
 const values={terminalAppearance:{theme:'dark',density:'compact'},history:{saved:true},optimizeSidebar:true,hideSidebar:true};
 const store={get:async key=>({[key]:structuredClone(values[key])}),set:async value=>Object.assign(values,value)};
 const html=readFileSync(new URL('../extension/ui.html',import.meta.url),'utf8');
 const first=new JSDOM(html),doc=first.window.document;
 await setupAppearance(doc,store);
 assert.equal(doc.documentElement.dataset.theme,'dark');
 doc.getElementById('themeChoice').value='light';
 await doc.getElementById('themeChoice').onchange();
 const reopened=new JSDOM(html);
 await setupAppearance(reopened.window.document,store);
 assert.equal(reopened.window.document.documentElement.dataset.theme,'light');
 assert.equal(reopened.window.document.documentElement.dataset.density,'compact');
 assert.deepEqual(values.history,{saved:true});assert.equal(values.hideSidebar,true);
 first.window.close();reopened.window.close();
});
test('hidden sidebar has a reachable restore control and cleans up to original state',()=>{
 const dom=new JSDOM('<html><head></head><body><aside id="fileSidebar" class="native"><button id="fileSidebarToggle">原始入口</button><div>计划列表</div></aside></body></html>');
 const doc=dom.window.document,changes=[];
 const ui=installSidebarUI(doc,{hidden:true,onHiddenChange:value=>changes.push(value)});
 assert(doc.documentElement.classList.contains('xutu-sidebar-hidden'));
 assert.equal(doc.getElementById('xutu-sidebar-restore').hidden,false);
 doc.getElementById('xutu-sidebar-restore').click();
 assert.equal(doc.getElementById('fileSidebarToggle').getAttribute('aria-expanded'),'true');
 doc.getElementById('xutu-sidebar-hide').click();
 assert.deepEqual(changes,[false,true]);
 ui.destroy();
 assert.equal(doc.getElementById('fileSidebar').className,'native');
 assert.equal(doc.getElementById('fileSidebarToggle').textContent,'原始入口');
 assert.equal(doc.querySelector('[id^="xutu-sidebar-"]'),null);
 assert(!doc.documentElement.classList.contains('xutu-sidebar-hidden'));
 dom.window.close();
});

