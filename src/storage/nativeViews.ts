import { newSiyuanId, SiYuanAVClient } from './avClient.ts';
import type { Binding, SettingsStore } from './bootstrap.ts';

export const NATIVE_TASK_VIEWS_FILE = 'things-native-task-views.json';
export const NATIVE_TASK_VIEW_NAMES = ['inbox', 'today', 'upcoming', 'anytime', 'someday', 'logbook'] as const;
export type NativeTaskViewName = typeof NATIVE_TASK_VIEW_NAMES[number];
type Filter = Record<string, any>;
export interface NativeTaskViewIds {
  views: Record<NativeTaskViewName, string>;
  projectStatusKey: string;
  unresolvedKey: string;
}
interface ViewIntent extends NativeTaskViewIds {
  avId: string;
  blockId: string;
  bindingKeys: string;
  originalViewId: string;
  helpersReady: boolean;
  ready: NativeTaskViewName[];
  complete: boolean;
}
interface ViewState { version: 1; databases: Record<string, ViewIntent> }
export interface TaskViewDefinition {
  name: string;
  desc: string;
  filters: Filter[];
  sorts: { column: string; order: 'ASC' | 'DESC' }[];
  visibleFields: string[];
}

const ID = /^\d{14}-[a-z0-9]{7}$/;
const inflight = new WeakMap<SettingsStore, Promise<NativeTaskViewIds>>();
const required = ['title', 'status', 'storageState', 'startDate', 'deadline', 'someday', 'completedDate',
  'parentId', 'projectId', 'areaId', 'extra', 'order'];
const and = (...filters: Filter[]): Filter => ({ combination: 'and', filters });
const or = (...filters: Filter[]): Filter => ({ combination: 'or', filters });
const leaf = (column: string, operator: string, value: any): Filter => ({ column, operator, value });
const selected = (column: string, content: string): Filter => leaf(column, '=', { type: 'select', mSelect: [{ content, color: '' }] });
const empty = (column: string, type: 'date' | 'relation'): Filter => leaf(column, 'Is empty',
  type === 'date' ? { type, date: { content: 0, isNotEmpty: false } } : { type, relation: { blockIDs: [] } });
const checked = (column: string, value: boolean): Filter => leaf(column, value ? 'Is true' : 'Is false', { type: 'checkbox', checkbox: { checked: value } });
// SiYuan evaluates this range in the local timezone on each render, including after midnight.
const today = (column: string, operator: string): Filter => ({
  column, operator, value: { type: 'date', date: { content: 0, isNotEmpty: true } },
  relativeDate: { count: 0, unit: 0, direction: 0 },
});

/** Native filters match TaskStore, including hidden subtasks and paused/canceled projects. */
export function taskViewDefinitions(binding: Binding, ids: NativeTaskViewIds): Record<NativeTaskViewName, TaskViewDefinition> {
  const k = binding.tables.tasks.keys;
  const noMissing = (field: string) => leaf(ids.unresolvedKey, 'Does not contains', { type: 'template', template: { content: field } });
  const noRelation = (field: string) => and(empty(k[field], 'relation'), noMissing(field));
  const root = () => [selected(k.storageState, 'active'), noRelation('parentId')];
  const pending = () => [...root(), selected(k.status, 'todo')];
  const projectVisible = or(empty(k.projectId, 'relation'), and(...['onhold', 'canceled'].map(status => ({
    ...leaf(ids.projectStatusKey, '=', { type: 'rollup', rollup: { contents: [{ type: 'select', mSelect: [{ content: status, color: '' }] }] } }),
    quantifier: 'None',
  }))));
  const actionable = () => [...pending(), checked(k.someday, false), projectVisible];
  const fields = ['title', 'status', 'startDate', 'deadline', 'projectId', 'tags', 'priority', 'notes', 'notesAssets'];
  const standardSort = [{ column: k.order, order: 'ASC' as const }];
  return {
    inbox: {
      name: '收件箱', desc: '未安排开始日期、项目或区域的待办任务。',
      filters: [and(...pending(), checked(k.someday, false), empty(k.startDate, 'date'), noRelation('projectId'), noRelation('areaId'))],
      sorts: standardSort, visibleFields: ['title', 'status', 'deadline', 'priority', 'tags', 'notes', 'notesAssets'],
    },
    today: {
      name: '今天', desc: '已到开始日期或今天截止的待办任务；日期随当天自动变化。',
      filters: [and(...actionable(), or(today(k.startDate, '<='), today(k.deadline, '=')))],
      sorts: standardSort, visibleFields: fields,
    },
    upcoming: {
      name: '计划', desc: '明天及以后开始，或尚未安排开始日期且未来截止的待办任务。',
      filters: [and(...actionable(), or(today(k.startDate, '>'), and(empty(k.startDate, 'date'), today(k.deadline, '>'))))],
      sorts: [{ column: k.startDate, order: 'ASC' }, { column: k.deadline, order: 'ASC' }, ...standardSort], visibleFields: fields,
    },
    anytime: {
      name: '随时', desc: '没有未来开始日期、现在可以处理的待办任务。',
      filters: [and(...actionable(), or(empty(k.startDate, 'date'), today(k.startDate, '<=')))],
      sorts: standardSort, visibleFields: fields,
    },
    someday: {
      name: '某天', desc: '暂存到某天再做的待办任务。',
      filters: [and(...pending(), checked(k.someday, true), projectVisible)],
      sorts: standardSort, visibleFields: ['title', 'status', 'someday', 'projectId', 'areaId', 'tags', 'notes', 'notesAssets'],
    },
    logbook: {
      name: '日志', desc: '已完成且尚未归档的主任务，按完成时间倒序排列。',
      filters: [and(...root(), selected(k.status, 'done'))],
      sorts: [{ column: k.completedDate, order: 'DESC' }], visibleFields: ['title', 'status', 'completedDate', 'projectId', 'tags', 'notes', 'notesAssets'],
    },
  };
}

