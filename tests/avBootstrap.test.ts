import assert from 'node:assert/strict';
import test from 'node:test';
import { SiYuanAVClient, newSiyuanId } from '../src/storage/avClient.ts';
import { TABLE_NAMES, TABLES } from '../src/storage/avSchema.ts';
import { ensureDatabases, STORAGE_BINDING_FILE, STORAGE_BOOTSTRAP_FILE } from '../src/storage/bootstrap.ts';

const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));

class MemorySettings {
  data = new Map<string, any>();
  async loadData(name: string) { return clone(this.data.get(name)); }
  async saveData(name: string, value: any) { this.data.set(name, clone(value)); }
}

/** Kernel response shapes follow SiYuan v3.8.8 (notably isDetached is a Value field). */
class Kernel {
  notebooks: any[] = [];
  blocks = new Map<string, any>();
  pendingBlocks = new Map<string, any>();
  deferIndex = false;
  avs = new Map<string, any>();
  calls: { path: string; body: any }[] = [];
  failAfter = '';
  failBefore = '';
  client = new SiYuanAVClient(async (path, body) => {
    this.calls.push({ path, body: clone(body) });
    if (this.failBefore === path) { this.failBefore = ''; throw new Error('network unavailable'); }
    const result = this.handle(path, body as any);
    if (this.failAfter === path) { this.failAfter = ''; throw new Error('response lost'); }
    return clone(result);
  });
  count(path: string) { return this.calls.filter((call) => call.path === path).length; }
  writes() { return this.calls.filter((call) => !['/api/query/sql', '/api/sqlite/flushTransaction', '/api/notebook/lsNotebooks', '/api/av/getAttributeView'].includes(call.path)); }
  handle(path: string, body: any): any {
    switch (path) {
      case '/api/sqlite/flushTransaction':
        for (const [id, value] of this.pendingBlocks) this.blocks.set(id, value);
        this.pendingBlocks.clear(); return null;
      case '/api/notebook/lsNotebooks': return { notebooks: this.notebooks };
      case '/api/notebook/createNotebook': {
        const notebook = { id: newSiyuanId(), name: body.name, closed: false };
        this.notebooks.push(notebook); return { notebook };
      }
      case '/api/notebook/renameNotebook': this.notebooks.find((entry) => entry.id === body.notebook).name = body.name; return null;
      case '/api/query/sql': {
        const id = body.stmt.match(/WHERE id = '([^']+)'/)?.[1];
        assert.ok(id, 'test SQL must identify one validated block');
        return this.blocks.has(id) ? [this.blocks.get(id)] : [];
      }
      case '/api/filetree/createDocWithMd':
        assert.ok(!this.blocks.has(body.id), 'must not create the same document twice');
        (this.deferIndex ? this.pendingBlocks : this.blocks).set(body.id, { id: body.id, root_id: body.id, box: body.notebook, type: 'd', markdown: body.markdown }); return body.id;
      case '/api/block/appendBlock': {
        const id = body.data.match(/data-node-id="([^"]+)"/)?.[1];
        assert.ok(id); assert.ok(!this.blocks.has(id), 'must not append the same carrier twice');
        const parent = this.blocks.get(body.parentID);
        (this.deferIndex ? this.pendingBlocks : this.blocks).set(id, { id, root_id: parent.id, box: parent.box, type: 'av', markdown: body.data }); return [];
      }
      case '/api/av/renderAttributeView': {
        if (!this.avs.has(body.id)) {
          const primaryId = newSiyuanId();
          this.avs.set(body.id, { id: body.id, name: '', views: [{ id: newSiyuanId(), type: 'table', table: { columns: [{ id: primaryId, hidden: false }] } }],
            keyValues: [{ key: { id: primaryId, type: 'block', name: '块' }, values: [] }] });
        }
        return {};
      }
      case '/api/av/getAttributeView': return { av: this.avs.get(body.id) ?? null };
      case '/api/av/addAttributeViewKey': {
        const av = this.avs.get(body.avID);
        assert.ok(!av.keyValues.some((entry: any) => entry.key.id === body.keyID), 'must not create a repeated column ID');
        av.keyValues.push({ key: { id: body.keyID, name: body.keyName, type: body.keyType }, values: [] });
        av.views[0].table.columns.push({ id: body.keyID, hidden: false }); return null;
      }
      case '/api/transactions': {
        for (const transaction of body.transactions) for (const op of transaction.doOperations) {
          const av = this.avs.get(op.avID);
          if (op.action === 'setAttrViewName') av.name = op.data;
          else {
            const key = av.keyValues.find((entry: any) => entry.key.id === (op.keyID || op.id)).key;
            if (op.action === 'updateAttrViewCol') { key.name = op.name; key.type = op.type; }
            else if (op.action === 'updateAttrViewColOptions') key.options = op.data;
            else if (op.action === 'updateAttrViewColRelation') key.relation = { avID: op.id, isTwoWay: op.isTwoWay };
            else if (op.action === 'setAttrViewColHidden') av.views.find((view: any) => view.id === op.viewID).table.columns.find((column: any) => column.id === op.id).hidden = op.data;
            else throw new Error(`Unknown transaction ${op.action}`);
          }
        }
        return null;
      }
      case '/api/av/addAttributeViewBlocks': {
        const primary = this.avs.get(body.avID).keyValues.find((entry: any) => entry.key.type === 'block');
        for (const source of body.srcs) {
          assert.equal(source.isDetached, true); assert.equal(source.id, source.itemID);
          primary.values.push({ id: newSiyuanId(), keyID: primary.key.id, blockID: source.itemID, type: 'block', isDetached: true, block: { id: source.id, content: source.content } });
        }
        return null;
      }
      case '/api/av/batchSetAttributeViewBlockAttrs': return null;
      case '/api/av/removeAttributeViewBlocks': return null;
      default: throw new Error(`Unexpected API ${path}`);
    }
  }
}

