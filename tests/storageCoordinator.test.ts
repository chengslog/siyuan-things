import test from 'node:test';
import assert from 'node:assert/strict';
import { StorageCoordinator, SOURCE_FILE, BACKUP_FILE, WRITE_INTENT_FILE, OBSERVATION_FILE, stableJSON } from '../src/storage/coordinator.ts';
import { SiYuanAVClient } from '../src/storage/avClient.ts';
import { LEGACY_FILES, type LegacySnapshot } from '../src/storage/preflight.ts';
import { saveFiles, usesNativeStorage } from '../src/storage/bridge.ts';
import type { Binding } from '../src/storage/bootstrap.ts';
import { AVRepository, encodeCell } from '../src/storage/avRepository.ts';
import { TABLE_NAMES, TABLES } from '../src/storage/avSchema.ts';
import { NativeNotesUnsupportedError } from '../src/storage/nativeNotes.ts';

const empty = (): LegacySnapshot => ({ tasks: [], archived: [], trash: [], projects: [], areas: [], tags: [] });
const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));
const task = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: 'Test task', notes: '', status: 'todo', priority: 'none', created: 10, updated: 20,
  tags: [], order: 0, ...extra,
});
const binding: Binding = { schemaVersion: 1, notebookId: 'test-notebook', docId: 'test-data-center', tables: {} as Binding['tables'] };

function fixture(source?: LegacySnapshot) {
  const files = new Map<string, any>();
  if (source) for (const [key, filename] of Object.entries(LEGACY_FILES)) files.set(filename, clone(source[key as keyof LegacySnapshot]));
  const calls = { ensure: 0, verify: 0, repository: 0, load: 0, imported: [] as LegacySnapshot[], snapshots: [] as LegacySnapshot[], bases: [] as LegacySnapshot[], recoveries: [] as Array<{base: LegacySnapshot; desired: LegacySnapshot}>,
    writes: [] as Array<{ name: string; value: any }>, requests: [] as string[] };
  const hooks = {
    ensure: undefined as undefined | (() => Promise<void>),
    load: undefined as undefined | (() => Promise<LegacySnapshot | undefined>),
    import: undefined as undefined | ((snapshot: LegacySnapshot) => Promise<void>),
    save: undefined as undefined | ((snapshot: LegacySnapshot) => Promise<void>),
    preflight: undefined as undefined | ((snapshot: LegacySnapshot, base: LegacySnapshot) => Promise<void>),
    verify: undefined as undefined | (() => Promise<void>),
    recover: undefined as undefined | ((base: LegacySnapshot, desired: LegacySnapshot) => Promise<void>),
    write: undefined as undefined | ((name: string, value: any) => Promise<void>),
  };
  let database = empty();
  let clock = 1793156400123;
  let version = '3.8.8';
  let legacyCache: Record<string, unknown[]> = {};
  const host = {
    async loadData(name: string) { return clone(files.get(name)); },
    async saveData(name: string, value: any) {
      await hooks.write?.(name, value);
      calls.writes.push({ name, value: clone(value) });
      files.set(name, clone(value));
    },
  };
  const client = new SiYuanAVClient(async (path) => {
    calls.requests.push(path);
    assert.equal(path, '/api/system/version');
    return version;
  });
  const repository = {
    async load() { calls.load++; return clone(await hooks.load?.() || database); },
    async import(snapshot: LegacySnapshot) {
      calls.imported.push(clone(snapshot));
      await hooks.import?.(snapshot);
      database = clone(snapshot);
    },
    async preflightSnapshot(snapshot: LegacySnapshot, base: LegacySnapshot) { await hooks.preflight?.(snapshot, base); },
    async saveSnapshot(snapshot: LegacySnapshot, base: LegacySnapshot) {
      calls.snapshots.push(clone(snapshot));
      calls.bases.push(clone(base));
      await hooks.save?.(snapshot);
      database = clone(snapshot);
    },
    async recoverPending(base: LegacySnapshot, desired: LegacySnapshot) {
      calls.recoveries.push(clone({ base, desired }));
      await hooks.recover?.(base, desired);
      database = clone(desired);
    },
  };
  const create = () => new StorageCoordinator(host, client, {
    now: () => clock,
    async inspectLegacyCache() { return clone(legacyCache); },
    async ensure() { calls.ensure++; await hooks.ensure?.(); return clone(binding); },
    async verify() { calls.verify++; await hooks.verify?.(); },
    repository(value) {
      calls.repository++;
      assert.deepEqual(value, binding);
      return repository;
    },
  });
  return {
    files, calls, hooks, host, create,
    setDatabase(value: LegacySnapshot) { database = clone(value); },
    setClock(value: number) { clock = value; },
    setVersion(value: string) { version = value; },
    setCache(value: Record<string, unknown[]>) { legacyCache = value; },
  };
}

