import test from 'node:test';
import assert from 'node:assert/strict';
test('delegated selection verifies pending application and unchanged effective nodes',async()=>{
 const task={id:'T',projectId:'P',canSelectNodes:true,nodeSelectionNeedsReview:true,owner:'owner',projectNodeLinks:[]};
 const selected=[{nodeId:'1',isKey:true}],step={id:'s',op:'records.linkNode',params:{taskId:'T',planId:'G',nodeLinks:selected,before:task}};
 const application={id:'R',target_id:'T',action:'nodes',status:'pending',payload:{nodeDetails:[{id:'1',isKey:true}]}};
 const request=async(path,method,body)=>{
  if(method){assert.deepEqual(body,{nodeLinks:selected});return {id:'R',status:'pending',reviewer:'owner'};}
  if(path.endsWith('/requests'))return [application];
  if(path.endsWith('/tasks'))return [task];
  if(path.endsWith('/nodes'))return {planId:'G',nodes:[{id:1}]};
  return {};
 };
 assert.equal((await runRecord(request,step,{mode:'preview'})).data.expectedStatus,'待审核');
 assert.equal((await runRecord(request,step,{mode:'execute'})).data.requestId,'R');
});
import {runRecord} from '../extension/records.js';
import {workspacePath} from '../extension/workspace.js';
import {validateStep} from '../extension/validation.js';
test('workspace query stays on a fixed route and keeps page metadata',()=>{
 assert.equal(workspacePath('records.taskPage',{projectId:'P&kind=X',page:2}),'/api/records/tasks?page=2&size=50&projectId=P%26kind%3DX');
 assert.throws(()=>validateStep({id:'s',op:'records.taskPage',params:{url:'/api/login'}}));
});
test('number previews allocate nothing and executions retain the same operation id',async()=>{
 const calls=[];
 const request=async(path,method,body)=>{if(!method)return {};calls.push(body);return {number:'JH-example',title:body.title}};
 const step={id:'n',op:'records.claimNumber',params:{kind:'JH',title:'example'}};
 const preview=await runRecord(request,step,{mode:'preview',requestId:'r'});
 assert.equal(calls.length,0);
 await runRecord(request,step,{mode:'execute',requestId:'r'});
 assert.equal(calls[0].operation,preview.data.after.operation);
});
test('node association refuses a changed project plan before posting',async()=>{
 const task={id:'T',projectId:'P'};
 const request=async(path,method)=>{assert(!method);if(path.endsWith('/meta'))return {canAssociate:true};if(path.endsWith('/tasks'))return [task];return {planId:'other',nodes:[]}};
 await assert.rejects(runRecord(request,{op:'records.linkNode',params:{before:task,taskId:'T',nodeId:'1',planId:'old'}},{mode:'execute'}),/项目关联计划已变化/);
});
