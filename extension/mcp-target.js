import {fail} from './core.js';
import {pagePlanTarget} from './page-plan-target.js';

export async function stablePagePlan(page, list) {
 const target=await pagePlanTarget(page,list);
 if(target?.id)return target.id;
 if(!target?.number)return null;
 const matches=(await list()).filter(p=>p.planNumber===target.number&&(!target.owner||p.planOwner===target.owner));
 if(matches.length!==1)fail('TARGET_CHANGED','无法唯一核对当前页计划。请重新打开目标计划并读取。');
 return matches[0].id;
}

// Resolve only an originally scoped plan; never use an unrelated active tab as fallback.
export async function recoverPlanTab({tabs,planId,actor,session,inspect,list}) {
 if(!planId)return {tab:null,selection:'no_target'};
 const matches=(await Promise.all(tabs.map(async tab=>{
  try {
   const account=await session(tab);
   if(!account.actor||(actor&&actor!==account.actor))return null;
   const active=await stablePagePlan(await inspect(tab),()=>list(tab));
   return active===planId?tab:null;
  } catch {return null;}
 }))).filter(Boolean);
 return matches.length===1?{tab:matches[0],selection:'stable_target'}:{tab:null,selection:matches.length?'ambiguous':'no_target'};
}