test('fresh installation initializes once for concurrent callers and activates a read-back verified source', async () => {
  const f = fixture();
  const coordinator = f.create();
  await Promise.all([coordinator.start(), coordinator.start(), coordinator.read('tasks.json')]);
  assert.equal(f.calls.ensure, 1);
  assert.equal(f.calls.repository, 1);
  assert.equal(coordinator.mode, 'database');
  assert.equal(coordinator.docId, binding.docId);
  assert.equal(usesNativeStorage(coordinator.facade), true);
  assert.deepEqual(f.files.get(SOURCE_FILE), { schemaVersion: 1, mode: 'database', binding });
  assert.deepEqual(f.calls.writes.map(write => write.name), [OBSERVATION_FILE, SOURCE_FILE]);
  assert.deepEqual(f.calls.requests, ['/api/system/version']);
});

test('restart uses the active source binding and never provisions replacement databases', async () => {
  const f = fixture();
  await f.create().start();
  f.setDatabase({ ...empty(), tasks: [task('existing')] });
  const restarted = f.create();
  await restarted.start();
  assert.equal(f.calls.ensure, 1);
  assert.deepEqual(await restarted.read('tasks.json'), [task('existing')]);
  assert.deepEqual(f.calls.writes.map(write => write.name), [OBSERVATION_FILE, SOURCE_FILE, OBSERVATION_FILE]);
});

test('unreadable active databases fail closed instead of creating a new empty source', async () => {
  const f = fixture();
  f.files.set(SOURCE_FILE, { schemaVersion: 1, mode: 'database', binding });
  f.hooks.load = async () => { throw new Error('database unavailable'); };
  const coordinator = f.create();
  await assert.rejects(coordinator.start(), /database unavailable/);
  assert.equal(f.calls.ensure, 0);
  assert.equal(f.calls.writes.length, 0);
  assert.equal(coordinator.mode, 'starting');
});

test('a failed startup retries the original database once for concurrent callers after recovery', async () => {
  const f = fixture();
  f.files.set(SOURCE_FILE, { schemaVersion: 1, mode: 'database', binding });
  f.setDatabase({ ...empty(), tasks: [task('existing')] });
  f.hooks.load = async () => { throw new Error('temporarily unavailable'); };
  const coordinator = f.create();
  await assert.rejects(coordinator.start(), /temporarily unavailable/);
  f.hooks.load = undefined;
  await Promise.all([coordinator.start(), coordinator.start(), coordinator.read('tasks.json')]);
  assert.equal(coordinator.mode, 'database');
  assert.equal(f.calls.ensure, 0);
  assert.equal(f.calls.load, 2);
  assert.deepEqual(await coordinator.read('tasks.json'), [task('existing')]);
  await coordinator.write('tasks.json', [task('existing', { title: 'After recovery' })]);
  assert.equal(f.calls.snapshots.length, 1, 'successful recovery releases the startup failure latch');
});

test('startup retries keep malformed or temporarily missing active bindings fail-closed', async () => {
  const f = fixture();
  f.files.set(SOURCE_FILE, { schemaVersion: 1, mode: 'database', binding });
  f.hooks.verify = async () => { throw new Error('temporarily unavailable'); };
  const coordinator = f.create();
  await assert.rejects(coordinator.start(), /temporarily unavailable/);
  f.hooks.verify = undefined;
  f.files.delete(SOURCE_FILE);
  await assert.rejects(coordinator.start(), /不会创建替代数据库/);
  f.files.set(SOURCE_FILE, { schemaVersion: 1, mode: 'unexpected' });
  await assert.rejects(coordinator.start(), /数据源配置无效/);
  await assert.rejects(coordinator.start(), /数据源配置无效/);
  assert.equal(f.calls.ensure, 0);
  assert.equal(f.calls.writes.length, 0);
});

test('archive-only and recovery-only installations remain legacy until explicit migration', async () => {
  for (const source of [
    { ...empty(), archived: [task('archived', { status: 'done' })] },
    { ...empty(), trash: [{ id: 'batch', deletedAt: 20, tasks: [task('deleted')] }] },
  ]) {
    const f = fixture(source);
    const coordinator = f.create();
    await coordinator.start();
    assert.equal(coordinator.mode, 'legacy');
    assert.equal(usesNativeStorage(coordinator.facade), false);
    assert.equal(f.calls.ensure, 0);
    assert.equal(f.calls.writes.length, 0);
    assert.equal((await coordinator.preflight()).hasLegacyData, true);
  }
});

test('old IndexedDB data prevents accidental initialization of an empty installation', async () => {
  const f = fixture();
  f.setCache({ tasks: [task('cached')] });
  const coordinator = f.create();
  await assert.rejects(coordinator.start(), /IndexedDB/);
  assert.equal(f.calls.ensure, 0);
  assert.equal(f.files.has(SOURCE_FILE), false);
  assert.equal(f.calls.writes.length, 0);
});

test('initialization errors and unsupported versions never write an active source', async () => {
  for (const version of ['3.8.7', '3.7.0', 'unknown']) {
    const f = fixture();
    f.setVersion(version);
    await assert.rejects(f.create().start(), /3\.8\.8/);
    assert.equal(f.calls.ensure, 0);
    assert.equal(f.files.has(SOURCE_FILE), false);
  }
  const f = fixture();
  f.hooks.ensure = async () => { throw new Error('creation interrupted'); };
  await assert.rejects(f.create().start(), /creation interrupted/);
  assert.equal(f.files.has(SOURCE_FILE), false);
  assert.equal(f.calls.writes.length, 0);
});

