import type { Plugin } from 'siyuan';
import type { Task, TaskStatus, RepeatRule } from '@/types';
import { BaseStore } from './base';
import { genUUID } from '@/utils/id';
import { initialRepeatStartDate, nextRepeatTimestamp } from '@/utils/recurrence';
import { removeTagId } from '@/utils/tagCleanup';

export class TaskStore extends BaseStore<Task> {
  private archiveFileName: string;
  private archivedItems: Map<string, Task> = new Map();
  private trashFileName = 'tasks-trash.json';
  private trashBatches: Array<{ id: string; deletedAt: number; tasks: Task[] }> = [];

  constructor(plugin: Plugin) {
    super(plugin, 'tasks.json');
    this.archiveFileName = 'tasks-archive.json';
  }

  /** 删除标签前批量清理当前、归档和回收记录中的任务引用。 */
  async removeTagFromAll(tagId: string): Promise<string[]> {
    const changedIds = new Set<string>();
    const now = Date.now();
    let activeChanged = false;
    let archiveChanged = false;
    let trashChanged = false;

    for (const task of this.items.values()) {
      const tags = removeTagId(task.tags, tagId);
      if (!tags) continue;
      this.items.set(task.id, { ...task, tags, updated: now });
      changedIds.add(task.id);
      activeChanged = true;
    }

    for (const task of this.archivedItems.values()) {
      const tags = removeTagId(task.tags, tagId);
      if (!tags) continue;
      this.archivedItems.set(task.id, { ...task, tags, updated: now });
      changedIds.add(task.id);
      archiveChanged = true;
    }

    for (const batch of this.trashBatches) {
      batch.tasks = batch.tasks.map((task) => {
        const tags = removeTagId(task.tags, tagId);
        if (!tags) return task;
        changedIds.add(task.id);
        trashChanged = true;
        return { ...task, tags, updated: now };
      });
    }

    await Promise.all([
      activeChanged ? this.save() : Promise.resolve(),
      archiveChanged ? this.saveArchive() : Promise.resolve(),
      trashChanged ? this.plugin.saveData(this.trashFileName, this.trashBatches) : Promise.resolve(),
    ]);
    if (changedIds.size > 0) this.emit({ type: 'update', ids: [...changedIds] });
    return [...changedIds];
  }

  /** 清空当前、归档及回收记录中的全部任务。 */
  async clear(): Promise<void> {
    this.items.clear();
    this.archivedItems.clear();
    this.trashBatches = [];
    await Promise.all([
      this.plugin.saveData(this.fileName, []),
      this.plugin.saveData(this.archiveFileName, []),
      this.plugin.saveData(this.trashFileName, []),
    ]);
    this.emit({ type: 'change', ids: [] });
  }

  /**
   * 加载数据（包括归档）
   */
  async load(): Promise<void> {
    await super.load();
    let migratedRepeatAnchors = false;
    const now = Date.now();
    for (const task of this.items.values()) {
      if (task.status === 'todo' && !task.parentId && task.repeatRule && !task.startDate && !task.deadline) {
        task.startDate = initialRepeatStartDate(task.repeatRule, undefined, undefined, now);
        task.updated = now;
        migratedRepeatAnchors = true;
      }
    }
    if (migratedRepeatAnchors) await this.save();
    await this.loadArchive();
    const trash = await this.plugin.loadData(this.trashFileName);
    this.trashBatches = Array.isArray(trash) ? trash : [];
  }

  /** Move tasks (including checklist children) to a recoverable trash file. */
  async trashTasks(ids: string[]): Promise<number> {
    const selected = new Set(ids);
    for (const task of this.items.values()) {
      if (task.parentId && selected.has(task.parentId)) selected.add(task.id);
    }
    const tasks = Array.from(selected).map((id) => this.items.get(id)).filter((task): task is Task => !!task);
    if (!tasks.length) return 0;
    this.trashBatches.push({ id: `trash-${Date.now()}`, deletedAt: Date.now(), tasks });
    for (const task of tasks) this.items.delete(task.id);
    await Promise.all([
      this.save(),
      this.plugin.saveData(this.trashFileName, this.trashBatches),
    ]);
    this.emit({ type: 'delete', ids: tasks.map((task) => task.id) });
    return tasks.filter((task) => !task.parentId).length;
  }

  /** Restore the most recently deleted AI/user batch. */
  async restoreLastTrashedBatch(): Promise<number> {
    const batch = this.trashBatches.pop();
    if (!batch) return 0;
    for (const task of batch.tasks) this.items.set(task.id, task);
    await Promise.all([
      this.save(),
      this.plugin.saveData(this.trashFileName, this.trashBatches),
    ]);
    this.emit({ type: 'change', ids: batch.tasks.map((task) => task.id) });
    return batch.tasks.filter((task) => !task.parentId).length;
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
      completedDate: partial.status === 'done' ? (partial.completedDate || now) : partial.completedDate,
      priority: partial.priority || 'none',
      created: now,
      updated: now,
      startDate: initialRepeatStartDate(partial.repeatRule, partial.startDate, partial.deadline, now),
      deadline: partial.deadline,
      someday: partial.someday,
      repeatRule: partial.repeatRule,
      recurrenceSourceId: partial.recurrenceSourceId,
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

    // 首次为无日期任务启用重复时，以今天作为第一次；已有日期保持不变。
    if (changes.repeatRule && !task.repeatRule && !updated.startDate && !updated.deadline) {
      updated.startDate = initialRepeatStartDate(changes.repeatRule, undefined, undefined, updated.updated);
    }

    // 如果标记完成，设置完成时间
    if (changes.status === 'done' && task.status !== 'done') {
      updated.completedDate = Date.now();
    }

    await this.update(updated);

    if (changes.status === 'done' && task.status !== 'done' && updated.repeatRule && !updated.recurrenceGeneratedAt && !updated.parentId) {
      const next = await this.createRecurringOccurrence(updated);
      updated.recurrenceGeneratedAt = Date.now();
      await this.update(updated);
      this.emit({ type: 'recurrence', ids: [updated.id, next.id] });
    }
    return updated;
  }

