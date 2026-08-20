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
}

export { TaskStore } from "./taskStore";
export { ProjectStore } from "./projectStore";
export { AreaStore } from "./areaStore";
export { TagStore } from "./tagStore";