test('an unactivated nonempty database is never mistaken for fresh empty storage', async () => {
  const f = fixture();
  f.setDatabase({ ...empty(), tasks: [task('already-written')] });
  await assert.rejects(f.create().start(), /已有数据库记录/);
  assert.equal(f.files.has(SOURCE_FILE), false);
});

test('business writes use the database and a logical multi-file move is one repository write', async () => {
  const f = fixture();
  const coordinator = f.create();
  await coordinator.start();
  const original = task('moved', { status: 'done' });
  await coordinator.write('tasks.json', [original]);
  await saveFiles(coordinator.facade, { 'tasks.json': [], 'tasks-archive.json': [original] });
  assert.equal(f.calls.snapshots.length, 2);
  assert.deepEqual(f.calls.snapshots[1], { ...empty(), archived: [original] });
  assert.deepEqual(await coordinator.read('tasks.json'), []);
  assert.deepEqual(await coordinator.read('tasks-archive.json'), [original]);
  assert.equal(f.files.has('tasks.json'), false);
  assert.equal(f.files.has('tasks-archive.json'), false);
  await coordinator.facade.saveData('things-reminders.json', { safe: 123 });
  assert.deepEqual(await coordinator.facade.loadData('things-reminders.json'), { safe: 123 });
});

test('returned records are snapshots rather than mutable references to coordinator state', async () => {
  const f = fixture({ ...empty(), tasks: [task('id')] });
  const coordinator = f.create();
  const records = await coordinator.read('tasks.json');
  records[0].title = 'locally changed';
  records.push(task('uncommitted'));
  assert.deepEqual(await coordinator.read('tasks.json'), [task('id')]);
});

test('a partial database save failure pauses subsequent writes and preserves the previous read snapshot', async () => {
  const f = fixture();
  const coordinator = f.create();
  await coordinator.start();
  f.hooks.save = async () => { throw new Error('write failed'); };
  await assert.rejects(coordinator.write('tasks.json', [task('a')]), /暂停后续写入/);
  await assert.rejects(coordinator.write('tasks.json', [task('b')]), /暂停后续写入/);
  assert.equal(f.calls.snapshots.length, 1);
  assert.equal(f.files.has('tasks.json'), false);
});

test('queued edits cannot continue after an earlier edit has failed', async () => {
  const f = fixture();
  const coordinator = f.create();
  await coordinator.start();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.hooks.save = async () => { await gate; throw new Error('first write failed'); };
  const first = coordinator.write('tasks.json', [task('first')]);
  const second = coordinator.write('tasks.json', [task('second')]);
  const settled = Promise.allSettled([first, second]);
  release();
  const results = await settled;
  assert.ok(results.every(result => result.status === 'rejected'));
  assert.equal(f.calls.snapshots.length, 1, 'queued edits must inspect the failure latch inside the serialized operation');
});

test('explicit migration verifies an original backup and preserves every old business file', async () => {
  const original: LegacySnapshot = {
    ...empty(), tasks: [task('active', { parentId: 'historically-missing', custom: { keep: true }, order: -0.25 })],
    archived: [task('archived', { status: 'done', completedDate: 0 })],
    trash: [{ id: 'batch', deletedAt: 0, tasks: [task('active', { notes: 'old version' })] }],
  };
  const f = fixture(original);
  const coordinator = f.create();
  await coordinator.start();
  assert.equal(f.calls.ensure, 0);
  await coordinator.migrateLegacy();
  assert.equal(coordinator.mode, 'database');
  assert.equal(f.calls.ensure, 1);
  assert.deepEqual(f.calls.imported, [original]);
  assert.deepEqual(f.files.get(BACKUP_FILE).snapshot, original);
  assert.equal(f.files.get(BACKUP_FILE).schemaVersion, 1);
  for (const [key, name] of Object.entries(LEGACY_FILES)) assert.deepEqual(f.files.get(name), original[key as keyof LegacySnapshot]);
  assert.deepEqual(f.calls.writes.map(write => write.name), [BACKUP_FILE, OBSERVATION_FILE, SOURCE_FILE]);
  await coordinator.migrateLegacy();
  assert.equal(f.calls.imported.length, 1, 'already active migration is a no-op');
});

test('preflight errors and residual IDB block explicit migration before provisioning', async () => {
  const duplicate = fixture({ ...empty(), tasks: [task('same')], archived: [task('same')] });
  await assert.rejects(duplicate.create().migrateLegacy(), /迁移预检未通过/);
  assert.equal(duplicate.calls.ensure, 0);
  assert.equal(duplicate.files.has(BACKUP_FILE), false);
  const cached = fixture({ ...empty(), tasks: [task('source')] });
  cached.setCache({ tasks: [task('cached')] });
  await assert.rejects(cached.create().migrateLegacy(), /IndexedDB/);
  assert.equal(cached.calls.ensure, 0);
});

test('failed original-backup verification prevents import or activation', async () => {
  const f = fixture({ ...empty(), tasks: [task('original')] });
  f.hooks.write = async (name) => { if (name === BACKUP_FILE) throw new Error('backup write unavailable'); };
  await assert.rejects(f.create().migrateLegacy(), /backup write unavailable/);
  assert.equal(f.calls.ensure, 0);
  assert.equal(f.calls.imported.length, 0);
  assert.equal(f.files.has(SOURCE_FILE), false);
});

