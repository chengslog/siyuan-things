// Uses only the known synthetic AV fixture created by verify_native_database.mjs.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { SiYuanAVClient } from '../src/storage/avClient.ts';
import { StorageCoordinator, SOURCE_FILE } from '../src/storage/coordinator.ts';
import { encodeCell } from '../src/storage/avRepository.ts';
import { occurrenceId } from '../src/storage/nativeTransitions.ts';
import { nextRepeatTimestamp } from '../src/utils/recurrence.ts';
import { setupLute } from './native_test_runtime.mjs';

if (process.env.THINGS_AV_LIVE_TEST !== '1') throw new Error('Set THINGS_AV_LIVE_TEST=1 for this synthetic test.');
const url = process.env.THINGS_SIYUAN_URL || 'http://127.0.0.1:6806';
await setupLute(url);
const bindingState = JSON.parse(await fs.readFile('tmp/things-av-live-state.json', 'utf8'));
const binding = bindingState['things-database-binding.json'];
assert.ok(binding?.docId);
const statePath = 'tmp/things-native-transition-state.json';
let data = {};
try { data = JSON.parse(await fs.readFile(statePath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (data[SOURCE_FILE]) assert.deepEqual(data[SOURCE_FILE].binding, binding);
else data[SOURCE_FILE] = { schemaVersion: 1, mode: 'database', binding };
const store = {
  async loadData(name) { return structuredClone(data[name]); },
  async saveData(name, value) { data[name] = structuredClone(value); await fs.writeFile(statePath, JSON.stringify(data, null, 2)); },
};
const client = new SiYuanAVClient(async (endpoint, body) => {
  const response = await fetch(url + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.ok(response.ok, endpoint);
  const result = await response.json();
  assert.equal(result.code, 0, endpoint + ': ' + result.msg);
  return result.data;
});
const notebooks = await client.request('/api/notebook/lsNotebooks', {});
assert.equal(notebooks.notebooks.find(item => item.id === binding.notebookId)?.name, 'Things 自动建库验证（测试）');
const now = 1793156400123;
const coordinator = new StorageCoordinator(store, client, { now: () => now });
await coordinator.start();
const original = await coordinator.facade.loadData('tasks.json');
const prefix = `transition-test-${Date.now()}`;
const ids = [prefix, prefix + '-child', prefix + '-grandchild'];
const task = (id, parentId) => ({ id, title: '虚构重复任务验证', notes: '', status: 'todo', priority: 'none', created: now,
  updated: now, tags: [], order: 100, ...(parentId ? { parentId } : { repeatRule: 'daily', startDate: now }) });
await coordinator.facade.saveData('tasks.json', [...original, task(ids[0]), task(ids[1], ids[0]), task(ids[2], ids[1])]);
const av = await client.getAV(binding.tables.tasks.avId);
const itemId = av.keyValues.find(kv => kv.key.id === binding.tables.tasks.keys.id).values.find(cell => cell.text?.content === ids[0]).blockID;
await client.setCells(binding.tables.tasks.avId, [{ itemID: itemId, keyID: binding.tables.tasks.keys.status, value: encodeCell('select', 'done') }]);
await coordinator.refresh();
const after = await coordinator.facade.loadData('tasks.json');
const next = await occurrenceId(binding.docId, ids[0]);
const nextChild = await occurrenceId(binding.docId, ids[0], ids[1]);
const nextGrandchild = await occurrenceId(binding.docId, ids[0], ids[2]);
assert.equal(after.find(item => item.id === ids[0]).completedDate, now);
assert.equal(after.find(item => item.id === ids[0]).recurrenceGeneratedAt, now);
assert.equal(after.find(item => item.id === next).startDate, nextRepeatTimestamp(now, 'daily'));
assert.equal(after.find(item => item.id === nextChild).parentId, next);
assert.equal(after.find(item => item.id === nextGrandchild).parentId, nextChild);
assert.equal(after.length, original.length + 6);
const restarted = new StorageCoordinator(store, client, { now: () => now + 1 });
await restarted.start();
await restarted.refresh();
assert.deepEqual(await restarted.facade.loadData('tasks.json'), after);
await client.setCells(binding.tables.tasks.avId, [{ itemID: itemId, keyID: binding.tables.tasks.keys.status, value: encodeCell('select', 'todo') }]);
await restarted.refresh();
await client.setCells(binding.tables.tasks.avId, [{ itemID: itemId, keyID: binding.tables.tasks.keys.status, value: encodeCell('select', 'done') }]);
await restarted.refresh();
const repeated = await restarted.facade.loadData('tasks.json');
assert.equal(repeated.length, after.length);
const synthetic = new Set([...ids, next, nextChild, nextGrandchild]);
await restarted.facade.saveData('tasks.json', repeated.filter(item => !synthetic.has(item.id)));
assert.deepEqual(await restarted.facade.loadData('tasks.json'), original);
console.log(JSON.stringify({ nativeCompletion: 'passed', depth: 3, restartNoDuplicates: true, recompletionNoDuplicates: true, syntheticRowsRemoved: 6 }));
