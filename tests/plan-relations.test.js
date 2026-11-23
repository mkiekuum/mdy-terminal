import assert from 'node:assert/strict';
import test from 'node:test';
import {planRelations} from '../extension/plan-relations.js';
import {requestJob} from '../mcp/job-queue.mjs';
const record={id:'stable',revision:2,collaborators:[],current:{planOwner:'A',
  nodes:['a','b','c','d'].map(id=>({id,name:id})),edges:[
    {from:'a',to:'b',completedAt:'2026-10-01'},{from:'a',to:'c'},
    {from:'b',to:'d',dashed:true},{from:'c',to:'d'}]}};
test('root plan, own task plan and bound node remain distinct across a fork/join',()=>{
 const task={id:'T',projectPlanId:'stable',planId:'another',projectNodeId:'d'};
 const data=planRelations(record,{id:'stable',revision:2,assistantEditable:true},
   [{id:'P',planId:'stable'}],[task],{canAssociate:true,reviewer:false},{actor:'B',role:'user'},
   [{planId:'stable',revision:1,canAssign:true}]);
 assert.deepEqual(data.graph.forks,['a']);
 assert.deepEqual(data.graph.joins,['d']);
 assert.deepEqual(data.graph.nodes[1].unfinishedIncoming,[]);
 assert.deepEqual(data.graph.nodes[3].unfinishedIncoming,['b','c']);
 assert.equal(data.permissions.canEdit,true);
 assert.equal(data.permissions.canManage,false);
 assert.equal(data.permissions.canReviewRecords,false);
 assert.equal(data.workTasks[0].canAssign,false);
 assert.equal(data.tasks[0].ownPlan,false);
 assert.equal(data.tasks[0].projectPlan,true);
 assert.throws(()=>planRelations(record,{id:'stable',revision:3}),{code:'VERSION_CONFLICT'});
});
test('MCP planId generates a read of exactly the requested stable ID',()=>{
 const jobs=new Map(),ticket=requestJob(jobs,'xutu_read',{planId:'stable',tabId:12},1);
 assert.deepEqual(jobs.get(ticket.jobId).command.steps[0],{id:'relations',op:'graph.relations',target:{id:'stable'},params:{}});
 assert.throws(()=>requestJob(jobs,'xutu_read',{planId:'stable',command:{}},1));
});