test('fresh install creates all native tables, typed fields and second-pass self/cross relations', async () => {
  const storage = new MemorySettings(); const kernel = new Kernel();
  const binding = await ensureDatabases(storage, kernel.client);
  assert.equal(binding.schemaVersion, 2);
  assert.equal(kernel.notebooks.length, 1);
  assert.equal(kernel.notebooks[0].name, 'Things');
  assert.equal(kernel.count('/api/filetree/createDocWithMd'), 8);
  assert.equal(kernel.count('/api/block/appendBlock'), 7);
  assert.equal(kernel.avs.size, 7);
  assert.deepEqual(storage.data.get(STORAGE_BINDING_FILE), binding);
  assert.equal(storage.data.get(STORAGE_BOOTSTRAP_FILE).phase, 'complete');
  for (const name of TABLE_NAMES) {
    const table = binding.tables[name]; const av = kernel.avs.get(table.avId);
    assert.equal(av.keyValues.length, TABLES[name].columns.length + 1);
    assert.equal(new Set(Object.values(table.keys)).size, Object.keys(table.keys).length);
    for (const column of TABLES[name].columns) {
      const key = av.keyValues.find((entry: any) => entry.key.id === table.keys[column.field]).key;
      assert.equal(key.type, column.type);
      if (column.relation) assert.equal(key.relation.avID, binding.tables[column.relation].avId);
    }
    assert.ok(av.keyValues.every((entry: any) => entry.values.length === 0));
    assert.equal(av.views[0].table.columns.find((column: any) => column.id === table.keys.id).hidden, true);
    assert.equal(av.views[0].table.columns.find((column: any) => column.id === table.keys[TABLES[name].titleField]).hidden, false);
  }
  for (const name of ['tasks', 'projects', 'areas', 'trashItems'] as const) {
    const table = binding.tables[name], av = kernel.avs.get(table.avId);
    assert.equal(av.keyValues.find((entry: any) => entry.key.id === table.keys.notes).key.type, 'text');
    assert.equal(av.keyValues.find((entry: any) => entry.key.id === table.keys.notesAssets).key.type, 'mAsset');
    assert.equal(av.views[0].table.columns.find((column: any) => column.id === table.keys.notesLink).hidden, true);
  }
  // Business records have scalar/relation columns; only recycle snapshots have a complete payload.
  for (const name of ['tasks', 'projects', 'areas', 'tags', 'headings'] as const) assert.ok(!TABLES[name].columns.some((column) => column.field === 'payload'));
});

