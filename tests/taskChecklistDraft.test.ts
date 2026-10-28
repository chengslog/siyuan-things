import test from 'node:test';
import assert from 'node:assert/strict';
import { planChecklistDraft, rememberChecklistDraft, recalledChecklistDraft, type ChecklistBaselineItem } from '../src/utils/taskChecklistDraft.ts';
const a: ChecklistBaselineItem = { id: 'a', title: 'before', status: 'todo', order: 10 };
const draft = [{ id: 'a', title: 'before', completed: false }];

test('untouched checklist never rewrites remote edits or deletes remote additions', () => {
  const result = planChecklistDraft([a], draft, [{ ...a, title: 'external' }, { ...a, id: 'remote-new' }]);
  assert.deepEqual(result, { updates: [], additions: [], deletions: [], conflicts: [] });
});
test('remote deletions stay deleted and locally edited deleted rows conflict instead of recreating', () => {
  assert.deepEqual(planChecklistDraft([a], draft, []).additions, []);
  const result = planChecklistDraft([a], [{ ...draft[0], title: 'mine' }], []);
  assert.deepEqual(result.conflicts, ['a']);
  assert.deepEqual(result.additions, []);
});
test('independent checkbox and remote title edits merge with only the dirty field', () => {
  const result = planChecklistDraft([a], [{ ...draft[0], completed: true }], [{ ...a, title: 'external' }]);
  assert.deepEqual(result.updates, [{ id: 'a', changes: { status: 'done' } }]);
  assert.deepEqual(result.conflicts, []);
});
test('same-field changes and deletion of a remotely edited row are refused', () => {
  const remote = [{ ...a, title: 'external' }];
  assert.deepEqual(planChecklistDraft([a], [{ ...draft[0], title: 'mine' }], remote).conflicts, ['a']);
  const deleted = planChecklistDraft([a], [], remote);
  assert.deepEqual(deleted.conflicts, ['a']);
  assert.deepEqual(deleted.deletions, []);
});
test('explicit additions and deletions are planned without treating an empty input as a task', () => {
  const result = planChecklistDraft([a], [{ id: 'new', title: 'create', completed: false }, { id: 'empty', title: '', completed: false }], [a]);
  assert.deepEqual(result.additions, [{ id: 'new', title: 'create', completed: false }]);
  assert.deepEqual(result.deletions, ['a']);
});
test('reordering does not write untouched text or completion fields', () => {
  const b = { ...a, id: 'b', title: 'second', order: 20 };
  const result = planChecklistDraft([a, b], [{ id: 'b', title: 'second', completed: false }, draft[0]], [a, b]);
  assert.deepEqual(result.updates, [{ id: 'b', changes: { order: 0 } }, { id: 'a', changes: { order: 1 } }]);
});
test('failed/conflicting checklist drafts survive a view switch without aliasing live input', () => {
  const owner = {};
  const local = [{ ...draft[0], title: 'mine' }];
  rememberChecklistDraft(owner, 'parent', [a], local);
  local[0].title = 'later';
  const recalled = recalledChecklistDraft(owner, 'parent')!;
  assert.equal(recalled.draft[0].title, 'mine');
  assert.deepEqual(planChecklistDraft(recalled.baseline, recalled.draft, [{ ...a, title: 'external' }]).conflicts, ['a']);
  rememberChecklistDraft(owner, 'parent', [a], draft);
  assert.equal(recalledChecklistDraft(owner, 'parent'), undefined);
});
