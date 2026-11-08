import { SiYuanAVClient } from './avClient.ts';
import { verifyDatabaseBinding, type Binding, type SettingsStore } from './bootstrap.ts';
import { TABLE_NAMES } from './avSchema.ts';
import { markDatabase } from './discovery.ts';
import { repairStoredLocation, sameDatabase } from './location.ts';

export const MOVE_FILE = 'things-database-move.json';
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const stable = (v: any): string => Array.isArray(v) ? `[${v.map(stable)}]` : v && typeof v === 'object'
  ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v);
async function save(store: SettingsStore, value: any) {
  try { await store.saveData(MOVE_FILE, copy(value)); } catch { /* Verify lost response. */ }
  if (stable(await store.loadData(MOVE_FILE)) !== stable(value)) throw new Error('位置迁移进度保存失败，已停止移动');
}
async function capture(client: SiYuanAVClient, binding: Binding) {
  await client.request('/api/sqlite/flushTransaction', {});
  const documents: any[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await client.request('/api/query/sql', { stmt:
      `SELECT id, root_id, box, path, type, markdown FROM blocks WHERE root_id = '${binding.docId}' OR path LIKE '%/${binding.docId}/%' ORDER BY id LIMIT 500 OFFSET ${offset}`, mode: 'readonly' });
    if (!Array.isArray(page)) throw new Error('无法备份数据中心文档树');
    documents.push(...page); if (page.length < 500) break;
  }
  if (!documents.some(d => d.id === binding.docId)) throw new Error('数据中心文档树尚不可读取');
  for (const name of TABLE_NAMES) if (!documents.some(d => d.id === binding.tables[name].blockId)) throw new Error('数据库承载块不在数据中心子树中，停止整体迁移');
  const avs = await Promise.all(TABLE_NAMES.map(name => client.getAV(binding.tables[name].avId)));
  return { documents, avs };
}
const unchanged = (a: Awaited<ReturnType<typeof capture>>, b: Awaited<ReturnType<typeof capture>>) =>
  stable(a.avs) === stable(b.avs) && stable(a.documents.map(({ box, path, ...row }) => row)) === stable(b.documents.map(({ box, path, ...row }) => row));

/** Explicit move, never an implicit startup migration. Keeps the existing subtree and all AV identities. */
export async function relocateDatabase(store: SettingsStore, client: SiYuanAVClient, binding: Binding, targetNotebook: string): Promise<void> {
  await verifyDatabaseBinding(client, binding);
  const notebooks = (await client.request('/api/notebook/lsNotebooks', {}))?.notebooks;
  const target = notebooks?.find((n: any) => n.id === targetNotebook);
  if (!target || target.closed) throw new Error('目标数据库笔记本不可访问，请打开后继续');
  let progress = await store.loadData(MOVE_FILE);
  if (progress && (progress.version !== 1 || !sameDatabase(progress.binding, binding) || progress.targetNotebook !== targetNotebook)) {
    if (progress.phase !== 'complete') throw new Error('存在另一项未完成的位置迁移，请先恢复原迁移');
    progress = undefined;
  }
  if (progress?.phase === 'complete' && binding.notebookId === targetNotebook) {
    await markDatabase(client, binding); await repairStoredLocation(store, binding); return;
  }
  if (!progress) {
    const snapshot = await capture(client, binding);
    const exported = await client.request('/api/export/exportSY', { id: binding.docId });
    if (!exported) throw new Error('思源原生备份未返回导出位置，停止迁移');
    progress = { version: 1, phase: 'backed-up', binding: copy(binding), targetNotebook, exported, snapshot, createdAt: Date.now() };
    await save(store, progress);
  }
  if (!progress.snapshot || !unchanged(progress.snapshot, await capture(client, binding))) throw new Error('数据与迁移前备份不一致，请核对未完成迁移；不会覆盖数据');
  if (binding.notebookId !== targetNotebook) {
    // SiYuan moves the document tree as one operation; a lost response is resolved by ID on retry.
    await client.request('/api/filetree/moveDocsByID', { fromIDs: [binding.docId], toID: targetNotebook });
  }
  await verifyDatabaseBinding(client, binding);
  if (binding.notebookId !== targetNotebook) throw new Error('移动结果尚未可见，请稍后重试原迁移');
  const after = await capture(client, binding);
  if (after.documents.some(d => d.box !== targetNotebook) || !unchanged(progress.snapshot, after)) throw new Error('移动后文档、表或关联校验不一致，已保留备份并停止激活');
  progress.phase = 'moved'; await save(store, progress);
  await markDatabase(client, binding);
  await repairStoredLocation(store, binding);
  progress.phase = 'complete'; progress.completedAt = Date.now(); await save(store, progress);
}
