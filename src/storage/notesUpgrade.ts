import { SiYuanAVClient, newSiyuanId } from './avClient.ts';
import { AVRepository, canonical } from './avRepository.ts';
import { TABLES } from './avSchema.ts';
import { validateBinding, verifyDatabaseBinding, type Binding, type SettingsStore } from './bootstrap.ts';
import type { LegacySnapshot } from './preflight.ts';
import { RichNotes } from './richNotes.ts';

export const NOTES_UPGRADE_FILE = 'things-notes-upgrade-v2.json';
export const NOTES_BACKUP_FILE = 'things-notes-original-v1.json';
const NOTE_TABLES = ['tasks', 'projects', 'areas', 'trashItems'] as const;
type NoteTable = typeof NOTE_TABLES[number];
const NOTE_FIELDS = ['notes', 'notesAssets'] as const;
type NoteColumn = `${NoteTable}.${typeof NOTE_FIELDS[number]}`;
type Repository = { load(): Promise<LegacySnapshot>; migrateNotesFromV1(snapshot: LegacySnapshot): Promise<void> };
type UpgradeOptions = {
  repository?: (binding: Binding) => Repository;
  verify?: typeof verifyDatabaseBinding;
  preflight?: (snapshot: LegacySnapshot) => void | Promise<void>;
  onProgress?: (stage: string) => void;
};
type Backup = { schemaVersion: 1; kind: 'things-rich-notes-backup'; binding: Binding; snapshot: LegacySnapshot; createdAt: number };
type Intent = {
  schemaVersion: 2; kind: 'things-rich-notes-upgrade'; originalBinding: Binding; binding: Binding;
  phase: 'planned' | 'columns' | 'copied' | 'verified'; createdColumns: NoteColumn[]; createdAt: number;
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

function preflightRichNotes(snapshot: LegacySnapshot): void {
  const notes = new RichNotes();
  const records = [...snapshot.tasks, ...snapshot.archived, ...snapshot.projects, ...snapshot.areas,
    ...snapshot.trash.flatMap(batch => batch.tasks)];
  for (const record of records) notes.validate(record.notes ?? '');
}

async function persist(store: SettingsStore, name: string, value: unknown): Promise<void> {
  try { await store.saveData(name, clone(value)); } catch { /* A lost response may have committed. */ }
  if (!same(await store.loadData(name), value)) throw new Error('备注升级进度保存后核对失败，已停止后续写入');
}

function validateIntent(value: any, original: Binding): asserts value is Intent {
  if (value?.schemaVersion !== 2 || value.kind !== 'things-rich-notes-upgrade'
    || !same(value.originalBinding, original) || value.binding?.schemaVersion !== 2
    || !['planned', 'columns', 'copied', 'verified'].includes(value.phase)
    || !Array.isArray(value.createdColumns)
    || value.createdColumns.some((column: any) => !NOTE_TABLES.some(table => NOTE_FIELDS.some(field => `${table}.${field}` === column)))
    || new Set(value.createdColumns).size !== value.createdColumns.length) {
    throw new Error('备注升级记录损坏或属于其他数据库，已停止迁移');
  }
  validateBinding(value.binding);
  const downgraded = clone(value.binding) as Binding;
  downgraded.schemaVersion = 1;
  for (const name of NOTE_TABLES) for (const field of NOTE_FIELDS) delete downgraded.tables[name].keys[field];
  if (!same(downgraded, original)) throw new Error('备注升级记录改变了原数据库身份，已停止迁移');
  const reserved = new Set<string>([original.docId, original.notebookId]);
  for (const table of Object.values(original.tables)) {
    reserved.add(table.avId); reserved.add(table.blockId);
    if (table.docId) reserved.add(table.docId);
    Object.values(table.keys).forEach(id => reserved.add(id));
  }
  for (const name of NOTE_TABLES) for (const field of NOTE_FIELDS) {
    const id = value.binding.tables[name].keys[field];
    if (reserved.has(id)) throw new Error('备注升级字段身份重复，已停止迁移');
    reserved.add(id);
  }
}

function createIntent(original: Binding): Intent {
  const binding = clone(original);
  binding.schemaVersion = 2;
  for (const name of NOTE_TABLES) for (const field of NOTE_FIELDS) {
    if (binding.tables[name].keys[field]) throw new Error('旧版数据库含未知备注字段绑定，请先核对');
    binding.tables[name].keys[field] = newSiyuanId();
  }
  const intent: Intent = { schemaVersion: 2, kind: 'things-rich-notes-upgrade', originalBinding: clone(original), binding,
    phase: 'planned', createdColumns: [], createdAt: Date.now() };
  validateIntent(intent, original);
  return intent;
}

async function waitForColumn(client: SiYuanAVClient, avId: string, keyId: string, type: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const av = await client.getAV(avId);
    const key = av.keyValues.find((entry: any) => entry.key?.id === keyId)?.key;
    if (key) {
      if (key.type !== type) throw new Error('备注字段类型已改变，已停止迁移');
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
  }
  throw new Error('备注字段创建后尚未核对完成，请重试升级');
}

async function hideLegacyLinks(client: SiYuanAVClient, binding: Binding): Promise<void> {
  for (const name of NOTE_TABLES) {
    const table = binding.tables[name], av = await client.getAV(table.avId);
    const operations = (av.views || []).filter((view: any) => view.type === 'table').flatMap((view: any) =>
      ['notesDocId', 'notesLink'].filter(field => view.table?.columns?.some((column: any) => column.id === table.keys[field] && !column.hidden))
        .map(field => ({ action: 'setAttrViewColHidden', id: table.keys[field], avID: table.avId,
          blockID: table.blockId, viewID: view.id, data: true })));
    await client.transaction(operations);
    if (!operations.length) continue;
    let confirmed = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      const updated = await client.getAV(table.avId);
      if (operations.every((operation: any) => updated.views?.find((view: any) => view.id === operation.viewID)
        ?.table?.columns?.find((column: any) => column.id === operation.id)?.hidden)) { confirmed = true; break; }
      await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
    }
    if (!confirmed) throw new Error('原备注备份链接隐藏后核对失败，请重试升级');
  }
}