test('a previous backup of a different source is never overwritten on retry', async () => {
  const f = fixture({ ...empty(), tasks: [task('changed-source')] });
  const previous = { schemaVersion: 1, snapshot: { ...empty(), tasks: [task('original-source')] }, createdAt: 10 };
  f.files.set(BACKUP_FILE, clone(previous));
  await assert.rejects(f.create().migrateLegacy(), /迁移备份不同/);
  assert.deepEqual(f.files.get(BACKUP_FILE), previous);
  assert.equal(f.calls.ensure, 0);
});

test('database round-trip differences prevent source activation', async () => {
  const original = { ...empty(), tasks: [task('original')] };
  const f = fixture(original);
  f.hooks.load = async () => ({ ...empty(), tasks: [task('wrong')] });
  const coordinator = f.create();
  await assert.rejects(coordinator.migrateLegacy(), /往返核对未通过/);
  assert.equal(coordinator.mode, 'legacy');
  assert.equal(f.files.has(SOURCE_FILE), false);
  assert.deepEqual(f.files.get('tasks.json'), original.tasks);
});

test('source changes during import prevent switching and remain in the original files', async () => {
  const original = { ...empty(), tasks: [task('original')] };
  const f = fixture(original);
  f.hooks.import = async () => { f.files.set('tasks.json', [task('edited-elsewhere')]); };
  const coordinator = f.create();
  await assert.rejects(coordinator.migrateLegacy(), /旧数据发生变化/);
  assert.equal(coordinator.mode, 'legacy');
  assert.equal(f.files.has(SOURCE_FILE), false);
  assert.deepEqual(f.files.get(BACKUP_FILE).snapshot, original);
  assert.deepEqual(f.files.get('tasks.json'), [task('edited-elsewhere')]);
});

test('comparison normalizes object key order but preserves array order, false and zero', () => {
  assert.equal(stableJSON({ b: 0, a: false }), stableJSON({ a: false, b: 0 }));
  assert.notEqual(stableJSON([1, 2]), stableJSON([2, 1]));
  assert.notEqual(stableJSON({ order: 0 }), stableJSON({}));
  assert.notEqual(stableJSON({ someday: false }), stableJSON({}));
});

test('active sources validate their original binding before loading or recovering, without provisioning', async () => {
  const f = fixture(); f.files.set(SOURCE_FILE, { schemaVersion: 1, mode: 'database', binding });
  f.hooks.verify = async () => { throw new Error('carrier was removed'); };
  await assert.rejects(f.create().start(), /carrier was removed/);
  assert.equal(f.calls.load, 0); assert.equal(f.calls.ensure, 0); assert.equal(f.calls.writes.length, 0);
});

test('durable intent is verified before business writes and retained when recovery conflicts', async () => {
  const f = fixture(); const coordinator = f.create(); await coordinator.start();
  f.hooks.write = async (name) => { if (name === WRITE_INTENT_FILE) throw new Error('journal unavailable'); };
  await assert.rejects(coordinator.write('tasks.json', [task('new')]), /journal unavailable/);
  assert.equal(f.calls.snapshots.length, 0);
  f.hooks.write = undefined;
  const next = f.create(); await next.start();
  f.hooks.save = async () => { throw new Error('partial write'); };
  await assert.rejects(next.write('tasks.json', [task('new')]), /partial write/);
  const intent = clone(f.files.get(WRITE_INTENT_FILE));
  assert.deepEqual(intent.base, empty()); assert.deepEqual(intent.desired.tasks, [task('new')]);
  f.hooks.recover = async () => { throw new Error('native edit conflicts'); };
  const readsBefore = f.calls.load;
  await assert.rejects(f.create().start(), /native edit conflicts/);
  assert.equal(f.calls.load, readsBefore, 'cannot load or adopt rows before pending recovery succeeds');
  assert.deepEqual(f.files.get(WRITE_INTENT_FILE), intent);
});

test('missing or mismatched source bindings cannot claim a pending write', async () => {
  const f = fixture();
  const intent = { schemaVersion: 1, binding, base: empty(), desired: empty(), createdAt: 1 };
  f.files.set(WRITE_INTENT_FILE, intent);
  await assert.rejects(f.create().start(), /缺少原数据源绑定/);
  assert.equal(f.calls.ensure, 0);
  f.files.set(SOURCE_FILE, { schemaVersion: 1, mode: 'database', binding });
  f.files.set(WRITE_INTENT_FILE, { ...intent, binding: { ...binding, docId: 'different' } });
  await assert.rejects(f.create().start(), /不属于当前数据库/);
  assert.equal(f.calls.recoveries.length, 0);
});

