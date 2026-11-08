import { SiYuanAVClient } from './avClient.ts';
import { TABLE_NAMES, getTableSpecs, type TableName } from './avSchema.ts';
import { validateBinding, verifyDatabaseBinding, type Binding, type SettingsStore, type TableBinding } from './bootstrap.ts';

export const CENTER_MARK = 'custom-siyuan-things-center';
export const CENTER_BINDING = 'custom-siyuan-things-binding';
export const CENTER_INITIALIZING = 'custom-siyuan-things-initializing';
export const SELECTION_FILE = 'things-database-selection.json';
export interface LocationChoice { id: string; label: string }
export interface DiscoveryOptions {
  choose?: (kind: 'database' | 'notebook', choices: LocationChoice[]) => Promise<string>;
}
const validId = (id: unknown): id is string => typeof id === 'string' && /^\d{14}-[a-z0-9]{7}$/.test(id);
let localInit: Promise<unknown> = Promise.resolve();

/** Shared notebook lock name is available to the other plugins too; never an atomic cross-device lock. */
export async function withDatabaseInitLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = localInit.then(async () => {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    return locks ? locks.request('siyuan-shared-database-notebook-init-v1', fn) : fn();
  });
  localInit = run.catch(() => {});
  return run;
}

async function persist(storage: SettingsStore, value: unknown) {
  await storage.saveData(SELECTION_FILE, value);
  if (JSON.stringify(await storage.loadData(SELECTION_FILE)) !== JSON.stringify(value)) throw new Error('数据库选择未保存，请重试');
}

async function select(storage: SettingsStore, kind: 'database' | 'notebook', choices: LocationChoice[], options: DiscoveryOptions): Promise<string> {
  const saved = await storage.loadData(SELECTION_FILE) || {};
  const ids = choices.map(c => c.id).sort().join(',');
  if (saved[kind]?.candidates === ids && choices.some(c => c.id === saved[kind]?.id)) return saved[kind].id;
  const id = choices.length === 1 ? choices[0].id : await options.choose?.(kind, choices);
  if (!id || !choices.some(c => c.id === id)) throw new Error(`发现多个${kind === 'database' ? 'Things 数据中心' : '同名数据库笔记本'}，请选择后继续；未合并或删除数据`);
  await persist(storage, { ...saved, [kind]: { id, candidates: ids } });
  return id;
}

export async function chooseNotebook(storage: SettingsStore, client: SiYuanAVClient, options: DiscoveryOptions): Promise<any> {
  const list = async () => {
    const result = (await client.request('/api/notebook/lsNotebooks', {}))?.notebooks;
    if (!Array.isArray(result)) throw new Error('无法读取笔记本列表，停止创建');
    return result;
  };
  let notebooks = await list();
  // Persisted identity remains valid even after a rename.
  const saved = await storage.loadData(SELECTION_FILE);
  const previous = notebooks.find((n: any) => n.id === saved?.notebook?.id);
  if (saved?.notebook?.id && !previous) throw new Error('已选择的数据库笔记本尚未同步或已丢失，停止新建');
  let matches = previous && previous.name !== '数据库' ? [previous] : notebooks.filter((n: any) => n.name === '数据库');
  if (!matches.length) {
    // Reread under the shared browser lock immediately before creation.
    notebooks = await list();
    matches = notebooks.filter((n: any) => n.name === '数据库');
    if (!matches.length) {
      await client.request('/api/notebook/createNotebook', { name: '数据库' });
      notebooks = await list();
      matches = notebooks.filter((n: any) => n.name === '数据库');
    }
  }
  if (!matches.length) throw new Error('数据库笔记本创建结果尚未可见，请稍后重试');
  const id = await select(storage, 'notebook', matches.map((n: any) => ({ id: n.id, label: `${n.name} · ${n.id}${n.closed ? '（已关闭）' : ''}` })), options);
  const notebook = matches.find((n: any) => n.id === id);
  if (!validId(notebook.id) || notebook.closed) throw new Error('数据库笔记本已关闭，请打开后继续；不会另建同名笔记本');
  return notebook;
}

/** Only call after ID/schema ownership verification, never based on a display title. */
export async function markDatabase(client: SiYuanAVClient, binding: Binding): Promise<void> {
  validateBinding(binding);
  const attrs = await client.request('/api/attr/getBlockAttrs', { id: binding.docId });
  if (!attrs || typeof attrs !== 'object') throw new Error('数据中心身份属性不可读取');
  if (attrs[CENTER_MARK] && attrs[CENTER_MARK] !== '1') throw new Error('数据中心身份标记版本不支持');
  if (attrs[CENTER_BINDING]) {
    let previous: Binding;
    try { previous = JSON.parse(attrs[CENTER_BINDING]); validateBinding(previous); } catch { throw new Error('已有数据中心身份信息损坏，请先恢复'); }
    if (previous.docId !== binding.docId || previous.schemaVersion > binding.schemaVersion) throw new Error('数据中心身份或版本与当前连接冲突，请等待同步完成后重新加载');
  }
  const value = JSON.stringify(binding);
  if (attrs[CENTER_MARK] === '1' && attrs[CENTER_BINDING] === value && !attrs[CENTER_INITIALIZING]) return;
  await client.request('/api/attr/setBlockAttrs', { id: binding.docId, attrs: { [CENTER_MARK]: '1', [CENTER_BINDING]: value, [CENTER_INITIALIZING]: '' } });
  const check = await client.request('/api/attr/getBlockAttrs', { id: binding.docId });
  if (check?.[CENTER_MARK] !== '1' || check?.[CENTER_BINDING] !== value) throw new Error('数据中心身份标记保存后校验失败');
}

