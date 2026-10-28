// Opt-in, synthetic-only integration check. It creates its own notebook and never reads a production binding.
// Run: THINGS_RICH_UPGRADE_LIVE_TEST=1 node --experimental-strip-types scripts/verify_rich_upgrade.mjs
// Reuse the same state file to resume an interrupted run. Created resources are deliberately kept for review/cleanup.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { SiYuanAVClient, newSiyuanId } from '../src/storage/avClient.ts';
import { AVRepository, canonical } from '../src/storage/avRepository.ts';
import { TABLE_NAMES, V1_TABLES } from '../src/storage/avSchema.ts';
import { ensureDatabases, verifyDatabaseBinding, STORAGE_BINDING_FILE, STORAGE_BOOTSTRAP_FILE } from '../src/storage/bootstrap.ts';
import { NOTES_BACKUP_FILE, NOTES_UPGRADE_FILE, upgradeNotesToRichText } from '../src/storage/notesUpgrade.ts';
import { auditLegacy } from '../src/storage/preflight.ts';
import { RichNotes } from '../src/storage/richNotes.ts';
import { setupLute } from './native_test_runtime.mjs';

if (process.env.THINGS_RICH_UPGRADE_LIVE_TEST !== '1') throw new Error('Set THINGS_RICH_UPGRADE_LIVE_TEST=1 to create isolated synthetic test data.');
const base = (process.env.THINGS_SIYUAN_URL || 'http://127.0.0.1:6806').replace(/\/$/, '');
const statePath = path.resolve(process.env.THINGS_RICH_UPGRADE_STATE || 'tmp/things-rich-upgrade-live.json');
const tempRoot = path.resolve('tmp');
assert.ok(statePath.startsWith(tempRoot + path.sep), 'The test state must be inside this workspace tmp directory.');
const kind = 'things-rich-upgrade-isolated-v1';
let state;
try { state = JSON.parse(await fs.readFile(statePath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; state = { kind, base, data: {}, createdAt: Date.now() }; }
assert.equal(state.kind, kind, 'Refuse a state file that was not created by this isolated test.');
assert.equal(state.base, base, 'Use a separate test state for each kernel.');

async function persistState() {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const pending = statePath + '.writing';
  await fs.writeFile(pending, JSON.stringify(state, null, 2));
  await fs.rename(pending, statePath);
}
const storage = {
  async loadData(name) { return structuredClone(state.data[name]); },
  async saveData(name, value) { state.data[name] = structuredClone(value); await persistState(); },
};

// Resume the supported V1 bootstrap intent rather than creating a V2 table and removing columns.
if (!state.data[STORAGE_BOOTSTRAP_FILE]) {
  assert.equal(Object.keys(state.data).length, 0, 'An incomplete test identity must not adopt an unrelated binding.');
  const token = newSiyuanId();
  const tables = Object.fromEntries(TABLE_NAMES.map(name => [name, {
    avId: newSiyuanId(), blockId: newSiyuanId(), docId: newSiyuanId(),
    keys: Object.fromEntries(V1_TABLES[name].columns.map(column => [column.field, newSiyuanId()])),
  }]));
  state.data[STORAGE_BOOTSTRAP_FILE] = { schemaVersion: 1, token, notebookName: `Things 初始化 ${token}`,
    notebookId: '', docId: newSiyuanId(), tables, phase: 'planned', readyTables: [], createdDocs: [] };
  await persistState();
}
const intent = state.data[STORAGE_BOOTSTRAP_FILE];
assert.equal(intent.schemaVersion, 1);
const testLabel = `Things 富文本升级验证（测试） ${intent.token}`;

// These image URLs are deliberately synthetic. This verifies the image reference and mAsset
// round-trip without uploading an asset or depending on an external image server.
const image = 'assets/things-rich-upgrade-synthetic.png';
const time = 1793156400123;
const fixture = {
  tasks: [
    { id: 'rich-parent', title: '合成父任务', notes: `# 任务备注\n\n**加粗**、*斜体*和 \`code\`。  \n第二行\n\n- [ ] 未完成步骤\n- [x] 已完成步骤\n\n[说明](https://example.com/task)\n\n![合成图片](${image} "任务图片")\n`,
      status: 'todo', priority: 'high', created: time, updated: time, startDate: time, someday: false,
      order: 0, tags: ['rich-tag'], projectId: 'rich-project', headingId: 'rich-heading' },
    { id: 'rich-child', title: '合成子任务', notes: '', status: 'done', priority: 'none', created: time,
      updated: time, completedDate: time, parentId: 'rich-parent', order: -0.5, tags: [] },
  ],
  archived: [{ id: 'rich-archived', title: '合成归档任务', notes: '', status: 'done', priority: 'low',
    created: time, updated: time, completedDate: time, order: 1, tags: [] }],
  projects: [{ id: 'rich-project', name: '合成项目', notes: `## 项目备注\n\n**项目目标**与[项目链接](https://example.com/project)。\n\n- [ ] 确认范围\n- [x] 准备样例\n\n![项目图片](${image})\n`,
    status: 'active', areaId: 'rich-area', created: time, updated: time, order: 0,
    headings: [{ id: 'rich-heading', title: '合成分组', order: 0, collapsed: false }],
    groupOrder: ['rich-heading', 'none'], collapsedGroups: { active: false } }],
  areas: [{ id: 'rich-area', name: '合成区域', notes: '区域的**富文本**备注。\n\n- 一\n- 二\n', created: time, updated: time, order: 0 }],
  tags: [{ id: 'rich-tag', name: '合成标签', color: '#123456', order: 0 }],
  trash: [{ id: 'rich-trash-batch', deletedAt: time, tasks: [{ id: 'rich-deleted', title: '合成回收站任务',
    notes: '回收站的**历史备注**。\n\n[历史链接](https://example.com/history)\n',
    status: 'canceled', priority: 'none', created: time, updated: time, order: 0, tags: [] }] }],
};
assert.equal(auditLegacy(fixture).errors.length, 0);
if (state.fixture) assert.equal(canonical(state.fixture), canonical(fixture), 'The fixture changed; use a new test state path.');
else { state.fixture = structuredClone(fixture); await persistState(); }

let noteDocumentCreates = 0;
let duringUpgrade = false;
const request = async (endpoint, body) => {
  if (duringUpgrade && endpoint === '/api/filetree/createDocWithMd') noteDocumentCreates++;
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.THINGS_SIYUAN_TOKEN) headers.Authorization = `Token ${process.env.THINGS_SIYUAN_TOKEN}`;
  const response = await fetch(base + endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${endpoint}: HTTP ${response.status}`);
  const result = await response.json();
  if (result.code !== 0) throw new Error(`${endpoint}: ${result.msg || result.code}`);
  return result.data;
};
const client = new SiYuanAVClient(request);
const sameSnapshot = async (repository, label) => assert.equal(canonical(await repository.load()), canonical(fixture), label);
const listDocuments = async binding => {
  await request('/api/sqlite/flushTransaction', {});
  assert.match(binding.notebookId, /^\d{14}-[a-z0-9]{7}$/);
  const rows = await request('/api/query/sql', { stmt: `SELECT id FROM blocks WHERE box='${binding.notebookId}' AND type='d' ORDER BY id LIMIT 1000`, mode: 'readonly' });
  assert.ok(Array.isArray(rows));
  return rows.map(row => row.id);
};
const readNoteIdentity = async binding => {
  const result = {};
  for (const name of ['tasks', 'projects', 'areas', 'trashItems']) {
    const table = binding.tables[name], av = await client.getAV(table.avId);
    const entries = new Map(av.keyValues.map(entry => [entry.key.id, entry]));
    result[name] = entries.get(table.keys.id).values.map(cell => {
      const doc = entries.get(table.keys.notesDocId).values.find(value => value.blockID === cell.blockID)?.text?.content || '';
      const link = entries.get(table.keys.notesLink).values.find(value => value.blockID === cell.blockID)?.url?.content || '';
      return { id: cell.text.content, itemId: cell.blockID, doc, link };
    }).sort((a, b) => a.id.localeCompare(b.id));
  }
  return result;
};
const summary = () => {
  const current = state.originalBinding || state.data[STORAGE_BINDING_FILE] || state.data[STORAGE_BOOTSTRAP_FILE];
  return { statePath, notebookId: current.notebookId, docId: current.docId,
    avIds: Object.fromEntries(TABLE_NAMES.map(name => [name, current.tables[name].avId])),
    documentIds: state.beforeDocuments || [], syntheticImage: image };
};

try {
  await setupLute(base);
  let original = state.originalBinding;
  if (!original) {
    original = await ensureDatabases(storage, client);
    assert.equal(original.schemaVersion, 1);
    state.originalBinding = structuredClone(original);
    await persistState();
  }
  const reserved = state.data[STORAGE_BOOTSTRAP_FILE];
  assert.equal(original.docId, reserved.docId);
  assert.equal(original.notebookId, reserved.notebookId);
  for (const name of TABLE_NAMES) assert.equal(original.tables[name].avId, reserved.tables[name].avId);
  await verifyDatabaseBinding(client, original);
  await request('/api/notebook/renameNotebook', { notebook: original.notebookId, name: testLabel });
  console.log(JSON.stringify({ stage: 'isolated-v1-ready', ...summary() }));

  const oldRepository = new AVRepository(client, original);
  if (!state.fixtureImported) {
    await oldRepository.import(fixture);
    await sameSnapshot(oldRepository, 'The V1 fixture must round-trip before upgrade.');
    state.fixtureImported = true;
    state.beforeDocuments = await listDocuments(original);
    state.beforeNoteIdentity = await readNoteIdentity(original);
    assert.equal(state.beforeDocuments.length, TABLE_NAMES.length + 1 + 4, 'V1 creates exactly four nonempty note documents.');
    await persistState();
  }
  await sameSnapshot(oldRepository, 'The old document-backed notes must remain identical.');
  assert.deepEqual(await listDocuments(original), state.beforeDocuments);
  duringUpgrade = true;
  const result = await upgradeNotesToRichText(storage, client, original, {
    onProgress: stage => console.log(JSON.stringify({ stage: `upgrade:${stage}` })),
  });
  assert.equal(result.binding.schemaVersion, 2);
  assert.equal(canonical(result.snapshot), canonical(fixture));
  assert.equal(canonical((await storage.loadData(NOTES_BACKUP_FILE)).snapshot), canonical(fixture));
  assert.equal((await storage.loadData(NOTES_UPGRADE_FILE)).phase, 'verified');
  await sameSnapshot(new AVRepository(client, result.binding), 'All business fields must survive V2 loading.');
  await sameSnapshot(oldRepository, 'Upgrade must not modify the old documents or V1 business data.');
  assert.deepEqual(await readNoteIdentity(result.binding), state.beforeNoteIdentity, 'Old document IDs and links must remain as backup.');

  // Inspect the native cells too: an exact-original formatting alias alone is not proof of migration.
  const rich = new RichNotes();
  let richCells = 0, imageCells = 0;
  for (const name of ['tasks', 'projects', 'areas', 'trashItems']) {
    const table = result.binding.tables[name], av = await client.getAV(table.avId);
    const entries = new Map(av.keyValues.map(entry => [entry.key.id, entry]));
    const expected = name === 'tasks' ? [...fixture.tasks, ...fixture.archived] : name === 'trashItems' ? fixture.trash.flatMap(batch => batch.tasks) : fixture[name];
    for (const identity of entries.get(table.keys.id).values) {
      const cell = field => entries.get(table.keys[field]).values.find(value => value.blockID === identity.blockID);
      const source = expected.find(record => record.id === (name === 'trashItems' ? cell('taskId').text.content : identity.text.content));
      assert.ok(source);
      const wanted = rich.prepare(source.notes);
      assert.ok(rich.same(cell('notes'), wanted.cell), `${name}: native rich cell must match the source semantics.`);
      assert.equal(canonical((cell('notesAssets')?.mAsset || []).map(({ type, content, name }) => ({ type, content, name: name || '' }))), canonical(wanted.assets.mAsset));
      if (source.notes) { assert.equal(cell('notes').text.rich.spec, 1); richCells++; }
      if (source.notes.includes('![')) { assert.equal(cell('notesAssets').mAsset.length, 1); imageCells++; }
    }
    for (const view of av.views.filter(view => view.type === 'table')) {
      for (const field of ['notesDocId', 'notesLink']) assert.equal(view.table.columns.find(column => column.id === table.keys[field]).hidden, true);
    }
  }
  assert.equal(richCells, 4);
  assert.equal(imageCells, 2);

  const keysBeforeRetry = await Promise.all(TABLE_NAMES.map(async name => (await client.getAV(result.binding.tables[name].avId)).keyValues.map(entry => entry.key.id)));
  const retried = await upgradeNotesToRichText(storage, client, original);
  assert.deepEqual(retried, result, 'Retrying the V1 upgrade must reuse the existing V2 identities and snapshot.');
  assert.deepEqual(await Promise.all(TABLE_NAMES.map(async name => (await client.getAV(result.binding.tables[name].avId)).keyValues.map(entry => entry.key.id))), keysBeforeRetry);
  assert.deepEqual(await listDocuments(result.binding), state.beforeDocuments, 'Upgrade and retry must not create note documents.');

  // Simulate a restart from the durable V2 binding, with a fresh client, store and repository.
  await storage.saveData(STORAGE_BINDING_FILE, result.binding);
  const disk = JSON.parse(await fs.readFile(statePath, 'utf8'));
  const reopenedStore = { async loadData(name) { return structuredClone(disk.data[name]); },
    async saveData() { throw new Error('Restart of an existing V2 binding must not reinitialize anything.'); } };
  const reopenedClient = new SiYuanAVClient(request);
  const reopenedBinding = await ensureDatabases(reopenedStore, reopenedClient);
  assert.deepEqual(reopenedBinding, result.binding);
  await sameSnapshot(new AVRepository(reopenedClient, reopenedBinding), 'V2 restart must preserve all business data and note formatting.');
  assert.deepEqual(await upgradeNotesToRichText(reopenedStore, reopenedClient, reopenedBinding), result);
  assert.equal(noteDocumentCreates, 0, 'No document-create endpoint may run during upgrade or restart.');
  assert.deepEqual(await listDocuments(reopenedBinding), state.beforeDocuments);
  state.result = { status: 'passed', richCells, imageCells, noNewNoteDocuments: true, oldLinksPreserved: true,
    idempotentRetry: true, restart: true, checkedAt: Date.now() };
  await persistState();
  console.log(JSON.stringify({ ...state.result, ...summary() }));
} catch (error) {
  state.lastError = { message: String(error?.message || error), at: Date.now() };
  await persistState();
  console.error(JSON.stringify({ status: 'failed', ...state.lastError, ...summary() }));
  throw error;
}