test('explicit refresh resumes a saved operation and releases the failure latch only after verification', async () => {
  const f = fixture(); const coordinator = f.create(); await coordinator.start();
  f.hooks.save = async () => { throw new Error('response lost'); };
  await assert.rejects(coordinator.write('tasks.json', [task('retry')]), /response lost/);
  await coordinator.refresh();
  assert.deepEqual(await coordinator.read('tasks.json'), [task('retry')]);
  assert.equal(f.calls.recoveries.length, 1); assert.equal(f.files.get(WRITE_INTENT_FILE), null);
  f.hooks.save = undefined;
  await coordinator.write('tasks.json', [task('retry', { title: 'After recovery' })]);
  assert.equal((await coordinator.read('tasks.json'))[0].title, 'After recovery');
});

test('false or zero source metadata is corruption rather than a fresh installation', async () => {
  for (const value of [false, 0]) {
    const f = fixture(); f.files.set(SOURCE_FILE, value);
    await assert.rejects(f.create().start(), /数据源配置无效/);
    assert.equal(f.calls.ensure, 0);
  }
});

test('two coordinators sharing a host cannot overwrite an in-flight recovery intent', async () => {
  const f = fixture(); const first = f.create(); await first.start(); const second = f.create(); await second.start();
  let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.hooks.save = async () => { entered(); await gate; throw new Error('first write interrupted'); };
  const pending = first.write('tasks.json', [task('first')]);
  await started;
  const intent = clone(f.files.get(WRITE_INTENT_FILE));
  const competing = second.write('tasks.json', [task('second')]);
  release();
  const results = await Promise.allSettled([pending, competing]);
  assert.ok(results.every(result => result.status === 'rejected'));
  assert.equal(f.calls.snapshots.length, 1);
  assert.deepEqual(f.files.get(WRITE_INTENT_FILE), intent);
});

/** Native AV boundary for coordinator/repository integration, using actual Value/itemID shapes. */
function nativeFixture() {
  const avs = new Map<string, any>(), files = new Map<string, any>();
  const nativeBinding: Binding = { schemaVersion: 1, notebookId: '20261028000000-notebok', docId: '20261028000000-center0', tables: {} as any };
  for (const table of TABLE_NAMES) {
    const spec = TABLES[table], keys = Object.fromEntries([spec.titleField, ...spec.columns.map(column => column.field)].map(field => [field, `${table}-${field}`]));
    nativeBinding.tables[table] = { avId: table, blockId: `${table}-block`, keys };
    avs.set(table, { id: table, keyValues: [{ key: { id: keys[spec.titleField], type: 'block' }, values: [] },
      ...spec.columns.map(column => ({ key: { id: keys[column.field], type: column.type, ...(column.relation ? { relation: { avID: column.relation } } : {}) }, values: [] }))] });
  }
  files.set(SOURCE_FILE, { schemaVersion: 1, mode: 'database', binding: nativeBinding });
  const host = { async loadData(name: string) { return clone(files.get(name)); }, async saveData(name: string, value: any) { files.set(name, clone(value)); } };
  let failIdentity = false, requireIntent = false;
  const client = new SiYuanAVClient(async (path, input) => {
    const body: any = input;
    if (path === '/api/system/version') return '3.8.8';
    if (path === '/api/av/getAttributeView') return { av: clone(avs.get(body.id)) };
    if (requireIntent) assert.ok(files.get(WRITE_INTENT_FILE), 'native write must have a durable intent first');
    if (path === '/api/av/addAttributeViewBlocks') {
      for (const source of body.srcs) avs.get(body.avID).keyValues[0].values.push({ blockID: source.itemID, isDetached: true, type: 'block', block: { id: source.id, content: source.content } });
      return null;
    }
    if (path === '/api/av/batchSetAttributeViewBlockAttrs') {
      for (const patch of body.values) {
        const entry = avs.get(body.avID).keyValues.find((value: any) => value.key.id === patch.keyID);
        const value = { ...clone(patch.value), blockID: patch.itemID, keyID: patch.keyID };
        const index = entry.values.findIndex((old: any) => old.blockID === patch.itemID);
        if (index < 0) entry.values.push(value); else entry.values[index] = value;
      }
      if (failIdentity && body.values.length === 1 && body.values[0].keyID === `${body.avID}-id`) {
        failIdentity = false; throw new Error('identity committed, response lost');
      }
      return null;
    }
    if (path === '/api/av/removeAttributeViewBlocks') {
      for (const entry of avs.get(body.avID).keyValues) entry.values = entry.values.filter((value: any) => !body.srcIDs.includes(value.blockID));
      return null;
    }
    throw new Error(`Unexpected native fixture API ${path}`);
  });
  const create = () => new StorageCoordinator(host, client, { now: () => 1793156400123, async verify() {}, repository: value => new AVRepository(client, value) });
  const item = (table: string, id: string) => avs.get(table).keyValues.find((entry: any) => entry.key.id === `${table}-id`).values.find((value: any) => value.text.content === id)?.blockID;
  return { avs, files, client, create, item,
    async seed(snapshot: LegacySnapshot) { await new AVRepository(client, nativeBinding).import(snapshot); },
    failAfterIdentity() { failIdentity = true; requireIntent = true; },
  };
}