/** Add and verify rich note cells without switching the authoritative source binding or deleting notes. */
export async function upgradeNotesToRichText(
  store: SettingsStore, client: SiYuanAVClient, originalBinding: Binding, options: UpgradeOptions = {},
): Promise<{ binding: Binding; snapshot: LegacySnapshot }> {
  validateBinding(originalBinding);
  const verify = options.verify || verifyDatabaseBinding;
  const repository = options.repository || ((binding: Binding) => new AVRepository(client, binding));
  const progress = (stage: string) => { try { options.onProgress?.(stage); } catch { /* Display callbacks cannot change migration. */ } };
  await verify(client, originalBinding);
  const oldRepository = repository(originalBinding);
  const current = await oldRepository.load();
  if (originalBinding.schemaVersion === 2) return { binding: clone(originalBinding), snapshot: current };

  // Unsupported content is a normal rejected upgrade, not an obligation to recover. Check all
  // notes before freezing the source in a durable backup/intent or adding any target columns.
  await (options.preflight || preflightRichNotes)(clone(current));

  progress('backup');
  let backup: Backup = await store.loadData(NOTES_BACKUP_FILE);
  if (backup) {
    if (backup.schemaVersion !== 1 || backup.kind !== 'things-rich-notes-backup'
      || !same(backup.binding, originalBinding) || !same(backup.snapshot, current)) {
      throw new Error('原生数据或备注在升级备份后发生变化，已保留双方并停止迁移');
    }
  } else {
    backup = { schemaVersion: 1, kind: 'things-rich-notes-backup', binding: clone(originalBinding), snapshot: clone(current), createdAt: Date.now() };
    await persist(store, NOTES_BACKUP_FILE, backup);
  }
  let intent: Intent = await store.loadData(NOTES_UPGRADE_FILE);
  if (intent) validateIntent(intent, originalBinding);
  else { intent = createIntent(originalBinding); await persist(store, NOTES_UPGRADE_FILE, intent); }

  progress('columns');
  for (const name of NOTE_TABLES) for (const field of NOTE_FIELDS) {
    const table = intent.binding.tables[name], keyId = table.keys[field], marker: NoteColumn = `${name}.${field}`;
    const spec = TABLES[name].columns.find(column => column.field === field)!;
    const av = await client.getAV(table.avId);
    const existing = av.keyValues.find((entry: any) => entry.key?.id === keyId)?.key;
    if (existing && existing.type !== spec.type) throw new Error('备注升级预留字段已被其他类型占用');
    if (!existing) {
      if (intent.createdColumns.includes(marker)) throw new Error('已创建的备注字段被删除，已停止自动重建');
      await client.request('/api/av/addAttributeViewKey', { avID: table.avId, blockID: table.blockId,
        keyID: keyId, keyName: spec.name, keyType: spec.type, keyIcon: '',
        previousKeyID: field === 'notes' ? table.keys[TABLES[name].titleField] : table.keys.notes });
      await waitForColumn(client, table.avId, keyId, spec.type);
    }
    if (!intent.createdColumns.includes(marker)) {
      intent.createdColumns.push(marker); await persist(store, NOTES_UPGRADE_FILE, intent);
    }
  }
  intent.phase = 'columns'; await persist(store, NOTES_UPGRADE_FILE, intent);
  await verify(client, intent.binding);
  if (!same(await oldRepository.load(), backup.snapshot)) throw new Error('备注升级期间原生数据发生变化，尚未切换数据源');
  progress('copying');
  const nextRepository = repository(intent.binding);
  // The repository only admits empty target cells or exact previously acknowledged migration content.
  await nextRepository.migrateNotesFromV1(clone(backup.snapshot));
  intent.phase = 'copied'; await persist(store, NOTES_UPGRADE_FILE, intent);
  progress('verifying');
  const migrated = await nextRepository.load();
  if (!same(migrated, backup.snapshot)) throw new Error('富文本备注迁移读回不一致，保留原备注数据源');
  if (!same(await oldRepository.load(), backup.snapshot)) throw new Error('备注迁移期间原文发生变化，尚未切换数据源');
  await hideLegacyLinks(client, intent.binding);
  intent.phase = 'verified'; await persist(store, NOTES_UPGRADE_FILE, intent);
  progress('done');
  return { binding: clone(intent.binding), snapshot: clone(migrated) };
}
