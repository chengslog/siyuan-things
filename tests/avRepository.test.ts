import test from 'node:test';
import assert from 'node:assert/strict';
import { AVRepository, AVConflictError, decodeCell, encodeCell, stripBlockAttributes } from '../src/storage/avRepository.ts';
import { TABLE_NAMES, TABLES, getTableSpecs } from '../src/storage/avSchema.ts';
import type { Binding } from '../src/storage/bootstrap.ts';
import type { LegacySnapshot } from '../src/storage/preflight.ts';
import { memoryCodec, memoryNativeDocuments, nodeId, splitRoots } from './helpers/nativeNotesMemory.ts';
import { RichNotes } from '../src/storage/richNotes.ts';

(globalThis as any).Lute = { New: () => memoryCodec };

const clone = (value: any) => JSON.parse(JSON.stringify(value));
const empty = (): LegacySnapshot => ({ tasks: [], archived: [], trash: [], projects: [], areas: [], tags: [] });
const task = (id: string, changes: any = {}) => ({ id, title: 'Task', notes: '', status: 'todo', priority: 'none', created: 1700000000123,
  updated: 1700000000456, tags: [], order: 0, ...changes });

function setup(version: 1 | 2 = 1) {
  const tables: any = {}, documents = new Map<string, string>();
  const native = memoryNativeDocuments(documents);
  const binding: Binding = { schemaVersion: version, notebookId: '20261028000000-notebok', docId: '20261028000000-center0', tables: {} as any };
  let writes = 0;
  for (const name of TABLE_NAMES) {
    const schema = getTableSpecs(version)[name];
    const keys = Object.fromEntries([schema.titleField, ...schema.columns.map(column => column.field)].map(field => [field, `${name}-${field}`]));
    binding.tables[name] = { avId: name, blockId: `${name}-block`, keys };
    tables[name] = { id: name, keyValues: [
      { key: { id: keys[schema.titleField], type: 'block' }, values: [] },
      ...schema.columns.map(column => ({ key: { id: keys[column.field], type: column.type }, values: [] })),
    ] };
  }
  const client: any = {
    async getAV(id: string) { return clone(tables[id]); },
    async addRow(avId: string, id: string, title: string) {
      const primary = tables[avId].keyValues[0];
      if (!primary.values.some((value: any) => value.blockID === id)) primary.values.push({ blockID: id, type: 'block', isDetached: true, block: { content: title } });
      writes++;
    },
    async setCells(avId: string, cells: any[]) {
      for (const patch of cells) {
        const entry = tables[avId].keyValues.find((entry: any) => entry.key.id === patch.keyID);
        assert.ok(entry, `missing column ${patch.keyID}`);
        const value = { ...clone(patch.value), blockID: patch.itemID, keyID: patch.keyID };
        const index = entry.values.findIndex((old: any) => old.blockID === patch.itemID);
        if (index < 0) entry.values.push(value); else entry.values[index] = value;
      }
      writes++;
    },
    async removeRows(avId: string, ids: string[]) {
      for (const entry of tables[avId].keyValues) entry.values = entry.values.filter((value: any) => !ids.includes(value.blockID));
      writes++;
    },
    async request(path: string, body: any) {
      if (path === '/api/sqlite/flushTransaction') return null;
      if (path === '/api/query/sql') {
        const id = body.stmt.match(/id = '([^']+)'/)[1];
        return documents.has(id) ? [{ id, type: 'd', box: binding.notebookId }] : [];
      }
      if (path === '/api/filetree/createDocWithMd') { documents.set(body.id, body.markdown); return body.id; }
      if (['/api/attr/getBlockAttrs', '/api/attr/setBlockAttrs', '/api/block/getBlockDOM', '/api/block/checkBlocksExist', '/api/transactions'].includes(path)) return native.request(path, body);
      if (path === '/api/block/getBlockKramdown') {
        if (!documents.has(body.id)) throw new Error('Missing notes document');
        return { kramdown: documents.get(body.id) };
      }
      if (path === '/api/block/getChildBlocks') return [{ id: body.id, type: 'p' }];
      if (path === '/api/block/updateBlock') { documents.set(body.id, body.data); return []; }
      throw new Error(`Unexpected request ${path}`);
    },
  };
  const item = (table: string, id: string) => tables[table].keyValues.find((entry: any) => entry.key.id === `${table}-id`).values.find((value: any) => value.text.content === id)?.blockID;
  async function change(table: string, id: string, field: string, type: string, value: any) {
    await client.setCells(table, [{ itemID: item(table, id), keyID: `${table}-${field}`, value: encodeCell(type, value) }]);
  }
  return { binding, client, tables, documents, native, item, change, writes: () => writes, repo: new AVRepository(client, binding) };
}

