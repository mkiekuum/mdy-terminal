import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiAdapter} from '../extension/api.js';
import {site,envelope} from './v25-helpers.js';

test('priority is previewed, persisted, preserved on replacement and explicitly clearable', async () => {
  const web = site();
  const api = new ApiAdapter(web.request);
  const run = (step, mode = 'execute') => api.run(step, envelope([step], {mode}));
  const params = {number:'TEST', title:'Synthetic priority', priority:'P2', nodes:[{id:'1',name:'Start'}], edges:[]};
  const created = await run({id:'create',op:'plan.create',params});
  const id = created.targetId;
  const target = () => ({id,version:web.records.get(id).revision});
  const update = priority => ({id:'update',op:'plan.update',target:target(),params:{set:{priority}}});
  const preview = await run(update('P1'),'preview');
  assert.deepEqual(preview.data.changes.changedFields,['priority']);
  assert.equal(web.records.get(id).current.priority,'P2');
  assert.equal((await run(update('P1'))).data.current.priority,'P1');
  const replacement = {replace:true,title:'Changed',nodes:params.nodes,edges:[]};
  assert.equal((await run({id:'replace',op:'plan.replace',target:target(),params:replacement})).data.current.priority,'P1');
  await assert.rejects(run(update('P4')));
  assert.equal((await run(update(''))).data.current.priority,'');
});
