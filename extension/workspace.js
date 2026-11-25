const text = {type:'string'};
const id = {type:'string',minLength:1};
const kind = {enum:['JH','SJ']};
const page = {type:'integer',minimum:1};
const size = {...page,maximum:100};
const dates = {month:text,from:text,to:text};
const listing = {page,size,q:text,owner:text,status:text,coverage:text,assistantRole:text,assistantName:text};
const contract = (properties,required=[]) => ({type:'object',properties,required,additionalProperties:false});

const routes = {
  'records.trash':['/api/trash',{}],
  'records.projectPage':['/api/records/projects',listing],
  'records.taskPage':['/api/records/tasks',{...listing,projectId:id}],
  'records.planPage':['/api/plans',listing],
  'records.workPage':['/api/work-tasks',listing],
  'records.summary':['/api/records/summary',{field:{enum:['created','updated','completed']},...dates}],
  'records.listSummary':['/api/records/list-summary',{}],
  'records.overdue':['/api/work-tasks/overdue-summary',dates],
  'records.claims':['/api/number-claims',{kind,page,size}],
  'records.availableNumbers':['/api/number-claims/options',{kind},['kind']],
  'records.projectNodes':['/api/records/projects',{projectId:id},['projectId']]
};
export const workspaceReads = Object.fromEntries(Object.entries(routes).map(([op,[url]])=>[op,url]));
export const workspaceSchemas = Object.fromEntries(Object.entries(routes).map(([op,[,fields,required]])=>[op,contract(fields,required)]));
workspaceSchemas['records.claimNumber']=contract({kind,title:id},['kind','title']);
workspaceSchemas['records.linkNode']=contract({taskId:id,planId:id,nodeId:text,nodeLinks:{type:'array',items:contract({nodeId:id,isKey:{type:'boolean'}},['nodeId','isKey'])},before:{type:'object'}},['taskId','planId','before']);

export function workspacePath(op,params) {
  const [url] = routes[op];
  if(op==='records.projectNodes')return url+'/'+encodeURIComponent(params.projectId)+'/nodes';
  const query=new URLSearchParams(op.endsWith('Page') || op==='records.claims' ? {page:1,size:50,...params} : params);
  return query.size ? url+'?'+query : url;
}
