import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskStore } from '../src/stores/taskStore.ts';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function fixture() {
  const files = new Map<string, any[]>([['tasks.json', []], ['tasks-archive.json', []], ['tasks-trash.json', []]]);
  let writes = 0;
  let fail: 'before' | 'after' | 'partial' | undefined;
  const store = new TaskStore({
    async loadData(name: string) { return clone(files.get(name) || []); },
    async saveData(name: string, value: any[]) {
      writes++;
      if (fail === 'before') throw new Error('offline');
      files.set(name, clone(fail === 'partial' ? value.slice(0, 2) : value));
      if (fail) throw new Error('response lost');
    },
  } as any);
  const group = store.prepareTaskGroup({ title: 'Parent', tags: ['original'] }, [
    { title: 'First', completed: false }, { title: 'Second', completed: true }, { title: ' ', completed: false },
  ]);
  return { store, group, files, writes: () => writes, fail: (value: typeof fail) => { fail = value; } };
}

test('a parent and checklist save once and notify only after the whole group is stored', async () => {
  const f = fixture();
  const publishedSizes: number[] = [];
  f.store.on(() => publishedSizes.push(f.store.getAll().length));
  const parent = await f.store.createTaskGroup(f.group);
  assert.equal(parent.id, f.group[0].id);
  assert.equal(f.writes(), 1);
  assert.equal(f.store.getAll().length, 3);
  assert.ok(publishedSizes.every(size => size === 0 || size === 3));
  assert.deepEqual(f.store.getSubTasks(parent.id).map(task => task.status), ['todo', 'done']);
});

test('a rejected group rolls memory back and retries with the same identities', async () => {
  const f = fixture();
  const ids = f.group.map(task => task.id);
  f.fail('before');
  await assert.rejects(f.store.createTaskGroup(f.group), /offline/);
  assert.deepEqual(f.store.getAll(), []);
  f.fail(undefined);
  await f.store.createTaskGroup(f.group);
  assert.deepEqual(f.store.getAll().map(task => task.id), ids);
  assert.equal(f.writes(), 2);
});

test('retry after a lost response does not duplicate or overwrite subsequently edited rows', async () => {
  const f = fixture();
  f.fail('after');
  await assert.rejects(f.store.createTaskGroup(f.group), /response lost/);
  const saved = f.files.get('tasks.json')!;
  saved[0].title = 'Edited elsewhere';
  saved[1].status = 'done';
  f.fail(undefined);
  const parent = await f.store.createTaskGroup(f.group);
  assert.equal(parent.title, 'Edited elsewhere');
  assert.equal(f.store.get(f.group[1].id)?.status, 'done');
  assert.equal(f.store.getAll().length, 3);
  assert.equal(f.writes(), 1, 'acknowledged identities need no further write');
});

test('retry fills only missing children after a partial save and preserves external edits', async () => {
  const f = fixture();
  f.fail('partial');
  await assert.rejects(f.store.createTaskGroup(f.group), /response lost/);
  f.files.get('tasks.json')![1].title = 'Edited first child';
  f.fail(undefined);
  await f.store.createTaskGroup(f.group);
  assert.equal(f.store.getAll().length, 3);
  assert.equal(f.store.get(f.group[1].id)?.title, 'Edited first child');
  assert.equal(f.store.get(f.group[2].id)?.title, 'Second');
  assert.equal(f.writes(), 2);
});

test('retry refuses to resurrect a group that has since been moved to archive or trash', async () => {
  for (const destination of ['archive', 'trash']) {
    const f = fixture();
    await f.store.createTaskGroup(f.group);
    f.files.set('tasks.json', []);
    f.files.set(destination === 'archive' ? 'tasks-archive.json' : 'tasks-trash.json',
      destination === 'archive' ? clone(f.group) : [{ id: 'deleted', deletedAt: 123, tasks: clone(f.group) }]);
    await assert.rejects(f.store.createTaskGroup(f.group), /移走或删除/);
    assert.deepEqual(f.files.get('tasks.json'), []);
    assert.equal(f.writes(), 1);
  }
});
