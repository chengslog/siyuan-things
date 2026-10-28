import test from 'node:test';
import assert from 'node:assert/strict';
import { BaseStore } from '../src/stores/base.ts';
import { TaskStore } from '../src/stores/taskStore.ts';
import { STORAGE_BRIDGE } from '../src/storage/bridge.ts';

const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));
const task = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: 'Task', notes: '', status: 'todo' as const, priority: 'none' as const,
  created: 10, updated: 20, tags: [] as string[], order: 0, ...extra,
});
type Seed = { active?: any[]; archived?: any[]; trash?: any[] };

function fixture(seed: Seed = {}) {
  const files = new Map<string, any>([
    ['tasks.json', clone(seed.active || [])],
    ['tasks-archive.json', clone(seed.archived || [])],
    ['tasks-trash.json', clone(seed.trash || [])],
  ]);
  // Models stable AV item identities when one logical write moves a task between collections.
  const itemIds = new Map<string, string>();
  let nextItem = 0;
  function reconcileItems() {
    const present = new Set<string>([...files.get('tasks.json'), ...files.get('tasks-archive.json')].map(row => row.id));
    for (const id of present) if (!itemIds.has(id)) itemIds.set(id, `item-${++nextItem}`);
    for (const id of itemIds.keys()) if (!present.has(id)) itemIds.delete(id);
  }
  reconcileItems();
  const singleWrites: Array<{ name: string; value: any }> = [];
  const groupedWrites: Array<Record<string, any[]>> = [];
  const control = { fail: false };
  const plugin = {
    async loadData(name: string) { return clone(files.get(name)); },
    async saveData(name: string, value: any) {
      if (control.fail) throw new Error('simulated persistence failure');
      singleWrites.push({ name, value: clone(value) });
      files.set(name, clone(value));
      reconcileItems();
    },
    [STORAGE_BRIDGE]: {
      isNative: () => true,
      async writeFiles(updates: Record<string, any[]>) {
        if (control.fail) throw new Error('simulated persistence failure');
        groupedWrites.push(clone(updates));
        for (const [name, value] of Object.entries(updates)) files.set(name, clone(value));
        reconcileItems();
      },
    },
  };
  return { files, itemIds, singleWrites, groupedWrites, control, plugin, store: new TaskStore(plugin as any) };
}

test('native load preserves undated recurrence, history, unknown fields and source timestamps without writes', async () => {
  const original = task('repeating', { repeatRule: 'daily', custom: { preserve: true }, someday: false });
  const archived = task('archived', { status: 'done', completedDate: 1 });
  const trash = [{ id: 'old-batch', deletedAt: 1, tasks: [task('deleted', { notes: 'old snapshot' })] }];
  const f = fixture({ active: [original], archived: [archived], trash });
  await f.store.load();
  assert.deepEqual(f.store.get('repeating'), original);
  assert.equal(f.store.get('repeating')?.startDate, undefined);
  assert.deepEqual(f.store.getArchivedTasks(), [archived]);
  assert.deepEqual(f.files.get('tasks-trash.json'), trash);
  assert.equal(f.singleWrites.length, 0);
  assert.equal(f.groupedWrites.length, 0);
});

test('native completion delegates recurrence once and returns the committed coordinator result', async () => {
  const f = fixture({ active: [task('repeat', { repeatRule: 'daily' })] });
  await f.store.load();
  let writes = 0;
  f.plugin.saveData = async (name: string, value: any) => {
    writes++;
    assert.equal(name, 'tasks.json');
    assert.equal(value[0].completedDate, undefined, 'Store must not pre-empt the durable transition');
    const committed = clone(value);
    committed[0].completedDate = 12345;
    committed[0].recurrenceGeneratedAt = 12345;
    committed.push(task('coordinator-next', { recurrenceSourceId: 'repeat' }));
    f.files.set(name, committed);
  };
  const result = await f.store.updateTask('repeat', { status: 'done' });
  assert.equal(writes, 1);
  assert.equal(result?.completedDate, 12345);
  assert.equal(result?.recurrenceGeneratedAt, 12345);
  assert.deepEqual(f.store.getAll().map(item => item.id), ['repeat', 'coordinator-next']);
});

