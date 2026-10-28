import assert from 'node:assert/strict';
import test from 'node:test';
import { SiYuanAVClient, newSiyuanId } from '../src/storage/avClient.ts';
import { TABLE_NAMES, V1_TABLES, getTableSpecs } from '../src/storage/avSchema.ts';
import { validateBinding, STORAGE_BINDING_FILE, type Binding } from '../src/storage/bootstrap.ts';
import { NOTES_BACKUP_FILE, NOTES_UPGRADE_FILE, upgradeNotesToRichText } from '../src/storage/notesUpgrade.ts';
import type { LegacySnapshot } from '../src/storage/preflight.ts';

const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));
class Fixture {
  binding: Binding = { schemaVersion: 1, docId: newSiyuanId(), notebookId: newSiyuanId(), tables: {} as Binding['tables'] };
  source: LegacySnapshot = { tasks: [{ id: 'task-a', notes: 'Paragraph  \n\n![image](assets/example.png)\n' }], archived: [], projects: [], areas: [], tags: [], trash: [] };
  copied?: LegacySnapshot;
  data = new Map<string, any>();
  avs = new Map<string, any>();
  additions = 0;
  copies = 0;
  loseAddResponse = false;
  loseCopyResponse = false;
  changeOriginalAfterCopy = false;
  saveFailure = '';
  saveResponseLost = '';
  calls: string[] = [];
  constructor() {
    for (const name of TABLE_NAMES) {
      const specs = V1_TABLES[name];
      const keys = Object.fromEntries([specs.titleField, ...specs.columns.map(c => c.field)].map(field => [field, newSiyuanId()]));
      const table = { avId: newSiyuanId(), blockId: newSiyuanId(), docId: newSiyuanId(), keys };
      this.binding.tables[name] = table;
      const keyValues = [{ key: { id: keys[specs.titleField], type: 'block' }, values: [] },
        ...specs.columns.map(c => ({ key: { id: keys[c.field], type: c.type }, values: [] }))];
      this.avs.set(table.avId, { id: table.avId, keyValues,
        views: [{ id: newSiyuanId(), type: 'table', table: { columns: keyValues.map(v => ({ id: v.key.id, hidden: false })) } }] });
    }
    this.data.set(STORAGE_BINDING_FILE, clone(this.binding));
  }
  store = {
    loadData: async (name: string) => clone(this.data.get(name)),
    saveData: async (name: string, value: any) => {
      if (this.saveFailure === name) throw new Error('write unavailable');
      this.data.set(name, clone(value));
      if (this.saveResponseLost === name) { this.saveResponseLost = ''; throw new Error('save response lost'); }
    },
  };
  client = new SiYuanAVClient(async (path, raw) => {
    const body: any = raw; this.calls.push(path);
    if (path === '/api/av/getAttributeView') return { av: clone(this.avs.get(body.id)) };
    if (path === '/api/av/addAttributeViewKey') {
      const av = this.avs.get(body.avID);
      assert.ok(!av.keyValues.some((v: any) => v.key.id === body.keyID), 'Do not duplicate upgrade columns.');
      av.keyValues.push({ key: { id: body.keyID, type: body.keyType }, values: [] });
      av.views[0].table.columns.push({ id: body.keyID, hidden: false }); this.additions++;
      if (this.loseAddResponse) { this.loseAddResponse = false; throw new Error('column response lost'); }
      return null;
    }
    if (path === '/api/transactions') {
      for (const tx of body.transactions) for (const op of tx.doOperations) {
        assert.equal(op.action, 'setAttrViewColHidden');
        this.avs.get(op.avID).views.find((v: any) => v.id === op.viewID).table.columns.find((c: any) => c.id === op.id).hidden = op.data;
      }
      return null;
    }
    throw new Error(`Unexpected mutation ${path}`);
  });
  options = {
    preflight: async (_snapshot: LegacySnapshot) => {},
    verify: async (_client: SiYuanAVClient, binding: Binding) => {
      validateBinding(binding);
      for (const name of TABLE_NAMES) for (const field of getTableSpecs(binding.schemaVersion)[name].columns) {
        assert.equal(this.avs.get(binding.tables[name].avId).keyValues.find((v: any) => v.key.id === binding.tables[name].keys[field.field])?.key.type, field.type);
      }
    },
    repository: (binding: Binding) => ({
      load: async () => clone(binding.schemaVersion === 1 ? this.source : this.copied!),
      migrateNotesFromV1: async (snapshot: LegacySnapshot) => {
        assert.equal(binding.schemaVersion, 2); this.copies++;
        if (this.copied) assert.deepEqual(this.copied, snapshot, 'A changed rich cell must not be overwritten on retry.');
        this.copied = clone(snapshot);
        if (this.changeOriginalAfterCopy) this.source.tasks[0].notes = 'Native user changed the old note';
        if (this.loseCopyResponse) { this.loseCopyResponse = false; throw new Error('copy response lost'); }
      },
    }),
  };
  upgrade() { return upgradeNotesToRichText(this.store, this.client, this.binding, this.options); }
}

