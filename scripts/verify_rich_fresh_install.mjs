// Opt-in full coordinator integration test. All state and business data are synthetic and isolated.
// Run: THINGS_RICH_FRESH_LIVE_TEST=1 node --experimental-strip-types scripts/verify_rich_fresh_install.mjs
// Temporary resources are retained and printed for explicit cleanup; rerunning reuses the same state.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { StorageCoordinator, SOURCE_FILE, WRITE_INTENT_FILE } from '../src/storage/coordinator.ts';
import { STORAGE_BINDING_FILE, STORAGE_BOOTSTRAP_FILE } from '../src/storage/bootstrap.ts';
import { SiYuanAVClient } from '../src/storage/avClient.ts';
import { AVRepository, canonical } from '../src/storage/avRepository.ts';
import { TABLE_NAMES } from '../src/storage/avSchema.ts';
import { LEGACY_FILES } from '../src/storage/preflight.ts';
import { NATIVE_TASK_VIEWS_FILE, NATIVE_TASK_VIEW_NAMES } from '../src/storage/nativeViews.ts';
import { RichNotes } from '../src/storage/richNotes.ts';
import { setupLute } from './native_test_runtime.mjs';

if (process.env.THINGS_RICH_FRESH_LIVE_TEST !== '1') throw new Error('Set THINGS_RICH_FRESH_LIVE_TEST=1 to create an isolated fresh-install test.');
const base = (process.env.THINGS_SIYUAN_URL || 'http://127.0.0.1:6806').replace(/\/$/, '');
const statePath = path.resolve(process.env.THINGS_RICH_FRESH_STATE || 'tmp/things-rich-fresh-live.json');
assert.ok(statePath.startsWith(path.resolve('tmp') + path.sep), 'Test state must be inside this workspace tmp directory.');
const kind = 'things-rich-fresh-install-isolated-v1';
let state;
try { state = JSON.parse(await fs.readFile(statePath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; state = { kind, base, data: {}, createdAt: Date.now() }; }
assert.equal(state.kind, kind, 'Refuse to adopt a state file belonging to another test or production.');
assert.equal(state.base, base);
async function persistState() {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath + '.writing', JSON.stringify(state, null, 2));
  await fs.rename(statePath + '.writing', statePath);
}
const makeStorage = () => ({
  async loadData(name) { return structuredClone(state.data[name]); },
  async saveData(name, value) { state.data[name] = structuredClone(value); await persistState(); },
});
const time = 1793156400123;
const image = 'assets/things-rich-fresh-synthetic.png';
const fixture = { tasks: [{ id: 'fresh-rich-task', title: '全新安装合成任务', status: 'todo', priority: 'high',
  notes: `## 数据库内的备注\n\n**加粗**与*斜体*。\n\n- [ ] 第一步\n- [x] 第二步\n\n[合成链接](https://example.com/fresh)\n\n![合成图片](${image} "图片引用验证")\n`,
  created: time, updated: time, order: 0, tags: [], someday: false }],
  archived: [], projects: [], areas: [], tags: [], trash: [] };
if (state.fixture) assert.equal(canonical(state.fixture), canonical(fixture), 'Use a new state file after changing the fixture.');
else { state.fixture = structuredClone(fixture); await persistState(); }

const calls = {};
const request = async (endpoint, body) => {
  calls[endpoint] = (calls[endpoint] || 0) + 1;
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.THINGS_SIYUAN_TOKEN) headers.Authorization = `Token ${process.env.THINGS_SIYUAN_TOKEN}`;
  const response = await fetch(base + endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${endpoint}: HTTP ${response.status}`);
  const result = await response.json();
  if (result.code !== 0) throw new Error(`${endpoint}: ${result.msg || result.code}`);
  return result.data;
};
const client = new SiYuanAVClient(request);
const documents = async binding => {
  assert.match(binding.notebookId, /^\d{14}-[a-z0-9]{7}$/);
  await request('/api/sqlite/flushTransaction', {});
  const rows = await request('/api/query/sql', { stmt: `SELECT id FROM blocks WHERE box='${binding.notebookId}' AND type='d' ORDER BY id LIMIT 1000`, mode: 'readonly' });
  return rows.map(row => row.id);
};
const readSnapshot = async coordinator => Object.fromEntries(await Promise.all(Object.entries(LEGACY_FILES).map(async ([name, file]) => [name, await coordinator.facade.loadData(file)])));
async function assertViews(binding) {
  const av = await client.getAV(binding.tables.tasks.avId);
  const saved = state.data[NATIVE_TASK_VIEWS_FILE]?.databases?.[av.id];
  assert.equal(saved?.complete, true);
  assert.equal(saved.ready.length, NATIVE_TASK_VIEW_NAMES.length);
  assert.equal(av.views.length, NATIVE_TASK_VIEW_NAMES.length + 1, 'Keep the original view plus exactly six named business views.');
  for (const name of NATIVE_TASK_VIEW_NAMES) {
    const view = av.views.find(item => item.id === saved.views[name]);
    assert.ok(view, `Missing native view: ${name}`);
    assert.equal(view.type, 'table');
    assert.ok(view.filters?.length, `The ${name} view must have its native filters.`);
  }
  assert.ok(av.views.some(view => view.id === saved.originalViewId));
  const attrs = await request('/api/attr/getBlockAttrs', { id: binding.tables.tasks.blockId });
  assert.equal(attrs['custom-sy-av-view'], saved.originalViewId, 'Setup must restore the original selected view.');
  return { originalViewId: saved.originalViewId, ...saved.views };
}
const summary = () => {
  const binding = state.data[SOURCE_FILE]?.binding || state.data[STORAGE_BINDING_FILE] || state.data[STORAGE_BOOTSTRAP_FILE];
  return { statePath, notebookId: binding?.notebookId, docId: binding?.docId,
    avIds: binding && Object.fromEntries(TABLE_NAMES.map(name => [name, binding.tables[name].avId])),
    viewIds: state.viewIds, documentIds: state.documentIds || [], syntheticImage: image };
};

try {
  await setupLute(base);
  // No ensure/repository/view overrides: exercise the actual default new-install path.
  const coordinator = new StorageCoordinator(makeStorage(), client);
  await coordinator.start();
  assert.equal(coordinator.mode, 'database');
  assert.equal(coordinator.notesInDatabase, true);
  const binding = state.data[SOURCE_FILE].binding;
  assert.equal(binding.schemaVersion, 2);
  assert.deepEqual(state.data[STORAGE_BINDING_FILE], binding);
  assert.equal(Object.keys(binding.tables).length, 7);
  const bootstrap = state.data[STORAGE_BOOTSTRAP_FILE];
  assert.equal(bootstrap.phase, 'complete');
  assert.equal(bootstrap.schemaVersion, 2);
  assert.equal(binding.docId, bootstrap.docId);
  assert.equal(binding.notebookId, bootstrap.notebookId);
  await request('/api/notebook/renameNotebook', { notebook: binding.notebookId, name: `Things 全新安装富文本验证（测试） ${bootstrap.token}` });
  const originalDocuments = await documents(binding);
  assert.equal(originalDocuments.length, TABLE_NAMES.length + 1, 'A fresh install creates only the center and seven table documents.');
  state.documentIds = originalDocuments;
  state.viewIds = await assertViews(binding);
  await persistState();
  console.log(JSON.stringify({ stage: 'automatic-v2-install-passed', ...summary() }));

  const createdBeforeWrite = calls['/api/filetree/createDocWithMd'] || 0;
  const existing = await readSnapshot(coordinator);
  if (!existing.tasks.length) {
    assert.ok(Object.values(existing).every(rows => rows.length === 0), 'Only a new empty synthetic database is eligible for fixture creation.');
    await coordinator.facade.saveData(LEGACY_FILES.tasks, fixture.tasks);
  }
  assert.equal(canonical(await readSnapshot(coordinator)), canonical(fixture));
  assert.equal(canonical(await new AVRepository(client, binding).load()), canonical(fixture));
  assert.equal(state.data[WRITE_INTENT_FILE], null, 'The coordinator must acknowledge and clear its write journal.');
  const av = await client.getAV(binding.tables.tasks.avId), keys = binding.tables.tasks.keys;
  const cell = field => av.keyValues.find(entry => entry.key.id === keys[field]).values[0];
  assert.equal(cell('id').text.content, fixture.tasks[0].id);
  assert.equal(cell('notes').text.rich.spec, 1);
  const rich = new RichNotes(), plan = rich.prepare(fixture.tasks[0].notes);
  assert.ok(rich.same(cell('notes'), plan.cell));
  assert.equal(cell('notesAssets').mAsset.length, 1);
  assert.equal(cell('notesAssets').mAsset[0].content, image);
  assert.ok(!cell('notesDocId')?.text?.content, 'V2 must not assign a separate note document.');
  assert.ok(!cell('notesLink')?.url?.content, 'V2 must not link to a separate note document.');
  assert.deepEqual(await documents(binding), originalDocuments);
  assert.equal(calls['/api/filetree/createDocWithMd'] || 0, createdBeforeWrite);

  // Reload durable state into a new coordinator/store/client, retaining the default production path.
  const beforeRestart = structuredClone(calls);
  state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  const restarted = new StorageCoordinator(makeStorage(), new SiYuanAVClient(request));
  await restarted.start();
  await restarted.refresh();
  assert.equal(restarted.notesInDatabase, true);
  assert.equal(canonical(await readSnapshot(restarted)), canonical(fixture));
  assert.deepEqual(state.data[SOURCE_FILE].binding, binding);
  assert.deepEqual(await assertViews(binding), state.viewIds);
  assert.deepEqual(await documents(binding), originalDocuments);
  for (const endpoint of ['/api/notebook/createNotebook', '/api/filetree/createDocWithMd', '/api/av/addAttributeViewKey',
    '/api/av/addAttributeViewBlocks', '/api/transactions', '/api/av/batchSetAttributeViewBlockAttrs']) {
    assert.equal(calls[endpoint] || 0, beforeRestart[endpoint] || 0, `Restart must not repeat provisioning or note writes: ${endpoint}`);
  }
  state.result = { status: 'passed', schemaVersion: 2, tables: 7, businessViews: 6, totalTaskViews: 7,
    standaloneNoteDocuments: 0, exactRichText: true, imageReferences: 1, stableRestart: true, checkedAt: Date.now() };
  await persistState();
  console.log(JSON.stringify({ ...state.result, ...summary() }));
} catch (error) {
  state.lastError = { message: String(error?.message || error), at: Date.now() };
  await persistState();
  console.error(JSON.stringify({ status: 'failed', ...state.lastError, ...summary() }));
  throw error;
}
