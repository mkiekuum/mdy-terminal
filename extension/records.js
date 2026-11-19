import {assert,fail,equivalent,validDate} from './core.js';

export const recordReads = {'records.meta':'/api/records/meta','records.projects':'/api/records/projects','records.tasks':'/api/records/tasks','records.requests':'/api/records/requests'};
export const recordWrites = ['records.submit','records.review','records.link'];
const listPath = kind => '/api/records/' + (kind === 'project' ? 'projects' : 'tasks');
const matches = (record, payload) => Object.entries(payload).every(([key,value]) => equivalent(record?.[key],value));

export async function runRecord(request, step, envelope) {
 const p=step.params, meta=await request('/api/records/meta');
 const review=step.op==='records.review', link=step.op==='records.link';
 if ((review||link||p.direct) && !meta.reviewer) fail('PERMISSION_DENIED');
 if (envelope.execution?.backup) fail('UNSUPPORTED_BY_SITE','项目与任务申请暂不支持历史恢复');
 let current=null, kind=p.kind, action=p.action, targetId=p.targetId||'';
 if(review){
  current=(await request('/api/records/requests')).find(r=>r.id===p.requestId);
  if(!current)fail('TARGET_NOT_FOUND');
  assert(current.status==='pending','申请已经处理，请重新读取');
  kind=current.kind;action=current.action;targetId=current.targetId||'';
 }else if(link||action==='update'){
  current=(await request(listPath(kind))).find(r=>r.id===targetId);
  if(!current)fail('TARGET_NOT_FOUND');
 }
 if(current&&!equivalent(current,p.before))fail('VERSION_CONFLICT','记录已变化，请重新读取并预览');
 let payload;
 if(!link){
  assert(kind==='project'||kind==='task','未知记录类型');
  assert(kind==='project'?p.payload.shortName:p.payload.subject,'记录类型与内容不匹配');
  const fields=kind==='project'?['kind','referenceNumber','shortName','owner','category','status','startDate','targetDate','note']:['projectId','type','subject','owner','status','completedAt','targetDate','content','deliverable','note'];
  const original=review?current.payload:current;
  payload={...Object.fromEntries(Object.entries(original||{}).filter(([key])=>fields.includes(key))),...p.payload};
  if(kind==='task'){
   assert(meta.types?.includes(payload.type),'任务类型已变化，请读取 records.meta');
   payload.title=payload.type+'-'+payload.subject;
   if(payload.status)assert(meta.statuses?.includes(payload.status),'任务状态无效');
   const projects=await request('/api/records/projects');
   assert(projects.some(r=>r.id===payload.projectId),'请选择现有项目');
  }
  assert(meta.users?.includes(payload.owner),'负责人不在当前人员列表');
  for(const field of ['startDate','targetDate','completedAt'])if(payload[field]!==undefined)assert(validDate(payload[field]),'日期无效');
  if(action==='create'&&!review){
   assert(!p.direct,'新建统一提交审核');
   assert(payload.targetDate===undefined,'新建时由审核流程确定计划完成日期');
   if(kind==='task')assert(payload.status===undefined&&payload.completedAt===undefined,'新任务状态由审核流程确定');
  }
 }
 if(link&&p.planId){const plans=await request('/api/plans');assert(plans.some(r=>r.id===p.planId),'关联计划必须使用稳定 ID');}
 const endpoint=review?'/api/records/requests/'+encodeURIComponent(p.requestId)+'/review':link?'/api/records/link':'/api/records/requests';
 const body=review?{decision:p.decision,payload,note:p.note||''}:link?{kind,targetId,planId:p.planId}:{kind,action,targetId,payload,direct:p.direct||false};
 if(review&&p.decision==='reject')assert(p.note?.trim(),'退回需要原因');
 const notice='记录接口未提供原子版本条件，执行前比较完整读取依据；提交期间并发修改仍由网站处理。';
 if(envelope.mode==='preview')return {data:{before:current,after:body,notice,expectedStatus:link?'linked':review?p.decision==='reject'?'rejected':'approved':p.direct?'approved':'pending'},serverVerified:false};
 const previousRequests=link||review?[]:await request('/api/records/requests');
 try{
  const result=await request(endpoint,'POST',body);
  let saved;
  if(link){saved=(await request(listPath(kind))).find(r=>r.id===targetId);if(!saved||saved.planId!==p.planId)fail('SERVER_NOT_CONFIRMED');}
  else {
   const requests=await request('/api/records/requests');
   const id=review?p.requestId:result.id;
   saved=requests.find(r=>r.id===id);
   if(!saved&&!review){const added=requests.filter(r=>!previousRequests.some(old=>old.id===r.id)&&r.kind===kind&&r.action===action&&matches(r.payload,payload));if(added.length===1)saved=added[0];}
   if(!saved||saved.status!==(review?(p.decision==='reject'?'rejected':'approved'):(p.direct?'approved':'pending')))fail('SERVER_NOT_CONFIRMED');
   if(!review&&(saved.kind!==kind||saved.action!==action))fail('SERVER_NOT_CONFIRMED');
   if(saved.status!=='rejected'&&!matches(saved.payload,payload))fail('SERVER_NOT_CONFIRMED');
  }
  return {data:{record:saved,notice,status:saved.status||'linked'},serverVerified:true};
 }catch(error){error.outcome=['PERMISSION_DENIED','VERSION_CONFLICT','INVALID_SITE_DATA'].includes(error.code)?'not_executed':'unconfirmed';throw error;}
}