test('native empty reload clears stale current and archive caches and notifies views', async () => {
  const f = fixture({ active: [task('active')], archived: [task('archived')] });
  await f.store.load();
  const events: any[] = [];
  f.store.on(event => events.push(event));
  f.files.set('tasks.json', []);
  f.files.set('tasks-archive.json', []);
  await f.store.load();
  assert.deepEqual(f.store.getAll(), []);
  assert.deepEqual(f.store.getArchivedTasks(), []);
  assert.ok(events.some(event => event.type === 'change'));
});

test('corrupt recovery data must not be replaced silently by an empty history', async () => {
  const f = fixture();
  f.files.set('tasks-trash.json', { unexpected: 'object' });
  await assert.rejects(f.store.load(), /trash|recovery|回收|Invalid/i);
  assert.equal(f.groupedWrites.length, 0);
  assert.deepEqual(f.files.get('tasks-trash.json'), { unexpected: 'object' });
});

test('duplicate current or archived identities fail instead of disappearing into a Map', async () => {
  for (const filename of ['tasks.json', 'tasks-archive.json']) {
    const f = fixture();
    f.files.set(filename, [task('duplicate', { notes: 'version one' }), task('duplicate', { notes: 'version two' })]);
    await assert.rejects(f.store.load(), /duplicate|重复|冲突/i);
    assert.equal(f.files.get(filename).length, 2);
    assert.equal(f.groupedWrites.length, 0);
  }
});

test('BaseStore add, update and delete reject failed persistence and do not emit success events', async () => {
  class TestStore extends BaseStore<{ id: string; value: number }> {}
  for (const operation of ['add', 'update', 'delete'] as const) {
    const f = fixture();
    f.files.set('sample.json', [{ id: 'existing', value: 1 }]);
    const store = new TestStore(f.plugin as any, 'sample.json');
    await store.load();
    const events: any[] = [];
    store.on(event => events.push(event));
    f.control.fail = true;
    await assert.rejects(operation === 'delete' ? store.delete('existing')
      : operation === 'add' ? store.add({ id: 'new', value: 2 }) : store.update({ id: 'existing', value: 3 }), /persistence failure/);
    assert.deepEqual(store.getAll(), [{ id: 'existing', value: 1 }]);
    assert.ok(events.every(event => event.type === 'change'));
    assert.deepEqual(f.files.get('sample.json'), [{ id: 'existing', value: 1 }]);
  }
});

test('native archive and restore each use one grouped write and retain original item identity', async () => {
  const archivedTask = task('done', { status: 'done', completedDate: Date.now() - 90 * 86_400_000 });
  const f = fixture({ active: [archivedTask, task('still-active')] });
  await f.store.load();
  const rowIdentity = f.itemIds.get('done');
  assert.equal(await f.store.archiveCompleted(30), 1);
  assert.equal(f.groupedWrites.length, 1);
  assert.equal(f.singleWrites.length, 0);
  assert.equal(f.itemIds.get('done'), rowIdentity);
  assert.deepEqual(f.files.get('tasks-archive.json'), [archivedTask]);
  assert.equal(f.store.get('done'), undefined);
  assert.equal(await f.store.restoreTask('done'), true);
  assert.equal(f.groupedWrites.length, 2);
  assert.equal(f.itemIds.get('done'), rowIdentity);
  assert.deepEqual(f.store.get('done'), archivedTask);
  assert.deepEqual(f.store.getArchivedTasks(), []);
});

