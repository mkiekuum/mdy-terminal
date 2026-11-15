export function choosePlanTab(all,windowId,lastWindowId){
 const matching=all.filter(t=>{try{return new URL(t.url).origin==='https://plan.fpgabbs.cn';}catch{return false;}});
 const visible=matching.filter(t=>t.active&&(windowId==null||t.windowId===windowId));
 if(visible.length===1)return visible[0];
 if(visible.length>1){
  const focused=visible.filter(t=>t.windowId===lastWindowId);
  if(focused.length===1)return focused[0];
 }
 return matching.length===1?matching[0]:null;
}
