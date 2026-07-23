import type { Plugin } from 'siyuan';
import type { StoreEvent, StoreEventType } from '@/types';

type Listener = (event: StoreEvent) => void;

/**
 * 基础数据存储类
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

  /**
   * 从磁盘加载数据
   */
  async load(): Promise<void> {
    try {
      const data = await this.plugin.loadData(this.fileName);
      if (data && Array.isArray(data)) {
        this.items.clear();
        for (const item of data) {
          this.items.set(item.id, item);
        }
        // 触发变化事件，通知组件数据已加载
        this.emit('change', []);
      }
    } catch (e) {
      console.error(`[Things] Failed to load ${this.fileName}:`, e);
    }
  }

  /**
   * 保存数据到磁盘
   */
  async save(): Promise<void> {
    try {
      const data = Array.from(this.items.values());
      console.log(`[Things] Saving ${this.fileName}:`, data.length, 'items');
      await this.plugin.saveData(this.fileName, data);
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
    await this.save();
    this.emit({ type: 'add', ids: [item.id] });
  }

  /**
   * 更新项目
   */
  async update(item: T): Promise<void> {
    this.items.set(item.id, item);
    await this.save();
    this.emit({ type: 'update', ids: [item.id] });
  }

  /**
   * 删除项目
   */
  async delete(id: string): Promise<void> {
    this.items.delete(id);
    await this.save();
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
    await this.save();
    this.emit({ type: 'change', ids: [] });
  }
}
