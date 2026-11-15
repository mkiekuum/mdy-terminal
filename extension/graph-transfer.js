import {assert,clone,fail} from './core.js';

export function transferGraph(source,destination,{mode='append',nodeIds}={}){
 const selected=new Set(nodeIds??source.nodes.map(n=>n.id));
 assert(selected.size>0&&[...selected].every(id=>source.nodes.some(n=>n.id===id)),'所选节点不存在或选择为空');
 const replacing=mode==='replace';
 assert(!replacing||!nodeIds,'替换全图时不能另选区域；区域复制只能追加');
 if(destination.baseline||destination.edges.some(e=>e.completedAt))fail('PERMISSION_DENIED','目标已有审核基线或完成进度，未复制');
 const result=clone(destination);
 if(replacing){result.nodes=[];result.edges=[];result.positions={};}
 const occupied=new Set(result.nodes.map(n=>n.id));
 let largest=Math.max(0,...result.nodes.map(n=>/^\d{1,9}$/.test(n.id)?Number(n.id):0));
 const idMap=new Map(),omittedBoundaryEdges=[];
 const pos=result.positions??={};
 const existingX=Object.values(pos).map(v=>v?.x).filter(Number.isFinite);
 const sourceX=source.nodes.filter(n=>selected.has(n.id)).map(n=>source.positions?.[n.id]?.x).filter(Number.isFinite);
 const shift=!replacing&&existingX.length&&sourceX.length?Math.max(...existingX)-Math.min(...sourceX)+200:0;
 for(const node of source.nodes.filter(n=>selected.has(n.id))){
  let id=node.id;
  if(!replacing){do{id=String(++largest);}while(occupied.has(id));}
  occupied.add(id);idMap.set(node.id,id);
  result.nodes.push({...clone(node),id});
  const p=source.positions?.[node.id];
  if(Number.isFinite(p?.x)&&Number.isFinite(p?.y))pos[id]={...clone(p),x:p.x+shift};
 }
 for(const edge of source.edges){
  const from=idMap.get(edge.from),to=idMap.get(edge.to);
  if(from&&to)result.edges.push({...clone(edge),from,to,completedAt:''});
  else if(from||to)omittedBoundaryEdges.push({from:edge.from,to:edge.to});
 }
 return {plan:result,changes:{mode,idMap:Object.fromEntries(idMap),omittedBoundaryEdges,addedNodes:idMap.size,addedEdges:result.edges.length-(replacing?0:destination.edges.length)}};
}