const richNotes = new RichNotes(() => memoryCodec);
function richCell(env: ReturnType<typeof setup>, table: string, id: string, field: string): any {
  return env.tables[table].keyValues.find((entry: any) => entry.key.id === `${table}-${field}`).values.find((cell: any) => cell.blockID === env.item(table, id));
}

test('V2 imports and edits rich notes and images without creating documents; native edits remain authoritative', async () => {
  const env = setup(2), source = empty();
  source.tasks = [task('one', { notes: '**Original**\n\n![image](assets/one.png)\n' })];
  await env.repo.import(source);
  assert.deepEqual(await env.repo.load(), source);
  assert.equal(env.documents.size, 0);
  assert.ok(richCell(env, 'tasks', 'one', 'notes').text.rich);
  assert.equal(richCell(env, 'tasks', 'one', 'notesAssets').mAsset.length, 1);
  await env.repo.import(source);
  const stale = await env.repo.load();
  await env.change('tasks', 'one', 'notesAssets', 'mAsset', []);
  stale.tasks[0].title = 'Unrelated title';
  await env.repo.saveSnapshot(stale);
  const current = await env.repo.load();
  assert.doesNotMatch(current.tasks[0].notes, /!\[/);
  assert.equal(current.tasks[0].title, 'Unrelated title');
  current.tasks[0].notes = '';
  await env.repo.saveSnapshot(current);
  assert.equal(richCell(env, 'tasks', 'one', 'notes').text.rich, null);
  assert.equal(env.documents.size, 0);
});

test('V2 preflight rejects unsupported new and existing notes without writes', async () => {
  const env = setup(2), source = empty(); source.tasks = [task('one')];
  await env.repo.import(source); const base = await env.repo.load(), writes = env.writes();
  const bad = clone(base); bad.tasks[0].notes = '```mermaid\ngraph TD\n```';
  await assert.rejects(env.repo.preflightSnapshot(bad, base), /不支持/);
  const newBad = clone(base); newBad.tasks.push(task('new', { notes: bad.tasks[0].notes }));
  await assert.rejects(env.repo.preflightSnapshot(newBad, base), /不支持/);
  assert.equal(env.writes(), writes);
});

test('V2 same-field native conflicts stop saves while native rich styles survive unrelated edits', async () => {
  const env = setup(2), source = empty(); source.tasks = [task('one', { notes: 'Original' })];
  await env.repo.import(source); const base = await env.repo.load(), wanted = clone(base);
  wanted.tasks[0].notes = 'Plugin';
  const native = richNotes.prepare('**Native**');
  await env.client.setCells('tasks', [{ itemID: env.item('tasks', 'one'), keyID: 'tasks-notes', value: native.cell }]);
  await assert.rejects(env.repo.preflightSnapshot(wanted, base), AVConflictError);
  await assert.rejects(env.repo.saveSnapshot(wanted, base), AVConflictError);
  const stale = clone(base); stale.tasks[0].title = 'Renamed';
  const before = clone(richCell(env, 'tasks', 'one', 'notes'));
  await env.repo.saveSnapshot(stale, base);
  assert.deepEqual(richCell(env, 'tasks', 'one', 'notes'), before);
  assert.equal((await env.repo.load()).tasks[0].notes, '**Native**');
});

test('V2 recovery finishes either partially written note column after response loss', async () => {
  for (const which of ['notes', 'notesAssets']) {
    const env = setup(2), source = empty(); source.tasks = [task('one', { notes: '![old](assets/old.png)' })];
    await env.repo.import(source); const base = await env.repo.load(), desired = clone(base);
    desired.tasks[0].notes = 'New ![new](assets/new.png)';
    const original = env.client.setCells;
    let failed = false;
    env.client.setCells = async (av: string, cells: any[]) => {
      if (!failed && cells.some(cell => cell.keyID === `tasks-${which}`)) {
        failed = true;
        await original(av, cells.filter(cell => cell.keyID === `tasks-${which}`));
        throw new Error('lost partial response');
      }
      return original(av, cells);
    };
    await assert.rejects(env.repo.saveSnapshot(desired, base), /lost partial/);
    await assert.rejects(new AVRepository(env.client, env.binding).load(), /尚未完成/);
    env.client.setCells = original;
    const recovered = new AVRepository(env.client, env.binding);
    await recovered.recoverPending(base, desired);
    assert.deepEqual(await recovered.load(), desired);
    assert.equal(JSON.parse(richCell(env, 'tasks', 'one', 'extra').text.content).richNotes.pending, undefined);
    assert.equal(env.documents.size, 0);
  }
});

test('V2 new-row import resumes after rich cells committed and metadata completion response is lost', async () => {
  const env = setup(2), source = empty(); source.tasks = [task('one', { notes: '![photo](assets/photo.png)' })];
  const original = env.client.setCells;
  let failed = false;
  env.client.setCells = async (av: string, cells: any[]) => {
    await original(av, cells);
    if (!failed && cells.some(cell => cell.keyID === 'tasks-notes')) { failed = true; throw new Error('lost response'); }
  };
  await assert.rejects(env.repo.import(source), /lost response/);
  env.client.setCells = original;
  await new AVRepository(env.client, env.binding).import(source);
  assert.deepEqual(await new AVRepository(env.client, env.binding).load(), source);
  assert.equal(env.documents.size, 0);
});

test('V2 migration only adds notes cells; V1 documents and snapshot are unchanged and rerun is idempotent', async () => {
  const env = setup(1), source = empty();
  source.tasks = [task('one', { notes: '**Legacy**\n\n![old](assets/old.png)' })];
  source.projects = [{ id: 'project', name: 'Project', notes: 'Project notes', headings: [], status: 'active', created: 1, updated: 1, order: 0 }];
  source.trash = [{ id: 'trash', deletedAt: 1, tasks: [task('removed', { notes: 'Frozen' })] }];
  await env.repo.import(source);
  const oldDocuments = clone([...env.documents]), oldBinding = clone(env.binding), nextBinding = clone(env.binding);
  nextBinding.schemaVersion = 2;
  for (const table of ['tasks', 'projects', 'areas', 'trashItems']) for (const field of ['notes', 'notesAssets']) {
    const key = `${table}-${field}`, type = field === 'notes' ? 'text' : 'mAsset';
    nextBinding.tables[table].keys[field] = key;
    env.tables[table].keyValues.push({ key: { id: key, type }, values: [] });
  }
  const next = new AVRepository(env.client, nextBinding);
  await next.migrateNotesFromV1(source);
  assert.deepEqual(await next.load(), source);
  assert.deepEqual(await new AVRepository(env.client, oldBinding).load(), source);
  assert.deepEqual([...env.documents], oldDocuments);
  const before = JSON.stringify(env.tables);
  await next.migrateNotesFromV1(source);
  assert.equal(JSON.stringify(env.tables), before);
});

test('V2 checks again immediately before and after reserving each rich write', async () => {
  for (const moment of ['before', 'after']) {
    const env = setup(2), source = empty(); source.tasks = [task('one', { notes: 'Original' })];
    await env.repo.import(source); const base = await env.repo.load(), desired = clone(base);
    desired.tasks[0].notes = 'Plugin';
    const original = env.client.setCells, getAV = env.client.getAV;
    let reads = 0, edited = false;
    const edit = async () => { edited = true; await original('tasks', [{ itemID: env.item('tasks', 'one'), keyID: 'tasks-notes', value: richNotes.prepare('Native raced').cell }]); };
    if (moment === 'before') env.client.getAV = async (av: string) => {
      if (av === 'tasks' && ++reads === 4) await edit();
      return getAV(av);
    };
    else env.client.setCells = async (av: string, cells: any[]) => {
      await original(av, cells);
      if (!edited && cells.some(cell => cell.keyID === 'tasks-extra' && JSON.parse(cell.value.text.content).richNotes?.pending)) await edit();
    };
    await assert.rejects(env.repo.saveSnapshot(desired, base), AVConflictError);
    assert.equal(edited, true);
    assert.equal(richCell(env, 'tasks', 'one', 'notes').text.rich.content, 'Native raced');
  }
});

test('native values preserve zero, negative fractions, millisecond dates and true emptiness', () => {
  for (const value of [0, -0.5, 17]) assert.equal(decodeCell('number', encodeCell('number', value)), value);
  for (const value of [0, 1793156400123, undefined]) assert.equal(decodeCell('date', encodeCell('date', value)), value);
  assert.throws(() => decodeCell('date', { date: { hasEndDate: true, content: 1 } }), /日期区间/);
  assert.equal(stripBlockAttributes('a\n{: id="x"}\n\n```\n{: literal="kept"}\n```\n'), 'a\n\n```\n{: literal="kept"}\n```');
});

test('all seven tables round-trip relationships, fields, original IDs, snapshots and notes', async () => {
  const env = setup(), snapshot = empty();
  snapshot.areas = [{ id: 'area', name: 'Same', notes: '', order: -0.5, created: 1, updated: 2, collapsedGroups: { active: true } }];
  snapshot.tags = [{ id: 'tag-a', name: 'Same', order: 0, color: '#112233' }, { id: 'tag-b', name: 'Same', parentId: 'tag-a', order: 0 }];
  snapshot.projects = [{ id: 'project', name: 'Same', notes: 'Project notes', status: 'onhold', areaId: 'area', created: 1, updated: 2, order: 0,
    deadline: 1793156400123, headings: [{ id: 'heading', title: 'Group', order: 0, collapsed: false }], groupOrder: ['none', 'heading'], collapsedGroups: { completed: true } }];
  snapshot.tasks = [task('main', { projectId: 'project', areaId: 'area', headingId: 'heading', notes: 'Simple notes', tags: ['tag-b', 'tag-a'],
    repeatRule: 'monthly', recurrenceSourceId: 'older', startDate: 1793156400123, deadline: 1793156400124, someday: false, blockId: 'old-note-block', customFuture: { intact: true } }),
  task('child', { parentId: 'main', priority: 'high' })];
  snapshot.archived = [task('older', { status: 'done', completedDate: 1700000000222, recurrenceGeneratedAt: 1700000000333 })];
  snapshot.trash = [{ id: 'same-batch', deletedAt: 1, tasks: [task('main', { title: 'Old version' })] },
    { id: 'same-batch', deletedAt: 2, tasks: [task('main', { title: 'Different version' })] }];
  await env.repo.import(snapshot);
  assert.deepEqual(await env.repo.load(), snapshot);
  const ids = env.tables.tasks.keyValues.find((entry: any) => entry.key.id === 'tasks-id').values.map((value: any) => value.blockID);
  assert.ok(ids.every((id: string) => !['main', 'child', 'older'].includes(id)));
  assert.equal(env.documents.size, 2);
  const before = JSON.stringify(env.tables);
  await env.repo.import(snapshot);
  assert.equal(JSON.stringify(env.tables), before);
  assert.equal(env.documents.size, 2);
});

test('missing legacy references survive import as explicit unresolved metadata', async () => {
  const env = setup(), snapshot = empty();
  snapshot.tasks = [task('orphan', { projectId: 'missing', parentId: 'missing-parent', tags: ['missing-tag'] })];
  await env.repo.import(snapshot);
  assert.deepEqual(await env.repo.load(), snapshot);
});

test('saving a stale full collection preserves a disjoint native edit and rejects same-field conflicts', async () => {
  const env = setup(), source = empty(); source.tasks = [task('one')];
  await env.repo.import(source);
  const old = await env.repo.load();
  await env.change('tasks', 'one', 'priority', 'select', 'high');
  old.tasks[0].title = 'Plugin title';
  await env.repo.saveSnapshot(old);
  const merged = await env.repo.load();
  assert.equal(merged.tasks[0].priority, 'high');
  assert.equal(merged.tasks[0].title, 'Plugin title');
  await env.change('tasks', 'one', 'title', 'block', 'Native title');
  merged.tasks[0].title = 'Other plugin title';
  await assert.rejects(env.repo.saveSnapshot(merged), AVConflictError);
  assert.equal((await env.repo.load()).tasks[0].title, 'Native title');
});

test('archiving in one snapshot retains the same AV item and parent relation', async () => {
  const env = setup(), source = empty(); source.tasks = [task('parent'), task('child', { parentId: 'parent' })];
  await env.repo.import(source);
  const previous = env.item('tasks', 'parent');
  const snapshot = await env.repo.load(); snapshot.archived.push(snapshot.tasks.shift());
  await env.repo.saveSnapshot(snapshot);
  assert.equal(env.item('tasks', 'parent'), previous);
  assert.deepEqual(await env.repo.load(), snapshot);
});

test('deleted native rows are not resurrected by an unrelated stale save', async () => {
  const env = setup(), source = empty(); source.tasks = [task('removed'), task('kept')];
  await env.repo.import(source);
  const stale = await env.repo.load();
  await env.client.removeRows('tasks', [env.item('tasks', 'removed')]);
  stale.tasks[1].title = 'Changed';
  await env.repo.saveSnapshot(stale);
  assert.deepEqual((await env.repo.load()).tasks.map((value: any) => value.id), ['kept']);
});

test('notes update preserves existing block IDs while adding paragraphs', async () => {
  const env = setup(), source = empty(); source.tasks = [task('one', { notes: 'Original' })];
  await env.repo.import(source);
  const next = await env.repo.load(); next.tasks[0].notes = 'New paragraph';
  await env.repo.saveSnapshot(next);
  assert.equal((await env.repo.load()).tasks[0].notes, 'New paragraph');
  const docId = [...env.documents.keys()][0];
  const oldId = nodeId(splitRoots((await env.client.request('/api/block/getBlockDOM', { id: docId })).dom)[0]);
  const changed = await env.repo.load(); changed.tasks[0].notes = 'First\n\nSecond';
  await env.repo.saveSnapshot(changed);
  assert.equal((await env.repo.load()).tasks[0].notes, 'First\n\nSecond');
  const roots = splitRoots((await env.client.request('/api/block/getBlockDOM', { id: docId })).dom);
  assert.equal(roots.length, 2);
  assert.equal(nodeId(roots[0]), oldId);
});

test('schema column loss and duplicate IDs fail explicitly rather than appearing as empty data', async () => {
  const env = setup(), source = empty(); source.tasks = [task('one')]; await env.repo.import(source);
  env.tables.tasks.keyValues = env.tables.tasks.keyValues.filter((entry: any) => entry.key.id !== 'tasks-status');
  await assert.rejects(env.repo.load(), /列被删除/);
});

test('a named native row is adopted once with valid defaults, while an empty draft stays untouched', async () => {
  const env = setup();
  await env.client.addRow('tasks', '20261028000000-native1', 'Native task');
  await env.client.addRow('tasks', '20261028000000-native2', '');
  const first = await env.repo.load();
  assert.equal(first.tasks.length, 1);
  assert.equal(first.tasks[0].title, 'Native task');
  assert.equal(first.tasks[0].status, 'todo');
  assert.equal(first.tasks[0].priority, 'none');
  assert.deepEqual(first.tasks[0].tags, []);
  assert.deepEqual(await env.repo.load(), first);
  assert.equal(env.tables.tasks.keyValues[0].values.length, 2);
});

test('import resumes if row creation succeeded but identity or other cell writes failed', async () => {
  for (const failureAt of [1, 3]) {
    const env = setup(), snapshot = empty(); snapshot.tasks = [task('one'), task('two')];
    const write = env.client.setCells.bind(env.client);
    let calls = 0;
    env.client.setCells = async (...args: any[]) => { if (++calls === failureAt) throw new Error('Injected interruption'); return write(...args); };
    await assert.rejects(env.repo.import(snapshot), /Injected/);
    env.client.setCells = write;
    await env.repo.import(snapshot);
    assert.deepEqual(await env.repo.load(), snapshot);
    assert.equal(env.tables.tasks.keyValues[0].values.length, 2);
  }
});

test('native clears of dates and relations are authoritative, not restored from metadata', async () => {
  const env = setup(), snapshot = empty();
  snapshot.tasks = [task('parent'), task('one', { parentId: 'parent', startDate: 1793156400123 })];
  await env.repo.import(snapshot);
  await env.change('tasks', 'one', 'parentId', 'relation', []);
  await env.change('tasks', 'one', 'startDate', 'date', undefined);
  const result = await env.repo.load();
  assert.equal(result.tasks[1].parentId, undefined);
  assert.equal(result.tasks[1].startDate, undefined);
});

test('a lost note-creation response resumes from its persisted intent without duplicating notes', async () => {
  const env = setup(), source = empty(); source.tasks = [task('one', { notes: 'First\n\nSecond' })];
  const request = env.client.request.bind(env.client);
  let failed = false;
  env.client.request = async (path: string, body: any) => {
    const result = await request(path, body);
    if (path === '/api/filetree/createDocWithMd' && !failed) { failed = true; throw new Error('Lost response'); }
    return result;
  };
  await assert.rejects(env.repo.import(source), /Lost response/);
  const restarted = new AVRepository(env.client, env.binding);
  await restarted.import(source);
  assert.deepEqual(await restarted.load(), source);
  assert.equal(env.documents.size, 1);
});

test('restoring a recovery batch preserves its frozen history and hides it from pending batches', async () => {
  const env = setup(), source = empty();
  source.trash = [{ id: 'deleted', deletedAt: 100, tasks: [task('one')] }];
  await env.repo.import(source);
  const next = await env.repo.load();
  next.tasks = next.trash.pop().tasks;
  await env.repo.saveSnapshot(next);
  assert.deepEqual(await env.repo.load(), next);
  assert.equal(env.tables.trashItems.keyValues[0].values.length, 1);
  const state = env.tables.trashBatches.keyValues.find((entry: any) => entry.key.id === 'trashBatches-state').values[0];
  assert.equal(state.mSelect[0].content, 'restored');
  next.tasks[0].title = 'Restored and changed';
  await env.repo.saveSnapshot(next);
  assert.equal(env.tables.trashItems.keyValues[0].values.length, 1);
});

test('bound native blocks are never adopted even if nested isDetached incorrectly says true', async () => {
  const env = setup();
  await env.client.addRow('tasks', '20261028000000-bound00', 'Bound note');
  Object.assign(env.tables.tasks.keyValues[0].values[0], { isDetached: false, block: { content: 'Bound note', isDetached: true } });
  const before = env.writes();
  await assert.rejects(env.repo.load(), /非绑定行/);
  assert.equal(env.writes(), before);
  assert.equal(env.tables.tasks.keyValues.find((entry: any) => entry.key.id === 'tasks-id').values.length, 0);
});

test('retrying a complete import rejects native field or note edits before any write', async () => {
  for (const field of ['title', 'priority', 'notes']) {
    const env = setup(), source = empty(); source.tasks = [task('one', { notes: 'Imported note' })];
    await env.repo.import(source);
    if (field === 'notes') env.documents.set([...env.documents.keys()][0], 'Native note');
    else await env.change('tasks', 'one', field, field === 'title' ? 'block' : 'select', field === 'title' ? 'Native title' : 'high');
    const before = env.writes();
    await assert.rejects(new AVRepository(env.client, env.binding).import(source), AVConflictError);
    assert.equal(env.writes(), before);
    assert.equal((await env.repo.load()).tasks[0][field], field === 'notes' ? 'Native note' : field === 'title' ? 'Native title' : 'high');
  }
});

test('restoring an earlier duplicate-ID batch keeps later batch rows and note documents stable', async () => {
  const env = setup(), source = empty();
  source.trash = [
    { id: 'duplicate', deletedAt: 100, tasks: [task('same', { title: 'First', notes: 'Old first note' })] },
    { id: 'duplicate', deletedAt: 100, tasks: [task('same', { title: 'Second', notes: 'Old second note' })] },
  ];
  await env.repo.import(source);
  const laterItem = env.tables.trashItems.keyValues[0].values.find((cell: any) => cell.block.content === 'Second').blockID;
  const beforeDocs = [...env.documents.entries()];
  const next = await env.repo.load(); next.trash.shift();
  await env.repo.saveSnapshot(next);
  assert.deepEqual(await env.repo.load(), next);
  const laterItemAfter = env.tables.trashItems.keyValues[0].values.find((cell: any) => cell.block.content === 'Second').blockID;
  assert.equal(laterItemAfter, laterItem);
  assert.deepEqual([...env.documents.entries()], beforeDocs);
  assert.equal(env.tables.trashBatches.keyValues[0].values.length, 2);
  next.tasks = [task('new')];
  await env.repo.saveSnapshot(next);
  assert.deepEqual(await env.repo.load(), next);
  assert.deepEqual([...env.documents.entries()], beforeDocs);
});

test('adding the first note to an existing row clears its persisted pending marker', async () => {
  const env = setup(), source = empty(); source.tasks = [task('one')];
  await env.repo.import(source);
  const next = await env.repo.load(); next.tasks[0].notes = 'First note';
  await env.repo.saveSnapshot(next);
  assert.deepEqual(await env.repo.load(), next);
  const extra = env.tables.tasks.keyValues.find((entry: any) => entry.key.id === 'tasks-extra').values[0];
  assert.equal(JSON.parse(extra.text.content).notesPending, undefined);
});

test('a persisted ordinary note creation intent recovers after a lost document response', async () => {
  const env = setup(), source = empty(); source.tasks = [task('one')];
  await env.repo.import(source);
  const base = await env.repo.load(), desired = clone(base); desired.tasks[0].notes = 'First note';
  const request = env.client.request.bind(env.client);
  let failed = false;
  env.client.request = async (path: string, body: any) => {
    const result = await request(path, body);
    if (path === '/api/filetree/createDocWithMd' && !failed) { failed = true; throw new Error('Lost response'); }
    return result;
  };
  await assert.rejects(env.repo.saveSnapshot(desired, base), /Lost response/);
  const restarted = new AVRepository(env.client, env.binding);
  await restarted.recoverPending(base, desired);
  assert.deepEqual(await restarted.load(), desired);
  assert.equal(env.documents.size, 1);
});

test('ordinary recovery refuses complete new rows changed natively while the write was interrupted', async () => {
  const env = setup(), base = empty(), desired = empty(); desired.tasks = [task('one')];
  await env.repo.load();
  const write = env.client.setCells.bind(env.client);
  env.client.setCells = async (avId: string, cells: any[]) => {
    await write(avId, cells);
    if (cells.some((cell: any) => cell.keyID === 'tasks-presence')) throw new Error('Lost complete response');
  };
  await assert.rejects(env.repo.saveSnapshot(desired, base), /Lost complete/);
  env.client.setCells = write;
  await env.change('tasks', 'one', 'title', 'block', 'Native edit');
  const before = env.writes();
  await assert.rejects(new AVRepository(env.client, env.binding).recoverPending(base, desired), AVConflictError);
  assert.equal(env.writes(), before);
  assert.equal((await env.repo.load()).tasks[0].title, 'Native edit');
});

test('ordinary recovery completes a new related heading after the task row already committed', async () => {
  const env = setup(), base = empty(), desired = empty();
  desired.projects = [{ id: 'project', name: 'Project', notes: '', status: 'active', created: 1, updated: 1, order: 0,
    headings: [{ id: 'heading', title: 'Group', order: 0 }] }];
  desired.tasks = [task('one', { projectId: 'project', headingId: 'heading' })];
  await env.repo.load();
  const write = env.client.setCells.bind(env.client);
  env.client.setCells = async (avId: string, cells: any[]) => {
    if (cells.some((cell: any) => cell.keyID === 'headings-presence')) throw new Error('Heading write interrupted');
    await write(avId, cells);
  };
  await assert.rejects(env.repo.saveSnapshot(desired, base), /Heading write/);
  env.client.setCells = write;
  const restarted = new AVRepository(env.client, env.binding);
  await restarted.recoverPending(base, desired);
  assert.deepEqual(await restarted.load(), desired);
});

test('a native new row is reconciled during an existing Store save and before pending recovery load', async () => {
  for (const restart of [false, true]) {
    const env = setup(), source = empty(); source.tasks = [task('one')];
    await env.repo.import(source);
    const base = await env.repo.load(), desired = clone(base); desired.tasks[0].title = 'Plugin changed';
    await env.client.addRow('tasks', '20261028000000-native1', 'Native addition');
    if (restart) await new AVRepository(env.client, env.binding).recoverPending(base, desired);
    else await env.repo.saveSnapshot(desired, base);
    const actual = await env.repo.load();
    assert.equal(actual.tasks.length, 2);
    assert.equal(actual.tasks[0].title, 'Plugin changed');
    assert.equal(actual.tasks[1].title, 'Native addition');
  }
});

test('partial new rows retain native changes to their already written title or nonempty cells', async () => {
  for (const field of ['title', 'priority']) {
    const env = setup(), base = empty(), desired = empty(); desired.tasks = [task('one')];
    await env.repo.load();
    const write = env.client.setCells.bind(env.client);
    let calls = 0;
    env.client.setCells = async (...args: any[]) => { if (++calls === 2) throw new Error('Partial interruption'); return write(...args); };
    await assert.rejects(env.repo.saveSnapshot(desired, base), /Partial interruption/);
    env.client.setCells = write;
    await env.change('tasks', 'one', field, field === 'title' ? 'block' : 'select', field === 'title' ? 'Native title' : 'high');
    const before = JSON.stringify(env.tables);
    await assert.rejects(new AVRepository(env.client, env.binding).recoverPending(base, desired), AVConflictError);
    assert.equal(JSON.stringify(env.tables), before);
  }
});

test('unknown legacy fields that share system-column names survive import and later changes', async () => {
  const env = setup(), source = empty();
  source.tasks = [task('one', { sourceIndex: 'extension order', storageState: 'future state', notesDocId: 'future extension', extra: { retained: true }, headings: ['future'] })];
  source.tags = [{ id: 'tag', name: 'Tag', order: 0, notes: 'Unknown tag extension' }];
  await env.repo.import(source);
  assert.deepEqual(await env.repo.load(), source);
  const desired = clone(source); desired.tasks[0].title = 'Updated'; desired.tasks[0].sourceIndex = 'changed extension';
  await env.repo.saveSnapshot(desired, source);
  assert.deepEqual(await env.repo.load(), desired);
  assert.equal(env.documents.size, 0);
});

test('import accepts the same empty note after editing and clearing its owned document', async () => {
  const env = setup(), source = empty(); source.tasks = [task('one')];
  await env.repo.import(source);
  const withNote = await env.repo.load(); withNote.tasks[0].notes = 'Temporary note';
  await env.repo.saveSnapshot(withNote);
  const cleared = await env.repo.load(); cleared.tasks[0].notes = '';
  await env.repo.saveSnapshot(cleared);
  assert.deepEqual(await env.repo.load(), source);
  const before = JSON.stringify(env.tables);
  await env.repo.import(source);
  assert.equal(JSON.stringify(env.tables), before);
  assert.equal(env.documents.size, 1);
});

test('ordinary saves preserve the project headings marker and imports tolerate an older missing marker', async () => {
  const env = setup(), source = empty();
  source.projects = [{ id: 'project', name: 'Project', notes: '', status: 'active', created: 1, updated: 1, order: 0,
    headings: [{ id: 'heading', title: 'Group', order: 0 }] }];
  source.tasks = [task('one', { projectId: 'project', headingId: 'heading' })];
  await env.repo.import(source);
  const desired = await env.repo.load(); desired.tasks[0].title = 'Updated task';
  await env.repo.saveSnapshot(desired);
  const presenceCell = () => env.tables.projects.keyValues.find((entry: any) => entry.key.id === 'projects-presence').values[0];
  assert.ok(JSON.parse(presenceCell().text.content).includes('headings'));
  await env.repo.import(desired);
  assert.deepEqual(await env.repo.load(), desired);

  const oldPresence = JSON.parse(presenceCell().text.content).filter((name: string) => name !== 'headings');
  await env.change('projects', 'project', 'presence', 'text', JSON.stringify(oldPresence));
  await env.repo.import(desired);
  assert.deepEqual(await env.repo.load(), desired);
  assert.ok(JSON.parse(presenceCell().text.content).includes('headings'));

  await env.change('headings', 'project:heading', 'title', 'block', 'Native changed group');
  const before = JSON.stringify(env.tables);
  await assert.rejects(env.repo.import(desired), AVConflictError);
  assert.equal(JSON.stringify(env.tables), before);
});

test('read-only preflight rejects unsupported native notes without writing recovery metadata or adopting new rows', async () => {
  const env = setup(), source = empty(); source.tasks = [task('one', { notes: 'Original' })];
  await env.repo.import(source);
  const docId = [...env.documents.keys()][0];
  env.native.doms.set(docId, env.native.sync(docId).replace('NodeParagraph', 'NodeTabs'));
  const base = await env.repo.load(), desired = clone(base); desired.tasks[0].notes = 'Changed';
  await env.client.addRow('tasks', '20261028000000-native1', 'Unidentified native task');
  const beforeTables = JSON.stringify(env.tables), beforeAttrs = JSON.stringify([...env.native.attrs]), writes = env.writes();
  await assert.rejects(env.repo.preflightSnapshot(desired, base), /无法安全映射|原生结构/);
  assert.equal(env.writes(), writes);
  assert.equal(JSON.stringify(env.tables), beforeTables);
  assert.equal(JSON.stringify([...env.native.attrs]), beforeAttrs);
  const titleOnly = clone(base); titleOnly.tasks[0].title = 'Unrelated task edit';
  await env.repo.preflightSnapshot(titleOnly, base);
  assert.equal(JSON.stringify(env.tables), beforeTables);
});

test('read-only note preflight detects native same-field conflicts and does not block an already matching draft', async () => {
  const env = setup(), source = empty(); source.tasks = [task('one', { notes: 'Original' })];
  await env.repo.import(source);
  const base = await env.repo.load(), desired = clone(base); desired.tasks[0].notes = 'User changed';
  const docId = [...env.documents.keys()][0]; env.documents.set(docId, 'Native changed');
  const before = JSON.stringify([...env.native.attrs]), writes = env.writes();
  await assert.rejects(env.repo.preflightSnapshot(desired, base), AVConflictError);
  assert.equal(env.writes(), writes);
  assert.equal(JSON.stringify([...env.native.attrs]), before);
  desired.tasks[0].notes = 'Native changed';
  await env.repo.preflightSnapshot(desired, base);
  assert.equal(env.writes(), writes);
});
