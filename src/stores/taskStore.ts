import type { Plugin } from 'siyuan';
import type { Task, TaskStatus } from '@/types';
import { BaseStore } from './base';
import { genUUID } from '@/utils/id';

export class TaskStore extends BaseStore<Task> {
  private archiveFileName: string;
  private archivedItems: Map<string, Task> = new Map();

  constructor(plugin: Plugin) {
    super(plugin, 'tasks.json');
    this.archiveFileName = 'tasks-archive.json';
  }

  /**
   * 加载数据（包括归档）
   */
  async load(): Promise<void> {
    await super.load();
    await this.loadArchive();
  }

  /**
   * 加载归档数据
   */
  private async loadArchive(): Promise<void> {
    try {
      const data = await this.plugin.loadData(this.archiveFileName);
      if (data && Array.isArray(data)) {
        this.archivedItems.clear();
        for (const item of data) {
          this.archivedItems.set(item.id, item);
        }
      }
    } catch (e) {
      console.error(`[Things] Failed to load archive:`, e);
    }
  }

  /**
   * 保存归档数据
   */
  private async saveArchive(): Promise<void> {
    try {
      const data = Array.from(this.archivedItems.values());
      await this.plugin.saveData(this.archiveFileName, data);
    } catch (e) {
      console.error(`[Things] Failed to save archive:`, e);
    }
  }

  /**
   * 归档已完成的任务
   * @param daysOld 归档多少天前完成的任务
   */
  async archiveCompleted(daysOld: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    const cutoffTime = cutoffDate.getTime();

    const toArchive: Task[] = [];

    for (const task of this.items.values()) {
      if (
        task.status === 'done' &&
        task.completedDate &&
        task.completedDate < cutoffTime
      ) {
        toArchive.push(task);
      }
    }

    if (toArchive.length === 0) return 0;

    // 移动到归档
    for (const task of toArchive) {
      this.archivedItems.set(task.id, task);
      this.items.delete(task.id);
    }

    // 保存
    await this.save();
    await this.saveArchive();

    console.log(`[Things] Archived ${toArchive.length} tasks`);
    return toArchive.length;
  }

  /**
   * 获取归档任务
   */
  getArchivedTasks(): Task[] {
    return Array.from(this.archivedItems.values());
  }

  /**
   * 恢复归档任务
   */
  async restoreTask(id: string): Promise<boolean> {
    const task = this.archivedItems.get(id);
    if (!task) return false;

    this.archivedItems.delete(id);
    this.items.set(id, task);

    await this.save();
    await this.saveArchive();

    return true;
  }

