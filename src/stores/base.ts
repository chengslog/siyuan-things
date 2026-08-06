import type { Plugin } from 'siyuan';
import type { StoreEvent } from '@/types';
import { idbGetAll, idbClear, type IDBStoreName } from './idb';

type Listener = (event: StoreEvent) => void;

/**
 * 基础数据存储类
 * 运行时数据在内存 Map，持久化层为思源文件存储（可被思源同步）。
 * 启动时若 IDB 有最近数据（从 IDB 迁移后的残留），先合并回文件再清 IDB。
 */
export abstract class BaseStore<T extends { id: string }> {
  protected plugin: Plugin;
  protected fileName: string;
  protected items: Map<string, T> = new Map();
  protected listeners: Set<Listener> = new Set();

  constructor(plugin: Plugin, fileName: string) {
    this.plugin = plugin;
    this.fileName = fileName;
  }

  /** fileName（如 tasks.json）→ IndexedDB store 名（tasks） */
  protected get idbStore(): IDBStoreName {
    return this.fileName.replace(/\.json$/, "") as IDBStoreName;
  }

  /**
   * 加载数据：文件存储为主。
   * 启动时检查 IDB 是否有残留数据（上次 IDB 迁移后的写入），
   * 若有则合并到文件，然后清 IDB，之后统一用文件存储。
   */
  async load(): Promise<void> {
    try {
      // 1. 先从文件加载
      let data: T[] = [];
      const fileData = await this.plugin.loadData(this.fileName);
      if (fileData && Array.isArray(fileData)) {
        data = fileData as T[];
      }
      console.log(`[Things] File read ${this.fileName}: ${data.length} items`);

      // 2. 检查 IDB 是否有残留数据（从 IDB 迁移期写入的）
      try {
        const idbData = await idbGetAll<T>(this.idbStore);
        if (idbData.length > 0) {
          console.log(`[Things] IDB has ${idbData.length} residual items, merging to file...`);
          // 合并：IDB 数据覆盖文件（以 id 为 key）
          const merged = new Map<string, T>();
          for (const item of data) merged.set(item.id, item);
          for (const item of idbData) merged.set(item.id, item);
          data = Array.from(merged.values());
          // 写回文件
          await this.plugin.saveData(this.fileName, data);
          console.log(`[Things] ✓ Merged ${data.length} items to file`);
          // 清 IDB
          await idbClear(this.idbStore);
          console.log(`[Things] ✓ Cleared IDB store: ${this.idbStore}`);
        }
      } catch (e) {
        console.error(`[Things] IDB residual check failed (non-fatal):`, e);
      }

      this.items.clear();
      for (const item of data) {
        this.items.set(item.id, item);
      }
      console.log(`[Things] Loaded ${this.fileName}: ${this.items.size} items in memory`);
      if (data.length) {
        this.emit({ type: 'change', ids: [] });
      }
    } catch (e) {
      console.error(`[Things] Failed to load ${this.fileName}:`, e);
    }
  }

  /**
   * 全量落盘（批量操作后调用）
   */
  async save(): Promise<void> {
    try {
      await this.plugin.saveData(this.fileName, Array.from(this.items.values()));
    } catch (e) {
      console.error(`[Things] Failed to save ${this.fileName}:`, e);
    }
  }

  /**
   * 获取所有项目
   */
  getAll(): T[] {
    return Array.from(this.items.values());
  }

  /**
   * 根据 ID 获取
   */
  get(id: string): T | undefined {
    return this.items.get(id);
  }

  /**
   * 添加项目
   */
  async add(item: T): Promise<void> {
    this.items.set(item.id, item);
    try {
      await this.plugin.saveData(this.fileName, Array.from(this.items.values()));
    } catch (e) {
      console.error(`[Things] Failed to save ${this.fileName} after add:`, e);
    }
    this.emit({ type: 'add', ids: [item.id] });
  }

  /**
   * 更新项目
   */
  async update(item: T): Promise<void> {
    this.items.set(item.id, item);
    try {
      await this.plugin.saveData(this.fileName, Array.from(this.items.values()));
    } catch (e) {
      console.error(`[Things] Failed to save ${this.fileName} after update:`, e);
    }
    this.emit({ type: 'update', ids: [item.id] });
  }

  /**
   * 删除项目
   */
  async delete(id: string): Promise<void> {
    this.items.delete(id);
    try {
      await this.plugin.saveData(this.fileName, Array.from(this.items.values()));
    } catch (e) {
      console.error(`[Things] Failed to save ${this.fileName} after delete:`, e);
    }
    this.emit({ type: 'delete', ids: [id] });
  }

  /**
   * 批量操作
   */
  async batch(fn: () => void): Promise<void> {
    fn();
    await this.save();
    this.emit({ type: 'change', ids: [] });
  }

  /**
   * 订阅变更
   */
  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected emit(event: StoreEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('[Things] Store listener error:', e);
      }
    }
  }

  /**
   * 获取数量
   */
  get count(): number {
    return this.items.size;
  }

  /**
   * 清空
   */
  async clear(): Promise<void> {
    this.items.clear();
    try {
      await this.plugin.saveData(this.fileName, []);
    } catch (e) {
      console.error(`[Things] Failed to save ${this.fileName} after clear:`, e);
    }
    this.emit({ type: 'change', ids: [] });
  }
}
