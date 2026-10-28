import type { Task } from '../types.ts';

export interface ChecklistDraftItem { id: string; title: string; completed: boolean }
export type ChecklistBaselineItem = Pick<Task, 'id' | 'title' | 'status' | 'order'>;
const drafts = new WeakMap<object, Map<string, { baseline: ChecklistBaselineItem[]; draft: ChecklistDraftItem[] }>>();

export function rememberChecklistDraft(owner: object, id: string, baseline: ChecklistBaselineItem[], draft: ChecklistDraftItem[]) {
  let values = drafts.get(owner);
  if (!values) drafts.set(owner, values = new Map());
  const pending = planChecklistDraft(baseline, draft, baseline);
  if (!pending.updates.length && !pending.additions.length && !pending.deletions.length) values.delete(id);
  else values.set(id, { baseline: baseline.map(row => ({ ...row })), draft: draft.map(row => ({ ...row })) });
}

export function recalledChecklistDraft(owner: object, id: string) {
  const value = drafts.get(owner)?.get(id);
  return value && { baseline: value.baseline.map(row => ({ ...row })), draft: value.draft.map(row => ({ ...row })) };
}

/** Compare against what was displayed, never use remote-only rows as a deletion list. */
export function planChecklistDraft(base: readonly ChecklistBaselineItem[], draft: readonly ChecklistDraftItem[],
  remote: readonly ChecklistBaselineItem[]) {
  const updates: Array<{ id: string; changes: Partial<Task> }> = [];
  const additions: ChecklistDraftItem[] = [];
  const deletions: string[] = [];
  const conflicts: string[] = [];
  const baseline = new Map(base.map(item => [item.id, item]));
  const latest = new Map(remote.map(item => [item.id, item]));
  const nextIds = new Set(draft.map(item => item.id));
  for (const [index, item] of draft.entries()) {
    const before = baseline.get(item.id);
    if (!before) {
      if (latest.has(item.id)) conflicts.push(item.id);
      else if (item.title.trim()) additions.push({ ...item });
      continue;
    }
    const now = latest.get(item.id);
    const changes: Partial<Task> = {};
    if (item.title !== before.title) changes.title = item.title;
    if (item.completed !== (before.status === 'done')) changes.status = item.completed ? 'done' : 'todo';
    if (base.findIndex(row => row.id === item.id) !== index) changes.order = index;
    if (!Object.keys(changes).length) continue;
    if (!now) { conflicts.push(item.id); continue; }
    let conflict = false;
    for (const field of Object.keys(changes) as Array<'title' | 'status' | 'order'>) {
      if (now[field] === changes[field]) delete changes[field];
      else if (now[field] !== before[field]) conflict = true;
    }
    if (conflict) conflicts.push(item.id);
    else if (Object.keys(changes).length) updates.push({ id: item.id, changes });
  }
  for (const before of base) {
    if (nextIds.has(before.id)) continue;
    const now = latest.get(before.id);
    if (!now) continue;
    if (now.title !== before.title || now.status !== before.status || now.order !== before.order) conflicts.push(before.id);
    else deletions.push(before.id);
  }
  return { updates, additions, deletions, conflicts };
}
