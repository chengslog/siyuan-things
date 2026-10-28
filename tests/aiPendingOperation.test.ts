import test from 'node:test';
import assert from 'node:assert/strict';
import { createPendingTaskPlan, validatePendingTaskPlan, type PendingOperationIdentity } from '../src/utils/aiPendingOperation.ts';
import type { Task } from '../src/types.ts';

const task = (id = 't', extra: Partial<Task> = {}): Task => ({ id, title: 'before', notes: '', status: 'todo', priority: 'none',
  tags: [], order: 0, created: 1, updated: 10, ...extra });
const identity = (changes: Record<string, unknown>, type: 'update' | 'delete' = 'update'): PendingOperationIdentity =>
  ({ operationId: 'op', type, targetIds: ['t'], changes });

test('native title changes conflict even when updated is unchanged', () => {
  const op = identity({ title: 'planned' });
  const plan = createPendingTaskPlan(op, { title: 'planned' }, undefined, [task()]);
  assert.throws(() => validatePendingTaskPlan(plan, op, [task('t', { title: 'native' })]), /title/);
});
test('native date changes conflict and explicit date clears are retained in the frozen plan', () => {
  const op = identity({ startDate: null });
  const plan = createPendingTaskPlan(op, { startDate: undefined }, undefined, [task('t', { startDate: 5 })]);
  assert.throws(() => validatePendingTaskPlan(plan, op, [task('t', { startDate: 6 })]), /startDate/);
  const approved = validatePendingTaskPlan(plan, op, [task('t', { startDate: 5 })]);
  assert.ok(Object.hasOwn(approved.changes, 'startDate'));
  assert.equal(approved.changes.startDate, undefined);
});
test('disjoint native edits survive without being included in the accepted patch', () => {
  const op = identity({ title: 'planned' });
  const plan = createPendingTaskPlan(op, { title: 'planned' }, undefined, [task()]);
  assert.deepEqual(validatePendingTaskPlan(plan, op, [task('t', { notes: 'native note', startDate: 123, updated: 11 })]),
    { changes: { title: 'planned' }, checklist: undefined });
});
test('deletion checks the entire task and all descendant identities, even with unchanged timestamps', () => {
  const op = identity({}, 'delete');
  const initial = [task(), task('child', { parentId: 't' }), task('grandchild', { parentId: 'child' })];
  const plan = createPendingTaskPlan(op, {}, undefined, initial);
  assert.throws(() => validatePendingTaskPlan(plan, op, [task('t', { title: 'native' }), ...initial.slice(1)]), /已发生变化/);
  assert.throws(() => validatePendingTaskPlan(plan, op, [...initial, task('added', { parentId: 'child' })]), /检查清单/);
  assert.throws(() => validatePendingTaskPlan(plan, op, initial.map(row => row.id === 'grandchild' ? { ...row, notes: 'native' } : row)), /检查清单/);
});
test('checklist replacement cannot remove a new native child, while an unrelated parent edit is allowed', () => {
  const op = identity({ checklist: ['replacement'] });
  const initial = [task(), task('child', { parentId: 't' })];
  const plan = createPendingTaskPlan(op, {}, ['replacement'], initial);
  assert.throws(() => validatePendingTaskPlan(plan, op, [...initial, task('new', { parentId: 't' })]), /检查清单/);
  assert.deepEqual(validatePendingTaskPlan(plan, op, [task('t', { notes: 'remote' }), initial[1]]).checklist, ['replacement']);
});
test('old pending operations cannot fall back to updated timestamps', () => {
  assert.throws(() => validatePendingTaskPlan(undefined, identity({ title: 'planned' }), [task()]), /字段快照/);
});
test('planned values and baseline are immutable and changing a displayed operation requires a new plan', () => {
  const raw = { tags: ['tag'] };
  const op = identity(raw);
  const original = task();
  const patch = { tags: ['tag-id'] };
  const plan = createPendingTaskPlan(op, patch, undefined, [original]);
  raw.tags.push('different'); patch.tags.push('other-id'); original.tags.push('outside');
  assert.deepEqual(plan.changes.tags, ['tag-id']);
  assert.deepEqual(plan.tasks[0].tags, []);
  assert.throws(() => validatePendingTaskPlan(plan, op, [task()]), /内容已改变/);
  assert.throws(() => plan.tasks[0].tags.push('mutate'), TypeError);
});
test('retry accepts an already applied same value without updating the original baseline', () => {
  const op = identity({ title: 'planned' });
  const plan = createPendingTaskPlan(op, { title: 'planned' }, undefined, [task()]);
  validatePendingTaskPlan(plan, op, [task('t', { title: 'planned', updated: 11 })]);
  assert.equal(plan.tasks[0].title, 'before');
  assert.throws(() => validatePendingTaskPlan(plan, op, [task('t', { title: 'third-party', updated: 11 })]), /title/);
});
test('target substitution and missing targets stop the whole operation before any writes', () => {
  const op = identity({ title: 'planned' });
  const plan = createPendingTaskPlan(op, { title: 'planned' }, undefined, [task()]);
  assert.throws(() => validatePendingTaskPlan(plan, { ...op, targetIds: ['other'] }, [task('other')]), /内容已改变/);
  assert.throws(() => validatePendingTaskPlan(plan, { ...op, operationId: 'new-op' }, [task()]), /内容已改变/);
  assert.throws(() => validatePendingTaskPlan(plan, op, []), /移走或删除/);
});
test('execution state is not part of the frozen user-approved identity', () => {
  const op = { ...identity({ title: 'planned' }), status: 'pending', baseUpdated: { t: 10 } };
  const plan = createPendingTaskPlan(op, { title: 'planned' }, undefined, [task()]);
  op.status = 'executing';
  assert.deepEqual(validatePendingTaskPlan(plan, op, [task()]).changes, { title: 'planned' });
});
