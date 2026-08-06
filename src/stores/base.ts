import type { Plugin } from 'siyuan';
import type { StoreEvent } from '@/types';
import { idbGetAll, idbPut, idbPutBatch, idbDelete, idbClear, type IDBStoreName } from './idb';

type Listener = (event: StoreEvent) => void;

/**
 * 基础数据存储类
 * 运行时数据在内存 Map，持久化层为 IndexedDB（替代旧的 JSON 文件存储）。
 * 首次加载若 IndexedDB 为空而旧文件有数据，自动迁移入库（旧文件保留作备份）。
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
   * 加载数据：IndexedDB 优先；库里没有时回退旧文件并迁移入库
   */
  async load(): Promise<void> {
    try {
      let data: T[] = [];
      try {
        data = await idbGetAll<T>(this.idbStore);
      } catch (e) {
        console.error(`[Things] IDB read failed, fallback to file: ${this.fileName}`, e);
      }

      if (!data.length) {
        // 迁移旧文件数据（plugin.loadData 读 data/plugins/<name>/<fileName>）
        const fileData = await this.plugin.loadData(this.fileName);
        if (fileData && Array.isArray(fileData) && fileData.length) {
          data = fileData as T[];
          try {
            await idbPutBatch(this.idbStore, data);
            console.log(`[Things] Migrated ${data.length} ${this.fileName} items from file to IndexedDB`);
          } catch (e) {
            console.error(`[Things] Migration to IDB failed for ${this.fileName}:`, e);
          }
        }
      }

      this.items.clear();
      for (const item of data) {
        this.items.set(item.id, item);
      }
      if (data.length) {
        // 触发变化事件，通知组件数据已加载
        this.emit({ type: 'change', ids: [] });
      }
    } catch (e) {
      console.error(`[Things] Failed to load ${this.fileName}:`, e);
    }
  }

  /**
   * 全量落库（批量操作后调用）
   */
  async save(): Promise<void> {
    try {
      await idbPutBatch(this.idbStore, Array.from(this.items.values()));
    } catch (e) {
      console.error(`[Things] Failed to save ${this.fileName} to IDB:`, e);
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
      await idbPut(this.idbStore, item);
    } catch (e) {
      console.error(`[Things] IDB put failed (${this.fileName}/${item.id}):`, e);
    }
    this.emit({ type: 'add', ids: [item.id] });
  }

  /**
   * 更新项目
   */
  async update(item: T): Promise<void> {
    this.items.set(item.id, item);
    try {
      await idbPut(this.idbStore, item);
    } catch (e) {
      console.error(`[Things] IDB put failed (${this.fileName}/${item.id}):`, e);
    }
    this.emit({ type: 'update', ids: [item.id] });
  }

  /**
   * 删除项目
   */
  async delete(id: string): Promise<void> {
    this.items.delete(id);
    try {
      await idbDelete(this.idbStore, id);
    } catch (e) {
      console.error(`[Things] IDB delete failed (${this.fileName}/${id}):`, e);
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
      await idbClear(this.idbStore);
    } catch (e) {
      console.error(`[Things] IDB clear failed (${this.fileName}):`, e);
    }
    this.emit({ type: 'change', ids: [] });
  }
}
