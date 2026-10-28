import test from 'node:test';
import assert from 'node:assert/strict';
import { StorageCoordinator, SOURCE_FILE, OBSERVATION_FILE, stableJSON } from '../src/storage/coordinator.ts';
import { STORAGE_BINDING_FILE, type Binding } from '../src/storage/bootstrap.ts';
import { NOTES_UPGRADE_FILE } from '../src/storage/notesUpgrade.ts';
import { SiYuanAVClient } from '../src/storage/avClient.ts';
import { seedTaskObservation } from '../src/storage/nativeTransitions.ts';
import type { LegacySnapshot } from '../src/storage/preflight.ts';

const copy = <T>(x: T): T => x === undefined ? x : structuredClone(x);
function fixture() {
  const oldBinding = { schemaVersion: 1, notebookId: 'notebook', docId: 'center', tables: {} } as Binding;
  const nextBinding = { ...oldBinding, schemaVersion: 2 } as Binding;
  const snapshot: LegacySnapshot = { tasks: [{ id: 'one', title: 'One', notes: 'Note', status: 'todo', priority: 'none', created: 1, updated: 1, tags: [], order: 0 }],
    archived: [], projects: [], areas: [], tags: [], trash: [] };
  const observation = seedTaskObservation(snapshot, oldBinding.docId);
  const files = new Map<string, any>([[SOURCE_FILE, { schemaVersion: 1, mode: 'database', binding: oldBinding }],
    [STORAGE_BINDING_FILE, oldBinding], [OBSERVATION_FILE, observation]]);
  const hooks = { write: undefined as undefined | ((name: string, value: any) => void),
    upgrade: undefined as undefined | (() => Promise<void>), views: undefined as undefined | (() => Promise<void>) };
  let upgrades = 0, views = 0, writes = 0;
  const host = { async loadData(name: string) { return copy(files.get(name)); }, async saveData(name: string, value: any) {
    hooks.write?.(name, value); files.set(name, copy(value));
  } };
  const client = new SiYuanAVClient(async endpoint => { assert.equal(endpoint, '/api/system/version'); return '3.8.8'; });
  const create = () => new StorageCoordinator(host, client, {
    verify: async () => {}, now: () => 100,
    repository: () => ({ load: async () => copy(snapshot), import: async () => {}, preflightSnapshot: async () => {},
      saveSnapshot: async () => { writes++; }, recoverPending: async () => {} }),
    upgradeNotes: async () => { upgrades++; await hooks.upgrade?.(); return { binding: copy(nextBinding), snapshot: copy(snapshot) }; },
    ensureViews: async () => { views++; await hooks.views?.(); },
  });
  return { oldBinding, nextBinding, snapshot, observation, files, hooks, create,
    calls: () => ({ upgrades, views, writes }) };
}

test('note upgrade changes the source and provision binding without replaying recurrence history', async () => {
  const f = fixture(), c = f.create();
  await c.start();
  await c.upgradeNotes();
  assert.equal(c.notesInDatabase, true);
  assert.deepEqual(f.files.get(SOURCE_FILE).binding, f.nextBinding);
  assert.deepEqual(f.files.get(STORAGE_BINDING_FILE), f.nextBinding);
  assert.deepEqual(f.files.get(OBSERVATION_FILE), f.observation);
  assert.deepEqual(await c.read('tasks.json'), f.snapshot.tasks);
  assert.deepEqual(f.calls(), { upgrades: 1, views: 1, writes: 0 });
  await c.upgradeNotes();
  assert.equal(f.calls().upgrades, 1);
});

test('a lost source response is accepted only after matching readback', async () => {
  const f = fixture(), c = f.create(); await c.start();
  f.hooks.write = (name, value) => {
    if (name === SOURCE_FILE) { f.files.set(name, copy(value)); throw new Error('lost response'); }
  };
  await c.upgradeNotes();
  assert.equal(c.notesInDatabase, true);
});

test('an unknown source switch blocks further writes until reload', async () => {
  const f = fixture(), c = f.create(); await c.start();
  f.hooks.write = name => { if (name === SOURCE_FILE) throw new Error('not committed'); };
  await assert.rejects(c.upgradeNotes(), /切换结果无法确认/);
  await assert.rejects(c.write('tasks.json', f.snapshot.tasks), /切换结果无法确认/);
  assert.equal(f.calls().writes, 0);
});

test('restart repairs the secondary binding after the authoritative source committed', async () => {
  const f = fixture(), c = f.create(); await c.start();
  f.hooks.write = name => { if (name === STORAGE_BINDING_FILE) throw new Error('binding unavailable'); };
  await assert.rejects(c.upgradeNotes(), /绑定保存结果/);
  assert.equal(f.files.get(SOURCE_FILE).binding.schemaVersion, 2);
  f.hooks.write = undefined;
  const restarted = f.create(); await restarted.start();
  assert.equal(restarted.notesInDatabase, true);
  assert.deepEqual(f.files.get(STORAGE_BINDING_FILE), f.nextBinding);
  assert.deepEqual(f.files.get(OBSERVATION_FILE), f.observation);
});

test('an old window cannot write after another window switches the note source', async () => {
  const f = fixture(), oldWindow = f.create(); await oldWindow.start();
  f.files.set(SOURCE_FILE, { schemaVersion: 1, mode: 'database', binding: f.nextBinding });
  await assert.rejects(oldWindow.write('tasks.json', f.snapshot.tasks), /其他窗口升级或改变/);
  assert.equal(f.calls().writes, 0);
});

test('interrupted note copying keeps the old source and blocks edits that would invalidate the upgrade baseline', async () => {
  const f = fixture(), c = f.create(); await c.start();
  f.hooks.upgrade = async () => { f.files.set(NOTES_UPGRADE_FILE, { phase: 'columns' }); throw new Error('copy interrupted'); };
  await assert.rejects(c.upgradeNotes(), /copy interrupted/);
  assert.equal(f.files.get(SOURCE_FILE).binding.schemaVersion, 1);
  await assert.rejects(c.write('tasks.json', f.snapshot.tasks), /升级尚未完成/);
  assert.equal(f.calls().writes, 0);
  assert.equal(stableJSON(f.files.get(OBSERVATION_FILE)), stableJSON(f.observation));
});

test('a writer waiting for the shared lock rechecks an upgrade started by another window', async () => {
  const f = fixture(), c = f.create(); await c.start();
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    async request(_name: string, run: () => Promise<unknown>) {
      f.files.set(NOTES_UPGRADE_FILE, { phase: 'columns' });
      return run();
    },
  } });
  try {
    await assert.rejects(c.write('tasks.json', f.snapshot.tasks), /升级尚未完成/);
    assert.equal(f.calls().writes, 0);
  } finally {
    if (descriptor) Object.defineProperty(navigator, 'locks', descriptor);
    else delete (navigator as any).locks;
  }
});

test('a view setup failure can be retried after the source has already switched', async () => {
  const f = fixture(), c = f.create(); await c.start();
  f.hooks.views = async () => { throw new Error('view response lost'); };
  await assert.rejects(c.upgradeNotes(), /view response lost/);
  assert.equal(c.notesInDatabase, true);
  assert.equal(f.files.get(SOURCE_FILE).binding.schemaVersion, 2);
  f.hooks.views = undefined;
  await c.upgradeNotes();
  assert.deepEqual(f.calls(), { upgrades: 1, views: 2, writes: 0 });
  assert.deepEqual(f.files.get(OBSERVATION_FILE), f.observation);
});