test('a stale second Store cannot resurrect a native-deleted tag after another Store saved', async () => {
  const f = nativeFixture();
  const source = { ...empty(), tasks: [task('one', { tags: ['removed'] })], tags: [{ id: 'removed', name: 'Removed', order: 0 }] };
  await f.seed(source); const coordinator = f.create();
  const taskMap = await coordinator.read('tasks.json'), tagMap = await coordinator.read('tags.json');
  await f.client.setCells('tasks', [{ itemID: f.item('tasks', 'one'), keyID: 'tasks-tags', value: encodeCell('relation', []) }]);
  await f.client.removeRows('tags', [f.item('tags', 'removed')]);
  taskMap[0].title = 'Edited in Things';
  await coordinator.write('tasks.json', taskMap);
  // BaseStore.save reloads only tasks. The tag Store intentionally still holds its earlier Map.
  await coordinator.read('tasks.json');
  tagMap.push({ id: 'new-tag', name: 'New', order: 1 });
  await coordinator.write('tags.json', tagMap);
  assert.deepEqual((await coordinator.read('tags.json')).map((row: any) => row.id), ['new-tag']);
  const savedTasks = await coordinator.read('tasks.json');
  assert.deepEqual(savedTasks[0].tags, []); assert.equal(savedTasks[0].title, 'Edited in Things');
});

test('a new coordinator resumes an ordinary save after row identity committed without complete cells', async () => {
  const f = nativeFixture(); const coordinator = f.create(); await coordinator.start();
  f.failAfterIdentity();
  await assert.rejects(coordinator.write('tasks.json', [task('interrupted')]), /identity committed/);
  assert.ok(f.files.get(WRITE_INTENT_FILE));
  const restarted = f.create(); await restarted.start();
  assert.deepEqual(await restarted.read('tasks.json'), [task('interrupted')]);
  assert.equal(f.avs.get('tasks').keyValues[0].values.length, 1);
  assert.equal(f.files.get(WRITE_INTENT_FILE), null);
});

test('a stale active-task save preserves a native archive move without duplicating the task', async () => {
  const f = nativeFixture(); await f.seed({ ...empty(), tasks: [task('moved')] });
  const coordinator = f.create(); const active = await coordinator.read('tasks.json');
  await f.client.setCells('tasks', [{ itemID: f.item('tasks', 'moved'), keyID: 'tasks-storageState', value: encodeCell('select', 'archived') }]);
  active[0].title = 'Edited after native move';
  await coordinator.write('tasks.json', active);
  assert.deepEqual(await coordinator.read('tasks.json'), []);
  assert.deepEqual(await coordinator.read('tasks-archive.json'), [task('moved', { title: 'Edited after native move' })]);
  assert.equal(f.avs.get('tasks').keyValues[0].values.length, 1);
});

test('migration seeds done history and preserves undated repeats without firing completion effects', async () => {
  const source = { ...empty(), tasks: [task('history', { status: 'done', repeatRule: 'daily' }), task('undated', { repeatRule: 'daily' })] };
  const f = fixture(source); const coordinator = f.create();
  const stages: string[] = [];
  await coordinator.migrateLegacy(stage => { stages.push(stage); if (stage === 'importing') throw new Error('UI callback failed'); });
  assert.deepEqual(stages, ['checking', 'backup', 'creating', 'importing', 'verifying', 'activating', 'done']);
  await f.create().start();
  assert.deepEqual(await coordinator.read('tasks.json'), source.tasks);
  assert.equal(f.calls.snapshots.length, 0);
  assert.equal(f.files.get(OBSERVATION_FILE).tasks.find((row: any) => row.id === 'history').status, 'done');
});

test('Things completion and its entire recurring checklist are one durable repository write', async () => {
  const f = fixture(); const coordinator = f.create(); await coordinator.start();
  f.setDatabase({ ...empty(), tasks: [task('root', { repeatRule: 'daily', startDate: 1793156400123 }),
    task('child', { parentId: 'root' }), task('grandchild', { parentId: 'child' })] });
  await coordinator.refresh();
  const tasks = await coordinator.read('tasks.json'); tasks[0].status = 'done';
  const before = f.calls.snapshots.length;
  f.hooks.save = async desired => {
    const intent = f.files.get(WRITE_INTENT_FILE);
    assert.deepEqual(intent.desired, desired);
    assert.equal(intent.observation.tasks.find((row: any) => row.id === 'root').status, 'done');
    assert.equal(f.files.get(OBSERVATION_FILE).tasks.find((row: any) => row.id === 'root').status, 'todo');
  };
  await coordinator.write('tasks.json', tasks);
  assert.equal(f.calls.snapshots.length, before + 1);
  const saved = await coordinator.read('tasks.json');
  assert.equal(saved.length, 6);
  const next = saved.find((row: any) => row.recurrenceSourceId === 'root');
  const child = saved.find((row: any) => row.recurrenceSourceId === 'child');
  assert.equal(child.parentId, next.id);
  assert.equal(saved.find((row: any) => row.recurrenceSourceId === 'grandchild').parentId, child.id);
  assert.equal(saved[0].completedDate, 1793156400123);
  assert.equal(f.files.get(WRITE_INTENT_FILE), null);
});