  /**
   * 批量更新任务：内存统一修改后单次落盘、单次通知。
   * 逐条 updateTask 每次都会全量落盘并触发一次列表重排（拖动排序后列表连环抖动数秒），
   * 重排、跨组移动等批量操作必须走这里。值未变化的任务自动跳过。
   */
  async updateTasksBatch(patches: Array<{ id: string; changes: Partial<Task> }>): Promise<void> {
    if (patches.length === 0) return;
    const now = Date.now();
    await this.batch(() => {
      for (const { id, changes } of patches) {
        const task = this.items.get(id);
        if (!task) continue;
        let changed = false;
        const next: Task = { ...task };
        for (const key of Object.keys(changes) as Array<keyof Task>) {
          const value = changes[key];
          if (task[key] !== value) {
            (next as Record<string, unknown>)[key] = value;
            changed = true;
          }
        }
        if (!changed) continue;
        next.updated = now;
        this.items.set(id, next);
      }
    });
  }

  private async createRecurringOccurrence(source: Task): Promise<Task> {
    const base = source.startDate || source.deadline || source.completedDate || Date.now();
    const next = await this.createTask({
      title: source.title,
      notes: source.notes,
      priority: source.priority,
      startDate: source.startDate ? nextRepeatTimestamp(source.startDate, source.repeatRule!) : (!source.deadline ? nextRepeatTimestamp(base, source.repeatRule!) : undefined),
      deadline: source.deadline ? nextRepeatTimestamp(source.deadline, source.repeatRule!) : undefined,
      someday: false,
      repeatRule: source.repeatRule,
      recurrenceSourceId: source.id,
      projectId: source.projectId,
      areaId: source.areaId,
      headingId: source.headingId,
      tags: [...(source.tags || [])],
    });
    for (const child of this.getSubTasks(source.id)) {
      await this.createTask({
        title: child.title,
        notes: child.notes,
        priority: child.priority,
        parentId: next.id,
        tags: [...(child.tags || [])],
        status: 'todo',
      });
    }
    return next;
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
   * 满足以下任一条件：
   * 1. 开始日期 <= 今天
   * 2. 截止日期 = 今天（即使没有开始日期）
   * 且非 someday
   */
  getTodayTasks(): Task[] {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayStartTs = todayStart.getTime();

    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    const todayEndTs = todayEnd.getTime();

    return this.getAll().filter(t =>
      t.status === 'todo' &&
      !t.parentId &&
      !t.someday &&
      (
        // 条件1：开始日期 <= 今天
        (t.startDate && t.startDate <= todayEndTs) ||
        // 条件2：截止日期 = 今天（即使没有开始日期）
        (t.deadline && t.deadline >= todayStartTs && t.deadline <= todayEndTs)
      )
    );
  }

  /**
   * 获取即将到来的任务
   * 开始日期 > 今天，或者截止日期 > 今天（且无开始日期）
   */
  getUpcomingTasks(): Task[] {
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const todayEndTs = todayEnd.getTime();

    return this.getAll().filter(t =>
      t.status === 'todo' &&
      !t.parentId &&
      !t.someday && (
        (t.startDate && t.startDate > todayEndTs) ||
        (t.deadline && t.deadline > todayEndTs && !t.startDate)
      )
    );
  }

  /**
   * 获取"随时"任务
   * 没有日期但有项目、区域或标签的任务（可操作但没有时间限制）
   */
  /**
   * 获取"随时"任务（对齐 Things 3 逻辑）
   * 所有现在能做的活跃任务，包括：
   * 1. 无日期任务（无 startDate 且无 deadline）
   * 2. 只有截止日期的任务（活跃状态，可立即处理）
   * 3. 日期是今天的任务（今天也能随时做）
   * 排除：某天、即将到来（未来日期）、子任务
   */
  getAnytimeTasks(): Task[] {
    const now = new Date();
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    const todayEndTs = todayEnd.getTime();

    return this.getAll().filter(t =>
      t.status === 'todo' &&
      !t.someday &&
      !t.parentId &&
      (
        // 条件1：无日期任务
        (!t.startDate && !t.deadline) ||
        // 条件2：只有截止日期（活跃状态，可立即处理）
        (t.deadline && !t.startDate) ||
        // 条件3：日期是今天（今天任务也出现在随时）
        (t.startDate && t.startDate <= todayEndTs)
      )
    );
  }

  /**
   * 获取"某天"任务
   * 标记为someday的任务
   */
  getSomedayTasks(): Task[] {
    return this.getAll().filter(t =>
      t.status === 'todo' &&
      !t.parentId &&
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
      !t.parentId &&
      (t.areaId === areaId || t.projectId) // 需要结合 project 的 areaId
    );
  }

  /**
   * 获取标签的任务
   */
  getTagTasks(tagId: string): Task[] {
    return this.getAll().filter(t =>
      t.status === 'todo' &&
      !t.parentId &&
      t.tags.includes(tagId)
    );
  }

  /**
   * 搜索任务
   */
  search(query: string): Task[] {
    const q = query.toLowerCase();
    return this.getAll().filter(t =>
      !t.parentId && (
        t.title.toLowerCase().includes(q) ||
        t.notes.toLowerCase().includes(q)
      )
    );
  }

  /**
   * 获取已完成任务（日志簿）
   */
  getCompletedTasks(): Task[] {
    return this.getAll()
      .filter(t => t.status === 'done' && !t.parentId)
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
