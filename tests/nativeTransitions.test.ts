import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTaskChanges, occurrenceId, planTaskTransitions, seedTaskObservation, validateObservation } from '../src/storage/nativeTransitions.ts';
import type { LegacySnapshot } from '../src/storage/preflight.ts';
import { nextRepeatTimestamp } from '../src/utils/recurrence.ts';

const empty = (): LegacySnapshot => ({ tasks: [], archived: [], trash: [], projects: [], areas: [], tags: [] });
const task = (id: string, extra: any = {}) => ({ id, title: id, notes: '', status: 'todo', priority: 'none',
  created: 10, updated: 20, tags: [], order: 0, ...extra });
const source = (...tasks: any[]): LegacySnapshot => ({ ...empty(), tasks });
const docId = '20261028000000-center0';
const now = new Date(2026, 9, 28, 14, 25).getTime();

test('seeding historical done and undated repeat rows is lossless, including explicit null dates', async () => {
  const original = source(task('done', { status: 'done', repeatRule: 'daily', completedDate: null, recurrenceGeneratedAt: null }), task('undated', { repeatRule: 'daily' }));
  const observation = seedTaskObservation(original, docId);
  validateObservation(observation, docId);
  const plan = await planTaskTransitions(original, observation, now);
  assert.deepEqual(plan.snapshot, original);
  assert.equal(plan.changed, false);
});

test('completion generates one deterministic occurrence and preserves all levels of its checklist', async () => {
  const initial = source(task('root', { repeatRule: 'daily', startDate: now, tags: ['tag'], extra: { value: 0 } }),
    task('grandchild', { parentId: 'child', status: 'done', completedDate: 123, order: -0.5 }),
    task('child', { parentId: 'root', notes: 'Child note', priority: 'high' }));
  const current = structuredClone(initial); current.tasks[0].status = 'done';
  const plan = await planTaskTransitions(current, seedTaskObservation(initial, docId), now);
  const nextId = await occurrenceId(docId, 'root');
  const childId = await occurrenceId(docId, 'root', 'child');
  const next = plan.snapshot.tasks.find(row => row.id === nextId)!;
  assert.equal(plan.snapshot.tasks.length, 6);
  assert.equal(next.startDate, nextRepeatTimestamp(now, 'daily'));
  assert.equal(next.recurrenceSourceId, 'root');
  assert.deepEqual(next.extra, { value: 0 }); assert.deepEqual(next.tags, ['tag']);
  assert.equal(next.status, 'todo'); assert.equal(next.completedDate, undefined);
  assert.equal(plan.snapshot.tasks.find(row => row.id === childId)!.parentId, nextId);
  const grandchild = plan.snapshot.tasks.find(row => row.id !== 'grandchild' && row.recurrenceSourceId === 'grandchild')!;
  assert.equal(grandchild.parentId, childId); assert.equal(grandchild.status, 'todo'); assert.equal(grandchild.order, -0.5);
  assert.equal(grandchild.completedDate, undefined);
  assert.equal(plan.snapshot.tasks[0].recurrenceGeneratedAt, now);
  assert.equal(plan.snapshot.tasks[0].completedDate, now);
  assert.deepEqual(await planTaskTransitions(current, seedTaskObservation(initial, docId), now), plan);
});

test('unchecking and completing an occurrence again cannot generate another successor even if the marker is cleared', async () => {
  const initial = source(task('root', { repeatRule: 'daily' }));
  const done = structuredClone(initial); done.tasks[0].status = 'done';
  const first = await planTaskTransitions(done, seedTaskObservation(initial, docId), now);
  const reopened = structuredClone(first.snapshot); reopened.tasks[0].status = 'todo'; delete reopened.tasks[0].recurrenceGeneratedAt;
  const second = await planTaskTransitions(reopened, first.observation, now + 1);
  const completed = structuredClone(second.snapshot); completed.tasks[0].status = 'done';
  const third = await planTaskTransitions(completed, second.observation, now + 2);
  assert.equal(third.snapshot.tasks.length, 2);
  assert.equal(third.snapshot.tasks[0].recurrenceGeneratedAt, now);
  assert.equal(third.snapshot.tasks[0].completedDate, now + 2);
});

test('new native done tasks are completions but archived done tasks remain history', async () => {
  const observation = seedTaskObservation(empty(), docId);
  const current = source(task('new-done', { status: 'done', repeatRule: 'weekly', completedDate: 100 }));
  current.archived = [task('archived-done', { status: 'done', repeatRule: 'daily' })];
  const planned = await planTaskTransitions(current, observation, now);
  assert.equal(planned.snapshot.tasks.length, 2);
  assert.equal(planned.snapshot.tasks[0].completedDate, 100);
  assert.deepEqual(planned.snapshot.archived, current.archived);
});

