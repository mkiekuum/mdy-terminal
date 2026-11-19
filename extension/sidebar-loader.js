(async()=>{
 if(globalThis.__xutuSidebarLoader)return;
 globalThis.__xutuSidebarLoader=true;
 const {installSidebarUI}=await import(chrome.runtime.getURL('sidebar-ui.js'));
 let ui,generation=0;
 const apply=async()=>{
  const token=++generation;
  const {hideSidebar}=await chrome.storage.local.get('hideSidebar');
  if(token!==generation)return;
  ui?.destroy?.();
  ui=hideSidebar?installSidebarUI():null;
 };
 chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==='local'&&changes.hideSidebar)apply();
 });
 await apply();
})();
