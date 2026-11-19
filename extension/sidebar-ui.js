// Hide only the legacy plan library, leaving MDY's site navigation intact.
export function installSidebarUI(doc=document){
 const panel=doc.getElementById('fileSidebar');
 if(!panel)return {available:false,reason:'当前页面没有旧计划栏'};
 const style=doc.createElement('style');
 style.dataset.mdyLegacySidebar='hidden';
 style.textContent='html.mdy-hide-legacy-sidebar{--file-space:0px!important}html.mdy-hide-legacy-sidebar #fileSidebar{display:none!important}';
 doc.head.append(style);
 doc.documentElement.classList.add('mdy-hide-legacy-sidebar');
 return {available:true,destroy(){
  style.remove();
  doc.documentElement.classList.remove('mdy-hide-legacy-sidebar');
 }};
}
