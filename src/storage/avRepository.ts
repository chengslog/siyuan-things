import { TABLE_NAMES, TABLES, getTableSpecs, type TableName, type TableSpec } from './avSchema.ts';
import { SiYuanAVClient } from './avClient.ts';
import type { Binding } from './bootstrap.ts';
import { LEGACY_FILES, auditLegacy, type LegacySnapshot } from './preflight.ts';
import { NativeNotes } from './nativeNotes.ts';
import { RichNotes, type RichNotesPlan } from './richNotes.ts';

type Data = Record<string, any>;
type Row = { id: string; data: Data; presence: string[]; extra: Data; notes?: string; itemId?: string; notesDocId?: string; cells?: Data; richPlan?: RichNotesPlan };
type Tables = Record<TableName, Map<string, Row>>;
type ReadState = { tables: Tables; snapshot: LegacySnapshot };
const JSON_FIELDS = new Set(['presence', 'extra', 'tagOrder', 'groupOrder', 'collapsedGroups', 'payload']);
const TECHNICAL = new Set(['extra', 'presence', 'sourceIndex', 'notesAssets', 'notesDocId', 'notesLink', 'storageState', 'tagOrder']);
const NOTE_TABLES = new Set<TableName>(['tasks', 'projects', 'areas', 'trashItems']);
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const own = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);
const emptySnapshot = (): LegacySnapshot => ({ tasks: [], archived: [], projects: [], areas: [], tags: [], trash: [] });
const emptyTables = (): Tables => Object.fromEntries(TABLE_NAMES.map((table) => [table, new Map()])) as Tables;

/** Compare object data independently of object-key order, preserving array order and missing values. */
export function canonical(value: any): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
const equal = (left: any, right: any): boolean => canonical(left) === canonical(right);

export class AVConflictError extends Error {
  constructor(table: string, field: string) { super(`Things 数据已在其他位置改变：${table}.${field}。请刷新后重试。`); this.name = 'AVConflictError'; }
}

function json(value: any, fallback: any, field: string): any {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string') throw new Error(`Things 系统字段格式无效：${field}`);
  try { return JSON.parse(value); } catch { throw new Error(`Things 系统字段 JSON 损坏：${field}`); }
}

