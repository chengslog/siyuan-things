import assert from 'node:assert/strict';
import test from 'node:test';
import { SiYuanAVClient, newSiyuanId } from '../src/storage/avClient.ts';
import { TABLE_NAMES, TABLES } from '../src/storage/avSchema.ts';
import { ensureDatabases, verifyDatabaseBinding, STORAGE_BINDING_FILE, STORAGE_BOOTSTRAP_FILE } from '../src/storage/bootstrap.ts';
import { CENTER_MARK, CENTER_BINDING, CENTER_INITIALIZING, discoverDatabase, SELECTION_FILE } from '../src/storage/discovery.ts';
import { repairStoredLocation, LOCATION_REPAIR_FILE } from '../src/storage/location.ts';
import { relocateDatabase, MOVE_FILE } from '../src/storage/relocation.ts';
import { StorageCoordinator, SOURCE_FILE } from '../src/storage/coordinator.ts';

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
  attrs = new Map<string, any>();
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
  writes() { return this.calls.filter((call) => !['/api/sync/getBootSync', '/api/attr/getBlockAttrs', '/api/query/sql', '/api/sqlite/flushTransaction', '/api/notebook/lsNotebooks', '/api/av/getAttributeView'].includes(call.path)); }
  handle(path: string, body: any): any {
    switch (path) {
      case '/api/system/version': return '3.8.9';
      case '/api/sync/getBootSync': return null;
      case '/api/attr/getBlockAttrs': return this.attrs.get(body.id) || {};
      case '/api/attr/setBlockAttrs': this.attrs.set(body.id, { ...this.attrs.get(body.id), ...body.attrs }); return null;
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
        if (body.stmt.includes('ORDER BY id LIMIT 500')) {
          const id = body.stmt.match(/root_id = '([^']+)'/)![1];
          const offset = Number(body.stmt.match(/OFFSET (\d+)/)?.[1]);
          return [...this.blocks.values()].filter(b => b.root_id === id || b.path?.includes('/' + id + '/')).sort((a,b) => a.id.localeCompare(b.id)).slice(offset,offset+500);
        }
        if (body.stmt.includes('ORDER BY id LIMIT 200')) {
          let selected = [...this.blocks.values()].filter(b => body.stmt.includes("type = 'av'") ? b.type === 'av' : b.type === 'd' && (this.attrs.get(b.id)?.[CENTER_MARK] || this.attrs.get(b.id)?.[CENTER_INITIALIZING]));
          selected.sort((a, b) => a.id.localeCompare(b.id));
          const offset = Number(body.stmt.match(/OFFSET (\d+)/)?.[1]);
          return selected.slice(offset, offset + 200);
        }
        const batch = body.stmt.match(/WHERE id IN \(([^)]+)\)/)?.[1];
        if (batch) return [...batch.matchAll(/'([^']+)'/g)].flatMap(match => this.blocks.has(match[1]) ? [this.blocks.get(match[1])] : []);
        const id = body.stmt.match(/WHERE id = '([^']+)'/)?.[1];
        assert.ok(id, 'test SQL must identify one validated block');
        return this.blocks.has(id) ? [this.blocks.get(id)] : [];
      }
      case '/api/filetree/createDocWithMd':
        assert.ok(!this.blocks.has(body.id), 'must not create the same document twice');
        (this.deferIndex ? this.pendingBlocks : this.blocks).set(body.id, { id: body.id, root_id: body.id, box: body.notebook, type: 'd', markdown: body.markdown,
          path: body.parentID ? this.blocks.get(body.parentID).path.replace(/\.sy$/, '') + '/' + body.id + '.sy' : '/' + body.id + '.sy' }); return body.id;
      case '/api/export/exportSY': return { zip: '/export/backup.sy.zip' };
      case '/api/filetree/moveDocsByID':
        for (const id of body.fromIDs) for (const b of this.blocks.values()) if (b.root_id === id || b.path?.includes('/' + id + '/')) b.box = body.toID;
        return null;
      case '/api/block/appendBlock': {
        const id = body.data.match(/data-node-id="([^"]+)"/)?.[1];
        assert.ok(id); assert.ok(!this.blocks.has(id), 'must not append the same carrier twice');
        const parent = this.blocks.get(body.parentID);
        (this.deferIndex ? this.pendingBlocks : this.blocks).set(id, { id, root_id: parent.id, box: parent.box, type: 'av', markdown: body.data, path: parent.path }); return [];
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
  assert.equal(kernel.notebooks[0].name, '数据库');
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

