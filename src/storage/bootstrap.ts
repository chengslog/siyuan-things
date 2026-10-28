import { TABLE_NAMES, TABLES, getTableSpecs, type TableName } from './avSchema.ts';
import { newSiyuanId, SiYuanAVClient } from './avClient.ts';

export const STORAGE_BINDING_FILE = 'things-database-binding.json';
export const STORAGE_BOOTSTRAP_FILE = 'things-database-bootstrap.json';
export interface SettingsStore {
  loadData(name: string): Promise<any>;
  saveData(name: string, data: any): Promise<any>;
}
export interface TableBinding {
  avId: string;
  blockId: string;
  docId?: string;
  keys: Record<string, string>;
}
export interface Binding {
  schemaVersion: 1 | 2;
  notebookId: string;
  docId: string;
  tables: Record<TableName, TableBinding>;
}
interface BootstrapIntent extends Binding {
  token: string;
  notebookName: string;
  phase: 'planned' | 'building' | 'complete';
  readyTables: TableName[];
  createdDocs: string[];
}

const inflight = new WeakMap<SettingsStore, Promise<Binding>>();
const ID_PATTERN = /^\d{14}-[a-z0-9]{7}$/;
const HIDDEN_FIELDS = new Set(['id', 'extra', 'presence', 'sourceIndex', 'notesDocId', 'tagOrder',
  'groupOrder', 'collapsedGroups', 'recurrenceSourceId', 'recurrenceGeneratedAt', 'blockId', 'payload', 'taskId']);
const isId = (value: unknown): value is string => typeof value === 'string' && ID_PATTERN.test(value);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export function validateBinding(value: any): asserts value is Binding {
  if (![1, 2].includes(value?.schemaVersion) || !isId(value.docId) || !isId(value.notebookId)) {
    throw new Error('Things 数据库绑定损坏或版本不支持，请先恢复绑定');
  }
  const specs = getTableSpecs(value.schemaVersion);
  for (const name of TABLE_NAMES) {
    const table = value.tables?.[name];
    const fields = [specs[name].titleField, ...specs[name].columns.map((column) => column.field)];
    if (!table || !isId(table.avId) || !isId(table.blockId) || fields.some((field) => !isId(table.keys?.[field]))) {
      throw new Error(`Things 数据库 ${name} 的绑定不完整`);
    }
    if (new Set(Object.values(table.keys)).size !== Object.keys(table.keys).length) throw new Error(`Things 数据库 ${name} 的字段绑定重复`);
  }
  if (new Set(TABLE_NAMES.map((name) => value.tables[name].avId)).size !== TABLE_NAMES.length
    || new Set(TABLE_NAMES.map((name) => value.tables[name].blockId)).size !== TABLE_NAMES.length) {
    throw new Error('Things 数据库绑定指向了重复表');
  }
}

function validateIntent(value: any): asserts value is BootstrapIntent {
  const fail = () => { throw new Error('Things 数据库初始化记录损坏，请先恢复记录'); };
  if (![1, 2].includes(value?.schemaVersion) || !isId(value.docId) || !isId(value.token)
    || value.notebookName !== `Things 初始化 ${value.token}`
    || !['planned', 'building', 'complete'].includes(value.phase)
    || (value.notebookId !== '' && !isId(value.notebookId))
    || !Array.isArray(value.readyTables) || value.readyTables.some((name: any) => !TABLE_NAMES.includes(name))
    || !Array.isArray(value.createdDocs)) fail();
  const reservedIds = [value.docId];
  const specs = getTableSpecs(value.schemaVersion);
  for (const name of TABLE_NAMES) {
    const table = value.tables?.[name];
    if (!table || !isId(table.avId) || !isId(table.blockId) || !isId(table.docId)) fail();
    reservedIds.push(table.avId, table.blockId, table.docId);
    for (const column of specs[name].columns) {
      if (!isId(table.keys?.[column.field])) fail();
      reservedIds.push(table.keys[column.field]);
    }
    const primary = table.keys?.[specs[name].titleField];
    if ((primary !== undefined && !isId(primary)) || (value.readyTables.includes(name) && !primary)) fail();
  }
  if (new Set(reservedIds).size !== reservedIds.length
    || new Set(value.readyTables).size !== value.readyTables.length
    || (value.phase === 'planned' ? value.notebookId !== '' : !isId(value.notebookId))
    || (value.phase === 'complete' && value.readyTables.length !== TABLE_NAMES.length)
    || value.createdDocs.some((id: any) => id !== value.docId && !TABLE_NAMES.some((name) => value.tables[name].docId === id))
    || (!value.notebookId && (value.readyTables.length || value.createdDocs.length))) fail();
}

