// Slice the serialized value so callers can reconstruct arbitrary JSON without losing fields.
export function resultView(job, args) {
  const {command, approval, bridgeId, ...publicJob} = job;
  const {path, offset, limit} = args;
  if (job.status !== 'completed') return publicJob;
  if (path === undefined && offset === undefined && limit === undefined) {
    const step = job.result?.steps?.[0];
    if (!job.overview || step?.status !== 'success' || !step.data) return publicJob;
    const {target, tabId, complete, warnings, permissions, status, plan} = step.data;
    return {...publicJob, result:{status:job.result.status, target, tabId, complete, warnings,
      permissions, reviewStatus:status?.review?.status, title:plan?.current?.title,
      nodes:plan?.current?.nodes?.length, edges:plan?.current?.edges?.length,
      fields:Object.keys(step.data), detailPath:['steps','0','data']}};
  }
  if (path !== undefined && (!Array.isArray(path) || !path.every(key => typeof key === 'string')))
    throw Error('path 必须是相对 result 的字段名数组。');
  let value = job.result;
  for (const key of path || []) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key))
      throw Error('回执字段不存在。');
    value = value[key];
  }
  const serialized = JSON.stringify(value);
  const start = offset ?? 0;
  const length = limit ?? 8000;
  if (!Number.isSafeInteger(start) || start < 0 || start > serialized.length ||
      !Number.isSafeInteger(length) || length < 1 || length > 16000)
    throw Error('分页范围无效，limit 须在 1 至 16000 之间。');
  const end = Math.min(serialized.length, start + length);
  return {id:job.id, status:job.status, path:path || [], offset:start, total:serialized.length,
    nextOffset:end < serialized.length ? end : null, jsonText:serialized.slice(start,end)};
}

export function makeRoom(jobs, now) {
  if (jobs.size < 1000) return;
  // Never evict an execution receipt or a live preview on behalf of a new job.
  for (const [id, job] of jobs) {
    if (job.status === 'completed' && ['status','read','login'].includes(job.kind) &&
        now - job.createdAt > 300000) {
      jobs.delete(id);
      return;
    }
  }
  throw Error('任务缓存已满，请先核对已有请求。');
}
