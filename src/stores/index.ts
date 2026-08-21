import type { Plugin } from "siyuan";
import { TaskStore } from "./taskStore";
import { ProjectStore } from "./projectStore";
import { AreaStore } from "./areaStore";
import { TagStore } from "./tagStore";

export class StoreManager {
  readonly tasks: TaskStore;
  readonly projects: ProjectStore;
  readonly areas: AreaStore;
  readonly tags: TagStore;

  private useDB: boolean;

  constructor(plugin: Plugin) {
    // 使用文件存储
    this.tasks = new TaskStore(plugin);
    this.projects = new ProjectStore(plugin);
    this.areas = new AreaStore(plugin);
    this.tags = new TagStore(plugin);
  }

  /**
   * 加载所有数据
   */
  async loadAll(): Promise<void> {
    await Promise.all([
      this.tasks.load(),
      this.projects.load(),
      this.areas.load(),
      this.tags.load(),
    ]);
  }

  /** 清空所有 Things 业务数据，并移除旧 IndexedDB 中可能残留的副本。 */
  async clearAll(): Promise<void> {
    await Promise.all([
      this.tasks.clear(),
      this.projects.clear(),
      this.areas.clear(),
      this.tags.clear(),
    ]);
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
