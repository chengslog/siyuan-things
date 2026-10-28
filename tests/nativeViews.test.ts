import assert from 'node:assert/strict';
import test from 'node:test';
import { newSiyuanId, SiYuanAVClient } from '../src/storage/avClient.ts';
import { TABLES } from '../src/storage/avSchema.ts';
import type { Binding } from '../src/storage/bootstrap.ts';
import { ensureTaskViews, NATIVE_TASK_VIEW_NAMES, NATIVE_TASK_VIEWS_FILE, taskViewDefinitions } from '../src/storage/nativeViews.ts';

const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));
class Settings {
  data: any;
  failReady = -1;
  async loadData() { return clone(this.data); }
  async saveData(name: string, value: any) {
    assert.equal(name, NATIVE_TASK_VIEWS_FILE);
    if (Object.values(value.databases).some((entry: any) => entry.ready.length === this.failReady)) {
      this.failReady = -1;
      throw new Error('settings unavailable');
    }
    this.data = clone(value);
  }
}

/** Models kernel v3.8.8: filters/sorts/wrap/order address the carrier's current view, not operation.viewID. */
class Kernel {
  storage = new Settings();
  binding: Binding;
  av: any;
  selected: string;
  initialSelected: string;
  calls: { path: string; body: any }[] = [];
  failAfterAction = '';
  failAfterAddKey = false;
  client = new SiYuanAVClient(async (path, input) => {
    const body = input as any;
    this.calls.push({ path, body: clone(body) });
    if (path === '/api/av/getAttributeView') return { av: clone(this.av) };
    if (path === '/api/attr/getBlockAttrs') return { 'custom-sy-av-view': this.selected };
    if (path === '/api/av/addAttributeViewKey') {
      assert.equal(typeof body.previousKeyID, 'string');
      assert.ok(!this.av.keyValues.some((entry: any) => entry.key.id === body.keyID));
      this.av.keyValues.push({ key: { id: body.keyID, type: body.keyType, name: body.keyName }, values: [] });
      for (const view of this.av.views) view.table.columns.push({ id: body.keyID, hidden: false });
      if (this.failAfterAddKey) { this.failAfterAddKey = false; throw new Error('response lost'); }
      return null;
    }
    if (path === '/api/transactions') {
      for (const tx of body.transactions) for (const op of tx.doOperations) {
        this.apply(op);
        if (op.action === this.failAfterAction) { this.failAfterAction = ''; throw new Error('response lost'); }
      }
      return null;
    }
    throw new Error(`Unexpected request ${path}`);
  });
  constructor() {
    const tasks = { avId: newSiyuanId(), blockId: newSiyuanId(), keys: { title: newSiyuanId() } as Record<string, string> };
    const projects = { avId: newSiyuanId(), blockId: newSiyuanId(), keys: { status: newSiyuanId() } };
    for (const field of TABLES.tasks.columns) tasks.keys[field.field] = newSiyuanId();
    this.binding = { schemaVersion: 2, notebookId: newSiyuanId(), docId: newSiyuanId(), tables: { tasks, projects } } as Binding;
    const keys = [{ id: tasks.keys.title, name: '标题', type: 'block' }, ...TABLES.tasks.columns.map(field => ({
      id: tasks.keys[field.field], name: field.name, type: field.type,
      ...(field.field === 'projectId' ? { relation: { avID: projects.avId } } : {}),
    }))];
    const view = (name: string) => ({ id: newSiyuanId(), name, type: 'table', filters: [], sorts: [],
      table: { columns: keys.map(key => ({ id: key.id, hidden: false })) } });
    this.av = { id: tasks.avId, keyValues: keys.map(key => ({ key, values: [] })), views: [view('表格'), view('今天')] };
    this.selected = this.initialSelected = this.av.views[1].id;
    this.av.views[1].filters = [{ column: tasks.keys.title, operator: 'Contains', value: { type: 'block', block: { content: '用户设置' } } }];
  }
  apply(op: any) {
    const current = () => this.av.views.find((v: any) => v.id === this.selected);
    const key = () => this.av.keyValues.find((entry: any) => entry.key.id === op.id).key;
    if (op.action === 'addAttrViewView') {
      assert.ok(!this.av.views.some((v: any) => v.id === op.id), 'never add duplicate views');
      this.av.views.push({ id: op.id, name: op.name, type: 'table', filters: [], sorts: [],
        table: { columns: this.av.views[0].table.columns.map((col: any) => ({ id: col.id, hidden: false })) } });
      this.selected = op.id;
    } else if (op.action === 'setAttrViewBlockView') {
      assert.ok(this.av.views.some((v: any) => v.id === op.id)); this.selected = op.id;
    } else if (op.action === 'updateAttrViewColRollup') key().rollup = { relationKeyID: op.parentID, keyID: op.keyID, calc: op.data.calc };
    else if (op.action === 'updateAttrViewColTemplate') key().template = op.data;
    else if (op.action === 'setAttrViewColHidden') this.av.views.find((v: any) => v.id === op.viewID).table.columns.find((c: any) => c.id === op.id).hidden = op.data;
    else if (op.action === 'setAttrViewColWrap') current().table.columns.find((c: any) => c.id === op.id).wrap = op.data;
    else if (op.action === 'setAttrViewColWidth') current().table.columns.find((c: any) => c.id === op.id).width = op.data;
    else if (op.action === 'setAttrViewViewDesc') this.av.views.find((v: any) => v.id === op.id).desc = op.data;
    else if (op.action === 'setAttrViewSorts') current().sorts = clone(op.data);
    else if (op.action === 'setAttrViewFilters') current().filters = clone(op.data);
    else if (op.action === 'sortAttrViewCol') {
      const cols = current().table.columns;
      const [col] = cols.splice(cols.findIndex((c: any) => c.id === op.id), 1);
      cols.splice(op.previousID ? cols.findIndex((c: any) => c.id === op.previousID) + 1 : 0, 0, col);
    } else throw new Error(`Unexpected operation ${op.action}`);
  }
  ensure() { return ensureTaskViews(this.storage, this.client, this.binding); }
}