test('only new undated repeat tasks get an initial date and timestamp zero counts as an existing date', async () => {
  const initial = source(task('old', { repeatRule: 'daily' }));
  const current = structuredClone(initial); current.tasks.push(task('new', { repeatRule: 'daily' }), task('epoch', { repeatRule: 'daily', startDate: 0 }));
  const planned = await planTaskTransitions(current, seedTaskObservation(initial, docId), now);
  assert.equal(planned.snapshot.tasks[0].startDate, undefined);
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  assert.equal(planned.snapshot.tasks[1].startDate, midnight.getTime());
  assert.equal(planned.snapshot.tasks[2].startDate, 0);
});

test('restoring a historical done identity does not create a completion even when its tombstone was todo', async () => {
  const initial = source(task('same', { repeatRule: 'daily' }));
  initial.trash = [{ id: 'history', deletedAt: 1, tasks: [task('same', { status: 'done', repeatRule: 'daily' })] }];
  const removed = structuredClone(initial); removed.tasks = [];
  const first = await planTaskTransitions(removed, seedTaskObservation(initial, docId), now);
  const restored = source(initial.trash[0].tasks[0]);
  const second = await planTaskTransitions(restored, first.observation, now + 1);
  assert.deepEqual(second.snapshot, restored);
  assert.equal(second.changed, false);
});

test('three-way task merge preserves native fields and archive moves before recurrence planning', async () => {
  const base = source(task('root', { repeatRule: 'daily', startDate: now }));
  const desired = structuredClone(base); desired.tasks[0].status = 'done';
  const latest = structuredClone(base); latest.tasks[0].title = 'Native title'; latest.tasks[0].tags = ['native-tag'];
  const merged = mergeTaskChanges(base, desired, latest);
  const plan = await planTaskTransitions(merged, seedTaskObservation(base, docId), now);
  assert.equal(plan.snapshot.tasks[1].title, 'Native title');
  assert.deepEqual(plan.snapshot.tasks[1].tags, ['native-tag']);
  const archived = structuredClone(latest); archived.archived = archived.tasks.splice(0);
  const history = await planTaskTransitions(mergeTaskChanges(base, desired, archived), seedTaskObservation(base, docId), now);
  assert.equal(history.snapshot.tasks.length, 0);
  assert.equal(history.snapshot.archived[0].status, 'done');
});

test('same-field native conflicts and deleted edited rows stop before generating effects', () => {
  const base = source(task('root'));
  const desired = structuredClone(base); desired.tasks[0].title = 'Local';
  const latest = structuredClone(base); latest.tasks[0].title = 'Native';
  assert.throws(() => mergeTaskChanges(base, desired, latest), /title/);
  assert.throws(() => mergeTaskChanges(base, desired, empty()), /已删除任务/);
  assert.deepEqual(mergeTaskChanges(base, base, empty()).tasks, []);
});

test('recurrence templates keep content and extensions but do not inherit old block links or child scheduling', async () => {
  const initial = source(task('root', { repeatRule: 'daily', startDate: now, blockId: 'linked-root', projectId: 'project', areaId: 'area', headingId: 'heading' }),
    task('child', { parentId: 'root', blockId: 'linked-child', startDate: 0, deadline: 100, someday: true, repeatRule: 'monthly',
      projectId: 'old-project', areaId: 'old-area', headingId: 'old-heading', tags: ['tag'], priority: 'high', notes: 'Child notes',
      order: -0.5, customExtension: { keep: true } }));
  const done = structuredClone(initial); done.tasks[0].status = 'done';
  const plan = await planTaskTransitions(done, seedTaskObservation(initial, docId), now);
  const next = plan.snapshot.tasks.find(row => row.recurrenceSourceId === 'root')!;
  const child = plan.snapshot.tasks.find(row => row.recurrenceSourceId === 'child')!;
  assert.equal(next.blockId, undefined); assert.equal(next.projectId, 'project'); assert.equal(next.areaId, 'area'); assert.equal(next.headingId, 'heading');
  for (const field of ['blockId', 'startDate', 'deadline', 'someday', 'repeatRule', 'projectId', 'areaId', 'headingId']) assert.equal(child[field], undefined, field);
  assert.equal(child.title, 'child'); assert.equal(child.notes, 'Child notes'); assert.equal(child.priority, 'high'); assert.equal(child.order, -0.5);
  assert.deepEqual(child.tags, ['tag']); assert.deepEqual(child.customExtension, { keep: true });
  assert.equal(plan.snapshot.tasks[0].blockId, 'linked-root'); assert.equal(plan.snapshot.tasks[1].blockId, 'linked-child');
  assert.equal(plan.snapshot.tasks[1].startDate, 0); assert.equal(plan.snapshot.tasks[1].repeatRule, 'monthly');
});
