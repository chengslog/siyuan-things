import test from 'node:test';
import assert from 'node:assert/strict';
import { SiYuanAVClient } from '../src/storage/avClient.ts';

function fixture() {
  const rows = new Map<string, any>();
  const calls: Array<{ path: string; body: any }> = [];
  let loseResponse = false, omitLast = false;
  const client = new SiYuanAVClient(async (path, body: any) => {
    calls.push({ path, body });
    if (path === '/api/av/getAttributeView') return { av: { id: 'tasks', keyValues: [{ key: { type: 'block' }, values: [...rows.values()] }] } };
    assert.equal(path, '/api/av/addAttributeViewBlocks');
    const sources = omitLast ? body.srcs.slice(0, -1) : body.srcs;
    for (const source of sources) rows.set(source.itemID, { blockID: source.itemID, isDetached: true, block: { content: source.content } });
    if (loseResponse) throw new Error('response lost');
    return null;
  });
  return { client, calls, rows, lose: () => { loseResponse = true; }, omit: () => { omitLast = true; } };
}

test('inserting a task and checklist uses two reads and one batch request', async () => {
  const f = fixture();
  const group = Array.from({ length: 5 }, (_, id) => ({ id: `item-${id}`, title: `Task ${id}` }));
  await f.client.addRows('tasks', group);
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[1].body.srcs.length, group.length);
  assert.equal(f.rows.size, group.length);
});

test('large insertion batches are bounded and verify every requested identity', async () => {
  const f = fixture();
  await f.client.addRows('tasks', Array.from({ length: 205 }, (_, id) => ({ id: `item-${id}`, title: `${id}` })));
  assert.deepEqual(f.calls.filter(call => call.path === '/api/av/addAttributeViewBlocks').map(call => call.body.srcs.length), [100, 100, 5]);
  const broken = fixture(); broken.omit();
  await assert.rejects(broken.client.addRows('tasks', [{ id: 'one', title: 'One' }, { id: 'two', title: 'Two' }]), /校验失败/);
});

test('a committed batch with a lost response can be retried without duplicating rows', async () => {
  const f = fixture(); f.lose();
  const group = [{ id: 'one', title: 'One' }, { id: 'two', title: 'Two' }];
  await assert.rejects(f.client.addRows('tasks', group), /response lost/);
  await f.client.addRows('tasks', group);
  assert.equal(f.rows.size, 2);
  assert.equal(f.calls.filter(call => call.path === '/api/av/addAttributeViewBlocks').length, 1);
});

test('duplicate requests and bound-row identity collisions are rejected before writes', async () => {
  const f = fixture();
  await assert.rejects(f.client.addRows('tasks', [{ id: 'one', title: 'A' }, { id: 'one', title: 'B' }]), /Duplicate/);
  assert.equal(f.calls.length, 0);
  f.rows.set('one', { blockID: 'one', isDetached: false });
  await assert.rejects(f.client.addRows('tasks', [{ id: 'one', title: 'One' }]), /占用/);
  assert.equal(f.calls.filter(call => call.path === '/api/av/addAttributeViewBlocks').length, 0);
});
