import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installSidebarUI} from '../extension/sidebar-ui.js';

test('legacy sidebar hiding leaves the MDY navigation and native handlers intact',()=>{
 const dom=new JSDOM('<html><head></head><body><nav id="mdyNav">MDY navigation</nav><aside id="fileSidebar" class="native"><button>Original control</button></aside></body></html>');
 const doc=dom.window.document,panel=doc.getElementById('fileSidebar'),nav=doc.getElementById('mdyNav');
 let clicks=0;panel.querySelector('button').onclick=()=>clicks++;
 const before=nav.outerHTML,ui=installSidebarUI(doc);
 assert(ui.available);assert.equal(dom.window.getComputedStyle(panel).display,'none');
 assert.equal(nav.outerHTML,before);assert.notEqual(dom.window.getComputedStyle(nav).display,'none');
 ui.destroy();assert.equal(panel.className,'native');assert.notEqual(dom.window.getComputedStyle(panel).display,'none');
 panel.querySelector('button').click();assert.equal(clicks,1);
 assert.equal(doc.querySelector('[data-mdy-legacy-sidebar]'),null);
 dom.window.close();
});
test('pages without a legacy sidebar are unchanged',()=>{
 const dom=new JSDOM('<nav>MDY</nav>'),before=dom.serialize();
 assert.equal(installSidebarUI(dom.window.document).available,false);assert.equal(dom.serialize(),before);dom.window.close();
});
