import type { Plugin } from 'siyuan';
import type { StoreEvent } from '@/types';

type Listener = (event: StoreEvent) => void;

/** The injected data port selects legacy files or the native database. */
export abstract class BaseStore<T extends { id: string }> {
  protected plugin: Plugin;
  protected fileName: string;
  protected items: Map<string, T> = new Map();
  protected listeners: Set<Listener> = new Set();

  constructor(plugin: Plugin, fileName: string) {
    this.plugin = plugin;
    this.fileName = fileName;
  }

  async load(): Promise<void> {
    const data = await this.plugin.loadData(this.fileName);
    this.items = this.readCollection(data, this.fileName);
    this.emit({ type: 'change', ids: [] });
  }

  protected readCollection(data: unknown, fileName: string): Map<string, T> {
    if (data == null || data === '') return new Map();
    if (!Array.isArray(data)) throw new Error('Invalid Things collection: ' + fileName);
    const items = new Map<string, T>();
    for (const item of data) {
      if (!item || typeof item.id !== 'string' || !item.id.trim() || items.has(item.id)) {
        throw new Error('Invalid or duplicate Things ID: ' + fileName);
      }
      items.set(item.id, item);
    }
    return items;
  }

  async save(): Promise<void> {
    try {
      await this.plugin.saveData(this.fileName, Array.from(this.items.values()));
      const persisted = await this.plugin.loadData(this.fileName);
      this.items = this.readCollection(persisted, this.fileName);
    } catch (error) {
      try { await this.load(); } catch { /* Preserve original failure. */ }
      throw error;
    }
  }

  getAll(): T[] { return Array.from(this.items.values()); }
  get(id: string): T | undefined { return this.items.get(id); }
  get count(): number { return this.items.size; }

  async add(item: T): Promise<void> {
    this.items.set(item.id, item);
    await this.save();
    this.emit({ type: 'add', ids: [item.id] });
  }

  async update(item: T): Promise<void> {
    this.items.set(item.id, item);
    await this.save();
    this.emit({ type: 'update', ids: [item.id] });
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
    await this.save();
    this.emit({ type: 'delete', ids: [id] });
  }

  async batch(fn: () => void): Promise<void> {
    fn();
    await this.save();
    this.emit({ type: 'change', ids: [] });
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected emit(event: StoreEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch (error) { console.error('[Things] Store listener error:', error); }
    }
  }

  async clear(): Promise<void> {
    this.items.clear();
    await this.save();
    this.emit({ type: 'change', ids: [] });
  }
}