test('creates six distinct native views, preserves existing same-name views, wraps notes and hides only helpers in user views', async () => {
  const kernel = new Kernel();
  const original = clone(kernel.av.views);
  const ids = await kernel.ensure();
  assert.equal(kernel.av.views.length, 8);
  assert.equal(kernel.selected, kernel.initialSelected);
  for (const old of original) {
    const view = kernel.av.views.find((v: any) => v.id === old.id);
    assert.equal(view.name, old.name);
    assert.deepEqual(view.filters, old.filters);
    assert.deepEqual(view.table.columns.slice(0, old.table.columns.length), old.table.columns);
    assert.ok(view.table.columns.filter((c: any) => [ids.projectStatusKey, ids.unresolvedKey].includes(c.id)).every((c: any) => c.hidden));
  }
  const k = kernel.binding.tables.tasks.keys;
  for (const name of NATIVE_TASK_VIEW_NAMES) {
    const view = kernel.av.views.find((v: any) => v.id === ids.views[name]);
    const visible = view.table.columns.filter((c: any) => !c.hidden);
    assert.equal(visible[0].id, k.title);
    assert.ok(visible.find((c: any) => c.id === k.notes)?.wrap);
    assert.equal(view.table.columns.find((c: any) => c.id === k.extra).hidden, true);
    assert.equal(view.table.columns.find((c: any) => c.id === k.notesDocId).hidden, true);
    assert.equal(view.table.columns.find((c: any) => c.id === ids.projectStatusKey).hidden, true);
  }
});

test('finished setup does not touch renamed, reconfigured or deleted views on subsequent starts', async () => {
  const kernel = new Kernel(); const ids = await kernel.ensure();
  const view = kernel.av.views.find((v: any) => v.id === ids.views.today);
  view.name = '我的今天'; view.filters = []; view.sorts = []; view.table.columns.reverse();
  kernel.av.views = kernel.av.views.filter((v: any) => v.id !== ids.views.inbox);
  const before = clone(kernel.av); const calls = kernel.calls.length;
  await kernel.ensure();
  assert.deepEqual(kernel.av, before);
  assert.equal(kernel.calls.length, calls);
});