async function rows(client: SiYuanAVClient, where: string): Promise<any[]> {
  const result: any[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await client.request('/api/query/sql', {
      stmt: `SELECT id, root_id, box, type, path, content, markdown FROM blocks WHERE ${where} ORDER BY id LIMIT 200 OFFSET ${offset}`, mode: 'readonly',
    });
    if (!Array.isArray(page)) throw new Error('数据中心索引不可读取，请等待同步后重试');
    result.push(...page);
    if (page.length < 200) return result;
  }
}

/** Cold-start discovery only. A failed/partial scan is never evidence of a blank installation. */
export async function discoverDatabase(storage: SettingsStore, client: SiYuanAVClient, options: DiscoveryOptions = {}): Promise<Binding | undefined> {
  await client.request('/api/sync/getBootSync', {});
  const notebooks = (await client.request('/api/notebook/lsNotebooks', {}))?.notebooks;
  if (!Array.isArray(notebooks)) throw new Error('笔记本列表不可访问');
  if (notebooks.some((n: any) => n.closed)) throw new Error('存在已关闭的笔记本，无法确认已有 Things 数据；请打开后重试，不会创建空库');
  await client.request('/api/sqlite/flushTransaction', {});
  const markedDocs = await rows(client, `type = 'd' AND id IN (SELECT block_id FROM attributes WHERE name IN ('${CENTER_MARK}', '${CENTER_INITIALIZING}'))`);
  const found = new Map<string, Binding>();
  for (const doc of markedDocs) {
    const attrs = await client.request('/api/attr/getBlockAttrs', { id: doc.id });
    if (attrs?.[CENTER_INITIALIZING]) throw new Error('发现尚未完成初始化的 Things 数据中心，请在原设备继续初始化或等待同步，停止新建');
    if (attrs?.[CENTER_MARK] !== '1') throw new Error('发现不支持的数据中心身份标记，请升级插件');
    let binding: Binding;
    try { binding = JSON.parse(attrs[CENTER_BINDING]); validateBinding(binding); }
    catch { throw new Error('发现身份标记但连接信息不完整，请等待同步或恢复连接；不会新建空库'); }
    if (binding.docId !== doc.id) throw new Error('发现复制的数据中心身份冲突，请核对副本；不会覆盖原数据');
    await verifyDatabaseBinding(client, binding);
    found.set(doc.id, binding);
  }

  // Legacy centers have no marker. Match all seven typed schemas and relation targets,
  // grouped by the ID path of their carrier documents, independent of their titles.
  const carriers = await rows(client, "type = 'av'");
  const grouped = new Map<string, Array<{ carrier: any; av: any }>>();
  for (const carrier of carriers) {
    const parts = String(carrier.path || '').split('/').filter(Boolean);
    const centerId = parts.at(-2);
    if (!validId(centerId) || found.has(centerId)) continue;
    const avId = String(carrier.markdown || '').match(/data-av-id="(\d{14}-[a-z0-9]{7})"/)?.[1];
    if (!avId) continue;
    const av = await client.getAV(avId);
    if (!av.keyValues.some((kv: any) => kv.key?.name === 'Things ID') && !String(av.name).startsWith('Things · ')) continue;
    const list = grouped.get(centerId) || [];
    list.push({ carrier, av }); grouped.set(centerId, list);
  }
  for (const [docId, entries] of grouped) {
    let binding: Binding | undefined;
    for (const schemaVersion of [2, 1] as const) {
      const specs = getTableSpecs(schemaVersion);
      const tables = {} as Record<TableName, TableBinding>;
      for (const name of TABLE_NAMES) {
        const matches = entries.flatMap(({ carrier, av }) => {
          // Several small schemas are subsets of larger tables (areas vs projects).
          // Prefer the most specific role, while still allowing user-added columns.
          const fits = (role: TableName) => specs[role].columns.every(c => av.keyValues.filter((kv: any) => kv.key?.name === c.name && kv.key?.type === c.type).length === 1);
          if (TABLE_NAMES.some(role => specs[role].columns.length > specs[name].columns.length && fits(role))) return [];
          const keys: Record<string, string> = {};
          const primary = av.keyValues.filter((kv: any) => kv.key?.type === 'block');
          if (primary.length !== 1) return [];
          keys[specs[name].titleField] = primary[0].key.id;
          for (const column of specs[name].columns) {
            const match = av.keyValues.filter((kv: any) => kv.key?.name === column.name && kv.key?.type === column.type);
            if (match.length !== 1) return [];
            keys[column.field] = match[0].key.id;
          }
          return [{ avId: av.id, blockId: carrier.id, docId: carrier.root_id, keys }];
        });
        if (matches.length === 1) tables[name] = matches[0];
      }
      if (TABLE_NAMES.every(name => tables[name])) {
        binding = { schemaVersion, notebookId: entries[0].carrier.box, docId, tables }; break;
      }
    }
    if (!binding) throw new Error('发现未完成、已改动或重复的 Things 数据结构，请恢复后重试；不会自动新建空库');
    await verifyDatabaseBinding(client, binding);
    found.set(docId, binding);
  }
  if (!found.size) return undefined;
  const id = await select(storage, 'database', [...found.values()].map(b => ({ id: b.docId,
    label: `${notebooks.find((n: any) => n.id === b.notebookId)?.name || b.notebookId} · ${b.docId}` })), options);
  return found.get(id);
}
