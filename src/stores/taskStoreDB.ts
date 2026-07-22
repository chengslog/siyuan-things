import type { Plugin } from "siyuan";
import { fetchSyncPost } from "siyuan";
import type { Task, TaskStatus, Priority } from "@/types";
import { genUUID } from "@/utils/id";

/**
 * 使用思源块属性存储任务
 * 每个任务对应一个隐藏的文档块，任务数据存储在块属性中
 */
export class TaskStoreDB {
  private plugin: Plugin;
  private items: Map<string, Task> = new Map();
  private listeners: Set<(event: any) => void> = new Set();
  private notebookId: string = "";
  private rootPath: string = "/things-tasks";

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  /**
   * 初始化
   */
  async init(): Promise<void> {
    // 获取默认笔记本
    const notebooks: any = await fetchSyncPost("/api/notebook/lsNotebooks", {});
    if (notebooks.data?.notebooks?.length > 0) {
      this.notebookId = notebooks.data.notebooks[0].id;
    }

    // 创建存储文档（如果不存在）
    await this.ensureStorageDoc();

    // 加载数据
    await this.load();
  }

  /**
   * 确保存储文档存在
   */
  private async ensureStorageDoc(): Promise<void> {
    try {
      const result: any = await fetchSyncPost("/api/filetree/getIDsByHPath", {
        notebook: this.notebookId,
        path: this.rootPath,
      });

      if (!result.data || result.data.length === 0) {
        // 创建文档
        await fetchSyncPost("/api/filetree/createDocWithMd", {
          notebook: this.notebookId,
          path: this.rootPath,
          markdown: "# Things 任务存储\n\n此文档用于存储 Things 插件的任务数据，请勿删除。",
        });
      }
    } catch (e) {
      console.error("[Things] Failed to ensure storage doc:", e);
    }
  }

  /**
   * 从数据库加载
   */
  async load(): Promise<void> {
    try {
      // 使用 SQL 查询所有任务块
      const result: any = await fetchSyncPost("/api/query/sql", {
        stmt: `SELECT * FROM blocks WHERE type = 's' AND root IN (
          SELECT id FROM blocks WHERE path = '${this.rootPath}' AND notebook = '${this.notebookId}'
        ) ORDER BY created ASC`,
      });

      if (result.data) {
        this.items.clear();
        for (const block of result.data) {
          const task = this.parseBlockToTask(block);
          if (task) {
            this.items.set(task.id, task);
          }
        }
        console.log("[Things] Loaded", this.items.size, "tasks from DB");
      }
    } catch (e) {
      console.error("[Things] Failed to load tasks:", e);
    }
  }

  /**
   * 解析块为任务
   */
  private parseBlockToTask(block: any): Task | null {
    try {
      const attrs = block.custom || "{}";
      const taskData = JSON.parse(attrs);
      return {
        id: taskData.id || block.id,
        title: block.content || taskData.title || "",
        notes: taskData.notes || "",
        status: taskData.status || "todo",
        priority: taskData.priority || "none",
        created: block.created ? new Date(block.created).getTime() : Date.now(),
        updated: block.updated ? new Date(block.updated).getTime() : Date.now(),
        startDate: taskData.startDate,
        deadline: taskData.deadline,
        completedDate: taskData.completedDate,
        projectId: taskData.projectId,
        areaId: taskData.areaId,
        parentId: taskData.parentId,
        tags: taskData.tags || [],
        order: taskData.order || 0,
        blockId: block.id,
      };
    } catch {
      return null;
    }
  }

  /**
   * 获取所有任务
   */
  getAll(): Task[] {
    return Array.from(this.items.values());
  }

  /**
   * 根据ID获取
   */
  get(id: string): Task | undefined {
    return this.items.get(id);
  }

  /**
   * 创建任务
   */
  async createTask(partial: Partial<Task> & { title: string }): Promise<Task> {
    const now = Date.now();
    const task: Task = {
      id: genUUID(),
      title: partial.title,
      notes: partial.notes || "",
      status: partial.status || "todo",
      priority: partial.priority || "none",
      created: now,
      updated: now,
      startDate: partial.startDate,
      deadline: partial.deadline,
      projectId: partial.projectId,
      areaId: partial.areaId,
      parentId: partial.parentId,
      headingId: partial.headingId,
      tags: partial.tags || [],
      order: partial.order ?? this.getNextOrder(),
      blockId: partial.blockId,
    };

    // 创建块
    const taskJson = JSON.stringify({
      id: task.id,
      notes: task.notes,
      status: task.status,
      priority: task.priority,
      startDate: task.startDate,
      deadline: task.deadline,
      completedDate: task.completedDate,
      projectId: task.projectId,
      areaId: task.areaId,
      parentId: task.parentId,
      tags: task.tags,
      order: task.order,
    });

    try {
      // 获取存储文档ID
      const docIds: any = await fetchSyncPost("/api/filetree/getIDsByHPath", {
        notebook: this.notebookId,
        path: this.rootPath,
      });

      const docId = docIds.data?.[0];
      if (docId) {
        const result: any = await fetchSyncPost("/api/block/appendBlock", {
          dataType: "markdown",
          data: `- ${task.title}`,
          parentID: docId,
        });

        if (result.data?.[0]?.doOperations?.[0]?.id) {
          const blockId = result.data[0].doOperations[0].id;
          task.blockId = blockId;

          // 设置自定义属性
          await fetchSyncPost("/api/attr/setBlockAttrs", {
            id: blockId,
            attrs: {
              "custom": taskJson,
              "custom-type": "things-task",
            },
          });
        }
      }
    } catch (e) {
      console.error("[Things] Failed to create task block:", e);
    }

    this.items.set(task.id, task);
    this.emit({ type: "add", ids: [task.id] });

    return task;
  }