test('native completion resumes after the next-row identity commits but its response is lost', async () => {
  const f = nativeFixture(); await f.seed({ ...empty(), tasks: [task('root', { repeatRule: 'daily', startDate: 1793156400123 }), task('child', { parentId: 'root' })] });
  const coordinator = f.create(); await coordinator.start();
  await f.client.setCells('tasks', [{ itemID: f.item('tasks', 'root'), keyID: 'tasks-status', value: encodeCell('select', 'done') }]);
  f.failAfterIdentity();
  await assert.rejects(coordinator.refresh(), /identity committed/);
  const intent = clone(f.files.get(WRITE_INTENT_FILE));
  assert.equal(intent.desired.tasks.length, 4);
  assert.equal(f.files.get(OBSERVATION_FILE).tasks.find((row: any) => row.id === 'root').status, 'todo');
  const restarted = f.create(); await restarted.start(); await restarted.refresh();
  assert.deepEqual(await restarted.read('tasks.json'), intent.desired.tasks);
  assert.equal(f.avs.get('tasks').keyValues[0].values.length, 4);
  assert.equal(f.files.get(WRITE_INTENT_FILE), null);
});

test('completed database writes survive failed observation acknowledgement or intent cleanup without duplicating effects', async () => {
  for (const failingFile of [OBSERVATION_FILE, WRITE_INTENT_FILE]) {
    const f = fixture(); const coordinator = f.create(); await coordinator.start();
    f.setDatabase({ ...empty(), tasks: [task('root', { repeatRule: 'daily', startDate: 1793156400123 })] });
    await coordinator.refresh();
    const tasks = await coordinator.read('tasks.json'); tasks[0].status = 'done';
    let failed = false;
    f.hooks.write = async (name, value) => {
      if (!failed && name === failingFile && (name !== WRITE_INTENT_FILE || value === null)) { failed = true; throw new Error('acknowledgement lost'); }
    };
    await assert.rejects(coordinator.write('tasks.json', tasks), /acknowledgement lost/);
    const intent = clone(f.files.get(WRITE_INTENT_FILE));
    assert.ok(intent); assert.equal(intent.desired.tasks.length, 2);
    f.setClock(1793156400999);
    const restarted = f.create(); await restarted.start(); await restarted.refresh();
    assert.deepEqual(await restarted.read('tasks.json'), intent.desired.tasks);
    assert.equal(f.calls.snapshots.length, 1);
    assert.equal(f.calls.recoveries.length, 1);
    assert.equal(f.files.get(WRITE_INTENT_FILE), null);
  }
});

test('readback does not acknowledge native completions that appeared after the planned write', async () => {
  const f = fixture(); const coordinator = f.create(); await coordinator.start();
  let insertAtReadback = false;
  f.hooks.save = async () => { insertAtReadback = true; };
  f.hooks.load = async () => {
    if (!insertAtReadback) return undefined;
    insertAtReadback = false;
    const concurrent = { ...empty(), tasks: [task('native-late', { status: 'done', repeatRule: 'daily', startDate: 1793156400123 })], tags: [{ id: 'tag', name: 'Tag', order: 0 }] };
    f.setDatabase(concurrent); return concurrent;
  };
  await coordinator.write('tags.json', [{ id: 'tag', name: 'Tag', order: 0 }]);
  assert.equal(f.files.get(OBSERVATION_FILE).tasks.some((row: any) => row.id === 'native-late'), false);
  f.hooks.save = undefined; f.hooks.load = undefined;
  await coordinator.refresh();
  assert.equal((await coordinator.read('tasks.json')).length, 2);
  assert.equal(f.files.get(OBSERVATION_FILE).tasks.find((row: any) => row.id === 'native-late').status, 'done');
});

test('a stale Things completion derives its successor from the latest native title and date', async () => {
  const f = nativeFixture(); await f.seed({ ...empty(), tasks: [task('root', { repeatRule: 'daily', startDate: 1793156400123 })] });
  const coordinator = f.create(); const tasks = await coordinator.read('tasks.json');
  await f.client.setCells('tasks', [
    { itemID: f.item('tasks', 'root'), keyID: 'tasks-title', value: encodeCell('block', 'Native latest title') },
    { itemID: f.item('tasks', 'root'), keyID: 'tasks-startDate', value: encodeCell('date', 1793242800123) },
  ]);
  tasks[0].status = 'done'; await coordinator.write('tasks.json', tasks);
  const saved = await coordinator.read('tasks.json');
  assert.equal(saved.length, 2);
  assert.equal(saved[1].title, 'Native latest title'); assert.equal(saved[1].startDate, 1793329200123);
});

test('migration inspection checks compatibility and caches without creating a database', async () => {
  const f = fixture({ ...empty(), tasks: [task('old')] }); const coordinator = f.create();
  const report = await coordinator.inspectMigration();
  assert.equal(report.counts.tasks, 1); assert.equal(f.calls.ensure, 0); assert.equal(f.calls.writes.length, 0);
  f.setCache({ tasks: [{ id: 'old-cache' }] });
  await assert.rejects(coordinator.inspectMigration(), /IndexedDB/);
  assert.equal(f.calls.ensure, 0);
});