test('binding verification batches indexed blocks and overlaps independent table reads', async () => {
  const storage = new MemorySettings(); const kernel = new Kernel();
  const binding = await ensureDatabases(storage, kernel.client);
  // Simulate the index still catching up; the one barrier must expose every block.
  kernel.pendingBlocks = new Map(kernel.blocks);
  kernel.blocks.clear();
  kernel.calls = [];
  const releases: Array<() => void> = [];
  const client = new SiYuanAVClient(async (path, body) => {
    if (path === '/api/av/getAttributeView') await new Promise<void>(resolve => releases.push(resolve));
    return kernel.client.request(path, body);
  });
  const verifying = verifyDatabaseBinding(client, binding);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(releases.length, TABLE_NAMES.length, 'all independent table reads start before any finishes');
  assert.equal(kernel.count('/api/sqlite/flushTransaction'), 1);
  assert.equal(kernel.count('/api/query/sql'), 1);
  for (const release of releases) release();
  await verifying;
  assert.equal(kernel.calls.length, 10, 'one notebook read, one barrier, one block query, seven tables');
  assert.equal(kernel.writes().length, 0);
});

test('task-write ownership checks avoid table reads but still reject removed carriers', async () => {
  const storage = new MemorySettings(), kernel = new Kernel();
  const binding = await ensureDatabases(storage, kernel.client);
  kernel.calls = [];
  await verifyDatabaseBinding(kernel.client, binding, false);
  assert.equal(kernel.calls.length, 3);
  assert.equal(kernel.count('/api/av/getAttributeView'), 0);
  kernel.blocks.delete(binding.tables.tasks.blockId);
  await assert.rejects(verifyDatabaseBinding(kernel.client, binding, false), /缺失|替换/);
});

test('parallel verification still rejects a damaged final table and retries with fresh data', async () => {
  const storage = new MemorySettings(); const kernel = new Kernel();
  const binding = await ensureDatabases(storage, kernel.client);
  const last = binding.tables[TABLE_NAMES.at(-1)!];
  const av = kernel.avs.get(last.avId);
  const key = av.keyValues[0].key;
  key.type = 'text';
  await assert.rejects(verifyDatabaseBinding(kernel.client, binding), /字段缺失或类型被改变/);
  key.type = 'block';
  await verifyDatabaseBinding(kernel.client, binding);
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
  await storage.saveData(STORAGE_BINDING_FILE, binding);
  kernel.attrs.get(binding.docId)[CENTER_BINDING] = JSON.stringify(binding); kernel.calls = [];
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
  assert.equal(kernel.notebooks.find((entry) => entry.id === binding.notebookId).name, '数据库');
});