  /**
   * 更新任务
   */
  async updateTask(id: string, changes: Partial<Task>): Promise<Task | undefined> {
    const task = this.items.get(id);
    if (!task) return undefined;

    const updated = {
      ...task,
      ...changes,
      id: task.id,
      created: task.created,
      updated: Date.now(),
    };

    if (changes.status === "done" && task.status !== "done") {
      updated.completedDate = Date.now();
    }

    // 更新块
    if (task.blockId) {
      try {
        // 更新标题
        if (changes.title) {
          await fetchSyncPost("/api/block/updateBlock", {
            id: task.blockId,
            dataType: "markdown",
            data: `- ${updated.title}`,
          });
        }

        // 更新属性
        const taskJson = JSON.stringify({
          id: updated.id,
          notes: updated.notes,
          status: updated.status,
          priority: updated.priority,
          startDate: updated.startDate,
          deadline: updated.deadline,
          completedDate: updated.completedDate,
          projectId: updated.projectId,
          areaId: updated.areaId,
          parentId: updated.parentId,
          tags: updated.tags,
          order: updated.order,
        });

        await fetchSyncPost("/api/attr/setBlockAttrs", {
          id: task.blockId,
          attrs: {
            "custom": taskJson,
          },
        });
      } catch (e) {
        console.error("[Things] Failed to update task block:", e);
      }
    }

    this.items.set(id, updated);
    this.emit({ type: "update", ids: [id] });

    return updated;
  }

  /**
   * 切换任务状态
   */
  async toggleTask(id: string): Promise<Task | undefined> {
    const task = this.items.get(id);
    if (!task) return undefined;

    const newStatus: TaskStatus = task.status === "done" ? "todo" : "done";
    return this.updateTask(id, { status: newStatus });
  }

  /**
   * 删除任务
   */
  async delete(id: string): Promise<void> {
    const task = this.items.get(id);
    if (!task) return;

    if (task.blockId) {
      try {
        await fetchSyncPost("/api/block/deleteBlock", {
          id: task.blockId,
        });
      } catch (e) {
        console.error("[Things] Failed to delete task block:", e);
      }
    }

    this.items.delete(id);
    this.emit({ type: "delete", ids: [id] });
  }

  /**
   * 获取子任务
   */
  getSubTasks(parentId: string): Task[] {
    return this.getAll().filter((t) => t.parentId === parentId);
  }

  /**
   * 获取收件箱任务
   */
  getInboxTasks(): Task[] {
    return this.getAll().filter(
      (t) => t.status === "todo" && !t.projectId && !t.areaId && !t.parentId
    );
  }

  /**
   * 获取今天的任务
   */
  getTodayTasks(): Task[] {
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const todayEndTs = todayEnd.getTime();

    return this.getAll().filter(
      (t) => t.status === "todo" && t.startDate && t.startDate <= todayEndTs
    );
  }

  /**
   * 获取即将到来的任务
   */
  getUpcomingTasks(): Task[] {
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const todayEndTs = todayEnd.getTime();

    return this.getAll().filter(
      (t) => t.status === "todo" && t.startDate && t.startDate > todayEndTs
    );
  }

  /**
   * 获取随时任务
   */
  getAnytimeTasks(): Task[] {
    return this.getAll().filter(
      (t) => t.status === "todo" && !t.startDate && !t.parentId && (t.projectId || t.areaId)
    );
  }

  /**
   * 获取某天任务
   */
  getSomedayTasks(): Task[] {
    return this.getAll().filter(
      (t) => t.status === "todo" && !t.startDate && !t.projectId && !t.areaId && !t.parentId
    );
  }

  /**
   * 获取项目任务
   */
  getProjectTasks(projectId: string): Task[] {
    return this.getAll().filter((t) => t.projectId === projectId && !t.parentId);
  }

  /**
   * 获取标签任务
   */
  getTagTasks(tagId: string): Task[] {
    return this.getAll().filter((t) => t.status === "todo" && t.tags.includes(tagId));
  }

  /**
   * 搜索任务
   */
  search(query: string): Task[] {
    const q = query.toLowerCase();
    return this.getAll().filter(
      (t) => t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q)
    );
  }

  /**
   * 监听变化
   */
  on(listener: (event: any) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected emit(event: any): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error("[Things] Store listener error:", e);
      }
    }
  }

  get count(): number {
    return this.items.size;
  }

  private getNextOrder(): number {
    const tasks = this.getAll();
    if (tasks.length === 0) return 0;
    return Math.max(...tasks.map((t) => t.order)) + 1;
  }
}
