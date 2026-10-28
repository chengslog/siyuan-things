import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotTaskDraft, planTaskDraft, reconcileTaskDraft, acknowledgeTaskDraft, rememberTaskDraft, recalledTaskDraft } from '../src/utils/taskDraft.ts';

test('a collapsed untouched card adopts every remote field and cannot write stale values on destroy', () => {
  const base = snapshotTaskDraft({ title: 'before', tags: ['a'] });
  const remote = snapshotTaskDraft({ title: 'after', notes: 'new', tags: ['b'], priority: 'high', startDate: 0,
    deadline: -1, someday: true, repeatRule: 'weekly', projectId: 'p', areaId: 'a', headingId: 'h' });
  const next = reconcileTaskDraft(base, snapshotTaskDraft(base), remote);
  assert.deepEqual(next.draft, remote);
  assert.deepEqual(planTaskDraft(next.baseline, next.draft, remote), { changes: {}, conflicts: [] });
});

test('a local title edit merges an external notes edit without sending stale fields', () => {
  const base = snapshotTaskDraft({ title: 'old', notes: 'old notes' });
  const local = snapshotTaskDraft({ ...base, title: 'mine' });
  const remote = snapshotTaskDraft({ ...base, notes: 'theirs' });
  const next = reconcileTaskDraft(base, local, remote);
  assert.equal(next.draft.title, 'mine');
  assert.equal(next.draft.notes, 'theirs');
  assert.deepEqual(planTaskDraft(next.baseline, next.draft, remote), { changes: { title: 'mine' }, conflicts: [] });
});

test('same-field conflicts retain the draft and old baseline without authorizing overwrite', () => {
  const base = snapshotTaskDraft({ title: 'old' });
  const local = snapshotTaskDraft({ ...base, title: 'mine' });
  const remote = snapshotTaskDraft({ ...base, title: 'theirs' });
  const next = reconcileTaskDraft(base, local, remote);
  assert.equal(next.draft.title, 'mine');
  assert.equal(next.baseline.title, 'old');
  assert.deepEqual(planTaskDraft(next.baseline, next.draft, remote), { changes: {}, conflicts: ['title'] });
});

test('equal remote/local edits settle cleanly and explicit clears survive', () => {
  const base = snapshotTaskDraft({ title: 'old', deadline: 1 });
  const local = snapshotTaskDraft({ ...base, title: 'same', deadline: undefined });
  const remote = snapshotTaskDraft({ ...base, title: 'same' });
  const next = reconcileTaskDraft(base, local, remote);
  assert.deepEqual(planTaskDraft(next.baseline, next.draft, remote), { changes: { deadline: undefined }, conflicts: [] });
});

test('immediate title save cannot commit pending date/tag changes', () => {
  const base = snapshotTaskDraft({ title: 'old' });
  const local = snapshotTaskDraft({ ...base, title: 'new', startDate: 50, tags: ['a'] });
  assert.deepEqual(planTaskDraft(base, local, base, ['title']), { changes: { title: 'new' }, conflicts: [] });
});

test('acknowledgement preserves typing during an asynchronous save and unsaved fields', () => {
  const base = snapshotTaskDraft({ title: 'old' });
  const sent = snapshotTaskDraft({ ...base, title: 'sent' });
  const local = snapshotTaskDraft({ ...base, title: 'typed later', notes: 'draft' });
  const ack = acknowledgeTaskDraft(base, sent, ['title']);
  const next = reconcileTaskDraft(ack, local, sent);
  assert.deepEqual(planTaskDraft(next.baseline, next.draft, sent), { changes: { title: 'typed later', notes: 'draft' }, conflicts: [] });
});

test('baseline and cached drafts do not alias mutable tag arrays and survive view switches', () => {
  const source = { tags: ['a'] };
  const base = snapshotTaskDraft(source);
  source.tags.push('b');
  assert.deepEqual(base.tags, ['a']);
  const owner = {};
  const draft = snapshotTaskDraft({ ...base, tags: [] });
  rememberTaskDraft(owner, 'id', base, draft);
  draft.tags.push('later');
  assert.deepEqual(recalledTaskDraft(owner, 'id')?.draft.tags, []);
  const recalled = recalledTaskDraft(owner, 'id')!;
  recalled.baseline.tags.push('mutated');
  assert.deepEqual(recalledTaskDraft(owner, 'id')?.baseline.tags, ['a']);
  rememberTaskDraft(owner, 'id', base, base);
  assert.equal(recalledTaskDraft(owner, 'id'), undefined);
});

test('related assignment and scheduling fields do not silently combine incompatible concurrent edits', () => {
  const base = snapshotTaskDraft({ projectId: 'old' });
  const local = snapshotTaskDraft({ ...base, projectId: 'new', startDate: 5 });
  const remote = snapshotTaskDraft({ ...base, areaId: 'remote-area', someday: true });
  const next = reconcileTaskDraft(base, local, remote);
  const result = planTaskDraft(next.baseline, next.draft, remote);
  assert.ok(result.conflicts.includes('projectId'));
  assert.ok(result.conflicts.includes('startDate'));
});
