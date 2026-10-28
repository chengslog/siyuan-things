import type { Task } from '../types.ts';

export interface PendingOperationIdentity {
  operationId: string;
  type: 'update' | 'delete';
  targetIds: string[];
  changes: Record<string, unknown>;
}

export interface PendingTaskPlan {
  readonly schemaVersion: 1;
  readonly identity: PendingOperationIdentity;
  readonly changes: Partial<Task>;
  readonly checklist?: string[];
  readonly tasks: Task[];
}
const operationIdentity = ({ operationId, type, targetIds, changes }: PendingOperationIdentity): PendingOperationIdentity =>
  ({ operationId, type, targetIds, changes });

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(key => (value as any)[key] !== undefined).sort()
    .map(key => `${JSON.stringify(key)}:${canonical((value as any)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function descendants(tasks: readonly Task[], rootId: string): Task[] {
  const ids = new Set([rootId]);
  let added: boolean;
  do {
    added = false;
    for (const task of tasks) if (task.parentId && ids.has(task.parentId) && !ids.has(task.id)) {
      ids.add(task.id); added = true;
    }
  } while (added);
  return tasks.filter(task => task.id !== rootId && ids.has(task.id)).sort((a, b) => a.id.localeCompare(b.id));
}

/** Resolve dates/entity names before this call. Neither confirmation nor retry may refresh this baseline. */
export function createPendingTaskPlan(identity: PendingOperationIdentity, changes: Partial<Task>,
  checklist: string[] | undefined, tasks: readonly Task[]): PendingTaskPlan {
  const selected = new Set(identity.targetIds);
  for (const id of identity.targetIds) {
    if (!tasks.some(task => task.id === id)) throw new Error('待操作任务已不存在，请重新整理');
    if (identity.type === 'delete' || checklist !== undefined) {
      for (const child of descendants(tasks, id)) selected.add(child.id);
    }
  }
  return freeze(structuredClone({ schemaVersion: 1 as const, identity: operationIdentity(identity), changes, checklist,
    tasks: tasks.filter(task => selected.has(task.id)) }));
}

/** Whole deletion scopes are checked; updates guard only fields the user actually accepted. */
export function validatePendingTaskPlan(plan: PendingTaskPlan | undefined, identity: PendingOperationIdentity,
  currentTasks: readonly Task[]): { changes: Partial<Task>; checklist?: string[] } {
  if (!plan || plan.schemaVersion !== 1 || !equal(plan.identity, operationIdentity(identity))) {
    throw new Error('这项操作缺少原始字段快照或内容已改变，请重新整理后再确认');
  }
  const baseline = new Map(plan.tasks.map(task => [task.id, task]));
  const current = new Map(currentTasks.map(task => [task.id, task]));
  const fields = new Set(Object.keys(plan.changes));
  if (['startDate', 'someday'].some(field => fields.has(field))) ['startDate', 'someday'].forEach(field => fields.add(field));
  if (['projectId', 'areaId', 'headingId'].some(field => fields.has(field))) ['projectId', 'areaId', 'headingId'].forEach(field => fields.add(field));
  for (const id of identity.targetIds) {
    const before = baseline.get(id), now = current.get(id);
    if (!before || !now) throw new Error('待操作任务已被移走或删除，请重新整理');
    if (identity.type === 'delete') {
      if (!equal(before, now)) throw new Error(`任务“${now.title}”已发生变化，请重新整理后再删除`);
    } else {
      for (const field of fields) {
        const oldValue = (before as any)[field], newValue = (now as any)[field];
        const isPlanned = Object.prototype.hasOwnProperty.call(plan.changes, field);
        if (!equal(oldValue, newValue) && !(isPlanned && equal((plan.changes as any)[field], newValue))) {
          throw new Error(`任务“${now.title}”的 ${field} 已在其他位置发生变化，请重新整理后再修改`);
        }
      }
    }
    if (identity.type === 'delete' || plan.checklist !== undefined) {
      if (!equal(descendants(plan.tasks, id), descendants(currentTasks, id))) {
        throw new Error(`任务“${now.title}”的检查清单已发生变化，请重新整理后再操作`);
      }
    }
  }
  return structuredClone({ changes: plan.changes, checklist: plan.checklist });
}
