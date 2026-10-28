import type { Plugin } from "siyuan";
import { fetchSyncPost } from "siyuan";
import { StorageCoordinator } from '../storage/coordinator.ts';
import { SiYuanAVClient } from '../storage/avClient.ts';
import { inspectLegacyIDB } from './idb';
import { saveFiles } from '../storage/bridge.ts';
import { TaskStore } from "./taskStore";
import { ProjectStore } from "./projectStore";
import { AreaStore } from "./areaStore";
import { TagStore } from "./tagStore";

export class StoreManager {
  readonly tasks: TaskStore;
  readonly projects: ProjectStore;
  readonly areas: AreaStore;
  readonly tags: TagStore;

  readonly storage: StorageCoordinator;
  private dataPlugin: Plugin;
  private loading?: Promise<void>;

  constructor(plugin: Plugin) {
    const client = new SiYuanAVClient(async (path, body) => {
      const response = await fetchSyncPost(path, body);
      if (!response || response.code !== 0) throw new Error(`思源数据库请求失败：${response?.msg || path}`);
      return response.data;
    });
    this.storage = new StorageCoordinator(plugin, client, { inspectLegacyCache: inspectLegacyIDB });
    this.dataPlugin = this.storage.facade as Plugin;
    this.projects = new ProjectStore(this.dataPlugin);
    this.tasks = new TaskStore(this.dataPlugin, (projectId) => this.projects.get(projectId)?.status);
    this.areas = new AreaStore(this.dataPlugin);
    this.tags = new TagStore(this.dataPlugin, (tagId) => this.tasks.removeTagFromAll(tagId));
  }

  /**
   * 加载所有数据
   */
  async loadAll(): Promise<void> {
    if (!this.loading) this.loading = (async () => {
      await this.storage.refresh();
      await this.projects.load();
      await this.areas.load();
      await this.tags.load();
      await this.tasks.load();
    })().finally(() => { this.loading = undefined; });
    return this.loading;
  }

  /** 清空所有 Things 业务数据，并移除旧 IndexedDB 中可能残留的副本。 */
  async clearAll(): Promise<void> {
    await saveFiles(this.dataPlugin, {
      'tasks.json': [], 'tasks-archive.json': [], 'tasks-trash.json': [],
      'projects.json': [], 'areas.json': [], 'tags.json': [],
    });
    await this.loadAll();
    // IndexedDB 仅是旧版迁移残留；不可用时不应让主文件清空被误报为失败。
    try {
      const { IDB_STORES, idbClear } = await import('./idb');
      await Promise.all(IDB_STORES.map((name) => idbClear(name)));
    } catch (error) {
      console.warn('[Things] Failed to clear legacy IndexedDB data:', error);
    }
  }
}

export { TaskStore } from "./taskStore";
export { ProjectStore } from "./projectStore";
export { AreaStore } from "./areaStore";
export { TagStore } from "./tagStore";