test('a lost source-switch response is accepted only after its durable binding reads back exactly', async () => {
  const original = { ...empty(), tasks: [task('legacy')] };
  const f = fixture(original); const coordinator = f.create(); await coordinator.start();
  f.hooks.write = async (name, value) => {
    if (name === SOURCE_FILE) { f.files.set(name, clone(value)); throw new Error('source committed, response lost'); }
  };
  await coordinator.migrateLegacy();
  assert.equal(coordinator.mode, 'database');
  await coordinator.write('tasks.json', [task('legacy', { title: 'Saved in database' })]);
  assert.deepEqual(f.files.get('tasks.json'), original.tasks);
  assert.equal((await coordinator.read('tasks.json'))[0].title, 'Saved in database');
  assert.equal(f.calls.snapshots.length, 1);
});

test('unknown source-switch outcome freezes legacy writes until reloading confirms the source', async () => {
  const original = { ...empty(), tasks: [task('legacy')] };
  const f = fixture(original); const coordinator = f.create(); await coordinator.start();
  let uncertain = false;
  const read = f.host.loadData.bind(f.host);
  f.host.loadData = async name => {
    if (name === SOURCE_FILE && uncertain) throw new Error('readback unavailable');
    return read(name);
  };
  f.hooks.write = async (name, value) => {
    if (name === SOURCE_FILE) { f.files.set(name, clone(value)); uncertain = true; throw new Error('source committed, response lost'); }
  };
  await assert.rejects(coordinator.migrateLegacy(), /切换结果暂时无法确认/);
  const writes = f.calls.writes.length;
  await assert.rejects(coordinator.write('tasks.json', [task('new-local-edit')]), /切换结果暂时无法确认/);
  await assert.rejects(coordinator.migrateLegacy(), /切换结果暂时无法确认/);
  assert.equal(f.calls.writes.length, writes);
  assert.deepEqual(f.files.get('tasks.json'), original.tasks);
  assert.deepEqual(await coordinator.read('tasks.json'), original.tasks);
  uncertain = false; const restarted = f.create(); await restarted.start();
  assert.equal(restarted.mode, 'database');
  assert.deepEqual(await restarted.read('tasks.json'), original.tasks);
});

test('unsupported note drafts fail before journaling and canceling them permits a normal title edit', async () => {
  const f = fixture(); const coordinator = f.create(); await coordinator.start();
  f.setDatabase({ ...empty(), tasks: [task('one', { notes: 'Original native structure' })] });
  await coordinator.refresh();
  const beforeWrites = f.calls.writes.length;
  f.hooks.preflight = async snapshot => {
    assert.equal(f.files.has(WRITE_INTENT_FILE), false, 'read-only preflight precedes the first write intent');
    if (snapshot.tasks[0].notes === 'Unsupported replacement') throw new NativeNotesUnsupportedError();
  };
  const draft = await coordinator.read('tasks.json'); draft[0].notes = 'Unsupported replacement';
  await assert.rejects(coordinator.write('tasks.json', draft), NativeNotesUnsupportedError);
  assert.equal(f.calls.snapshots.length, 0);
  assert.equal(f.calls.writes.length, beforeWrites);
  assert.equal(f.files.has(WRITE_INTENT_FILE), false);
  const retry = await coordinator.read('tasks.json'); retry[0].title = 'Title after cancel';
  await coordinator.write('tasks.json', retry);
  assert.equal(f.calls.snapshots.length, 1);
  assert.equal((await coordinator.read('tasks.json'))[0].title, 'Title after cancel');
  assert.equal((await coordinator.read('tasks.json'))[0].notes, 'Original native structure');
});

test('known task conflicts before a journal do not freeze unrelated edits', async () => {
  const f = nativeFixture(); await f.seed({ ...empty(), tasks: [task('one')] });
  const coordinator = f.create(); const stale = await coordinator.read('tasks.json');
  await f.client.setCells('tasks', [{ itemID: f.item('tasks', 'one'), keyID: 'tasks-title', value: encodeCell('block', 'Native title') }]);
  stale[0].title = 'Conflicting title';
  await assert.rejects(coordinator.write('tasks.json', stale), /title/);
  assert.equal(f.files.has(WRITE_INTENT_FILE), false);
  await coordinator.write('tags.json', [{ id: 'safe-tag', name: 'Safe tag', order: 0 }]);
  assert.equal((await coordinator.read('tasks.json'))[0].title, 'Native title');
  assert.equal((await coordinator.read('tags.json'))[0].id, 'safe-tag');
});

test('a failed journal attempt still freezes writes even if no business write was reached', async () => {
  const f = fixture(); const coordinator = f.create(); await coordinator.start();
  f.hooks.write = async (name, value) => {
    if (name === WRITE_INTENT_FILE && value) { f.files.set(name, clone(value)); throw new Error('journal response lost'); }
  };
  await assert.rejects(coordinator.write('tasks.json', [task('first')]), /journal response lost/);
  const intent = clone(f.files.get(WRITE_INTENT_FILE));
  assert.ok(intent); assert.equal(f.calls.snapshots.length, 0);
  await assert.rejects(coordinator.write('tasks.json', [task('second')]), /journal response lost/);
  assert.deepEqual(f.files.get(WRITE_INTENT_FILE), intent);
  assert.equal(f.calls.snapshots.length, 0);
});
