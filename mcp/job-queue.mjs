import {randomUUID} from 'node:crypto';
import {checked,readOnly} from '../extension/mcp-policy.js';
import {makeRoom,resultView} from './job-results.mjs';

const ticket = job => ({jobId:job.id,status:job.status});

export function requestJob(jobs, name, args, now) {
  if (name === 'xutu_result') {
    const job = jobs.get(args.jobId);
    if (!job) throw Error('任务不存在；服务重启后先核对网站原 requestId，不自动重放');
    return resultView(job,args);
  }
  let payload;
  switch (name) {
    case 'xutu_status':
    case 'xutu_login':
      payload = {kind:name === 'xutu_login' ? 'login' : 'status'};
      break;
    case 'xutu_read':
    case 'xutu_preview': {
      if (args.tabId !== undefined && args.command !== undefined)
        throw Error('有 command 时请在 command.tabId 指定网页');
      if(args.planId!==undefined && (name!=='xutu_read' || args.command!==undefined ||
          typeof args.planId!=='string' || !args.planId.trim()))throw Error('planId 只用于独立的计划关系查询');
      const overview = name === 'xutu_read' && args.command === undefined;
      const command = checked(overview ? {
        protocol:'xutu.command/v1', requestId:randomUUID(), tabId:args.tabId,
        steps:args.planId?[{id:'relations',op:'graph.relations',target:{id:args.planId},params:{}}]:[{id:'context',op:'site.context',params:{projectGroups:'omit'}}]
      } : args.command);
      if (name === 'xutu_read' && !readOnly(command)) throw Error('只读工具拒绝写入');
      payload = {kind:name === 'xutu_read' ? 'read' : 'preview',command};
      if (overview && !args.planId) payload.overview = true;
      break;
    }
    case 'xutu_execute': {
      if (typeof args.approval !== 'string' || !args.approval.trim()) throw Error('缺少明确同意');
      const preview = jobs.get(args.previewJobId);
      if (!['preview','execute'].includes(preview?.kind) || preview.status !== 'completed' ||
          preview.result?.previewJobId !== preview.id) throw Error('预览未成功');
      const existing = [...jobs.values()].find(job => job.kind === 'execute' &&
        job.previewJobId === preview.id);
      if (existing) return ticket(existing);
      payload = {kind:'execute',previewJobId:preview.id,approval:args.approval};
      break;
    }
    default: throw Error('未知工具');
  }
  makeRoom(jobs, now);
  const job = {id:randomUUID(),...payload,status:'queued',createdAt:now};
  jobs.set(job.id,job);
  return ticket(job);
}
