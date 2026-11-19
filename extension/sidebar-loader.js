(async()=>{
 if(globalThis.__xutuSidebarLoader)return;globalThis.__xutuSidebarLoader=true;
 const {installSidebarUI}=await import(chrome.runtime.getURL('sidebar-ui.js'));let ui,generation=0;
 const apply=async()=>{const token=++generation;const {optimizeSidebar,hideSidebar}=await chrome.storage.local.get(['optimizeSidebar','hideSidebar']);if(token!==generation)return;ui?.destroy();ui=optimizeSidebar||hideSidebar?installSidebarUI(document,{hidden:!!hideSidebar,onHiddenChange:value=>chrome.storage.local.set({hideSidebar:value}).catch(()=>{})}):null;};
 chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes.optimizeSidebar||changes.hideSidebar))apply();});await apply();
})();