  /**
   * 获取存储统计
   */
  getStorageStats(): { active: number; archived: number; totalSize: string } {
    const active = this.items.size;
    const archived = this.archivedItems.size;

    // 估算大小
    const activeData = JSON.stringify(Array.from(this.items.values()));
    const archivedData = JSON.stringify(Array.from(this.archivedItems.values()));
    const totalBytes = activeData.length + archivedData.length;

    let totalSize: string;
    if (totalBytes < 1024) {
      totalSize = `${totalBytes} B`;
    } else if (totalBytes < 1024 * 1024) {
      totalSize = `${(totalBytes / 1024).toFixed(1)} KB`;
    } else {
      totalSize = `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    return { active, archived, totalSize };
  }

  /**
   * 创建新任务
   */
  async createTask(partial: Partial<Task> & { title: string }): Promise<Task> {
    const now = Date.now();
    const task: Task = {
      id: genUUID(),
      title: partial.title,
      notes: partial.notes || '',
      status: partial.status || 'todo',
      priority: partial.priority || 'none',
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
    await this.add(task);
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
      id: task.id, // 保持 ID 不变
      created: task.created, // 保持创建时间不变
      updated: Date.now(),
    };

    // 如果标记完成，设置完成时间
    if (changes.status === 'done' && task.status !== 'done') {
      updated.completedDate = Date.now();
    }

    await this.update(updated);
    return updated;
  }

  /**
   * 切换任务完成状态
   */
  async toggleTask(id: string): Promise<Task | undefined> {
    const task = this.items.get(id);
    if (!task) return undefined;

    const newStatus: TaskStatus = task.status === 'done' ? 'todo' : 'done';
    return this.updateTask(id, { status: newStatus });
  }

  /**
   * 获取子任务（按 order 排序）
   */
  getSubTasks(parentId: string): Task[] {
    return this.getAll()
      .filter(t => t.parentId === parentId)
      .sort((a, b) => a.order - b.order);
  }

  /**
   * 获取收件箱任务
   * 没有设置日期、项目、区域的任务
   */
  getInboxTasks(): Task[] {
    return this.getAll().filter(t =>
      t.status === 'todo' &&
      !t.startDate &&
      !t.someday &&
      !t.parentId &&
      !t.projectId &&
      !t.areaId
    );
  }

  /**
   * 获取今天的任务
   * 开始日期 <= 今天，包括过期未完成的任务
   */
  getTodayTasks(): Task[] {
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const todayEndTs = todayEnd.getTime();

    return this.getAll().filter(t =>
      t.status === 'todo' &&
      t.startDate &&
      t.startDate <= todayEndTs &&
      !t.someday
    );
  }

  /**
   * 获取即将到来的任务
   * 开始日期 > 今天，或者只有截止日期的任务
   */
  getUpcomingTasks(): Task[] {
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const todayEndTs = todayEnd.getTime();

    return this.getAll().filter(t =>
      t.status === 'todo' &&
      !t.someday && (
        (t.startDate && t.startDate > todayEndTs) ||
        (t.deadline && !t.startDate)
      )
    );
  }

  /**
   * 获取"随时"任务
   * 没有日期但有项目、区域或标签的任务（可操作但没有时间限制）
   */
  getAnytimeTasks(): Task[] {
    return this.getAll().filter(t =>
      t.status === 'todo' &&
      !t.startDate &&
      !t.someday &&
      !t.parentId &&
      (t.projectId || t.areaId || (t.tags && t.tags.length > 0))
    );
  }

  /**
   * 获取"某天"任务
   * 标记为someday的任务
   */
  getSomedayTasks(): Task[] {
    return this.getAll().filter(t =>
      t.status === 'todo' &&
      t.someday === true
    );
  }

  /**
   * 获取项目的任务
   */
  getProjectTasks(projectId: string): Task[] {
    return this.getAll().filter(t =>
      t.projectId === projectId &&
      !t.parentId
    );
  }

  /**
   * 获取区域的任务（包括区域内项目的任务）
   */
  getAreaTasks(areaId: string): Task[] {
    return this.getAll().filter(t =>
      t.status === 'todo' &&
      (t.areaId === areaId || t.projectId) // 需要结合 project 的 areaId
    );
  }

  /**
   * 获取标签的任务
   */
  getTagTasks(tagId: string): Task[] {
    return this.getAll().filter(t =>
      t.status === 'todo' &&
      t.tags.includes(tagId)
    );
  }

  /**
   * 搜索任务
   */
  search(query: string): Task[] {
    const q = query.toLowerCase();
    return this.getAll().filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.notes.toLowerCase().includes(q)
    );
  }

  /**
   * 获取已完成任务（日志簿）
   */
  getCompletedTasks(): Task[] {
    return this.getAll()
      .filter(t => t.status === 'done')
      .sort((a, b) => (b.completedDate || 0) - (a.completedDate || 0));
  }

  /**
   * 获取已取消任务
   */
  getCanceledTasks(): Task[] {
    return this.getAll().filter(t => t.status === 'canceled');
  }

  /**
   * 获取下一个排序值
   */
  private getNextOrder(): number {
    const tasks = this.getAll();
    if (tasks.length === 0) return 0;
    return Math.max(...tasks.map(t => t.order)) + 1;
  }

  /**
   * 按标签筛选
   */
  filterByTags(tasks: Task[], tagIds: string[]): Task[] {
    if (tagIds.length === 0) return tasks;
    return tasks.filter(t => tagIds.some(tagId => t.tags.includes(tagId)));
  }

  /**
   * 按优先级筛选
   */
  filterByPriority(tasks: Task[], priorities: string[]): Task[] {
    if (priorities.length === 0) return tasks;
    return tasks.filter(t => priorities.includes(t.priority));
  }
}