test('lost key creation response reuses the reserved helper identity', async () => {
  const kernel = new Kernel(); kernel.failAfterAddKey = true;
  await assert.rejects(kernel.ensure(), /response lost/);
  await kernel.ensure();
  assert.equal(kernel.av.keyValues.length, TABLES.tasks.columns.length + 3);
  assert.equal(kernel.av.views.length, 8);
});

test('interrupted view creation restores the original selection and retries without duplicates', async () => {
  const kernel = new Kernel(); kernel.failAfterAction = 'addAttrViewView';
  await assert.rejects(kernel.ensure(), /response lost/);
  assert.equal(kernel.selected, kernel.initialSelected);
  await kernel.ensure();
  assert.equal(kernel.av.views.length, 8);
  assert.equal(kernel.selected, kernel.initialSelected);
});

test('lost filter response resumes without resetting already configured columns', async () => {
  const kernel = new Kernel(); kernel.failAfterAction = 'setAttrViewFilters';
  await assert.rejects(kernel.ensure(), /response lost/);
  const intent = kernel.storage.data.databases[kernel.av.id];
  const view = kernel.av.views.find((v: any) => v.id === intent.views.inbox);
  view.table.columns[0].width = '777px';
  await kernel.ensure();
  assert.equal(view.table.columns[0].width, '777px');
  assert.equal(kernel.av.views.length, 8);
});

test('lost completion checkpoint adopts configured views without replacing user formatting', async () => {
  const kernel = new Kernel(); kernel.storage.failReady = 1;
  await assert.rejects(kernel.ensure(), /settings unavailable/);
  const intent = kernel.storage.data.databases[kernel.av.id];
  const view = kernel.av.views.find((v: any) => v.id === intent.views.inbox);
  view.name = '已自行改名'; view.table.columns[0].width = '700px';
  await kernel.ensure();
  assert.equal(view.name, '已自行改名');
  assert.equal(view.table.columns[0].width, '700px');
});

test('unfinished but user-modified filters are never overwritten', async () => {
  const kernel = new Kernel(); kernel.failAfterAction = 'addAttrViewView';
  await assert.rejects(kernel.ensure());
  const intent = kernel.storage.data.databases[kernel.av.id];
  const view = kernel.av.views.find((v: any) => v.id === intent.views.inbox);
  view.filters = [{ column: kernel.binding.tables.tasks.keys.title, operator: 'Contains', value: { type: 'block', block: { content: 'keep' } } }];
  const filters = clone(view.filters);
  await assert.rejects(kernel.ensure(), /未覆盖现有设置/);
  assert.deepEqual(view.filters, filters);
  assert.equal(kernel.selected, kernel.initialSelected);
});

test('concurrent callers share setup and corrupt state or changed binding fails before writes', async () => {
  const kernel = new Kernel();
  await Promise.all([kernel.ensure(), kernel.ensure(), kernel.ensure()]);
  assert.equal(kernel.av.views.length, 8);
  kernel.binding.tables.tasks.keys.extra = newSiyuanId();
  let count = kernel.calls.length;
  await assert.rejects(kernel.ensure(), /绑定发生变化/);
  assert.equal(kernel.calls.length, count);
  kernel.storage.data.version = 999;
  count = kernel.calls.length;
  await assert.rejects(kernel.ensure(), /记录损坏/);
  assert.equal(kernel.calls.length, count);
});

test('empty-string plugin settings mean first install and an unacknowledged intent blocks all database writes', async () => {
  const kernel = new Kernel(); kernel.storage.data = '';
  await kernel.ensure();
  assert.equal(kernel.av.views.length, 8);
  const rejected = new Kernel();
  rejected.storage.saveData = async () => undefined;
  await assert.rejects(rejected.ensure(), /保存后核对失败/);
  assert.ok(rejected.calls.every(call => ['/api/av/getAttributeView', '/api/attr/getBlockAttrs'].includes(call.path)));
});