async function persist(storage: SettingsStore, name: string, value: unknown): Promise<void> {
  const snapshot = clone(value);
  await storage.saveData(name, snapshot);
  if (JSON.stringify(await storage.loadData(name)) !== JSON.stringify(snapshot)) {
    throw new Error('Things 数据库初始化进度保存后校验失败');
  }
}

async function getBlock(client: SiYuanAVClient, id: string): Promise<any | undefined> {
  if (!isId(id)) throw new Error('Things 数据库记录含无效块 ID');
  // Document creation and block transactions may return before the SQLite index is current.
  // Flush before testing absence, otherwise a retry could recreate a successfully written object.
  await client.request('/api/sqlite/flushTransaction', {});
  const rows = await client.request('/api/query/sql', { stmt: `SELECT id, root_id, box, type, markdown FROM blocks WHERE id = '${id}' LIMIT 1`, mode: 'readonly' });
  if (!Array.isArray(rows)) throw new Error('Things 无法确认数据中心文档是否存在');
  return rows[0];
}

/** Validates an existing binding only. Never creates documents, tables, or replacement fields. */
export async function verifyDatabaseBinding(client: SiYuanAVClient, binding: Binding): Promise<void> {
  validateBinding(binding);
  const specs = getTableSpecs(binding.schemaVersion);
  const notebooks = (await client.request('/api/notebook/lsNotebooks', {}))?.notebooks;
  if (!Array.isArray(notebooks)) throw new Error('Things 无法读取笔记本列表');
  const notebook = notebooks.find((item: any) => item.id === binding.notebookId);
  if (!notebook || notebook.closed) throw new Error('Things 数据笔记本不存在或已关闭，请打开原笔记本');
  const doc = await getBlock(client, binding.docId);
  if (!doc || doc.type !== 'd' || doc.box !== binding.notebookId) throw new Error('Things 数据中心文档不存在，已停止自动新建');
  for (const name of TABLE_NAMES) {
    const table = binding.tables[name];
    const carrier = await getBlock(client, table.blockId);
    if (!carrier || carrier.box !== binding.notebookId || carrier.type !== 'av' || !String(carrier.markdown || '').includes(table.avId)) {
      throw new Error(`Things「${specs[name].name}」的数据库承载块缺失或已替换`);
    }
    const av = await client.getAV(table.avId);
    const fields = [{ field: specs[name].titleField, type: 'block', relation: undefined }, ...specs[name].columns];
    for (const field of fields) {
      const key = av.keyValues.find((entry: any) => entry.key?.id === table.keys[field.field])?.key;
      if (!key || key.type !== field.type) throw new Error(`Things「${specs[name].name}.${field.field}」字段缺失或类型被改变`);
      if (field.relation && key.relation?.avID !== binding.tables[field.relation].avId) {
        throw new Error(`Things「${specs[name].name}.${field.field}」关联目标被改变`);
      }
    }
  }
}

function plan(): BootstrapIntent {
  const token = newSiyuanId();
  const tables = {} as Record<TableName, TableBinding>;
  for (const name of TABLE_NAMES) {
    tables[name] = { avId: newSiyuanId(), blockId: newSiyuanId(), docId: newSiyuanId(), keys: {} };
    for (const column of TABLES[name].columns) tables[name].keys[column.field] = newSiyuanId();
  }
  return { schemaVersion: 2, token, notebookName: `Things 初始化 ${token}`, notebookId: '', docId: newSiyuanId(), tables, phase: 'planned', readyTables: [], createdDocs: [] };
}

async function createDoc(storage: SettingsStore, client: SiYuanAVClient, intent: BootstrapIntent, id: string, path: string, markdown: string): Promise<void> {
  const exists = await getBlock(client, id);
  if (exists) {
    if (exists.type !== 'd' || exists.box !== intent.notebookId) throw new Error('Things 文档 ID 已被其他内容占用');
  } else {
    if (intent.createdDocs.includes(id)) throw new Error('Things 已创建的数据文档丢失，已停止自动新建');
    await client.request('/api/filetree/createDocWithMd', { notebook: intent.notebookId, id, path, markdown });
    const created = await waitForBlock(client, id);
    if (created.type !== 'd' || created.box !== intent.notebookId) throw new Error('Things 数据文档创建后校验失败');
  }
  if (!intent.createdDocs.includes(id)) {
    intent.createdDocs.push(id);
    await persist(storage, STORAGE_BOOTSTRAP_FILE, intent);
  }
}

async function waitForBlock(client: SiYuanAVClient, id: string): Promise<any> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const block = await getBlock(client, id);
    if (block) return block;
    await new Promise((resolve) => setTimeout(resolve, 60 * (attempt + 1)));
  }
  throw new Error('Things 数据块创建后尚未验证完成，下次启动可继续');
}