/** The IDs are repeatable so a response lost after creation does not create a second row/document. */
async function stableId(root: string, purpose: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${root}:${purpose}`));
  const bytes = new Uint8Array(digest);
  let number = 0n;
  for (const byte of bytes.slice(0, 6)) number = (number << 8n) | BigInt(byte);
  const suffix = (number % (36n ** 7n)).toString(36).padStart(7, '0');
  return `${/^\d{14}-/.test(root) ? root.slice(0, 14) : '20000101000000'}-${suffix}`;
}

async function batchDigest(batch: Data): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(batch)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Exported for tests: AV date values are milliseconds, not strings, and blank is not epoch zero. */
export function encodeCell(type: string, value: any): Data {
  if (type === 'block') return { type: 'block', isDetached: true, block: { content: value ?? '', isDetached: true } };
  if (type === 'text') return { type, text: { content: value == null ? '' : String(value) } };
  if (type === 'mAsset') return { type, mAsset: value || [] };
  if (type === 'url') return { type, url: { content: value ?? '' } };
  if (type === 'number') return { type, number: { content: value ?? 0, isNotEmpty: value !== undefined && value !== null } };
  if (type === 'date') {
    const date = value === undefined || value === null ? undefined : new Date(value);
    return { type, date: { content: value ?? 0, isNotEmpty: date !== undefined,
      isNotTime: date ? date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0 : true,
      hasEndDate: false } };
  }
  if (type === 'checkbox') return { type, checkbox: { checked: value === true } };
  if (type === 'select') return { type, mSelect: value == null || value === '' ? [] : [{ content: value }] };
  if (type === 'relation') return { type, relation: { blockIDs: value || [], contents: [] } };
  throw new Error(`Unsupported Things AV type: ${type}`);
}

export function decodeCell(type: string, cell: any): any {
  if (!cell) return undefined;
  if (type === 'block') return cell.block?.content ?? '';
  if (type === 'text') return cell.text?.content ?? '';
  if (type === 'mAsset') return cell.mAsset || [];
  if (type === 'url') return cell.url?.content ?? '';
  if (type === 'number') return cell.number?.isNotEmpty ? cell.number.content : undefined;
  if (type === 'date') {
    if (cell.date?.hasEndDate) throw new Error('Things 日期目前只支持单一日期，请先处理数据库中的日期区间');
    return cell.date?.isNotEmpty ? cell.date.content : undefined;
  }
  if (type === 'checkbox') return cell.checkbox?.checked === true;
  if (type === 'select') {
    if (cell.mSelect?.length > 1) throw new Error('Things 单选字段包含多个值');
    return cell.mSelect?.[0]?.content;
  }
  if (type === 'relation') return cell.relation?.blockIDs || [];
  return undefined;
}

function definedRecord(value: Data): Data { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)); }

async function flatten(snapshot: LegacySnapshot, specs: Record<TableName, TableSpec> = TABLES): Promise<Tables> {
  const tables = emptyTables();
  function add(table: TableName, original: Data, index: number, overrides: Data = {}, extra: Data = {}): void {
    const data: Data = { ...definedRecord(original), sourceIndex: index, ...overrides };
    const id = data.id;
    if (!id || tables[table].has(id)) throw new Error(`Things 存在重复或缺失的业务 ID：${table}`);
    const fields = new Set([specs[table].titleField, ...specs[table].columns.map((column) => column.field).filter((field) => !TECHNICAL.has(field)),
      ...(NOTE_TABLES.has(table) ? ['notes'] : []), ...(table === 'projects' ? ['headings'] : [])]);
    const unknown = Object.fromEntries(Object.entries(original).filter(([key, value]) => !fields.has(key) && value !== undefined));
    tables[table].set(id, { id, data, presence: Object.keys(definedRecord(original)), extra: { ...extra, unknown }, notes: NOTE_TABLES.has(table) ? original.notes : undefined });
    // Headings have their own rows; a partially written group must not change the project row.
    if (table === 'projects') delete data.headings;
  }
  snapshot.tasks.forEach((task, index) => add('tasks', task, index, { storageState: 'active', tagOrder: task.tags || [] }));
  snapshot.archived.forEach((task, index) => add('tasks', task, index, { storageState: 'archived', tagOrder: task.tags || [] }));
  snapshot.areas.forEach((area, index) => add('areas', area, index));
  snapshot.tags.forEach((tag, index) => add('tags', tag, index));
  snapshot.projects.forEach((project, index) => {
    add('projects', project, index);
    (project.headings || []).forEach((heading: Data, headingIndex: number) => add('headings', heading, headingIndex,
      { id: `${project.id}:${heading.id}`, projectId: project.id }, { originalId: heading.id }));
  });
  const occurrences = new Map<string, number>();
  for (const [batchIndex, batch] of snapshot.trash.entries()) {
    // The legacy batch ID can repeat. Frozen content, not its position among pending batches,
    // determines the identity; removing another batch must not reassign this batch's documents.
    const digest = await batchDigest(batch), occurrence = occurrences.get(digest) || 0;
    occurrences.set(digest, occurrence + 1);
    const batchId = `trash:${digest}:${occurrence}`;
    add('trashBatches', { id: batchId, name: `删除批次 ${batchIndex + 1}`, deletedAt: batch.deletedAt, order: batchIndex, state: 'pending' }, batchIndex,
      {}, { originalId: batch.id, digest, itemCount: batch.tasks.length,
        batchExtra: Object.fromEntries(Object.entries(batch).filter(([key]) => !['id', 'deletedAt', 'tasks'].includes(key))) });
    (batch.tasks || []).forEach((task: Data, index: number) => add('trashItems', {
      id: `${batchId}:${index}`, title: task.title, batchId, taskId: task.id, payload: task, notes: task.notes,
    }, index));
  }
  return tables;
}

function ordered(rows: Iterable<Row>): Row[] { return [...rows].sort((a, b) => (a.data.sourceIndex ?? 0) - (b.data.sourceIndex ?? 0)); }

/** An AV implementation of legacy collections. The legacy shape is an in-memory compatibility boundary only. */
export class AVRepository {
  private readonly client: SiYuanAVClient;
  private readonly binding: Binding;
  private baseline: LegacySnapshot | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly nativeNotes: NativeNotes;
  private readonly richNotes = new RichNotes();
  private readonly specs: Record<TableName, TableSpec>;
  private get isRich(): boolean { return this.binding.schemaVersion === 2; }

  constructor(client: SiYuanAVClient, binding: Binding, nativeNotes?: NativeNotes) {
    this.client = client; this.binding = binding; this.specs = getTableSpecs(binding.schemaVersion);
    this.nativeNotes = nativeNotes || new NativeNotes(client.request);
  }

  async load(): Promise<LegacySnapshot> {
    await this.adoptNativeRows();
    const state = await this.readState();
    this.validate(state.snapshot);
    this.baseline = copy(state.snapshot);
    return copy(state.snapshot);
  }

  async import(snapshot: LegacySnapshot): Promise<void> {
    const source = copy(snapshot);
    this.validate(source);
    return this.enqueue(async () => {
      const desired = await flatten(source, this.specs);
      await this.recoverIdentities(desired);
      const current = await this.readState(true);
      // Resume only this same import. Never erase data created by somebody else.
      for (const table of TABLE_NAMES) for (const id of current.tables[table].keys()) {
        if (!desired[table].has(id)) throw new AVConflictError(table, 'import-target-not-empty');
      }
      await this.assertCompletedImports(desired, current.tables);
      await this.writeTables(desired, current.tables, false);
      const actual = (await this.readState()).snapshot;
      if (!equal(actual, source)) throw new Error('Things 导入读回校验不一致；旧数据源仍应保留，请检查迁移报告');
      this.baseline = copy(actual);
    });
  }

  /** Use for archive/trash/restore operations which change more than one collection. */
  async saveSnapshot(snapshot: LegacySnapshot, base?: LegacySnapshot): Promise<void> {
    const desired = copy(snapshot);
    const explicitBase = base && copy(base);
    return this.enqueue(async () => this.saveMerged(desired, explicitBase));
  }

  /** Read-only admission check before a coordinator persists its write intent. In particular,
   * unsupported native note structures must be rejected without putting ordinary editing into recovery. */
  async preflightSnapshot(desired: LegacySnapshot, base?: LegacySnapshot): Promise<void> {
    const baseline = base || this.baseline;
    if (!baseline) throw new Error('Things 保存前必须先加载数据库');
    this.validate(baseline); this.validate(desired);
    const before = await flatten(baseline, this.specs), wanted = await flatten(desired, this.specs);
    if (this.isRich) {
      for (const table of TABLE_NAMES) {
        if (!NOTE_TABLES.has(table)) continue;
        const changed = [...wanted[table].values()].filter(row => !before[table].has(row.id) || !equal(before[table].get(row.id)!.notes, row.notes));
        for (const row of changed) this.richNotes.validate(row.notes ?? '');
        if (!changed.length) continue;
        const binding = this.binding.tables[table], av = await this.client.getAV(binding.avId);
        const entries = new Map<string, any>(av.keyValues.map((entry: any) => [entry.key.id, entry]));
        for (const field of ['id', 'notes', 'extra', 'notesAssets']) if (entries.get(binding.keys[field])?.key?.type !== (field === 'notesAssets' ? 'mAsset' : 'text')) throw new Error(`Things 数据库备注列被删除或改变：${table}.${field}`);
        for (const row of changed) {
          const previous = before[table].get(row.id);
          if (!previous) continue;
          const ids = entries.get(binding.keys.id).values.filter((cell: any) => decodeCell('text', cell) === row.id);
          if (ids.length !== 1) throw new AVConflictError(table, 'notes-identity');
          const cell = (field: string) => entries.get(binding.keys[field]).values?.find((value: any) => value.blockID === ids[0].blockID);
          const extra = json(decodeCell('text', cell('extra')), {}, 'extra');
          const actual = this.richNotes.read(cell('notes'), cell('notesAssets'), extra.richNotes);
          if (actual !== (previous.notes ?? '') && actual !== (row.notes ?? '')) throw new AVConflictError(table, 'notes');
          if (table === 'trashItems' && actual !== (row.notes ?? '')) throw new AVConflictError(table, 'notes-snapshot');
        }
      }
      return;
    }
    for (const table of TABLE_NAMES) {
      if (!NOTE_TABLES.has(table)) continue;
      const changed = [...wanted[table].values()].filter(row => before[table].has(row.id) &&
        !equal(before[table].get(row.id)!.notes, row.notes));
      if (!changed.length) continue;
      // Inspect only identity and note-link cells. Unidentified native additions and incomplete
      // relationship targets are reconciled by the actual save, never mutated during preflight.
      const binding = this.binding.tables[table], av = await this.client.getAV(binding.avId);
      const ids = av.keyValues.find((entry: any) => entry.key.id === binding.keys.id);
      const links = av.keyValues.find((entry: any) => entry.key.id === binding.keys.notesDocId);
      if (ids?.key?.type !== 'text' || links?.key?.type !== 'text') throw new Error(`Things 数据库备注列被删除或改变：${table}`);
      for (const row of changed) {
        const matches = (ids.values || []).filter((cell: any) => decodeCell('text', cell) === row.id);
        if (matches.length !== 1) throw new AVConflictError(table, matches.length ? 'duplicate-id' : 'removed-row');
        const cell = (links.values || []).find((value: any) => value.blockID === matches[0].blockID);
        const docId = decodeCell('text', cell), previous = before[table].get(row.id)!.notes ?? '', next = row.notes ?? '';
        const current = docId ? await this.nativeNotes.read(docId, true) : { text: '', pending: false };
        if (current.text !== previous && current.text !== next) throw new AVConflictError(table, 'notes');
        if (!docId || (current.text === next && !current.pending)) continue;
        if (table === 'trashItems') throw new AVConflictError(table, 'notes-snapshot');
        const attrs = await this.client.request('/api/attr/getBlockAttrs', { id: docId });
        if (attrs?.['custom-things-owner'] !== this.binding.docId || attrs?.['custom-things-record'] !== `${table}:${row.id}`) {
          throw new Error('备注文档不属于此 Things 记录，请在思源原文中编辑');
        }
        await this.nativeNotes.preflight(docId, next);
      }
    }
  }

  /** Replay a coordinator's persisted intent before load() encounters an incomplete row. */
  async recoverPending(base: LegacySnapshot, desired: LegacySnapshot): Promise<void> {
    return this.saveSnapshot(desired, base);
  }

  async saveFile(fileName: string, data: any[]): Promise<void> {
    const entry = Object.entries(LEGACY_FILES).find(([, name]) => name === fileName);
    if (!entry) throw new Error(`Unsupported Things collection: ${fileName}`);
    const key = entry[0] as keyof LegacySnapshot;
    const replacement = copy(data);
    return this.enqueue(async () => {
      if (!this.baseline) await this.load();
      const desired = copy(this.baseline!);
      desired[key] = replacement;
      await this.saveMerged(desired);
    });
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const run = this.queue.then(operation);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private validate(snapshot: LegacySnapshot): void {
    const audit = auditLegacy(snapshot);
    if (audit.errors.length) throw new Error(`Things 数据校验失败：${audit.errors.map((item) => `${item.path}: ${item.message}`).join('；')}`);
  }

  private async adoptNativeRows(): Promise<void> {
    const avs = await Promise.all(TABLE_NAMES.map((table) => this.client.getAV(this.binding.tables[table].avId)));
    const nativeIds = new Map<string, string>();
    const pending: Array<{ table: TableName; itemId: string; fields: Data; cells: Data }> = [];
    for (let index = 0; index < TABLE_NAMES.length; index++) {
      const table = TABLE_NAMES[index], binding = this.binding.tables[table], schema = this.specs[table];
      const entries = new Map<string, any>(avs[index].keyValues.map((entry: any) => [entry.key.id, entry]));
      const primary = entries.get(binding.keys[schema.titleField]);
      if (primary?.key?.type !== 'block' || schema.columns.some((column) => entries.get(binding.keys[column.field])?.key?.type !== column.type)) {
        throw new Error(`Things 数据库列被删除或改变：${table}`);
      }
      for (const titleCell of primary?.values || []) {
        const itemId = titleCell.blockID, fields: Data = { [schema.titleField]: titleCell.block?.content || '' }, cells: Data = {};
        for (const column of schema.columns) {
          const cell = entries.get(binding.keys[column.field])?.values?.find((value: any) => value.blockID === itemId);
          cells[column.field] = cell;
          fields[column.field] = decodeCell(column.type, cell);
        }
        if (fields.id) { nativeIds.set(`${table}:${itemId}`, fields.id); continue; }
        if (!fields[schema.titleField].trim()) continue;
        if (table === 'trashBatches' || table === 'trashItems') throw new Error('回收历史中存在未标识的原生行，请先处理异常记录');
        if (titleCell.isDetached !== true) throw new Error('Things 原生新增任务需要非绑定行，关联笔记请使用原笔记关联字段');
        fields.id = crypto.randomUUID();
        fields.sourceIndex = Math.max(-1, ...((entries.get(binding.keys.sourceIndex)?.values || []).map((value: any) => decodeCell('number', value) ?? -1))) + pending.length + 1;
        fields.order ??= fields.sourceIndex;
        if (['tasks', 'projects', 'areas'].includes(table)) {
          fields.created ??= Date.now(); fields.updated ??= fields.created;
        }
        if (table === 'tasks') { fields.status ||= 'todo'; fields.priority ||= 'none'; fields.storageState ||= 'active'; }
        if (table === 'projects') fields.status ||= 'active';
        nativeIds.set(`${table}:${itemId}`, fields.id);
        pending.push({ table, itemId, fields, cells });
      }
    }
    for (const row of pending) {
      const { table, itemId, fields, cells } = row, binding = this.binding.tables[table];
      const extra: Data = { unknown: {} };
      if (table === 'headings') {
        const projects = fields.projectId || [];
        const projectId = projects.length === 1 ? nativeIds.get(`projects:${projects[0]}`) : undefined;
        if (!projectId) throw new Error('新增项目分组需要且只能选择一个有效项目');
        extra.originalId = fields.id;
        fields.id = `${projectId}:${fields.id}`;
      }
      const presence = ['id', this.specs[table].titleField];
      if (['tasks', 'projects', 'areas'].includes(table)) presence.push('notes');
      if (table === 'tasks') presence.push('tags');
      if (table === 'projects') presence.push('headings');
      const patches: Array<{ itemID: string; keyID: string; value: Data }> = [];
      for (const column of this.specs[table].columns) {
        if (['extra', 'presence', 'tagOrder', 'notes', 'notesAssets'].includes(column.field)) continue;
        const value = fields[column.field];
        if (!TECHNICAL.has(column.field) && value !== undefined && value !== '' && (!Array.isArray(value) || value.length)) presence.push(column.field);
        if (equal(value, decodeCell(column.type, cells[column.field]))) continue;
        patches.push({ itemID: itemId, keyID: binding.keys[column.field], value: encodeCell(column.type, value) });
      }
      patches.push({ itemID: itemId, keyID: binding.keys.extra, value: encodeCell('text', JSON.stringify(extra)) },
        { itemID: itemId, keyID: binding.keys.presence, value: encodeCell('text', JSON.stringify([...new Set(presence)])) });
      await this.client.setCells(binding.avId, patches);
    }
  }

  private async saveMerged(desired: LegacySnapshot, explicitBase?: LegacySnapshot): Promise<void> {
    const baseline = explicitBase || this.baseline;
    if (!baseline) throw new Error('Things 保存前必须先加载数据库');
    this.validate(baseline);
    this.validate(desired);
    const baseTables = await flatten(baseline, this.specs);
    const wantedTables = await flatten(desired, this.specs);
    await this.recoverIdentities(wantedTables);
    // A user may add a detached native row after the Store's last read. Reconcile it here too:
    // recovery runs before load(), so deferring adoption to load would deadlock a saved intent.
    await this.adoptNativeRows();
    const latest = await this.readState(true);
    const latestTables = await flatten(latest.snapshot, this.specs);
    for (const table of TABLE_NAMES) for (const row of latest.tables[table].values()) {
      if (!row.presence.length && (!wantedTables[table].has(row.id) || row.itemId !== await stableId(this.binding.docId, `${table}:${row.id}`))) {
        throw new AVConflictError(table, 'unowned-incomplete-row');
      }
    }
    await this.assertCompletedImports(wantedTables, latest.tables, (table, id) => !baseTables[table].has(id));
    // A previously restored frozen batch is audit history, never an empty slot to reuse.
    for (const id of wantedTables.trashBatches.keys()) {
      if (!baseTables.trashBatches.has(id) && latest.tables.trashBatches.get(id)?.data.state === 'restored') {
        throw new AVConflictError('trashBatches', 'restored-identity');
      }
    }
    for (const table of TABLE_NAMES) {
      const base = baseTables[table], wanted = wantedTables[table], merged = latestTables[table];
      for (const [id, oldRow] of base) {
        const newRow = wanted.get(id), current = merged.get(id);
        if (!newRow) {
          if (current && !equal(current.data, oldRow.data)) throw new AVConflictError(table, 'delete');
          merged.delete(id); continue;
        }
        if (!current) {
          if (!equal(newRow.data, oldRow.data)) throw new AVConflictError(table, 'removed-row');
          continue; // An externally deleted, untouched record must not be resurrected.
        }
        const fields = new Set([...Object.keys(oldRow.data), ...Object.keys(newRow.data)]);
        for (const field of fields) {
          if (equal(oldRow.data[field], newRow.data[field])) continue;
          if (!equal(current.data[field], oldRow.data[field]) && !equal(current.data[field], newRow.data[field])) throw new AVConflictError(table, field);
          if (own(newRow.data, field)) current.data[field] = copy(newRow.data[field]); else delete current.data[field];
        }
        // Metadata follows the merged record instead of blindly restoring a stale presence array.
        current.presence = [...new Set([...current.presence, ...newRow.presence])]
          .filter((field) => own(current.data, field) || (table === 'projects' && field === 'headings'));
        current.notes = NOTE_TABLES.has(table) ? current.data.notes : undefined;
        // Extensions may happen to use an internal column name, e.g. sourceIndex. Keep their
        // original JSON value separate from the native ordering/ownership columns.
        const oldUnknown = oldRow.extra.unknown || {}, newUnknown = newRow.extra.unknown || {};
        current.extra.unknown ||= {};
        for (const field of new Set([...Object.keys(oldUnknown), ...Object.keys(newUnknown)])) {
          if (equal(oldUnknown[field], newUnknown[field])) continue;
          if (!equal(current.extra.unknown[field], oldUnknown[field]) && !equal(current.extra.unknown[field], newUnknown[field])) throw new AVConflictError(table, field);
          if (own(newUnknown, field)) current.extra.unknown[field] = copy(newUnknown[field]); else delete current.extra.unknown[field];
        }
      }
      for (const [id, row] of wanted) if (!base.has(id)) {
        // Completed retry rows were compared against the raw native cells above. Reconstructing
        // their relationships while another target row is incomplete can temporarily lose fields.
        merged.set(id, row);
      }
    }
    // Validate the actual three-way result, not only the caller's stale snapshot.
    const mergedSnapshot = this.snapshotFromTables(latestTables);
    this.validate(mergedSnapshot);
    await this.writeTables(latestTables, latest.tables, true);
    // The caller's Map may still contain values from its base. Keep that exact base for the next patch;
    // refresh/load is what adopts unrelated edits made in the native database.
    this.baseline = copy(desired);
  }

  private async recoverIdentities(wanted: Tables): Promise<void> {
    // An addRow may have committed before its identity-cell response failed. Only recover the
    // deterministic item from this particular import, never a same-title or arbitrary native row.
    for (const table of TABLE_NAMES) {
      const av = await this.client.getAV(this.binding.tables[table].avId);
      const primary = av.keyValues.find((entry: any) => entry.key.type === 'block');
      const ids = av.keyValues.find((entry: any) => entry.key.id === this.binding.tables[table].keys.id);
      for (const row of wanted[table].values()) {
        const itemId = await stableId(this.binding.docId, `${table}:${row.id}`);
        const existing = primary?.values?.find((value: any) => value.blockID === itemId);
        if (!existing) continue;
        const identity = ids?.values?.find((value: any) => value.blockID === itemId)?.text?.content;
        if (identity && identity !== row.id) throw new Error('Things 确定性条目 ID 冲突');
        if (!identity) {
          if (existing.block?.content !== String(row.data[this.specs[table].titleField] ?? '')) throw new Error('Things 未完成条目的标题已变更，不能自动认领');
          await this.client.setCells(this.binding.tables[table].avId, [{ itemID: itemId, keyID: this.binding.tables[table].keys.id, value: encodeCell('text', row.id) }]);
        }
      }
    }
  }

  private encodeRow(table: TableName, row: Row, desired: Tables): Data {
    const schema = this.specs[table], unresolved: Data = {};
    const encoded: Data = { [schema.titleField]: encodeCell('block', row.data[schema.titleField]) };
    for (const column of schema.columns) {
      if (column.field === 'extra' || column.field === 'presence') continue;
      if (column.field === 'notes') { encoded.notes = row.richPlan?.cell || row.cells?.notes || this.richNotes.prepare(row.notes ?? '').cell; continue; }
      if (column.field === 'notesAssets') { encoded.notesAssets = row.richPlan?.assets || row.cells?.notesAssets || this.richNotes.prepare(row.notes ?? '').assets; continue; }
      let value = row.data[column.field];
      if (column.relation) {
        const ids = column.multiple ? (value || []) : (value ? [value] : []);
        const targets: string[] = [], missing: string[] = [];
        for (const id of ids) {
          const targetKey = column.relation === 'headings' ? `${row.data.projectId}:${id}` : id;
          const target = desired[column.relation].get(targetKey);
          if (target?.itemId) targets.push(target.itemId); else missing.push(id);
        }
        if (missing.length) unresolved[column.field] = column.multiple ? missing : missing[0];
        value = targets;
      } else if (JSON_FIELDS.has(column.field)) value = value === undefined ? '' : JSON.stringify(value);
      encoded[column.field] = encodeCell(column.type, value);
    }
    encoded.extra = encodeCell('text', JSON.stringify({ ...row.extra, unresolved }));
    encoded.presence = encodeCell('text', JSON.stringify(row.presence));
    return encoded;
  }

  private sameCell(type: string, field: string, left: any, right: any): boolean {
    if (this.isRich && field === 'notes') return this.richNotes.same(left, right);
    const a = decodeCell(type, left), b = decodeCell(type, right);
    if (field === 'presence') return equal([...json(a, [], field)].sort(), [...json(b, [], field)].sort());
    return JSON_FIELDS.has(field) ? equal(json(a, undefined, field), json(b, undefined, field)) : equal(a, b);
  }

  private async assertCompletedImports(desired: Tables, current: Tables, include: (table: TableName, id: string) => boolean = () => true): Promise<void> {
    for (const table of TABLE_NAMES) for (const row of desired[table].values()) {
      row.itemId = current[table].get(row.id)?.itemId || await stableId(this.binding.docId, `${table}:${row.id}`);
    }
    // Presence is written after all business cells. Completed rows belong to this import only
    // if their current values still match; a retry must never roll back later native edits.
    for (const table of TABLE_NAMES) for (const row of desired[table].values()) {
      if (!include(table, row.id)) continue;
      const old = current[table].get(row.id);
      if (!old) continue;
      if (old.itemId !== await stableId(this.binding.docId, `${table}:${row.id}`)) throw new AVConflictError(table, 'import-item-identity');
      const richPending = this.isRich && old.extra.richNotes?.pending;
      if (richPending && old.extra.richNotes.aliases?.[0]?.source !== (row.notes ?? '')) throw new AVConflictError(table, 'import-rich-intent');
      if (this.isRich && old.cells?.notes?.text?.rich && !richPending && (old.notes ?? '') !== (row.notes ?? '')) throw new AVConflictError(table, 'import-rich-notes');
      if (this.isRich && NOTE_TABLES.has(table)) this.prepareRichRow(row, old);
      let notesDocId = this.isRich ? old.notesDocId : row.notes ? await stableId(this.binding.docId, `notes:${table}:${row.id}`) : undefined;
      if (!this.isRich && !row.notes && old.notesDocId && old.notes === '' && old.presence.length) {
        const expected = await stableId(this.binding.docId, `notes:${table}:${row.id}`);
        const attrs = await this.client.request('/api/attr/getBlockAttrs', { id: old.notesDocId });
        if (old.notesDocId !== expected || attrs?.['custom-things-owner'] !== this.binding.docId || attrs?.['custom-things-record'] !== `${table}:${row.id}`) {
          throw new AVConflictError(table, 'import-empty-notes-owner');
        }
        // Clearing a note preserves its document/block identity and references. This is still
        // the same empty legacy note, so an idempotent import should retain the empty document.
        notesDocId = old.notesDocId;
      }
      const encoded = this.encodeRow(table, { ...row, data: { ...row.data, notesDocId, notesLink: notesDocId ? `siyuan://blocks/${notesDocId}` : '' } }, desired);
      if (old.cells?.[this.specs[table].titleField]?.isDetached !== true) throw new AVConflictError(table, 'bound-row');
      for (const [field, value] of Object.entries(encoded)) {
        const type = this.specs[table].columns.find((column) => column.field === field)?.type || 'block';
        if (richPending && ['notes', 'notesAssets'].includes(field)) continue;
        if (richPending && field === 'extra') {
          const expected = json(decodeCell('text', value), {}, field);
          for (const [key, stored] of Object.entries(old.extra)) if (key !== 'richNotes' && !equal(stored, expected[key])) throw new AVConflictError(table, `partial-extra-${key}`);
          continue;
        }
        if (!old.presence.length) {
          if (field === 'presence') continue;
          if (field === 'extra') {
            const expected = json(decodeCell('text', value), {}, field);
            for (const [key, stored] of Object.entries(old.extra)) {
              if (key !== 'notesPending' && !equal(stored, expected[key])) throw new AVConflictError(table, `partial-extra-${key}`);
            }
            continue;
          }
          const existing = decodeCell(type, old.cells?.[field]);
          // Native AVs may materialize default empty cells before any write. A nonempty value
          // (and always the primary title) was already written and must still match this intent.
          if (type !== 'block' && (existing === undefined || existing === '' || existing === false || (Array.isArray(existing) && !existing.length))) continue;
        }
        if (table === 'projects' && field === 'presence') {
          // Earlier writes omitted this derived marker because headings live in a separate
          // table. Their actual rows are checked independently, so the marker is not content.
          const stored = old.presence.filter((name) => name !== 'headings').sort();
          const expected = row.presence.filter((name) => name !== 'headings').sort();
          if (!equal(stored, expected)) throw new AVConflictError(table, `import-${field}`);
        } else if (!this.sameCell(type, field, old.cells?.[field], value)) throw new AVConflictError(table, `import-${field}`);
      }
      if (old.presence.length && !richPending && (old.notes ?? '') !== (row.notes ?? '')) throw new AVConflictError(table, 'import-notes');
    }
  }

  private async readState(allowIncomplete = false): Promise<ReadState> {
    const tables = emptyTables();
    const avs = await Promise.all(TABLE_NAMES.map((table) => this.client.getAV(this.binding.tables[table].avId)));
    for (let index = 0; index < TABLE_NAMES.length; index++) {
      const table = TABLE_NAMES[index], schema = this.specs[table], bound = this.binding.tables[table];
      const av = avs[index];
      const entries = new Map<string, any>(av.keyValues.map((entry: any) => [entry.key.id, entry]));
      const primary = entries.get(bound.keys[schema.titleField]);
      if (primary?.key?.type !== 'block') throw new Error(`Things 主列被删除或改变：${table}`);
      for (const column of schema.columns) {
        if (entries.get(bound.keys[column.field])?.key?.type !== column.type) throw new Error(`Things 数据库列被删除或改变：${table}.${column.field}`);
      }
      for (const titleCell of primary.values || []) {
        const itemId = titleCell.blockID;
        const cells: Data = { [schema.titleField]: titleCell };
        const fields: Data = { [schema.titleField]: decodeCell('block', titleCell) };
        for (const column of schema.columns) {
          const cell = entries.get(bound.keys[column.field]).values?.find((value: any) => value.blockID === itemId);
          cells[column.field] = cell;
          fields[column.field] = decodeCell(column.type, cell);
        }
        // A native blank/new record is a draft until a Things ID is assigned. Do not delete it.
        if (!fields.id) {
          if (!fields[schema.titleField]?.trim()) continue;
          throw new Error(`Things 检测到原生新增行，请先通过新增记录校验：${table}`);
        }
        if (tables[table].has(fields.id)) throw new Error(`Things 数据库存在重复业务 ID：${table}`);
        const presence = json(fields.presence, [], `${table}.presence`);
        if (!Array.isArray(presence) || presence.some((field) => typeof field !== 'string')) throw new Error('Things 原字段记录格式无效');
        if (!presence.length && !allowIncomplete) throw new Error('Things 存在未完成写入，请重试原操作或恢复迁移');
        const extra = json(fields.extra, {}, `${table}.extra`);
        if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new Error('Things 扩展数据格式无效');
        tables[table].set(fields.id, { id: fields.id, data: fields, presence, extra, itemId, notesDocId: fields.notesDocId || undefined, cells });
      }
    }

    const byItem = Object.fromEntries(TABLE_NAMES.map((table) => [table, new Map([...tables[table].values()].map((row) => [row.itemId, row]))])) as Record<TableName, Map<string, Row>>;
    for (const table of TABLE_NAMES) for (const row of tables[table].values()) {
      for (const column of this.specs[table].columns) {
        if (!column.relation) continue;
        const ids: string[] = row.data[column.field] || [];
        if (!column.multiple && ids.length > 1) throw new Error(`Things 单值关联包含多个目标：${table}.${column.field}`);
        const converted = ids.map((itemId) => {
          const target = byItem[column.relation!].get(itemId);
          if (!target) throw new Error(`Things 关联指向缺失条目：${table}.${column.field}`);
          if (column.relation !== 'headings') return target.id;
          const prefix = `${row.data.projectId}:`;
          return target.extra.originalId ?? (allowIncomplete && target.id.startsWith(prefix) ? target.id.slice(prefix.length) : undefined);
        });
        const missing = row.extra.unresolved?.[column.field];
        row.data[column.field] = column.multiple ? [...converted, ...(Array.isArray(missing) ? missing : [])] : (converted[0] ?? missing);
      }
      for (const field of ['groupOrder', 'collapsedGroups', 'payload', 'tagOrder']) {
        if (own(row.data, field)) row.data[field] = json(row.data[field], undefined, `${table}.${field}`);
      }
      if (table === 'tasks' && Array.isArray(row.data.tagOrder)) {
        const members = row.data.tags || [];
        row.data.tags = [...row.data.tagOrder.filter((id: string) => members.includes(id)), ...members.filter((id: string) => !row.data.tagOrder.includes(id))];
      }
      if (!NOTE_TABLES.has(table)) continue;
      if (this.isRich) {
        const note = this.richNotes.read(row.cells?.notes, row.cells?.notesAssets, row.extra.richNotes, allowIncomplete);
        if (row.presence.includes('notes') || note) row.notes = note;
        if (table === 'trashItems' && !allowIncomplete && note !== (row.data.payload?.notes ?? '')) throw new AVConflictError(table, 'notes-snapshot');
        continue;
      }
      if (row.extra.notesPending) {
        if (!allowIncomplete) throw new Error('Things 备注写入尚未完成，请重试原操作或恢复迁移');
        if (row.presence.includes('notes')) row.notes = '';
      } else if (row.notesDocId) row.notes = await this.readNotes(row.notesDocId, allowIncomplete);
      else if (row.presence.includes('notes')) row.notes = '';
    }

    const snapshot = this.snapshotFromTables(tables, allowIncomplete);
    for (const batch of tables.trashBatches.values()) {
      const items = ordered([...tables.trashItems.values()].filter((item) => item.presence.length && item.data.batchId === batch.id));
      if (!batch.presence.length || items.length !== batch.extra.itemCount) {
        if (!allowIncomplete) throw new Error('Things 回收批次写入尚未完成');
        continue;
      }
      const original = { ...(batch.extra.batchExtra || {}), id: batch.extra.originalId, deletedAt: batch.data.deletedAt, tasks: items.map((item) => item.data.payload) };
      if (await batchDigest(original) !== batch.extra.digest) throw new AVConflictError('trashBatches', 'frozen-snapshot');
    }
    return { tables, snapshot };
  }

  private snapshotFromTables(tables: Tables, allowIncomplete = false): LegacySnapshot {
    const snapshot = emptySnapshot();
    const original = (table: TableName, row: Row): Data => {
      const data: Data = { ...(row.extra.unknown || {}) };
      for (const field of [this.specs[table].titleField, ...this.specs[table].columns.map((column) => column.field)]) {
        if (TECHNICAL.has(field)) continue;
        const value = row.data[field];
        if (row.presence.includes(field) || (value !== undefined && value !== '' && value !== false && (!Array.isArray(value) || value.length))) data[field] = value;
      }
      if (row.notes !== undefined) data.notes = row.notes;
      return definedRecord(data);
    };
    for (const row of ordered(tables.tasks.values())) {
      if (allowIncomplete && !row.presence.length) continue;
      if (!['active', 'archived'].includes(row.data.storageState)) throw new Error('Things 任务存储状态无效');
      const task = original('tasks', row);
      (row.data.storageState === 'archived' ? snapshot.archived : snapshot.tasks).push(task);
    }
    for (const table of ['areas', 'tags'] as const) snapshot[table] = ordered(tables[table].values()).filter((row) => row.presence.length).map((row) => original(table, row));
    snapshot.projects = ordered(tables.projects.values()).filter((row) => row.presence.length).map((row) => {
      const project = original('projects', row);
      project.headings = ordered([...tables.headings.values()].filter((heading) => heading.presence.length && heading.data.projectId === row.id)).map((heading) => {
        const data = original('headings', heading);
        data.id = heading.extra.originalId;
        delete data.projectId;
        return data;
      });
      return project;
    });
    snapshot.trash = ordered(tables.trashBatches.values()).filter((batch) => batch.presence.length && batch.data.state !== 'restored' &&
      (!allowIncomplete || [...tables.trashItems.values()].filter((item) => item.presence.length && item.data.batchId === batch.id).length === batch.extra.itemCount)).map((batch) => ({
      ...(batch.extra.batchExtra || {}), id: batch.extra.originalId, deletedAt: batch.data.deletedAt,
      tasks: ordered([...tables.trashItems.values()].filter((item) => item.presence.length && item.data.batchId === batch.id)).map((item) => {
        if (!item.data.payload || typeof item.data.payload !== 'object') throw new Error('Things 回收快照损坏');
        return copy(item.data.payload);
      }),
    }));
    return snapshot;
  }

  private async readNotes(id: string, allowPending = false): Promise<string> {
    return (await this.nativeNotes.read(id, allowPending)).text;
  }

  private prepareRichRow(row: Row, current?: Row): void {
    row.extra = { ...current?.extra, ...row.extra };
    row.data.notesDocId = current?.data.notesDocId;
    row.data.notesLink = current?.data.notesLink;
    row.notesDocId = current?.notesDocId;
    if ((row.notes ?? '') === (current?.notes ?? '') && current?.cells && !current.extra.richNotes?.pending) {
      row.cells = current.cells;
      if (current.extra.richNotes) row.extra.richNotes = copy(current.extra.richNotes);
      return;
    }
    row.richPlan = this.richNotes.prepare(row.notes ?? '', current?.cells?.notes, current?.cells?.notesAssets, current?.extra.richNotes);
    row.extra.richNotes = row.richPlan.state;
  }

  /** Reserve both column versions before changing either. Recovery only accepts these exact
   * pairs, so a lost response cannot resurrect an image removed by a concurrent native edit. */
  private async writeRichNotes(table: TableName, row: Row, current?: Row): Promise<void> {
    const plan = row.richPlan;
    if (!plan) return;
    const binding = this.binding.tables[table];
    const patch = (field: string, value: Data) => ({ itemID: row.itemId!, keyID: binding.keys[field], value });
    const values = async () => {
      const av = await this.client.getAV(binding.avId);
      return (field: string) => av.keyValues.find((entry: any) => entry.key.id === binding.keys[field])?.values?.find((value: any) => value.blockID === row.itemId);
    };
    const before = await values();
    const sameNotes = (cell: (field: string) => any) => this.richNotes.same(cell('notes'), before('notes')) && equal(decodeCell('mAsset', cell('notesAssets')) || [], decodeCell('mAsset', before('notesAssets')) || []);
    if (decodeCell('text', before('id')) !== row.id || !this.richNotes.same(before('notes'), current?.cells?.notes) ||
      !equal(decodeCell('mAsset', before('notesAssets')) || [], decodeCell('mAsset', current?.cells?.notesAssets) || []) ||
      !equal(json(decodeCell('text', before('extra')), {}, 'extra'), current?.extra || {})) throw new AVConflictError(table, 'notes-before-write');
    const reservation = this.richNotes.reservation(plan, before('notes'), before('notesAssets'), current?.extra.richNotes);
    const reservedExtra = { ...row.extra, richNotes: reservation };
    await this.client.setCells(binding.avId, [patch('extra', encodeCell('text', JSON.stringify(reservedExtra)))]);
    const reserved = await values();
    if (!sameNotes(reserved) || !equal(json(decodeCell('text', reserved('extra')), {}, 'extra'), reservedExtra)) throw new AVConflictError(table, 'notes-after-reservation');
    await this.client.setCells(binding.avId, [patch('notes', plan.cell), patch('notesAssets', plan.assets)]);
    const cell = await values();
    if (this.richNotes.read(cell('notes'), cell('notesAssets'), plan.state) !== (row.notes ?? '')) throw new Error('Things 数据库富文本备注写入后的校验不一致，已保留恢复记录');
    await this.client.setCells(binding.avId, [patch('extra', encodeCell('text', JSON.stringify(row.extra)))]);
    if (current?.cells) { current.cells.notes = cell('notes'); current.cells.notesAssets = cell('notesAssets'); delete current.cells.extra; }
  }

  /** Copy only note columns and their formatting metadata. V1 documents, identities, relations,
   * and hidden links remain intact so the upgrade can still verify the original snapshot. */
  async migrateNotesFromV1(snapshot: LegacySnapshot): Promise<void> {
    if (!this.isRich) throw new Error('富文本备注迁移需要数据库版本 2');
    this.validate(snapshot);
    const wanted = await flatten(snapshot, this.specs);
    for (const table of NOTE_TABLES) for (const row of wanted[table].values()) this.richNotes.validate(row.notes ?? '');
    return this.enqueue(async () => {
      const current = await this.readState(true);
      for (const table of NOTE_TABLES) for (const row of wanted[table].values()) {
        const old = current.tables[table].get(row.id);
        if (!old?.itemId || !old.presence.length) throw new AVConflictError(table, 'notes-upgrade-identity');
        if (old.extra.richNotes && !old.extra.richNotes.pending && (old.notes ?? '') !== (row.notes ?? '')) throw new AVConflictError(table, 'notes-upgrade-edited');
        if (!old.extra.richNotes && ((old.notes ?? '') || old.cells?.notesAssets?.mAsset?.length)) throw new AVConflictError(table, 'notes-upgrade-nonempty');
        row.itemId = old.itemId; row.extra = copy(old.extra);
        this.prepareRichRow(row, old);
        await this.writeRichNotes(table, row, old);
      }
      const actual = (await this.readState()).snapshot;
      if (!equal(actual, snapshot)) throw new Error('Things 富文本备注迁移读回不一致，旧备注文档和数据绑定均应保留');
    });
  }

  private async writeNotes(table: TableName, row: Row, current?: Row): Promise<string | undefined> {
    const wanted = row.notes ?? '';
    let docId = current?.notesDocId;
    if (docId && !current?.extra.notesPending) {
      if (table === 'trashItems' && wanted !== current.notes) throw new AVConflictError(table, 'notes-snapshot');
      await this.nativeNotes.write(docId, wanted, current.notes ?? '', this.binding.docId, `${table}:${row.id}`);
      if (await this.readNotes(docId) !== wanted) throw new Error('Things 备注保存后的校验不一致');
      return docId;
    }
    if (!wanted) return undefined;
    docId = await stableId(this.binding.docId, `notes:${table}:${row.id}`);
    await this.client.request('/api/sqlite/flushTransaction', {});
    const found = await this.client.request('/api/query/sql', { stmt: `SELECT id, box, type FROM blocks WHERE id = '${docId}' LIMIT 1` });
    if (!Array.isArray(found)) throw new Error('Things 无法确认备注文档是否已创建');
    if (found.length) {
      const attrs = await this.client.request('/api/attr/getBlockAttrs', { id: docId });
      if (attrs?.['custom-things-owner'] !== this.binding.docId || attrs?.['custom-things-record'] !== `${table}:${row.id}`) {
        if (!current?.extra.notesPending || attrs?.['custom-things-owner'] || found[0].box !== this.binding.notebookId || found[0].type !== 'd') {
          throw new Error('Things 备注文档 ID 已被其他内容使用');
        }
        await this.client.request('/api/attr/setBlockAttrs', { id: docId, attrs: { 'custom-things-owner': this.binding.docId, 'custom-things-record': `${table}:${row.id}` } });
      }
      await this.nativeNotes.initialize(docId, wanted, this.binding.docId, `${table}:${row.id}`);
      if (await this.readNotes(docId) !== wanted) throw new AVConflictError(table, 'notes-import');
      delete row.extra.notesPending;
      return docId;
    }
    // Reserve the expected document identity in the row before creation. A lost response can then
    // be recovered after restart without trusting a matching title or an arbitrary existing note.
    await this.client.setCells(this.binding.tables[table].avId, [
      { itemID: row.itemId!, keyID: this.binding.tables[table].keys.notesDocId, value: encodeCell('text', docId) },
      { itemID: row.itemId!, keyID: this.binding.tables[table].keys.extra, value: encodeCell('text', JSON.stringify({ ...row.extra, notesPending: true })) },
    ]);
    // The reservation changed the server after readState(). Invalidate the cached extra cell,
    // otherwise an equality optimization could leave notesPending set after successful creation.
    if (current?.cells) delete current.cells.extra;
    const created = await this.client.request('/api/filetree/createDocWithMd', {
      notebook: this.binding.notebookId, parentID: this.binding.docId, path: `/Things 备注 ${docId}`, id: docId,
      markdown: await this.nativeNotes.prepareCreateMarkdown(wanted),
    });
    if (created !== docId) throw new Error('Things 备注文档创建结果不匹配');
    let ready = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      await this.client.request('/api/sqlite/flushTransaction', {});
      const rows = await this.client.request('/api/query/sql', { stmt: `SELECT id, box, type FROM blocks WHERE id = '${docId}' LIMIT 1` });
      if (!Array.isArray(rows)) throw new Error('Things 备注文档索引不可读取');
      if (rows.length) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 60 * (attempt + 1)));
    }
    if (!ready) throw new Error('Things 备注文档尚未可读取，请稍后重试原操作');
    await this.client.request('/api/attr/setBlockAttrs', { id: docId, attrs: { 'custom-things-owner': this.binding.docId, 'custom-things-record': `${table}:${row.id}` } });
    await this.nativeNotes.initialize(docId, wanted, this.binding.docId, `${table}:${row.id}`);
    if (await this.readNotes(docId) !== wanted) throw new Error('Things 备注导入的 Markdown 往返不一致；请保留原始数据检查');
    delete row.extra.notesPending;
    return docId;
  }

  private async writeTables(desired: Tables, current: Tables, remove: boolean): Promise<void> {
    // Preflight every note change before altering any table cells.
    for (const table of TABLE_NAMES) for (const row of desired[table].values()) {
      const old = current[table].get(row.id);
      if (this.isRich && NOTE_TABLES.has(table)) {
        if (row.notes !== old?.notes) this.richNotes.validate(row.notes ?? '');
        if (table === 'trashItems' && old?.presence.length && (row.notes ?? '') !== (old.notes ?? '')) throw new AVConflictError(table, 'notes-snapshot');
        this.prepareRichRow(row, old);
      } else if (old?.notesDocId && !old.extra.notesPending && row.notes !== old.notes) await this.nativeNotes.preflight(old.notesDocId, row.notes || '');
    }
    for (const table of TABLE_NAMES) for (const row of desired[table].values()) {
      const old = current[table].get(row.id);
      row.itemId = old?.itemId || await stableId(this.binding.docId, `${table}:${row.id}`);
      if (!old) {
        if ([...current[table].values()].some((item) => item.itemId === row.itemId)) throw new Error('Things 条目 ID 冲突');
        await this.client.addRow(this.binding.tables[table].avId, row.itemId, String(row.data[this.specs[table].titleField] ?? ''));
        // Publish identity immediately; if later work fails, retry can find the same entry.
        await this.client.setCells(this.binding.tables[table].avId, [{ itemID: row.itemId, keyID: this.binding.tables[table].keys.id, value: encodeCell('text', row.id) }]);
      }
    }
    for (const table of TABLE_NAMES) {
      const binding = this.binding.tables[table], schema = this.specs[table];
      const patches: Array<{ itemID: string; keyID: string; value: Data }> = [];
      for (const row of desired[table].values()) {
        const old = current[table].get(row.id);
        if (this.isRich) {
          if (NOTE_TABLES.has(table)) await this.writeRichNotes(table, row, old);
        } else {
          row.notesDocId = await this.writeNotes(table, row, old);
          row.data.notesDocId = row.notesDocId;
          row.data.notesLink = row.notesDocId ? `siyuan://blocks/${row.notesDocId}` : '';
        }
        const encoded = this.encodeRow(table, row, desired);
        for (const [field, value] of Object.entries(encoded)) {
          const spec = schema.columns.find((column) => column.field === field);
          const type = spec?.type || 'block';
          if (old?.cells?.[field] && this.sameCell(type, field, old.cells[field], value)) continue;
          patches.push({ itemID: row.itemId!, keyID: binding.keys[field], value });
        }
      }
      for (let offset = 0; offset < patches.length; offset += 100) await this.client.setCells(binding.avId, patches.slice(offset, offset + 100));
    }
    if (remove) for (const table of [...TABLE_NAMES].reverse()) {
      // Popping a legacy recovery batch means "restored", not "erase its history".
      // Frozen snapshots and their native note/asset references stay available for inspection.
      if (table === 'trashItems') continue;
      if (table === 'trashBatches') {
        const patches = [...current[table].values()].filter((row) => !desired[table].has(row.id) && row.data.state !== 'restored')
          .map((row) => ({ itemID: row.itemId!, keyID: this.binding.tables[table].keys.state, value: encodeCell('select', 'restored') }));
        if (patches.length) await this.client.setCells(this.binding.tables[table].avId, patches);
        continue;
      }
      const ids = [...current[table].values()].filter((row) => !desired[table].has(row.id)).map((row) => row.itemId!);
      if (ids.length) await this.client.removeRows(this.binding.tables[table].avId, ids);
    }
  }
}

export function stripBlockAttributes(kramdown: string): string {
  let fence = '';
  const lines: string[] = [];
  for (const line of kramdown.replace(/\r\n/g, '\n').split('\n')) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1][0]; else if (marker[1][0] === fence) fence = '';
      lines.push(line); continue;
    }
    if (!fence && /^\{:\s.*\}$/.test(line.trim())) continue;
    lines.push(line);
  }
  return lines.join('\n').trimEnd();
}