test('existing binding is reused by ID after user renames without writes', async () => {
  const storage = new MemorySettings(); const kernel = new Kernel();
  const binding = await ensureDatabases(storage, kernel.client);
  for (const av of kernel.avs.values()) { av.name = 'User renamed'; for (const { key } of av.keyValues) key.name = 'Renamed'; }
  kernel.notebooks[0].name = 'My Tasks'; kernel.calls = [];
  assert.deepEqual(await ensureDatabases(storage, kernel.client), binding);
  assert.equal(kernel.writes().length, 0);
});

test('a V1 binding without rich note columns remains readable until an explicit upgrade', async () => {
  const storage = new MemorySettings(); const kernel = new Kernel();
  const binding = await ensureDatabases(storage, kernel.client);
  binding.schemaVersion = 1;
  for (const name of ['tasks', 'projects', 'areas', 'trashItems'] as const) {
    const table = binding.tables[name], av = kernel.avs.get(table.avId);
    for (const field of ['notes', 'notesAssets']) {
      av.keyValues = av.keyValues.filter((entry: any) => entry.key.id !== table.keys[field]);
      av.views[0].table.columns = av.views[0].table.columns.filter((column: any) => column.id !== table.keys[field]);
      delete table.keys[field];
    }
  }
  await storage.saveData(STORAGE_BINDING_FILE, binding); kernel.calls = [];
  assert.deepEqual(await ensureDatabases(storage, kernel.client), binding);
  assert.equal(kernel.writes().length, 0);
});

test('pending document index is flushed before absence checks and after a lost create response', async () => {
  const storage = new MemorySettings(); const kernel = new Kernel();
  kernel.deferIndex = true; kernel.failAfter = '/api/filetree/createDocWithMd';
  await assert.rejects(ensureDatabases(storage, kernel.client), /response lost/);
  assert.equal(kernel.pendingBlocks.size, 1);
  await ensureDatabases(storage, kernel.client);
  assert.equal(kernel.count('/api/filetree/createDocWithMd'), 8);
  assert.equal(kernel.pendingBlocks.size, 0);
  assert.equal(kernel.avs.size, 7);
});

for (const path of ['/api/notebook/createNotebook', '/api/filetree/createDocWithMd', '/api/block/appendBlock', '/api/av/renderAttributeView', '/api/av/addAttributeViewKey', '/api/transactions']) {
  test(`lost response after ${path} resumes without duplicate objects`, async () => {
    const storage = new MemorySettings(); const kernel = new Kernel(); kernel.failAfter = path;
    await assert.rejects(ensureDatabases(storage, kernel.client), /response lost/);
    assert.equal(storage.data.has(STORAGE_BINDING_FILE), false);
    await ensureDatabases(storage, kernel.client);
    assert.equal(kernel.notebooks.length, 1);
    assert.equal([...kernel.blocks.values()].filter((entry) => entry.type === 'd').length, 8);
    assert.equal([...kernel.blocks.values()].filter((entry) => entry.type === 'av').length, 7);
    assert.equal(kernel.avs.size, 7);
  });
}

test('a same-named unbound notebook is not claimed', async () => {
  const storage = new MemorySettings(); const kernel = new Kernel();
  const unrelated = { id: newSiyuanId(), name: 'Things', closed: false }; kernel.notebooks.push(unrelated);
  const binding = await ensureDatabases(storage, kernel.client);
  assert.notEqual(binding.notebookId, unrelated.id);
  assert.equal(kernel.notebooks.length, 2);
  assert.match(kernel.notebooks.find((entry) => entry.id === binding.notebookId).name, /^Things [a-z0-9]{7}$/);
});

test('failed intent save cannot create resources and an acknowledged binding survives a lost save response', async () => {
  const storage = new MemorySettings(); const kernel = new Kernel();
  const originalSave = storage.saveData.bind(storage);
  storage.saveData = async () => { throw new Error('storage unavailable'); };
  await assert.rejects(ensureDatabases(storage, kernel.client), /storage unavailable/);
  assert.equal(kernel.calls.length, 0);
  storage.saveData = async (name, value) => {
    await originalSave(name, value);
    if (name === STORAGE_BINDING_FILE) throw new Error('binding response lost');
  };
  await assert.rejects(ensureDatabases(storage, kernel.client), /binding response lost/);
  kernel.calls = []; storage.saveData = originalSave;
  await ensureDatabases(storage, kernel.client);
  assert.equal(kernel.writes().length, 0);
  assert.equal(kernel.notebooks.length, 1);
});