test('native delete preserves a recoverable snapshot of all active descendants regardless of source ordering', async () => {
  const parent = task('parent', { notes: 'main' });
  const child = task('child', { parentId: 'parent', tags: ['tag'], priority: 'high', notes: 'child notes' });
  const grandchild = task('grandchild', { parentId: 'child', order: -0.5, deadline: 123 });
  const f = fixture({ active: [grandchild, task('unrelated'), child, parent] });
  await f.store.load();
  await f.store.delete('parent');
  assert.equal(f.groupedWrites.length, 1);
  assert.deepEqual(f.store.getAll(), [task('unrelated')]);
  const batches = f.files.get('tasks-trash.json');
  assert.equal(batches.length, 1);
  assert.deepEqual(new Set(batches[0].tasks.map((row: any) => row.id)), new Set(['parent', 'child', 'grandchild']));
  assert.deepEqual(batches[0].tasks.find((row: any) => row.id === 'child'), child);
  assert.deepEqual(batches[0].tasks.find((row: any) => row.id === 'grandchild'), grandchild);
  assert.equal(await f.store.restoreLastTrashedBatch(), 1);
  assert.deepEqual(f.files.get('tasks-trash.json'), []);
  assert.deepEqual(f.store.get('parent'), parent);
  assert.deepEqual(f.store.get('grandchild'), grandchild);
});

test('native grouped save failure restores the previous cache and cannot announce deletion', async () => {
  const original = task('parent');
  const f = fixture({ active: [original] });
  await f.store.load();
  const events: any[] = [];
  f.store.on(event => events.push(event));
  f.control.fail = true;
  await assert.rejects(f.store.delete('parent'), /persistence failure/);
  assert.deepEqual(f.store.get('parent'), original);
  assert.ok(events.every(event => event.type === 'change'));
  assert.deepEqual(f.files.get('tasks-trash.json'), []);
  assert.equal(await f.store.restoreLastTrashedBatch(), 0);
});

test('recovery rejects collisions with current and archived records without popping the batch', async () => {
  for (const location of ['active', 'archived'] as const) {
    const current = task('same', { notes: 'current version' });
    const batches = [{ id: 'batch', deletedAt: 1, tasks: [task('same', { notes: 'old version' })] }];
    const f = fixture({ [location]: [current], trash: batches });
    await f.store.load();
    await assert.rejects(f.store.restoreLastTrashedBatch(), /冲突/);
    assert.equal(f.groupedWrites.length, 0);
    assert.deepEqual(f.files.get('tasks-trash.json'), batches);
    assert.deepEqual(location === 'active' ? f.store.get('same') : f.store.getArchivedTasks()[0], current);
  }
});

test('recovery refuses two historical versions with the same ID inside one batch', async () => {
  const batches = [{ id: 'batch', deletedAt: 1, tasks: [task('same', { notes: 'version one' }), task('same', { notes: 'version two' })] }];
  const f = fixture({ trash: batches });
  await f.store.load();
  await assert.rejects(f.store.restoreLastTrashedBatch(), /duplicate|重复|冲突/i);
  assert.equal(f.groupedWrites.length, 0);
  assert.deepEqual(f.files.get('tasks-trash.json'), batches);
  assert.equal(f.store.count, 0);
});

test('native tag cleanup updates current and archived tasks but freezes old recovery snapshots', async () => {
  const oldSnapshot = task('old', { tags: ['removed', 'keep', 'removed'], custom: { raw: true } });
  const batches = [{ id: 'batch', deletedAt: 1, tasks: [oldSnapshot] }];
  const f = fixture({
    active: [task('active', { tags: ['removed', 'keep'] })],
    archived: [task('archived', { tags: ['removed'] })], trash: batches,
  });
  await f.store.load();
  const changed = await f.store.removeTagFromAll('removed');
  assert.deepEqual(new Set(changed), new Set(['active', 'archived']));
  assert.deepEqual(f.store.get('active')?.tags, ['keep']);
  assert.deepEqual(f.store.getArchivedTasks()[0].tags, []);
  assert.deepEqual(f.files.get('tasks-trash.json'), batches);
  assert.equal(f.groupedWrites.length, 1);
  assert.equal(f.singleWrites.length, 0);
});