/** Unresolved legacy relations remain semantically present until repaired; names are never identities. */
export function unresolvedRelationTemplate(extraKey: string): string {
  if (!ID.test(extraKey)) throw new Error('Things 原生视图的扩展字段 ID 无效');
  return `.action{$extra := index .id_mod "${extraKey}" | fromJson}`
    + '.action{if kindIs "map" $extra}.action{$missing := get $extra "unresolved"}'
    + '.action{if kindIs "map" $missing}'
    + ['parentId', 'projectId', 'areaId'].map(field => `.action{if get $missing "${field}"}${field} .action{end}`).join('')
    + '.action{end}.action{end}';
}

function bindingKeys(binding: Binding): string {
  const table = binding.tables.tasks;
  const ids = [...required.map(field => table.keys[field]), binding.tables.projects.avId, binding.tables.projects.keys.status];
  if (![table.avId, table.blockId, ...ids].every(id => typeof id === 'string' && ID.test(id))) {
    throw new Error('Things 原生任务视图缺少必要的数据库字段');
  }
  return ids.join(',');
}

function validateState(state: any): asserts state is ViewState {
  if (state?.version !== 1 || !state.databases || typeof state.databases !== 'object' || Array.isArray(state.databases)) {
    throw new Error('Things 原生视图初始化记录损坏');
  }
  for (const [avId, entry] of Object.entries(state.databases) as [string, any][]) {
    const ids = [entry?.avId, entry?.blockId, entry?.originalViewId, entry?.projectStatusKey, entry?.unresolvedKey,
      ...NATIVE_TASK_VIEW_NAMES.map(name => entry?.views?.[name])];
    if (avId !== entry?.avId || !ids.every(id => typeof id === 'string' && ID.test(id))
      || new Set(ids).size !== ids.length || typeof entry.bindingKeys !== 'string'
      || typeof entry.helpersReady !== 'boolean' || typeof entry.complete !== 'boolean'
      || !Array.isArray(entry.ready) || entry.ready.some((name: any) => !NATIVE_TASK_VIEW_NAMES.includes(name))
      || new Set(entry.ready).size !== entry.ready.length
      || (entry.complete && (!entry.helpersReady || entry.ready.length !== NATIVE_TASK_VIEW_NAMES.length))) {
      throw new Error('Things 原生视图初始化记录损坏');
    }
  }
}

function matches(actual: any, expected: any): boolean {
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((value, i) => matches(actual[i], value));
  if (expected && typeof expected === 'object') return !!actual && Object.entries(expected).every(([key, value]) => matches(actual[key], value));
  return actual === expected;
}
function hasFilters(filters: any[]): boolean {
  return (filters || []).some(filter => filter.combination ? hasFilters(filter.filters || []) : !!filter.column);
}
async function waitForAV(client: SiYuanAVClient, avId: string, predicate: (value: any) => boolean): Promise<any> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const av = await client.getAV(avId);
    if (predicate(av)) return av;
    await new Promise(resolve => setTimeout(resolve, 60 * (attempt + 1)));
  }
  throw new Error('Things 原生视图保存后尚未验证完成，下次启动可继续');
}
async function persist(storage: SettingsStore, state: ViewState): Promise<void> {
  await storage.saveData(NATIVE_TASK_VIEWS_FILE, state);
  if (JSON.stringify(await storage.loadData(NATIVE_TASK_VIEWS_FILE)) !== JSON.stringify(state)) {
    throw new Error('Things 原生视图初始化进度保存后核对失败');
  }
}