test('failed intent save cannot create resources and an acknowledged binding survives a lost save response', async () => {
  const storage = new MemorySettings(); const kernel = new Kernel();
  const originalSave = storage.saveData.bind(storage);
  storage.saveData = async () => { throw new Error('storage unavailable'); };
  await assert.rejects(ensureDatabases(storage, kernel.client), /storage unavailable/);
  assert.equal(kernel.writes().length, 0);
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
  const storage = new MemorySettings(); const kernel = new Kernel(); kernel.failBefore = '/api/notebook/createNotebook';
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

test('fresh install reuses the shared notebook without modifying another plugin or renaming it', async () => {
  const storage = new MemorySettings(), kernel = new Kernel();
  const notebook = { id: newSiyuanId(), name: '数据库', closed: false }; kernel.notebooks.push(notebook);
  const other = { id: newSiyuanId(), type: 'd', box: notebook.id, content: '投资手记' }; kernel.blocks.set(other.id, other);
  const binding = await ensureDatabases(storage, kernel.client);
  assert.equal(binding.notebookId, notebook.id); assert.equal(kernel.count('/api/notebook/createNotebook'), 0);
  assert.equal(kernel.count('/api/notebook/renameNotebook'), 0); assert.deepEqual(kernel.blocks.get(other.id), other);
  for (const call of kernel.calls.filter(c => c.path === '/api/filetree/createDocWithMd' && c.body.id !== binding.docId)) assert.equal(call.body.parentID, binding.docId);
});

test('closed notebooks and failed synchronization never count as an empty installation', async () => {
  for (const mode of ['closed', 'sync']) {
    const storage = new MemorySettings(), kernel = new Kernel();
    if (mode === 'closed') kernel.notebooks.push({ id: newSiyuanId(), name: '数据库', closed: true });
    else kernel.failBefore = '/api/sync/getBootSync';
    await assert.rejects(ensureDatabases(storage, kernel.client));
    assert.equal(kernel.writes().length, 0); assert.equal(storage.data.has(STORAGE_BINDING_FILE), false);
  }
});

test('same-name notebooks require one explicit choice and persist the chosen ID', async () => {
  const storage = new MemorySettings(), kernel = new Kernel();
  kernel.notebooks.push(...[1, 2].map(() => ({ id: newSiyuanId(), name: '数据库', closed: false })));
  let choices = 0;
  const b = await ensureDatabases(storage, kernel.client, { choose: async (kind, candidates) => {
    choices++; assert.equal(kind, 'notebook'); return candidates[1].id;
  } });
  assert.equal(b.notebookId, kernel.notebooks[1].id); assert.equal(choices, 1);
  kernel.notebooks[1].name = '资料库';
  await ensureDatabases(storage, kernel.client, { choose: async () => { throw new Error('must not ask again'); } });
  assert.equal(storage.data.get(SELECTION_FILE).notebook.id, b.notebookId);
});

test('moved centers resolve by document and AV identity with unchanged hot-write request budget', async () => {
  const storage = new MemorySettings(), kernel = new Kernel();
  const b = await ensureDatabases(storage, kernel.client);
  const next = { id: newSiyuanId(), name: 'New name', closed: false }; kernel.notebooks.push(next);
  for (const block of kernel.blocks.values()) block.box = next.id;
  kernel.notebooks[0].closed = true; kernel.calls = [];
  await verifyDatabaseBinding(kernel.client, b, false);
  assert.equal(b.notebookId, next.id); assert.equal(kernel.calls.length, 3);
  assert.equal(kernel.count('/api/av/getAttributeView'), 0);
});

test('reinstall discovers a marked center despite renamed notebook, center, tables and columns', async () => {
  const storage = new MemorySettings(), kernel = new Kernel(); const b = await ensureDatabases(storage, kernel.client);
  for (const av of kernel.avs.values()) { av.name = 'renamed'; for (const k of av.keyValues) k.key.name = 'renamed'; }
  kernel.notebooks[0].name = 'Not Things'; kernel.blocks.get(b.docId).content = 'renamed';
  kernel.calls = [];
  assert.deepEqual(await ensureDatabases(new MemorySettings(), kernel.client), b);
  assert.equal(kernel.writes().length, 0); assert.equal(kernel.avs.size, 7);
});

test('legacy unmarked center recovers by seven typed schemas and adds identity only after validation', async () => {
  const storage = new MemorySettings(), kernel = new Kernel(); const b = await ensureDatabases(storage, kernel.client);
  kernel.attrs.clear(); kernel.blocks.get(b.docId).content = '改名的数据'; kernel.calls = [];
  assert.deepEqual(await ensureDatabases(new MemorySettings(), kernel.client), b);
  assert.equal(kernel.count('/api/filetree/createDocWithMd'), 0);
  assert.equal(kernel.attrs.get(b.docId)[CENTER_MARK], '1');
});

test('partial or damaged legacy schemas stop recovery without provisioning a replacement', async () => {
  const storage = new MemorySettings(), kernel = new Kernel(); const b = await ensureDatabases(storage, kernel.client);
  kernel.attrs.clear(); kernel.avs.get(b.tables.tasks.avId).keyValues.pop(); kernel.calls = [];
  await assert.rejects(ensureDatabases(new MemorySettings(), kernel.client), /未完成|改动|重复/);
  assert.equal(kernel.writes().length, 0);
});

test('incomplete center identity prevents other devices from creating another center', async () => {
  const storage = new MemorySettings(), kernel = new Kernel(); kernel.failBefore = '/api/block/appendBlock';
  await assert.rejects(ensureDatabases(storage, kernel.client)); kernel.calls = [];
  await assert.rejects(ensureDatabases(new MemorySettings(), kernel.client), /未完成初始化/);
  assert.equal(kernel.count('/api/filetree/createDocWithMd'), 0);
  await ensureDatabases(storage, kernel.client); assert.equal(kernel.avs.size, 7);
});

test('multiple valid centers select once without merging, deleting or moving either center', async () => {
  const a = new Kernel(), b = new Kernel(); const ba = await ensureDatabases(new MemorySettings(), a.client);
  const bb = await ensureDatabases(new MemorySettings(), b.client);
  a.notebooks.push(...b.notebooks);
  for (const [key, value] of b.blocks) a.blocks.set(key, value);
  for (const [key, value] of b.avs) a.avs.set(key, value);
  for (const [key, value] of b.attrs) a.attrs.set(key, value);
  const storage = new MemorySettings(); let count = 0; a.calls = [];
  const options = { choose: async (kind: string, choices: any[]) => { assert.equal(kind, 'database'); assert.equal(choices.length, 2); count++; return bb.docId; } };
  assert.equal((await discoverDatabase(storage, a.client, options))!.docId, bb.docId);
  assert.equal((await discoverDatabase(storage, a.client, options))!.docId, bb.docId);
  assert.equal(count, 1); assert.ok(a.blocks.has(ba.docId)); assert.equal(a.writes().length, 0);
});

test('distinct settings wrappers still coordinate concurrent initialization in one runtime', async () => {
  const storage = new MemorySettings(), kernel = new Kernel();
  const wrapper = { loadData: storage.loadData.bind(storage), saveData: storage.saveData.bind(storage) };
  const [a, b] = await Promise.all([ensureDatabases(storage, kernel.client), ensureDatabases(wrapper, kernel.client)]);
  assert.deepEqual(a, b); assert.equal(kernel.notebooks.length, 1); assert.equal(kernel.avs.size, 7);
});

test('location configuration repair resumes a partial commit and preserves pending writes', async () => {
  const storage = new MemorySettings(), kernel = new Kernel(); const b = await ensureDatabases(storage, kernel.client);
  storage.data.set('things-storage-source.json', { schemaVersion: 1, mode: 'database', binding: clone(b) });
  storage.data.set('things-storage-write-intent-v1.json', { binding: clone(b), desired: { tasks: ['untouched'] } });
  const moved = { ...b, notebookId: newSiyuanId() };
  const save = storage.saveData.bind(storage); let block = true;
  storage.saveData = async (name, value) => { if (name === STORAGE_BINDING_FILE && block) throw new Error('write failed'); return save(name, value); };
  await assert.rejects(repairStoredLocation(storage, moved), /尚未保存/);
  assert.ok(storage.data.get(LOCATION_REPAIR_FILE)); assert.equal(storage.data.get('things-storage-source.json').binding.notebookId, moved.notebookId);
  block = false; await repairStoredLocation(storage, moved);
  assert.equal(storage.data.get(LOCATION_REPAIR_FILE), null);
  assert.deepEqual(storage.data.get(STORAGE_BINDING_FILE), moved);
  assert.deepEqual(storage.data.get('things-storage-write-intent-v1.json'), { binding: moved, desired: { tasks: ['untouched'] } });
  assert.equal(storage.data.get(STORAGE_BOOTSTRAP_FILE).notebookId, moved.notebookId);
});

test('explicit relocation preserves all IDs and table contents across lost move responses and repeats', async () => {
  const storage = new MemorySettings(), kernel = new Kernel(); const b = await ensureDatabases(storage, kernel.client);
  storage.data.set('things-storage-source.json', { schemaVersion: 1, mode: 'database', binding: clone(b) });
  const target = { id: newSiyuanId(), name: '数据库', closed: false }; kernel.notebooks.push(target);
  const avs = clone([...kernel.avs]), ids = [...kernel.blocks.keys()]; kernel.calls = [];
  kernel.failAfter = '/api/filetree/moveDocsByID';
  await assert.rejects(relocateDatabase(storage, kernel.client, b, target.id), /response lost/);
  assert.equal(storage.data.get(MOVE_FILE).phase, 'backed-up');
  await relocateDatabase(storage, kernel.client, b, target.id);
  await relocateDatabase(storage, kernel.client, b, target.id);
  assert.equal(storage.data.get(MOVE_FILE).phase, 'complete');
  assert.equal(kernel.count('/api/filetree/moveDocsByID'), 1); assert.equal(kernel.count('/api/export/exportSY'), 1);
  assert.deepEqual([...kernel.avs], avs); assert.deepEqual([...kernel.blocks.keys()], ids);
  assert.equal(storage.data.get('things-storage-source.json').binding.notebookId, target.id);
  assert.equal(kernel.count('/api/notebook/removeNotebook'), 0);
});

test('an interrupted relocation refuses changed data without moving or overwriting it', async () => {
  const storage = new MemorySettings(), kernel = new Kernel(); const b = await ensureDatabases(storage, kernel.client);
  const target = { id: newSiyuanId(), name: '数据库', closed: false }; kernel.notebooks.push(target);
  kernel.failBefore = '/api/filetree/moveDocsByID';
  await assert.rejects(relocateDatabase(storage, kernel.client, b, target.id));
  kernel.avs.get(b.tables.tasks.avId).keyValues[0].values.push({ blockID: newSiyuanId() }); kernel.calls = [];
  await assert.rejects(relocateDatabase(storage, kernel.client, b, target.id), /备份不一致/);
  assert.equal(kernel.writes().length, 0); assert.equal(storage.data.get(MOVE_FILE).phase, 'backed-up');
});

test('coordinator resumes its own partial bootstrap instead of treating it as a foreign incomplete center', async () => {
  const storage = new MemorySettings(), kernel = new Kernel();
  const empty = { tasks: [], archived: [], trash: [], projects: [], areas: [], tags: [] };
  const create = () => new StorageCoordinator(storage, kernel.client, { ensureViews: async () => {},
    repository: () => ({ load: async () => empty, import: async () => {}, preflightSnapshot: async () => {}, saveSnapshot: async () => {}, recoverPending: async () => {} }) });
  kernel.failBefore = '/api/block/appendBlock';
  await assert.rejects(create().start());
  assert.ok(storage.data.get(STORAGE_BOOTSTRAP_FILE)); assert.equal(storage.data.has(SOURCE_FILE), false);
  const restarted = create(); await restarted.start();
  assert.equal(restarted.mode, 'database'); assert.equal(kernel.avs.size, 7); assert.equal(kernel.notebooks.length, 1);
});
