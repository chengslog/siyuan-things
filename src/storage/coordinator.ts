import { SiYuanAVClient } from './avClient.ts';
import { ensureDatabases, verifyDatabaseBinding, STORAGE_BINDING_FILE, type Binding } from './bootstrap.ts';
import { AVRepository } from './avRepository.ts';
import { LEGACY_FILES, readLegacy, auditLegacy, type LegacySnapshot } from './preflight.ts';
import { STORAGE_BRIDGE, type DataStore } from './bridge.ts';
import { mergeTaskChanges, planTaskTransitions, seedTaskObservation, validateObservation, type TaskObservation } from './nativeTransitions.ts';
import { upgradeNotesToRichText, NOTES_UPGRADE_FILE } from './notesUpgrade.ts';
import { ensureTaskViews } from './nativeViews.ts';

export const SOURCE_FILE = 'things-storage-source.json';
export const BACKUP_FILE = 'things-storage-original-v1.json';
export const WRITE_INTENT_FILE = 'things-storage-write-intent-v1.json';
export const OBSERVATION_FILE = 'things-storage-observed-v1.json';

type Repository = Pick<AVRepository, 'load' | 'import' | 'preflightSnapshot' | 'saveSnapshot' | 'recoverPending'>;
type Options = {
  inspectLegacyCache?: () => Promise<Record<string, unknown[]>>;
  ensure?: typeof ensureDatabases;
  verify?: typeof verifyDatabaseBinding;
  repository?: (binding: any) => Repository;
  now?: () => number;
  upgradeNotes?: typeof upgradeNotesToRichText;
  ensureViews?: typeof ensureTaskViews;
};
type WriteIntent = { schemaVersion: 1; binding: Binding; base: LegacySnapshot; desired: LegacySnapshot; createdAt: number; observation?: TaskObservation };

