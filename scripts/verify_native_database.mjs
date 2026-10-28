// Opt-in integration check. Creates only an explicitly labelled test notebook.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { SiYuanAVClient } from '../src/storage/avClient.ts';
import { ensureDatabases } from '../src/storage/bootstrap.ts';
import { AVRepository, encodeCell } from '../src/storage/avRepository.ts';
import { setupLute } from './native_test_runtime.mjs';

if (process.env.THINGS_AV_LIVE_TEST !== '1') throw new Error('Set THINGS_AV_LIVE_TEST=1 to create isolated test data.');
const base = process.env.THINGS_SIYUAN_URL || 'http://127.0.0.1:6806';
await setupLute(base);
const statePath = path.resolve('tmp/things-av-live-state.json');
let state = {};
try { state = JSON.parse(await fs.readFile(statePath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const storage = {
  async loadData(name) { return structuredClone(state[name]); },
  async saveData(name, value) {
    state[name] = structuredClone(value);
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, JSON.stringify(state, null, 2));
  },
};
const client = new SiYuanAVClient(async (endpoint, body) => {
  const response = await fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${endpoint}: HTTP ${response.status}`);
  const result = await response.json();
  if (result.code !== 0) throw new Error(`${endpoint}: ${result.msg || result.code}`);
  return result.data;
});
console.log('Verifying first installation and restart against the running kernel.');
const binding = await ensureDatabases(storage, client);
await client.request('/api/notebook/renameNotebook', { notebook: binding.notebookId, name: 'Things 自动建库验证（测试）' });
assert.deepEqual(await ensureDatabases(storage, client), binding);
console.log(JSON.stringify({ bootstrap: 'passed', tables: Object.keys(binding.tables).length, docId: binding.docId, notebookId: binding.notebookId }));

if (process.env.THINGS_AV_FIXTURE_TEST !== '1') process.exit(0);
const fixture = {
  tasks: [
    { id: 'fixture-task-parent', title: '虚构任务：数据库验证', notes: '', status: 'todo', priority: 'high', created: 1793156400123, updated: 1793156400123, startDate: 1793156400123, someday: false, order: 0, tags: ['fixture-tag'], projectId: 'fixture-project', areaId: 'fixture-area' },
    { id: 'fixture-task-child', title: '虚构子任务', notes: '', status: 'done', priority: 'none', created: 1793156400123, updated: 1793156400123, completedDate: 1793156400123, parentId: 'fixture-task-parent', order: -0.5, tags: [] },
  ],
  archived: [], trash: [],
  projects: [{ id: 'fixture-project', name: '虚构项目', notes: '', status: 'active', areaId: 'fixture-area', created: 1793156400123, updated: 1793156400123, order: 0, headings: [], groupOrder: ['none'], collapsedGroups: { active: false } }],
  areas: [{ id: 'fixture-area', name: '虚构区域', notes: '', created: 1793156400123, updated: 1793156400123, order: 0 }],
  tags: [{ id: 'fixture-tag', name: '虚构标签', color: '#123456', order: 0 }],
};
const repo = new AVRepository(client, binding);
if (process.env.THINGS_AV_RESUME_NOTES === '1') {
  // Explicit recovery of the known synthetic note-write scenario after an interrupted live run.
  const pending = structuredClone(fixture);
  pending.tasks[0].notes = '这是一段虚构的备注，用于验证原生文档往返。';
  await repo.recoverPending(fixture, pending);
  assert.deepEqual(await repo.load(), pending);
  await repo.saveSnapshot(fixture);
}
await repo.import(fixture);
assert.deepEqual(await repo.load(), fixture);
await repo.import(fixture);
assert.deepEqual(await repo.load(), fixture);
console.log(JSON.stringify({ importAndRetry: 'passed', tasks: 2, docId: binding.docId }));

if (process.env.THINGS_AV_ROUNDTRIP_TEST !== '1') process.exit(0);
// Only the explicit synthetic fixture above is edited. Never point this state file at a production binding.
const withNotes = structuredClone(fixture);
withNotes.tasks[0].notes = '这是一段虚构的备注，用于验证原生文档往返。';
await repo.saveSnapshot(withNotes);
assert.deepEqual(await repo.load(), withNotes);
const taskAV = await client.getAV(binding.tables.tasks.avId);
const keys = (taskAV.av || taskAV).keyValues;
const idCells = keys.find(kv => kv.key.id === binding.tables.tasks.keys.id).values;
const parentItemId = idCells.find(cell => cell.text?.content === 'fixture-task-parent').blockID;
const childItemId = idCells.find(cell => cell.text?.content === 'fixture-task-child').blockID;

// Simultaneous, disjoint edits retain both the native title and the plugin priority.
await client.setCells(binding.tables.tasks.avId, [{ itemID: parentItemId, keyID: binding.tables.tasks.keys.title,
  value: encodeCell('block', '虚构任务：原生表格修改') }]);
const localEdit = structuredClone(withNotes);
localEdit.tasks[0].priority = 'low';
await repo.saveSnapshot(localEdit);
const merged = structuredClone(localEdit);
merged.tasks[0].title = '虚构任务：原生表格修改';
assert.deepEqual(await repo.load(), merged);

const archived = structuredClone(merged);
archived.archived.push(archived.tasks.pop());
await repo.saveSnapshot(archived);
assert.deepEqual(await repo.load(), archived);
const afterArchive = await client.getAV(binding.tables.tasks.avId);
assert.equal((afterArchive.av || afterArchive).keyValues.find(kv => kv.key.id === binding.tables.tasks.keys.id)
  .values.find(cell => cell.text?.content === 'fixture-task-child').blockID, childItemId);

// Return only this test fixture to its original state so the verification is repeatable.
await repo.saveSnapshot(fixture);
assert.deepEqual(await repo.load(), fixture);
console.log(JSON.stringify({ notesNativeMergeAndArchive: 'passed', stableItemIdentity: true }));