/** Small independent evaluator for the documented native filter subset used by these views. */
function accepts(filter: any, values: Record<string, any>, now: number): boolean {
  if (filter.combination) return filter.combination === 'and'
    ? filter.filters.every((f: any) => accepts(f, values, now)) : filter.filters.some((f: any) => accepts(f, values, now));
  const value = values[filter.column];
  if (filter.relativeDate) {
    assert.deepEqual(filter.relativeDate, { count: 0, unit: 0, direction: 0 });
    const date = new Date(now); date.setHours(0, 0, 0, 0);
    const start = date.getTime(); date.setDate(date.getDate() + 1); const end = date.getTime() - 1;
    if (!value) return false;
    return filter.operator === '=' ? value >= start && value <= end : filter.operator === '<=' ? value <= end : value > end;
  }
  if (filter.operator === 'Is empty') return !value || (Array.isArray(value) && !value.length);
  if (filter.operator === 'Is true') return !!value;
  if (filter.operator === 'Is false') return !value;
  if (filter.operator === 'Does not contains') return !String(value || '').includes(filter.value.template.content);
  if (filter.value.type === 'rollup') return !(value || []).includes(filter.value.rollup.contents[0].mSelect[0].content);
  return value === filter.value.mSelect[0].content;
}

test('relative day filters roll over without rewrites and preserve overlapping deadline-only views', async () => {
  const kernel = new Kernel(); const ids = await kernel.ensure();
  const defs = taskViewDefinitions(kernel.binding, ids); const k = kernel.binding.tables.tasks.keys;
  const day = new Date(2026, 9, 28, 12).getTime(), next = new Date(2026, 9, 29, 12).getTime();
  const values = { [k.status]: 'todo', [k.storageState]: 'active', [k.deadline]: next };
  const views = (now: number) => NATIVE_TASK_VIEW_NAMES.filter(name => accepts(defs[name].filters[0], values, now));
  assert.deepEqual(views(day), ['inbox', 'upcoming', 'anytime']);
  assert.deepEqual(views(next), ['inbox', 'today', 'anytime']);
  assert.deepEqual(views(new Date(2026, 9, 30, 12).getTime()), ['inbox', 'anytime']);
  values[k.startDate] = next;
  assert.deepEqual(views(day), ['upcoming']);
  assert.deepEqual(views(next), ['today', 'anytime']);
});

test('project status, archived rows, canceled tasks and unresolved parents match plugin visibility', async () => {
  const kernel = new Kernel(); const ids = await kernel.ensure();
  const defs = taskViewDefinitions(kernel.binding, ids); const k = kernel.binding.tables.tasks.keys;
  const now = new Date(2026, 9, 28, 12).getTime();
  const base = { [k.status]: 'todo', [k.storageState]: 'active', [k.startDate]: now };
  const views = (values: any) => NATIVE_TASK_VIEW_NAMES.filter(name => accepts(defs[name].filters[0], values, now));
  for (const state of ['active', 'completed']) assert.deepEqual(views({ ...base, [k.projectId]: ['p'], [ids.projectStatusKey]: [state] }), ['today', 'anytime']);
  for (const state of ['onhold', 'canceled']) assert.deepEqual(views({ ...base, [k.projectId]: ['p'], [ids.projectStatusKey]: [state] }), []);
  assert.deepEqual(views({ ...base, [ids.unresolvedKey]: 'parentId ' }), []);
  assert.deepEqual(views({ ...base, [k.parentId]: ['parent'] }), []);
  assert.deepEqual(views({ ...base, [k.storageState]: 'archived' }), []);
  assert.deepEqual(views({ ...base, [k.status]: 'canceled' }), []);
  assert.deepEqual(views({ ...base, [k.status]: 'done', [k.projectId]: ['p'], [ids.projectStatusKey]: ['onhold'] }), ['logbook']);
  assert.deepEqual(views({ ...base, [k.startDate]: undefined, [ids.unresolvedKey]: 'projectId ' }), ['anytime']);
  assert.deepEqual(views({ ...base, [k.someday]: true }), ['someday']);
});