/** Only initial setup writes view configuration. Renames, filters, hidden columns and deleted views then belong to the user. */
export function ensureTaskViews(storage: SettingsStore, client: SiYuanAVClient, binding: Binding): Promise<NativeTaskViewIds> {
  const existing = inflight.get(storage);
  if (existing) return existing;
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const operation = () => ensureTaskViewsOnce(storage, client, binding);
  const pending: Promise<NativeTaskViewIds> = (async () => locks
    ? await locks.request('siyuan-things-native-task-views-v1', operation)
    : await operation())().finally(() => inflight.delete(storage));
  inflight.set(storage, pending);
  return pending;
}

async function ensureTaskViewsOnce(storage: SettingsStore, client: SiYuanAVClient, binding: Binding): Promise<NativeTaskViewIds> {
  const table = binding.tables.tasks;
  const fingerprint = bindingKeys(binding);
  const saved = await storage.loadData(NATIVE_TASK_VIEWS_FILE);
  const state: ViewState = saved === undefined || saved === null || saved === '' ? { version: 1, databases: {} } : saved;
  validateState(state);
  let intent = state.databases[table.avId];
  if (intent && (intent.blockId !== table.blockId || intent.bindingKeys !== fingerprint)) {
    throw new Error('Things 原生视图绑定发生变化，已停止以保护现有视图');
  }
  if (intent?.complete) return intent;
  let av = await client.getAV(table.avId);
  const projectKey = av.keyValues.find((entry: any) => entry.key.id === table.keys.projectId)?.key;
  if (projectKey?.relation?.avID !== binding.tables.projects.avId) throw new Error('Things 原生视图的项目关联指向错误');
  if (!intent) {
    const attrs = await client.request('/api/attr/getBlockAttrs', { id: table.blockId });
    const originalViewId = attrs?.['custom-sy-av-view'] || av.views?.[0]?.id;
    if (!av.views.some((view: any) => view.id === originalViewId)) throw new Error('Things 任务数据库缺少当前视图');
    intent = {
      avId: table.avId, blockId: table.blockId, bindingKeys: fingerprint, originalViewId,
      projectStatusKey: newSiyuanId(), unresolvedKey: newSiyuanId(), helpersReady: false, complete: false, ready: [],
      views: Object.fromEntries(NATIVE_TASK_VIEW_NAMES.map(name => [name, newSiyuanId()])) as Record<NativeTaskViewName, string>,
    };
    state.databases[table.avId] = intent;
    // Reserve identities before the first mutation, so a lost response can never create duplicates.
    await persist(storage, state);
  }

  if (!intent.helpersReady) {
    for (const [id, name, type] of [[intent.projectStatusKey, '项目状态（视图筛选）', 'rollup'], [intent.unresolvedKey, '历史关联（视图筛选）', 'template']]) {
      const existing = av.keyValues.find((entry: any) => entry.key.id === id)?.key;
      if (existing && existing.type !== type) throw new Error('Things 原生视图辅助字段已被修改');
      if (!existing) {
        await client.request('/api/av/addAttributeViewKey', { avID: table.avId, blockID: table.blockId, keyID: id, keyName: name, keyType: type, keyIcon: '', previousKeyID: '' });
        av = await client.getAV(table.avId);
      }
    }
    const rollup = av.keyValues.find((entry: any) => entry.key.id === intent.projectStatusKey)?.key.rollup;
    const template = av.keyValues.find((entry: any) => entry.key.id === intent.unresolvedKey)?.key.template;
    const expectedRollup = { relationKeyID: table.keys.projectId, keyID: binding.tables.projects.keys.status, calc: { operator: '' } };
    const expectedTemplate = unresolvedRelationTemplate(table.keys.extra);
    const ops: Record<string, unknown>[] = [];
    if (!matches(rollup, expectedRollup)) {
      if (rollup?.relationKeyID || rollup?.keyID) throw new Error('Things 项目状态辅助字段已被修改');
      ops.push({ action: 'updateAttrViewColRollup', avID: table.avId, id: intent.projectStatusKey,
        parentID: table.keys.projectId, keyID: binding.tables.projects.keys.status, data: { calc: { operator: '' } } });
    }
    if (template !== expectedTemplate) {
      if (template) throw new Error('Things 历史关联辅助字段已被修改');
      ops.push({ action: 'updateAttrViewColTemplate', avID: table.avId, id: intent.unresolvedKey, type: 'template', data: expectedTemplate });
    }
    // Only the new helper fields are hidden in existing views; all user columns stay untouched.
    for (const view of av.views) for (const id of [intent.projectStatusKey, intent.unresolvedKey]) {
      ops.push({ action: 'setAttrViewColHidden', avID: table.avId, blockID: table.blockId, viewID: view.id, id, data: true });
    }
    await client.transaction(ops);
    av = await waitForAV(client, table.avId, next => matches(next.keyValues.find((entry: any) => entry.key.id === intent.projectStatusKey)?.key.rollup, expectedRollup)
      && next.keyValues.find((entry: any) => entry.key.id === intent.unresolvedKey)?.key.template === expectedTemplate);
    intent.helpersReady = true;
    await persist(storage, state);
  }

  const definitions = taskViewDefinitions(binding, intent);
  const restore = { action: 'setAttrViewBlockView', avID: table.avId, blockID: table.blockId, id: intent.originalViewId };
  try {
    for (const name of NATIVE_TASK_VIEW_NAMES) {
      if (intent.ready.includes(name)) continue;
      const definition = definitions[name];
      const viewId = intent.views[name];
      const view = av.views.find((entry: any) => entry.id === viewId);
      if (view && (view.type !== 'table' || (hasFilters(view.filters) && !matches(view.filters, definition.filters)))) {
        throw new Error(`Things「${definition.name}」视图已被修改，未覆盖现有设置`);
      }
      // Filters are written last: an interrupted settings save can adopt the already completed view without resetting it.
      if (!view || !matches(view.filters, definition.filters)) {
        if (view && (view.name !== definition.name || (view.desc && view.desc !== definition.desc))) {
          throw new Error(`Things「${definition.name}」视图已被修改，未覆盖现有设置`);
        }
        const ops: Record<string, unknown>[] = [{
          action: view ? 'setAttrViewBlockView' : 'addAttrViewView', avID: table.avId, blockID: table.blockId,
          id: viewId, ...(view ? {} : { name: definition.name, layout: 'table' }),
        }];
        const visible = definition.visibleFields.map(field => table.keys[field]).filter(Boolean);
        for (const { key } of av.keyValues) ops.push({ action: 'setAttrViewColHidden', avID: table.avId, blockID: table.blockId, viewID: viewId, id: key.id, data: !visible.includes(key.id) });
        let previousID = '';
        for (const id of visible) {
          ops.push({ action: 'sortAttrViewCol', avID: table.avId, blockID: table.blockId, id, previousID });
          previousID = id;
        }
        for (const field of ['title', 'notes']) if (table.keys[field]) {
          ops.push({ action: 'setAttrViewColWrap', avID: table.avId, blockID: table.blockId, id: table.keys[field], data: true });
          ops.push({ action: 'setAttrViewColWidth', avID: table.avId, blockID: table.blockId, id: table.keys[field], data: field === 'title' ? '280px' : '360px' });
        }
        ops.push({ action: 'setAttrViewViewDesc', avID: table.avId, blockID: table.blockId, id: viewId, data: definition.desc });
        ops.push({ action: 'setAttrViewSorts', avID: table.avId, blockID: table.blockId, data: definition.sorts });
        ops.push({ action: 'setAttrViewFilters', avID: table.avId, blockID: table.blockId, data: definition.filters });
        ops.push(restore);
        // These legacy setters resolve the carrier's current view, ignoring operation.viewID.
        // Switching/configuring/restoring within one transaction keeps concurrent renders from redirecting writes.
        await client.transaction(ops);
        av = await waitForAV(client, table.avId, next => matches(next.views.find((entry: any) => entry.id === viewId)?.filters, definition.filters));
      }
      intent.ready.push(name);
      await persist(storage, state);
    }
  } finally {
    // A failed transaction may have reached the switch but not its final restore operation.
    for (let attempt = 0; attempt < 8; attempt++) {
      const attrs = await client.request('/api/attr/getBlockAttrs', { id: table.blockId });
      if (attrs?.['custom-sy-av-view'] === intent.originalViewId) break;
      if (attempt === 0) await client.transaction([restore]);
      if (attempt === 7) throw new Error('Things 原生视图已保存，但原选中视图尚未恢复，请重新打开数据库');
      await new Promise(resolve => setTimeout(resolve, 60 * (attempt + 1)));
    }
  }
  intent.complete = true;
  await persist(storage, state);
  return intent;
}
