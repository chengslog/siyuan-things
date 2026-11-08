import { type Binding, type SettingsStore, STORAGE_BINDING_FILE, STORAGE_BOOTSTRAP_FILE, validateBinding } from './bootstrap.ts';

export const LOCATION_REPAIR_FILE = 'things-database-location-repair.json';
const SOURCE = 'things-storage-source.json';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const canonical = (v: any): string => Array.isArray(v) ? `[${v.map(canonical)}]` : v && typeof v === 'object'
  ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
export const sameDatabase = (a: Binding, b: Binding): boolean =>
  canonical({ ...a, notebookId: '' }) === canonical({ ...b, notebookId: '' });

async function persist(store: SettingsStore, name: string, value: unknown) {
  try { await store.saveData(name, value); } catch { /* Lost responses are decided by readback. */ }
  if (canonical(await store.loadData(name)) !== canonical(value)) throw new Error('数据中心位置配置尚未保存，请重新加载后继续；原数据未替换');
}

/** Verified location only. The journal makes partial configuration updates resumable. */
export async function repairStoredLocation(store: SettingsStore, binding: Binding): Promise<void> {
  validateBinding(binding);
  const source = await store.loadData(SOURCE);
  if (source && (source.mode !== 'database' || !sameDatabase(source.binding, binding))) {
    throw new Error('数据源在其他窗口发生变化，请重新加载；不会覆盖不同数据中心');
  }
  const pending = await store.loadData(LOCATION_REPAIR_FILE);
  if (pending && (pending.version !== 1 || !sameDatabase(pending.binding, binding))) throw new Error('存在另一数据中心的位置恢复记录，请先核对');
  const stored = await store.loadData(STORAGE_BINDING_FILE);
  if (!pending && canonical(stored) === canonical(binding) && (!source || canonical(source.binding) === canonical(binding))) return;
  await persist(store, LOCATION_REPAIR_FILE, { version: 1, binding: clone(binding) });
  // The active source is the commit decision. The secondary binding can always be repaired from it.
  if (source) await persist(store, SOURCE, { ...source, binding: clone(binding) });
  await persist(store, STORAGE_BINDING_FILE, clone(binding));
  for (const name of ['things-storage-write-intent-v1.json', 'things-notes-upgrade-v2.json', STORAGE_BOOTSTRAP_FILE]) {
    const value = await store.loadData(name);
    if (!value) continue;
    if (value.originalBinding && sameDatabase(value.originalBinding, binding) && value.binding?.docId === binding.docId) {
      await persist(store, name, { ...value, originalBinding: clone(binding), binding: { ...value.binding, notebookId: binding.notebookId } });
    } else if (value.binding && sameDatabase(value.binding, binding)) {
      await persist(store, name, { ...value, binding: clone(binding) });
    } else if (value.docId === binding.docId && value.notebookId !== binding.notebookId) {
      await persist(store, name, { ...value, notebookId: binding.notebookId });
    }
  }
  await persist(store, LOCATION_REPAIR_FILE, null);
}
