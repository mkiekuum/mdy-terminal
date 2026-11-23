import {fail} from './core.js';

// cloud.js writes a five-digit display ID (or the stable ID) with history.replaceState.
export async function pagePlanTarget(page, listPlans) {
  const value = page?.planUrlValue;
  if (!value) return page?.activeTarget;
  if (/^[a-f\d-]{36}$/i.test(value)) return {id:value};
  if (!/^\d{5}$/.test(value)) fail('TARGET_NOT_FOUND', '网页计划链接无效');
  const matches = (await listPlans()).filter(plan => plan.displayId === value);
  if (matches.length !== 1) fail(matches.length ? 'TARGET_AMBIGUOUS' : 'TARGET_NOT_FOUND',
    '当前账号可见的计划中无法唯一匹配网页显示 ID');
  return {id:matches[0].id};
}
