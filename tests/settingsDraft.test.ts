import assert from 'node:assert/strict';
import test from 'node:test';
import { createSettingsDraft } from '../src/utils/settingsDraft.ts';

function fixture() {
  const values: Record<string, unknown> = { defaultView: 'none', aiEnabled: true, githubAutoUpdate: false };
  const snapshots: Array<Record<string, unknown>> = [];
  const store = {
    get: (key: string) => values[key], set: (key: string, value: unknown) => { values[key] = value; },
    async save() { snapshots.push({ ...values }); },
  };
  return { values, snapshots, store };
}

test('editing or discarding a category draft does not change persisted or live settings', () => {
  const f = fixture();
  const draft = createSettingsDraft(f.store, ['defaultView', 'aiEnabled']);
  draft.set('defaultView', 'today'); draft.set('aiEnabled', false);
  assert.equal(draft.get('defaultView'), 'today');
  assert.deepEqual(f.values, { defaultView: 'none', aiEnabled: true, githubAutoUpdate: false });
  assert.equal(f.snapshots.length, 0);
  const reopened = createSettingsDraft(f.store, ['defaultView', 'aiEnabled']);
  assert.equal(reopened.get('defaultView'), 'none');
});

test('saving a category preserves the unsaved draft in another category', async () => {
  const f = fixture();
  const general = createSettingsDraft(f.store, ['defaultView', 'aiEnabled']);
  const updates = createSettingsDraft(f.store, ['githubAutoUpdate']);
  general.set('defaultView', 'today'); updates.set('githubAutoUpdate', true);
  assert.deepEqual(await general.save(), { defaultView: 'today' });
  assert.equal(f.values.defaultView, 'today');
  assert.equal(f.values.githubAutoUpdate, false);
  assert.equal(updates.get('githubAutoUpdate'), true);
  await updates.save();
  assert.equal(f.values.githubAutoUpdate, true);
});

test('an unchanged field updated elsewhere is not overwritten by saving another edit', async () => {
  const f = fixture();
  const draft = createSettingsDraft(f.store, ['defaultView', 'aiEnabled']);
  draft.set('defaultView', 'today');
  f.values.aiEnabled = false;
  await draft.save();
  assert.equal(f.values.aiEnabled, false);
  assert.equal(f.snapshots[0].aiEnabled, false);
  await draft.save();
  assert.equal(f.snapshots.length, 1);
});

test('a failed save keeps the draft available for retry and restores live values', async () => {
  const f = fixture();
  let fail = true;
  f.store.save = async () => { if (fail) throw Error('disk unavailable'); f.snapshots.push({ ...f.values }); };
  const draft = createSettingsDraft(f.store, ['defaultView']);
  draft.set('defaultView', 'today');
  await assert.rejects(draft.save(), /disk unavailable/);
  assert.equal(f.values.defaultView, 'none');
  assert.equal(draft.get('defaultView'), 'today');
  fail = false;
  await draft.save();
  assert.equal(f.values.defaultView, 'today');
});

test('new edits made during a save remain unsaved until the next explicit save', async () => {
  const f = fixture();
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.store.save = async () => { entered(); await gate; f.snapshots.push({ ...f.values }); };
  const draft = createSettingsDraft(f.store, ['defaultView']);
  draft.set('defaultView', 'today');
  const saving = draft.save(); await ready;
  draft.set('defaultView', 'inbox');
  release(); await saving;
  assert.equal(f.values.defaultView, 'today');
  assert.equal(draft.get('defaultView'), 'inbox');
  await draft.save();
  assert.equal(f.values.defaultView, 'inbox');
});

test('overlapping category saves serialize writes so failure cannot undo a later category', async () => {
  const f = fixture();
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  f.store.save = async () => {
    if (++calls === 1) { entered(); await gate; throw Error('first write failed'); }
    f.snapshots.push({ ...f.values });
  };
  const general = createSettingsDraft(f.store, ['defaultView']);
  const updates = createSettingsDraft(f.store, ['githubAutoUpdate']);
  general.set('defaultView', 'today'); updates.set('githubAutoUpdate', true);
  const first = general.save(); await ready;
  const second = updates.save();
  assert.equal(f.values.githubAutoUpdate, false);
  const rejection = assert.rejects(first, /first write failed/);
  release(); await rejection; await second;
  assert.deepEqual(f.values, { defaultView: 'none', aiEnabled: true, githubAutoUpdate: true });
  assert.equal(f.snapshots.length, 1);
});