export function stableJSON(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(stableJSON).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).filter(k => value[k] !== undefined).sort()
      .map(k => JSON.stringify(k) + ':' + stableJSON(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

const fileKey = (name: string) => Object.entries(LEGACY_FILES).find(([, f]) => f === name)?.[0] as keyof LegacySnapshot | undefined;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const present = (value: unknown): boolean => value !== undefined && value !== null && value !== '';
const localWriteLocks = new WeakMap<DataStore, Promise<void>>();

/** Selects a source once. Old records are never implicitly migrated on startup. */
export class StorageCoordinator {
  private host: DataStore;
  private client: SiYuanAVClient;
  private options: Options;
  private ready?: Promise<void>;
  private observedDatabaseSource = false;
  private queue: Promise<unknown> = Promise.resolve();
  private repository?: Repository;
  private snapshot?: LegacySnapshot;
  // Advance a consumer's base only when that exact collection was delivered to its Store.
  // Loading a newer global snapshot must not make another Store's stale Map look like new edits.
  private delivered: Partial<Record<keyof LegacySnapshot, LegacySnapshot>> = {};
  private binding?: Binding;
  private failed?: Error;
  private migrating = false;
  mode: 'starting' | 'legacy' | 'database' = 'starting';
  docId?: string;
  readonly facade: DataStore;

  get notesInDatabase(): boolean { return this.mode === 'database' && this.binding?.schemaVersion === 2; }

  constructor(host: DataStore, client: SiYuanAVClient, options: Options = {}) {
    this.host = host;
    this.client = client;
    this.options = options;
    const self = this;
    this.facade = new Proxy(host, {
      get(target, key) {
        if (key === STORAGE_BRIDGE) return { isNative: () => self.mode === 'database', writeFiles: self.writeFiles.bind(self) };
        if (key === 'loadData') return self.read.bind(self);
        if (key === 'saveData') return self.write.bind(self);
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  start(): Promise<void> {
    if (!this.ready) this.ready = this.initialize().then(() => {
      this.failed = undefined;
    }).catch(error => {
      this.failed = error;
      // A phone can start while sync or its local kernel is still unavailable.
      // Retry the same source validation; never substitute a new empty source.
      this.ready = undefined;
      throw error;
    });
    return this.ready;
  }

  private async initialize(): Promise<void> {
    const source = await this.host.loadData(SOURCE_FILE);
    if (present(source)) this.observedDatabaseSource = true;
    const pending = await this.host.loadData(WRITE_INTENT_FILE);
    // Retry like a new read, without retaining a partially initialized repository.
    this.repository = undefined;
    this.snapshot = undefined;
    this.binding = undefined;
    this.docId = undefined;
    this.mode = 'starting';
    this.delivered = {};
    if (present(source) && source.mode !== 'database') throw new Error('Things 数据源配置无效，请保留原数据并检查配置。');
    if (present(source)) {
      if (source.schemaVersion !== 1 || !source.binding?.docId) throw new Error('Things 数据库版本或绑定不受支持。');
      // An active binding must never be replaced by a freshly provisioned empty database.
      await this.checkVersion();
      await (this.options.verify || verifyDatabaseBinding)(this.client, source.binding);
      this.repository = this.makeRepository(source.binding);
      this.binding = source.binding;
      this.snapshot = await this.withWriteLock(() => this.recoverOrLoad());
      this.docId = source.binding.docId;
      this.mode = 'database';
      if (this.notesInDatabase) {
        await this.syncStoredBinding();
        await this.ensureViews();
      }
      return;
    }
    if (this.observedDatabaseSource) throw new Error('原数据库的数据源绑定暂不可读取，请恢复绑定后重试；不会创建替代数据库。');
    if (present(pending)) throw new Error('存在未完成的数据库保存，但缺少原数据源绑定；请恢复绑定，不能自动创建空数据库。');
    this.snapshot = await readLegacy(this.host);
    const audit = auditLegacy(this.snapshot);
    if (audit.hasLegacyData) {
      this.mode = 'legacy';
      return;
    }
    await this.assertNoLegacyCache();
    await this.checkVersion();
    const binding = await (this.options.ensure || ensureDatabases)(this.host, this.client);
    const repo = this.makeRepository(binding);
    const snapshot = await repo.load();
    if (auditLegacy(snapshot).hasLegacyData) throw new Error('发现已有数据库记录，但缺少激活记录；请恢复数据源绑定，不能当作全新安装。');
    await this.activate(binding, repo, snapshot);
  }

  private makeRepository(binding: any): Repository {
    return this.options.repository?.(binding) || new AVRepository(this.client, binding);
  }

  private async activate(binding: any, repository: Repository, snapshot: LegacySnapshot): Promise<void> {
    const source = { schemaVersion: 1, mode: 'database', binding };
    // Seed imported completion history before activation. It must never be replayed as new events.
    await this.persistObservation(seedTaskObservation(snapshot, binding.docId));
    // A failed response can still mean the source switch committed. Verify it before allowing any
    // more legacy writes; otherwise those writes would disappear on the next database-backed start.
    try { await this.host.saveData(SOURCE_FILE, source); } catch { /* Read back the durable decision below. */ }
    let confirmed = false;
    try { confirmed = stableJSON(await this.host.loadData(SOURCE_FILE)) === stableJSON(source); } catch { /* Unknown is not a legacy-mode decision. */ }
    if (!confirmed) {
      this.failed = new Error('数据源切换结果暂时无法确认，已暂停后续写入；请重新加载 Things 核对当前数据源。');
      throw this.failed;
    }
    this.repository = repository;
    this.binding = binding;
    this.snapshot = snapshot;
    this.docId = binding.docId;
    this.mode = 'database';
    if (this.notesInDatabase) await this.ensureViews();
  }

  private async ensureViews(): Promise<void> {
    if (this.binding?.schemaVersion === 2) {
      await (this.options.ensureViews || ensureTaskViews)(this.host, this.client, this.binding);
    }
  }

  /** The committed source decides the schema, even if a previous response was lost. */
  private async syncStoredBinding(): Promise<void> {
    if (stableJSON(await this.host.loadData(STORAGE_BINDING_FILE)) === stableJSON(this.binding)) return;
    try { await this.host.saveData(STORAGE_BINDING_FILE, clone(this.binding)); } catch { /* Confirm durable outcome below. */ }
    if (stableJSON(await this.host.loadData(STORAGE_BINDING_FILE)) !== stableJSON(this.binding)) {
      throw new Error('数据库绑定保存结果尚未确认，请重新加载 Things；当前数据源不会回退。');
    }
  }

  private async assertCurrentSource(): Promise<void> {
    const source = await this.host.loadData(SOURCE_FILE);
    if (source?.mode !== 'database' || stableJSON(source.binding) !== stableJSON(this.binding)) {
      throw new Error('Things 数据源已在其他窗口升级或改变，请重新加载后再编辑。');
    }
  }

  private async assertNoLegacyCache(): Promise<void> {
    const cached = await this.options.inspectLegacyCache?.();
    if (cached && Object.values(cached).some(items => items.length > 0)) {
      throw new Error('发现旧版 IndexedDB 数据，请先导出并核对旧缓存；已暂停数据库初始化，原数据未改动。');
    }
  }

  private async checkVersion(): Promise<void> {
    const version = await this.client.request('/api/system/version', {});
    const parts = String(version).split('.').map(Number);
    if (parts.length < 3 || parts.some(n => !Number.isFinite(n)) || parts[0] < 3 ||
      (parts[0] === 3 && (parts[1] < 8 || (parts[1] === 8 && parts[2] < 8)))) {
      throw new Error('原生数据库存储需要思源 3.8.8 或更新版本。');
    }
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => {});
    return next;
  }

  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (locks) return await locks.request(`siyuan-things-write-v1-${this.binding?.docId || 'unbound'}`, operation);
    const previous = localWriteLocks.get(this.host) || Promise.resolve();
    const run = previous.then(operation);
    const tail = run.then(() => undefined, () => undefined);
    localWriteLocks.set(this.host, tail);
    try { return await run; }
    finally { if (localWriteLocks.get(this.host) === tail) localWriteLocks.delete(this.host); }
  }

  private async persistIntent(value: WriteIntent | null): Promise<void> {
    await this.host.saveData(WRITE_INTENT_FILE, clone(value));
    if (stableJSON(await this.host.loadData(WRITE_INTENT_FILE)) !== stableJSON(value)) {
      throw new Error('保存恢复记录读回不一致，已停止修改数据库。');
    }
  }

  private async persistObservation(value: TaskObservation): Promise<void> {
    validateObservation(value, value.docId);
    if (stableJSON(await this.host.loadData(OBSERVATION_FILE)) === stableJSON(value)) return;
    await this.host.saveData(OBSERVATION_FILE, clone(value));
    if (stableJSON(await this.host.loadData(OBSERVATION_FILE)) !== stableJSON(value)) {
      throw new Error('Things 状态观察基线保存后校验失败，已保留未完成操作。');
    }
  }

  private async observationFor(snapshot: LegacySnapshot): Promise<TaskObservation> {
    const saved = await this.host.loadData(OBSERVATION_FILE);
    if (present(saved)) {
      validateObservation(saved, this.binding!.docId);
      return saved;
    }
    const seeded = seedTaskObservation(snapshot, this.binding!.docId);
    await this.persistObservation(seeded);
    return seeded;
  }

  private async commitIntent(intent: WriteIntent, recovering = false): Promise<LegacySnapshot> {
    if (intent.observation) validateObservation(intent.observation, this.binding!.docId);
    let recoveryMayBeNeeded = recovering;
    try {
      if (recovering) await this.repository!.recoverPending(clone(intent.base), clone(intent.desired));
      else {
        // Unsupported notes and known conflicts are ordinary rejected drafts. Check them before
        // creating a recovery obligation that would otherwise keep replaying an impossible edit.
        await this.repository!.preflightSnapshot(intent.desired, intent.base);
        recoveryMayBeNeeded = true;
        await this.persistIntent(intent);
        await this.repository!.saveSnapshot(intent.desired, intent.base);
      }
      const saved = await this.repository!.load();
      // Acknowledge only the planned state. Concurrent native changes in readback still need processing.
      if (intent.observation) await this.persistObservation(intent.observation);
      await this.persistIntent(null);
      return saved;
    } catch (error) {
      if (!recoveryMayBeNeeded) throw error;
      this.failed = new Error(`数据库保存中断，已暂停后续写入；请重新加载 Things 核对或恢复未完成保存：${(error as Error).message}`);
      throw this.failed;
    }
  }

  private async reconcileTransitions(snapshot: LegacySnapshot): Promise<LegacySnapshot> {
    const observation = await this.observationFor(snapshot);
    const now = this.options.now?.() ?? Date.now();
    const planned = await planTaskTransitions(snapshot, observation, now);
    if (!planned.changed) {
      await this.persistObservation(planned.observation);
      return snapshot;
    }
    return this.commitIntent({ schemaVersion: 1, binding: this.binding!, base: snapshot,
      desired: planned.snapshot, observation: planned.observation, createdAt: now });
  }

  private async recoverOrLoad(): Promise<LegacySnapshot> {
    await this.assertCurrentSource();
    const intent = await this.host.loadData(WRITE_INTENT_FILE);
    let snapshot: LegacySnapshot;
    if (present(intent)) {
      if (intent.schemaVersion !== 1 || stableJSON(intent.binding) !== stableJSON(this.binding)
        || auditLegacy(intent.base).errors.length || auditLegacy(intent.desired).errors.length) {
        throw new Error('未完成的保存记录损坏或不属于当前数据库，请保留记录并恢复原绑定。');
      }
      // Recovery performs the original three-way patch, never an unconditional import of stale data.
      snapshot = await this.commitIntent(intent, true);
    } else snapshot = await this.repository!.load();
    // An interrupted note upgrade freezes its original snapshot. Do not replay completion effects
    // against the old representation until the explicit upgrade has resumed and switched sources.
    if (this.binding?.schemaVersion === 1 && present(await this.host.loadData(NOTES_UPGRADE_FILE))) return snapshot;
    return this.reconcileTransitions(snapshot);
  }

  async refresh(): Promise<void> {
    await this.start();
    if (this.migrating) return;
    await this.enqueue(async () => {
      if (this.repository) {
        await (this.options.verify || verifyDatabaseBinding)(this.client, this.binding!);
        this.snapshot = await this.withWriteLock(() => this.recoverOrLoad());
        this.failed = undefined;
      } else this.snapshot = await readLegacy(this.host);
    });
  }

  async read(name: string): Promise<any> {
    const key = fileKey(name);
    if (!key) return this.host.loadData(name);
    await this.start();
    const value = clone(this.snapshot![key]);
    this.delivered[key] = this.snapshot!;
    return value;
  }

  async write(name: string, value: any): Promise<void> {
    if (!fileKey(name)) { await this.host.saveData(name, value); return; }
    return this.writeFiles({ [name]: value });
  }

  async writeFiles(files: Record<string, any[]>): Promise<void> {
    await this.start();
    if (this.failed) throw this.failed;
    if (this.migrating) throw new Error('数据库迁移中，请稍后再编辑任务。');
    const requested = clone(files);
    const observed: Partial<Record<keyof LegacySnapshot, LegacySnapshot>> = {};
    for (const [file, data] of Object.entries(requested)) {
      const key = fileKey(file);
      if (!key || !Array.isArray(data)) throw new Error('无效的 Things 数据集合。');
      observed[key] = this.delivered[key] ?? this.snapshot!;
    }
    await this.enqueue(async () => {
      if (this.failed) throw this.failed;
      if (this.binding?.schemaVersion === 1 && present(await this.host.loadData(NOTES_UPGRADE_FILE))) {
        throw new Error('备注升级尚未完成，请先在设置中继续升级；原数据和备注文档已保留。');
      }
      const keys = Object.keys(observed) as Array<keyof LegacySnapshot>;
      // Choose a coherent full baseline matching exactly the collections the caller saw.
      // Splicing old active tasks into a newer archive could otherwise duplicate the same ID.
      const candidate = [this.snapshot!, ...Object.values(observed)].find(snapshot => keys.every(key =>
        stableJSON(snapshot[key]) === stableJSON(observed[key]![key])));
      if (!candidate) throw new Error('这些列表来自不同的数据版本，请刷新 Things 后再保存。');
      const base = clone(candidate), next = clone(base);
      for (const [file, data] of Object.entries(requested)) {
        const key = fileKey(file);
        if (!key || !Array.isArray(data)) throw new Error('无效的 Things 数据集合。');
        next[key] = data;
      }
      if (this.repository) {
        if (auditLegacy(next).errors.length) throw new Error('待保存的 Things 数据未通过校验，数据库未修改。');
        try {
          await this.withWriteLock(async () => {
            if (present(await this.host.loadData(WRITE_INTENT_FILE))) {
              this.failed = new Error('存在未完成的保存，请先重新加载 Things 恢复，不能覆盖恢复记录。');
              throw this.failed;
            }
            await this.assertCurrentSource();
            if (this.binding?.schemaVersion === 1 && present(await this.host.loadData(NOTES_UPGRADE_FILE))) {
              throw new Error('备注升级尚未完成，请先在设置中继续升级；原数据和备注文档已保留。');
            }
            await (this.options.verify || verifyDatabaseBinding)(this.client, this.binding!);
            const latest = await this.repository!.load();
            const observation = await this.observationFor(latest);
            const merged = mergeTaskChanges(base, next, latest);
            const now = this.options.now?.() ?? Date.now();
            const planned = await planTaskTransitions(merged, observation, now);
            const intent: WriteIntent = { schemaVersion: 1, binding: this.binding!, base, desired: planned.snapshot,
              observation: planned.observation, createdAt: now };
            this.snapshot = await this.commitIntent(intent);
          });
        } catch (error) {
          // commitIntent owns the failure latch once a journal may exist. Pure validation failures
          // leave the last committed snapshot usable, so canceling that draft can unblock editing.
          throw error;
        }
      } else {
        for (const [name, data] of Object.entries(requested)) await this.host.saveData(name, data);
        this.snapshot = next;
      }
    });
  }

  async preflight() {
    await this.start();
    return this.enqueue(async () => {
      if (this.repository) {
        if (this.failed) throw this.failed;
        await (this.options.verify || verifyDatabaseBinding)(this.client, this.binding!);
        return auditLegacy(await this.repository.load());
      }
      return auditLegacy(await readLegacy(this.host));
    });
  }

  /** Read-only migration preview: checks compatibility and residual caches without provisioning. */
  async inspectMigration() {
    await this.start();
    if (this.mode === 'database') return this.preflight();
    return this.enqueue(async () => {
      await this.assertNoLegacyCache();
      await this.checkVersion();
      return auditLegacy(await readLegacy(this.host));
    });
  }

  /** Upgrade existing native notes only after an explicit user action. */
  async upgradeNotes(onProgress?: (stage: string) => void): Promise<void> {
    await this.start();
    if (this.failed) throw this.failed;
    if (this.mode !== 'database' || !this.binding) throw new Error('请先将旧版文件迁移到思源数据库。');
    if (this.migrating) throw new Error('迁移已经在进行中。');
    if (this.notesInDatabase) { await this.ensureViews(); return; }
    this.migrating = true;
    const report = (stage: string) => { try { void Promise.resolve(onProgress?.(stage)).catch(() => {}); } catch { /* UI only. */ } };
    try {
      await this.enqueue(() => this.withWriteLock(async () => {
        await this.assertCurrentSource();
        this.snapshot = await this.recoverOrLoad();
        const upgraded = await (this.options.upgradeNotes || upgradeNotesToRichText)(this.host, this.client, this.binding!, { onProgress: report });
        const source = { schemaVersion: 1, mode: 'database', binding: upgraded.binding };
        report('activating');
        try { await this.host.saveData(SOURCE_FILE, source); } catch { /* A lost response may already have committed. */ }
        let confirmed = false;
        try { confirmed = stableJSON(await this.host.loadData(SOURCE_FILE)) === stableJSON(source); } catch { /* Unknown is not a rollback. */ }
        if (!confirmed) {
          this.failed = new Error('备注数据源切换结果无法确认，已暂停写入；请重新加载 Things 核对。');
          throw this.failed;
        }
        // Keep the existing recurrence observation. This is a representation change, not an import.
        this.binding = upgraded.binding;
        this.repository = this.makeRepository(upgraded.binding);
        this.snapshot = upgraded.snapshot;
        this.delivered = {};
        try { await this.syncStoredBinding(); }
        catch (error) { this.failed = error as Error; throw error; }
        report('views');
        await this.ensureViews();
        report('done');
      }));
    } finally { this.migrating = false; }
  }

  /** Explicit upgrade, after isolated compatibility tests; never part of an old user's automatic startup. */
  async migrateLegacy(onProgress?: (stage: string) => void): Promise<void> {
    const report = (stage: string) => { try { void Promise.resolve(onProgress?.(stage)).catch(() => {}); } catch { /* UI feedback cannot interrupt migration. */ } };
    await this.start();
    if (this.failed) throw this.failed;
    if (this.mode === 'database') { report('done'); return; }
    if (this.migrating) throw new Error('迁移已经在进行中。');
    this.migrating = true;
    try {
      await this.enqueue(async () => {
        report('checking');
        await this.assertNoLegacyCache();
        await this.checkVersion();
        const original = await readLegacy(this.host);
        const audit = auditLegacy(original);
        if (audit.errors.length) throw new Error(`迁移预检未通过：${audit.errors.map(e => e.message).join('；')}`);
        report('backup');
        const previous = await this.host.loadData(BACKUP_FILE);
        if (previous && stableJSON(previous.snapshot) !== stableJSON(original)) {
          throw new Error('原始数据与已保存的迁移备份不同，请先核对中断后的修改。');
        }
        if (!previous) await this.host.saveData(BACKUP_FILE, { schemaVersion: 1, snapshot: original, createdAt: Date.now() });
        const saved = await this.host.loadData(BACKUP_FILE);
        if (stableJSON(saved?.snapshot) !== stableJSON(original)) throw new Error('原始备份核对失败，未开始迁移。');
        report('creating');
        const binding = await (this.options.ensure || ensureDatabases)(this.host, this.client);
        const repo = this.makeRepository(binding);
        report('importing');
        await repo.import(original);
        report('verifying');
        const imported = await repo.load();
        if (stableJSON(imported) !== stableJSON(original)) throw new Error('数据库往返核对未通过，保留旧数据源。');
        if (stableJSON(await readLegacy(this.host)) !== stableJSON(original)) throw new Error('迁移期间旧数据发生变化，尚未切换。');
        report('activating');
        await this.activate(binding, repo, imported);
        report('done');
      });
    } finally {
      this.migrating = false;
    }
  }
}