/** Bounded readback, since the generic transactions endpoint can finish before its AV update is visible. */
async function waitForAV(client: SiYuanAVClient, avId: string, predicate: (av: any) => boolean): Promise<any> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const av = await client.getAV(avId);
    if (predicate(av)) return av;
    await new Promise((resolve) => setTimeout(resolve, 60 * (attempt + 1)));
  }
  throw new Error('Things 数据库配置写入后尚未验证完成，下次启动可继续');
}

async function initialize(storage: SettingsStore, client: SiYuanAVClient): Promise<Binding> {
  const existing = await storage.loadData(STORAGE_BINDING_FILE);
  if (existing !== undefined && existing !== null && existing !== '') {
    await verifyDatabaseBinding(client, existing);
    return existing;
  }
  let intent: BootstrapIntent = await storage.loadData(STORAGE_BOOTSTRAP_FILE);
  if (intent) {
    validateIntent(intent);
  } else {
    intent = plan();
    await persist(storage, STORAGE_BOOTSTRAP_FILE, intent);
  }

  const notebooks = (await client.request('/api/notebook/lsNotebooks', {}))?.notebooks;
  if (!Array.isArray(notebooks)) throw new Error('Things 无法读取笔记本列表');
  if (intent.notebookId) {
    const found = notebooks.find((item: any) => item.id === intent.notebookId);
    if (!found || found.closed) throw new Error('Things 正在初始化的笔记本缺失或已关闭');
  } else {
    // Only the unique name saved before create is eligible for ambiguous-response recovery.
    const matches = notebooks.filter((item: any) => item.name === intent.notebookName);
    if (matches.length > 1) throw new Error('Things 初始化笔记本存在重复候选，无法安全继续');
    const created = matches[0] || (await client.request('/api/notebook/createNotebook', { name: intent.notebookName }))?.notebook;
    if (!isId(created?.id) || created.closed) throw new Error('Things 创建数据笔记本失败');
    intent.notebookId = created.id;
    intent.phase = 'building';
    await persist(storage, STORAGE_BOOTSTRAP_FILE, intent);
  }

  const specs = getTableSpecs(intent.schemaVersion);
  const hiddenFields = new Set([...HIDDEN_FIELDS, ...(intent.schemaVersion === 2 ? ['notesLink'] : [])]);
  const links = TABLE_NAMES.map((name) => `- [${specs[name].name}](siyuan://blocks/${intent.tables[name].docId})`).join('\n');
  await createDoc(storage, client, intent, intent.docId, '/Things 数据中心', `# Things 数据中心\n\n本页由 Things 创建，数据库承载任务数据。请保留系统字段。\n\n${links}\n`);

  for (const name of TABLE_NAMES) {
    const table = intent.tables[name];
    const spec = specs[name];
    await createDoc(storage, client, intent, table.docId!, `/Things 数据中心/${spec.name}`, `# ${spec.name}\n`);
    const carrier = await getBlock(client, table.blockId);
    if (!carrier) {
      if (intent.readyTables.includes(name)) throw new Error(`Things「${spec.name}」已完成初始化但承载块丢失`);
      await client.request('/api/block/appendBlock', {
        parentID: table.docId, dataType: 'dom',
        data: `<div data-type="NodeAttributeView" data-node-id="${table.blockId}" data-av-id="${table.avId}" data-av-type="table"></div>`,
      });
      const added = await waitForBlock(client, table.blockId);
      if (added.type !== 'av' || !String(added.markdown || '').includes(table.avId)) throw new Error(`Things「${spec.name}」承载块创建后校验失败`);
    } else if (carrier.box !== intent.notebookId || carrier.type !== 'av' || !String(carrier.markdown || '').includes(table.avId)) {
      throw new Error(`Things「${spec.name}」预留的承载块已被其他内容占用`);
    }
    if (!table.keys[spec.titleField]) {
      await client.request('/api/av/renderAttributeView', { id: table.avId, blockID: table.blockId, createIfNotExist: true, ignoreRows: true });
    }
    let av = await client.getAV(table.avId);
    const primary = av.keyValues.find((entry: any) => entry.key?.type === 'block')?.key;
    if (!primary?.id) throw new Error(`Things「${spec.name}」缺少主列`);
    if (table.keys[spec.titleField] && table.keys[spec.titleField] !== primary.id) throw new Error(`Things「${spec.name}」主列 ID 不匹配`);
    table.keys[spec.titleField] = primary.id;
    await persist(storage, STORAGE_BOOTSTRAP_FILE, intent);

    let previousKeyID = primary.id;
    for (const column of spec.columns) {
      const keyId = table.keys[column.field];
      const found = av.keyValues.find((entry: any) => entry.key?.id === keyId)?.key;
      if (found && found.type !== column.type) throw new Error(`Things「${spec.name}.${column.field}」字段类型不匹配`);
      if (!found) {
        if (intent.readyTables.includes(name)) throw new Error(`Things「${spec.name}.${column.field}」字段被删除`);
        await client.request('/api/av/addAttributeViewKey', {
          avID: table.avId, blockID: table.blockId, keyID: keyId, keyName: column.name,
          keyType: column.type, keyIcon: '', previousKeyID,
        });
      }
      previousKeyID = keyId;
    }
    const operations: Record<string, unknown>[] = [];
    if (!intent.readyTables.includes(name)) {
      operations.push({ action: 'setAttrViewName', id: table.avId, avID: table.avId, data: `Things · ${spec.name}` });
      operations.push({ action: 'updateAttrViewCol', id: primary.id, avID: table.avId, name: spec.titleField === 'title' ? '标题' : '名称', type: 'block' });
      for (const column of spec.columns) {
        if (column.options) operations.push({ action: 'updateAttrViewColOptions', id: table.keys[column.field], avID: table.avId, data: column.options.map((value) => ({ name: value, color: '' })) });
      }
      // Set the initial view only; later starts must preserve the user's column visibility.
      const view = av.views?.find((item: any) => item.type === 'table');
      if (!view?.id) throw new Error(`Things「${spec.name}」缺少默认表格视图`);
      for (const column of spec.columns.filter(column => hiddenFields.has(column.field))) {
        operations.push({ action: 'setAttrViewColHidden', id: table.keys[column.field], avID: table.avId,
          blockID: table.blockId, viewID: view.id, data: true });
      }
      await client.transaction(operations);
      av = await waitForAV(client, table.avId, (next) => next.name === `Things · ${spec.name}` && spec.columns.every((column) => {
        const key = next.keyValues.find((entry: any) => entry.key?.id === table.keys[column.field])?.key;
        return key?.type === column.type && (!column.options || column.options.every((option) => key.options?.some((item: any) => item.name === option)));
      }) && spec.columns.filter(column => hiddenFields.has(column.field)).every(column =>
        next.views?.find((item: any) => item.id === view.id)?.table?.columns?.some((item: any) => item.id === table.keys[column.field] && item.hidden)));
      intent.readyTables.push(name);
      await persist(storage, STORAGE_BOOTSTRAP_FILE, intent);
    }
  }

  // Relations are wired only after every target exists, including self-relations.
  for (const name of TABLE_NAMES) {
    const table = intent.tables[name];
    const av = await client.getAV(table.avId);
    const relations = specs[name].columns.filter((column) => column.relation);
    const operations = relations.filter((column) => {
      const key = av.keyValues.find((entry: any) => entry.key?.id === table.keys[column.field])?.key;
      if (key?.relation?.avID && key.relation.avID !== intent.tables[column.relation!].avId) {
        throw new Error(`Things「${specs[name].name}.${column.field}」关联目标被改变`);
      }
      return key?.relation?.avID !== intent.tables[column.relation!].avId;
    }).map((column) => ({
      action: 'updateAttrViewColRelation', avID: table.avId, id: intent.tables[column.relation!].avId,
      keyID: table.keys[column.field], isTwoWay: false, backRelationKeyID: '', name: '', format: column.name,
    }));
    await client.transaction(operations);
    if (operations.length) await waitForAV(client, table.avId, (next) => relations.every((column) =>
      next.keyValues.find((entry: any) => entry.key?.id === table.keys[column.field])?.key?.relation?.avID === intent.tables[column.relation!].avId));
  }
  const binding: Binding = { schemaVersion: intent.schemaVersion, notebookId: intent.notebookId, docId: intent.docId, tables: clone(intent.tables) };
  await verifyDatabaseBinding(client, binding);
  const finalName = notebooks.some((item: any) => item.name === 'Things' && item.id !== binding.notebookId) ? `Things ${intent.token.slice(-7)}` : 'Things';
  await client.request('/api/notebook/renameNotebook', { notebook: binding.notebookId, name: finalName });
  await persist(storage, STORAGE_BINDING_FILE, binding);
  intent.phase = 'complete';
  await persist(storage, STORAGE_BOOTSTRAP_FILE, intent);
  return binding;
}

export function ensureDatabases(storage: SettingsStore, client: SiYuanAVClient): Promise<Binding> {
  const pending = inflight.get(storage);
  if (pending) return pending;
  const operation = () => initialize(storage, client);
  // Serializes tabs/windows on one origin; multi-device bootstrap is still a single-writer operation.
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const promise: Promise<Binding> = (async () => locks
    ? await locks.request('siyuan-things-database-bootstrap-v1', operation)
    : await operation())().finally(() => inflight.delete(storage));
  inflight.set(storage, promise);
  return promise;
}
