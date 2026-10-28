import type { Task } from '../types.ts';

export const TASK_DRAFT_FIELDS = [
  'title', 'notes', 'startDate', 'deadline', 'repeatRule', 'someday',
  'tags', 'priority', 'projectId', 'areaId', 'headingId',
] as const;
export type TaskDraftField = typeof TASK_DRAFT_FIELDS[number];
export type TaskDraft = Pick<Task, TaskDraftField>;
const RELATED_FIELDS = [['projectId', 'areaId', 'headingId'], ['startDate', 'someday']] as const;

/** Detached editing baseline: store reloads and tag mutations cannot change it. */
export function snapshotTaskDraft(task: Partial<Task>): TaskDraft {
  return {
    title: task.title ?? '', notes: task.notes ?? '',
    startDate: task.startDate, deadline: task.deadline, repeatRule: task.repeatRule,
    someday: task.someday ?? false, tags: [...(task.tags ?? [])],
    priority: task.priority ?? 'none', projectId: task.projectId,
    areaId: task.areaId, headingId: task.headingId,
  };
}

function same(field: TaskDraftField, a: TaskDraft, b: TaskDraft): boolean {
  if (field !== 'tags') return Object.is(a[field], b[field]);
  return a.tags.length === b.tags.length && a.tags.every((tag, i) => tag === b.tags[i]);
}

function copyField(target: TaskDraft, source: TaskDraft, field: TaskDraftField): void {
  Object.assign(target, { [field]: field === 'tags' ? [...source.tags] : source[field] });
}

/** Only user edits are candidates for a write; remote changes never become local edits. */
export function planTaskDraft(base: TaskDraft, draft: TaskDraft, remote: TaskDraft,
  fields: readonly TaskDraftField[] = TASK_DRAFT_FIELDS) {
  const changes: Partial<TaskDraft> = {};
  const conflicts: TaskDraftField[] = [];
  for (const field of fields) {
    if (same(field, base, draft) || same(field, draft, remote)) continue;
    if (!same(field, base, remote)) conflicts.push(field);
    else Object.assign(changes, { [field]: field === 'tags' ? [...draft.tags] : draft[field] });
  }
  // These fields describe one value together; do not combine two different assignments/schedules.
  for (const group of RELATED_FIELDS) {
    const edited = group.filter(field => fields.includes(field) && !same(field, base, draft));
    if (edited.length && group.some(field => !same(field, base, remote)) &&
      group.some(field => !same(field, draft, remote))) {
      for (const field of edited) if (!conflicts.includes(field)) conflicts.push(field);
    }
  }
  for (const field of conflicts) delete changes[field];
  return { changes, conflicts };
}

/** Refresh clean fields, retain dirty values and their original comparison baseline. */
export function reconcileTaskDraft(base: TaskDraft, draft: TaskDraft, remote: TaskDraft) {
  const nextBase = snapshotTaskDraft(base);
  const nextDraft = snapshotTaskDraft(draft);
  const held = new Set<TaskDraftField>();
  for (const group of RELATED_FIELDS) {
    if (group.some(field => !same(field, base, draft)) && group.some(field => !same(field, draft, remote))) {
      for (const field of group) held.add(field);
    }
  }
  for (const field of TASK_DRAFT_FIELDS) {
    if (held.has(field)) continue;
    if (same(field, base, draft) || same(field, draft, remote)) {
      copyField(nextBase, remote, field);
      copyField(nextDraft, remote, field);
    }
  }
  return { baseline: nextBase, draft: nextDraft };
}

/** Acknowledging one write must not discard edits typed while it was in flight. */
export function acknowledgeTaskDraft(base: TaskDraft, saved: TaskDraft, fields: readonly TaskDraftField[]) {
  const next = snapshotTaskDraft(base);
  for (const field of fields) copyField(next, saved, field);
  return next;
}

// Session-only recovery for a view switch/unmount while a conflicting or failed draft remains.
const drafts = new WeakMap<object, Map<string, { baseline: TaskDraft; draft: TaskDraft }>>();
export function rememberTaskDraft(owner: object, id: string, baseline: TaskDraft, draft: TaskDraft): void {
  let values = drafts.get(owner);
  if (!values) drafts.set(owner, values = new Map());
  if (TASK_DRAFT_FIELDS.every(field => same(field, baseline, draft))) values.delete(id);
  else values.set(id, { baseline: snapshotTaskDraft(baseline), draft: snapshotTaskDraft(draft) });
}
export function recalledTaskDraft(owner: object, id: string) {
  const value = drafts.get(owner)?.get(id);
  return value && { baseline: snapshotTaskDraft(value.baseline), draft: snapshotTaskDraft(value.draft) };
}