test('missing or corrupted bound database fails closed without recreating it', async () => {
  for (const damage of ['document', 'carrier', 'database', 'column', 'relation'] as const) {
    const storage = new MemorySettings(); const kernel = new Kernel();
    const binding = await ensureDatabases(storage, kernel.client);
    const table = binding.tables.tasks;
    if (damage === 'document') kernel.blocks.delete(binding.docId);
    if (damage === 'carrier') kernel.blocks.delete(table.blockId);
    if (damage === 'database') kernel.avs.delete(table.avId);
    if (damage === 'column') kernel.avs.get(table.avId).keyValues = kernel.avs.get(table.avId).keyValues.filter((entry: any) => entry.key.id !== table.keys.id);
    if (damage === 'relation') kernel.avs.get(table.avId).keyValues.find((entry: any) => entry.key.id === table.keys.projectId).key.relation.avID = newSiyuanId();
    kernel.calls = [];
    await assert.rejects(ensureDatabases(storage, kernel.client), /Things/);
    assert.equal(kernel.writes().length, 0, damage);
  }
});

test('a database deleted during partial bootstrap is not recreated after its primary ID was saved', async () => {
  const storage = new MemorySettings(); const kernel = new Kernel(); kernel.failAfter = '/api/av/addAttributeViewKey';
  await assert.rejects(ensureDatabases(storage, kernel.client));
  const intent = storage.data.get(STORAGE_BOOTSTRAP_FILE);
  assert.ok(intent.tables.tasks.keys.title);
  kernel.avs.delete(intent.tables.tasks.avId); kernel.calls = [];
  await assert.rejects(ensureDatabases(storage, kernel.client), /不可读取/);
  assert.equal(kernel.count('/api/av/renderAttributeView'), 0);
});

test('corrupt saved intent is rejected before any kernel request', async () => {
  const storage = new MemorySettings(); const kernel = new Kernel(); kernel.failBefore = '/api/notebook/lsNotebooks';
  await assert.rejects(ensureDatabases(storage, kernel.client));
  storage.data.get(STORAGE_BOOTSTRAP_FILE).tables.tasks.blockId = "x' OR 1=1";
  kernel.calls = [];
  await assert.rejects(ensureDatabases(storage, kernel.client), /初始化记录损坏/);
  assert.equal(kernel.calls.length, 0);
});

test('read errors are not interpreted as an empty install and concurrent calls share one initialization', async () => {
  const storage = new MemorySettings(); const kernel = new Kernel(); kernel.failBefore = '/api/notebook/lsNotebooks';
  await assert.rejects(ensureDatabases(storage, kernel.client), /network unavailable/);
  assert.equal(kernel.writes().length, 0);
  const first = ensureDatabases(storage, kernel.client); const second = ensureDatabases(storage, kernel.client);
  assert.equal(first, second); await Promise.all([first, second]);
  assert.equal(kernel.notebooks.length, 1);
});

test('detached row retries preserve the separate item ID and reject collisions with bound blocks', async () => {
  const storage = new MemorySettings(); const kernel = new Kernel();
  const binding = await ensureDatabases(storage, kernel.client); const avId = binding.tables.tasks.avId;
  const itemId = newSiyuanId(); kernel.failAfter = '/api/av/addAttributeViewBlocks';
  await assert.rejects(kernel.client.addRow(avId, itemId, 'Test task'), /response lost/);
  await kernel.client.addRow(avId, itemId, 'Test task');
  assert.equal(kernel.count('/api/av/addAttributeViewBlocks'), 1);
  const value = kernel.avs.get(avId).keyValues.find((entry: any) => entry.key.type === 'block').values[0];
  assert.equal(value.blockID, itemId); value.isDetached = false;
  await assert.rejects(kernel.client.addRow(avId, itemId, 'Replacement'), /绑定记录占用/);
  const cells = [{ itemID: itemId, keyID: binding.tables.tasks.keys.id, value: { type: 'text', text: { content: 'business-id' } } }];
  await kernel.client.setCells(avId, cells);
  assert.deepEqual(kernel.calls.at(-1)?.body, { avID: avId, values: cells });
  await kernel.client.removeRows(avId, [itemId]);
  assert.deepEqual(kernel.calls.at(-1)?.body, { avID: avId, srcIDs: [itemId] });
});
