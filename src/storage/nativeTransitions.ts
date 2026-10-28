import type { LegacySnapshot } from './preflight.ts';
import { initialRepeatStartDate, nextRepeatTimestamp } from '../utils/recurrence.ts';
import type { RepeatRule, TaskStatus } from '../types.ts';

type Row = Record<string, any>;
export type ObservedTask = { id: string; status: TaskStatus; present?: boolean; completedDate?: number; generatedAt?: number };
export type TaskObservation = { schemaVersion: 1; docId: string; tasks: ObservedTask[] };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const canonical = (value: any): string => value && typeof value === 'object'
  ? (Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`)
  : JSON.stringify(value);
const equal = (a: any, b: any) => canonical(a) === canonical(b);
const statuses = new Set(['todo', 'done', 'canceled']);
const allTasks = (snapshot: LegacySnapshot): Row[] => [...snapshot.tasks, ...snapshot.archived];

export function validateObservation(value: any, docId: string): asserts value is TaskObservation {
  if (value?.schemaVersion !== 1 || value.docId !== docId || !Array.isArray(value.tasks)) throw new Error('Things 状态观察基线损坏或不属于当前数据库');
  const ids = new Set<string>();
  for (const row of value.tasks) {
    if (!row || typeof row.id !== 'string' || !row.id.trim() || ids.has(row.id) || !statuses.has(row.status) ||
      (row.present !== undefined && typeof row.present !== 'boolean') ||
      ['completedDate', 'generatedAt'].some(field => row[field] !== undefined && !Number.isSafeInteger(row[field]))) {
      throw new Error('Things 状态观察基线包含无效任务记录');
    }
    ids.add(row.id);
  }
}

/** Seed history once. Existing done rows, including recovery snapshots, are not completion events. */
export function seedTaskObservation(snapshot: LegacySnapshot, docId: string): TaskObservation {
  const records = new Map<string, ObservedTask>();
  for (const task of snapshot.trash.flatMap(batch => batch.tasks || [])) {
    records.set(task.id, { ...observed(task), present: false });
  }
  for (const task of allTasks(snapshot)) records.set(task.id, observed(task));
  // Old versions sometimes wrote the next occurrence before its source marker.
  for (const task of allTasks(snapshot)) if (task.recurrenceSourceId && records.has(task.recurrenceSourceId)) {
    const source = records.get(task.recurrenceSourceId)!;
    source.generatedAt ??= task.created;
  }
  return { schemaVersion: 1, docId, tasks: [...records.values()] };
}

function observed(task: Row, previous?: ObservedTask): ObservedTask {
  return {
    id: task.id, status: task.status, present: true,
    ...(task.completedDate != null ? { completedDate: task.completedDate } : {}),
    ...(task.recurrenceGeneratedAt != null || previous?.generatedAt !== undefined
      ? { generatedAt: task.recurrenceGeneratedAt ?? previous?.generatedAt } : {}),
  };
}

/** Stable UUIDs make a resumed completion use the exact same occurrence and checklist tree. */
export async function occurrenceId(docId: string, sourceId: string, childId?: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(
    JSON.stringify(['things-recurrence-v1', docId, sourceId, childId ?? null])))).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type Located = { task: Row; location: 'tasks' | 'archived'; index: number };
function located(snapshot: LegacySnapshot): Map<string, Located> {
  return new Map((['tasks', 'archived'] as const).flatMap(location => snapshot[location].map((task, index) => [task.id, { task: clone(task), location, index }] as const)));
}

/** Merge task edits before planning effects so an occurrence inherits native edits made since the Store read. */
export function mergeTaskChanges(base: LegacySnapshot, desired: LegacySnapshot, latest: LegacySnapshot): LegacySnapshot {
  const before = located(base), wanted = located(desired), merged = located(latest);
  const conflict = (field: string): never => { throw new Error(`Things 任务在其他位置已改变：${field}，请刷新后重试。`); };
  for (const [id, old] of before) {
    const next = wanted.get(id), current = merged.get(id);
    if (!next) {
      if (current && (!equal(current.task, old.task) || current.location !== old.location)) conflict('删除');
      merged.delete(id); continue;
    }
    if (!current) {
      if (!equal(next.task, old.task) || next.location !== old.location) conflict('已删除任务');
      continue;
    }
    for (const field of new Set([...Object.keys(old.task), ...Object.keys(next.task)])) {
      if (equal(old.task[field], next.task[field])) continue;
      if (!equal(current.task[field], old.task[field]) && !equal(current.task[field], next.task[field])) conflict(field);
      if (own(next.task, field)) current.task[field] = clone(next.task[field]); else delete current.task[field];
    }
    for (const field of ['location', 'index'] as const) {
      if (old[field] === next[field]) continue;
      if (current[field] !== old[field] && current[field] !== next[field]) conflict(field);
      Object.assign(current, { [field]: next[field] });
    }
  }
  for (const [id, row] of wanted) if (!before.has(id)) {
    const current = merged.get(id);
    if (current && (!equal(current.task, row.task) || current.location !== row.location)) conflict('新增任务身份');
    merged.set(id, row);
  }
  const result = clone(desired);
  for (const location of ['tasks', 'archived'] as const) {
    result[location] = [...merged.values()].filter(row => row.location === location).sort((a, b) => a.index - b.index).map(row => row.task);
  }
  return result;
}

/** Pure planning: all timestamps and identities are captured in the coordinator's durable write intent. */
export async function planTaskTransitions(snapshot: LegacySnapshot, observation: TaskObservation, now = Date.now()) {
  validateObservation(observation, observation.docId);
  const result = clone(snapshot);
  const records = new Map(observation.tasks.map(task => [task.id, clone(task)]));
  const byId = new Map(allTasks(result).map(task => [task.id, task]));
  const active = [...result.tasks];
  let nextOrder = Math.max(-1, ...result.tasks.map(task => task.order)) + 1;
  for (const task of active) {
    const prior = records.get(task.id);
    const isNew = !prior;
    // Reappearing known identities are restored history, regardless of their old tombstone status.
    if (prior?.present === false) continue;
    let changed = false;
    // Only post-baseline new tasks get a first date. Importing undated repeating history is lossless.
    if (isNew && task.repeatRule && task.startDate == null && task.deadline == null) {
      task.startDate = initialRepeatStartDate(task.repeatRule, undefined, undefined, now);
      changed = true;
    }
    if (task.status === 'done' && prior?.status !== 'done') {
      const explicitDate = task.completedDate != null && (isNew || task.completedDate !== prior?.completedDate);
      if (!explicitDate) task.completedDate = now;
      changed = true;
      if (task.repeatRule && !task.parentId) {
        const existingNext = allTasks(result).find(candidate => candidate.recurrenceSourceId === task.id);
        const generatedAt = task.recurrenceGeneratedAt ?? prior?.generatedAt ?? existingNext?.created;
        if (generatedAt !== undefined) {
          task.recurrenceGeneratedAt = generatedAt;
        } else {
          const nextId = await occurrenceId(observation.docId, task.id);
          if (byId.has(nextId)) throw new Error('Things 重复任务实例 ID 已被其他记录占用');
          const next: Row = { ...clone(task), id: nextId, status: 'todo', created: now, updated: now,
            someday: false, recurrenceSourceId: task.id, order: nextOrder++ };
          delete next.completedDate; delete next.recurrenceGeneratedAt; delete next.parentId;
          // Match the original Things repeat template: a new occurrence is not the old linked block.
          delete next.blockId;
          if (task.startDate != null) next.startDate = nextRepeatTimestamp(task.startDate, task.repeatRule as RepeatRule);
          if (task.deadline != null) next.deadline = nextRepeatTimestamp(task.deadline, task.repeatRule as RepeatRule);
          if (task.startDate == null && task.deadline == null) next.startDate = nextRepeatTimestamp(task.completedDate, task.repeatRule as RepeatRule);
          result.tasks.push(next); byId.set(next.id, next);
          const childIds = new Map<string, string>([[task.id, nextId]]);
          const pendingParents = [task.id];
          for (let index = 0; index < pendingParents.length; index++) {
            const parent = pendingParents[index];
            for (const child of active.filter(candidate => candidate.parentId === parent)) {
              if (childIds.has(child.id)) throw new Error('Things 重复任务的清单存在循环');
              const id = await occurrenceId(observation.docId, task.id, child.id);
              if (byId.has(id)) throw new Error('Things 重复清单实例 ID 已被其他记录占用');
              const copy: Row = { ...clone(child), id, parentId: childIds.get(parent), status: 'todo',
                created: now, updated: now, recurrenceSourceId: child.id };
              delete copy.completedDate; delete copy.recurrenceGeneratedAt;
              // Checklist occurrences copy their content, not independently scheduled/linked tasks.
              // Preserve custom extension data and sibling ordering without guessing their meaning.
              for (const field of ['blockId', 'startDate', 'deadline', 'someday', 'repeatRule', 'projectId', 'areaId', 'headingId']) delete copy[field];
              result.tasks.push(copy); byId.set(id, copy); childIds.set(child.id, id); pendingParents.push(child.id);
            }
          }
          task.recurrenceGeneratedAt = now;
        }
      }
    } else if (prior && task.status !== prior.status) changed = true;
    if (changed) task.updated = now;
  }
  // Retain deleted identities as tombstones so restoring a historical done row is not a new completion.
  // Archived rows are observed as history and never generate another occurrence.
  for (const record of records.values()) record.present = false;
  for (const task of allTasks(result)) records.set(task.id, observed(task, records.get(task.id)));
  return { snapshot: result, observation: { schemaVersion: 1 as const, docId: observation.docId, tasks: [...records.values()] },
    changed: !equal(result, snapshot) };
}