test('upgrade backs up current native data, adds rich/asset columns and leaves source activation to the caller', async () => {
  const f = new Fixture(); const before = clone(f.source);
  const result = await f.upgrade();
  assert.equal(result.binding.schemaVersion, 2);
  assert.deepEqual(result.snapshot, before);
  assert.deepEqual(f.data.get(NOTES_BACKUP_FILE).snapshot, before);
  assert.equal(f.data.get(NOTES_UPGRADE_FILE).phase, 'verified');
  assert.equal(f.additions, 8);
  assert.deepEqual(f.data.get(STORAGE_BINDING_FILE), f.binding);
  assert.ok(!f.data.has('things-storage-source.json'));
  for (const name of ['tasks', 'projects', 'areas', 'trashItems'] as const) {
    const table = result.binding.tables[name], view = f.avs.get(table.avId).views[0];
    assert.equal(view.table.columns.find((c: any) => c.id === table.keys.notesLink).hidden, true);
    assert.equal(view.table.columns.find((c: any) => c.id === table.keys.notes).hidden, false);
    assert.equal(view.table.columns.find((c: any) => c.id === table.keys.notesAssets).hidden, false);
  }
});

test('lost column response reuses persisted identities without duplicate columns', async () => {
  const f = new Fixture(); f.loseAddResponse = true;
  await assert.rejects(f.upgrade(), /column response lost/);
  const reserved = clone(f.data.get(NOTES_UPGRADE_FILE).binding);
  const result = await f.upgrade();
  assert.deepEqual(result.binding, reserved); assert.equal(f.additions, 8);
});

test('lost note-copy response can resume only the exact backup', async () => {
  const f = new Fixture(); f.loseCopyResponse = true;
  await assert.rejects(f.upgrade(), /copy response lost/);
  const result = await f.upgrade();
  assert.equal(f.additions, 8); assert.equal(f.copies, 2); assert.deepEqual(result.snapshot, f.source);
});

test('backup or intent storage failure prevents any native mutation', async () => {
  for (const name of [NOTES_BACKUP_FILE, NOTES_UPGRADE_FILE]) {
    const f = new Fixture(); f.saveFailure = name;
    await assert.rejects(f.upgrade(), /进度保存/);
    assert.equal(f.additions, 0); assert.equal(f.copies, 0);
  }
});

test('unsupported rich note content fails before backup, intent or native writes', async () => {
  const f = new Fixture();
  let checked: LegacySnapshot | undefined;
  f.options.preflight = async snapshot => { checked = clone(snapshot); throw new Error('unsupported note structure'); };
  await assert.rejects(f.upgrade(), /unsupported note structure/);
  assert.deepEqual(checked, f.source);
  assert.equal(f.data.has(NOTES_BACKUP_FILE), false);
  assert.equal(f.data.has(NOTES_UPGRADE_FILE), false);
  assert.equal(f.additions, 0);
  assert.equal(f.copies, 0);
  assert.deepEqual(f.data.get(STORAGE_BINDING_FILE), f.binding);
});

test('lost durable backup acknowledgement is verified by readback', async () => {
  const f = new Fixture(); f.saveResponseLost = NOTES_BACKUP_FILE;
  const result = await f.upgrade();
  assert.deepEqual(result.snapshot, f.source); assert.equal(f.additions, 8);
});

test('source changed after interrupted upgrade is kept and blocks retry', async () => {
  const f = new Fixture(); f.loseCopyResponse = true;
  await assert.rejects(f.upgrade());
  f.source.tasks[0].notes = 'A new user edit';
  await assert.rejects(f.upgrade(), /备份后发生变化/);
  assert.equal(f.copies, 1); assert.equal(f.source.tasks[0].notes, 'A new user edit');
});

test('a user edit during copying prevents activation and preserves original document', async () => {
  const f = new Fixture(); f.changeOriginalAfterCopy = true;
  await assert.rejects(f.upgrade(), /原文发生变化/);
  assert.equal(f.data.get(NOTES_UPGRADE_FILE).phase, 'copied');
  assert.deepEqual(f.data.get(STORAGE_BINDING_FILE), f.binding);
});

test('acknowledged column deletion and tampered targets fail closed', async () => {
  const f = new Fixture(); await f.upgrade();
  const intent = f.data.get(NOTES_UPGRADE_FILE), table = intent.binding.tables.tasks;
  f.avs.get(table.avId).keyValues = f.avs.get(table.avId).keyValues.filter((v: any) => v.key.id !== table.keys.notes);
  await assert.rejects(f.upgrade(), /被删除/); assert.equal(f.additions, 8);
  const g = new Fixture(); g.loseAddResponse = true; await assert.rejects(g.upgrade());
  g.data.get(NOTES_UPGRADE_FILE).binding.tables.tasks.avId = newSiyuanId();
  await assert.rejects(g.upgrade(), /改变了原数据库身份/); assert.equal(g.additions, 1);
});

test('already active V2 returns live data without replaying the historical upgrade', async () => {
  const f = new Fixture(); const result = await f.upgrade();
  f.copied!.tasks[0].notes = 'User edits after activation';
  const beforeCalls = f.calls.length;
  const next = await upgradeNotesToRichText(f.store, f.client, result.binding, f.options);
  assert.equal(next.snapshot.tasks[0].notes, 'User edits after activation');
  assert.equal(f.copies, 1); assert.equal(f.calls.length, beforeCalls);
});
