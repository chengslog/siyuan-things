import type { Plugin } from 'siyuan';
import type { Task, TaskStatus, ProjectStatus } from '@/types';
import { BaseStore } from './base.ts';
import { genUUID } from '../utils/id.ts';
import { initialRepeatStartDate, nextRepeatTimestamp } from '../utils/recurrence.ts';
import { removeTagId } from '../utils/tagCleanup.ts';
import { isTaskVisibleForProjectStatus } from '../utils/taskVisibility.ts';
import { saveFiles, usesNativeStorage } from '../storage/bridge.ts';

export class TaskStore extends BaseStore<Task> {
  private archiveFileName: string;
  private archivedItems: Map<string, Task> = new Map();
  private trashFileName = 'tasks-trash.json';
  private trashBatches: Array<{ id: string; deletedAt: number; tasks: Task[] }> = [];
  private getProjectStatus?: (projectId: string) => ProjectStatus | undefined;

  constructor(plugin: Plugin, getProjectStatus?: (projectId: string) => ProjectStatus | undefined) {
    super(plugin, 'tasks.json');
    this.archiveFileName = 'tasks-archive.json';
    this.getProjectStatus = getProjectStatus;
  }

  /** 暂停或作废项目中的任务不参与全局时间视图。 */
  private isVisibleInStandardView(task: Task): boolean {
    if (!task.projectId || !this.getProjectStatus) return true;
    return isTaskVisibleForProjectStatus(task, this.getProjectStatus(task.projectId));
  }

  override async delete(id: string): Promise<void> {
    if (usesNativeStorage(this.plugin)) { await this.trashTasks([id]); return; }
    await super.delete(id);
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

    // Native recovery snapshots are immutable history, not current task references.
    for (const batch of usesNativeStorage(this.plugin) ? [] : this.trashBatches) {
      batch.tasks = batch.tasks.map((task) => {
        const tags = removeTagId(task.tags, tagId);
        if (!tags) return task;
        changedIds.add(task.id);
        trashChanged = true;
        return { ...task, tags, updated: now };
      });
    }

    if (activeChanged || archiveChanged || trashChanged) await this.persistTaskCollections();
    if (changedIds.size > 0) this.emit({ type: 'update', ids: [...changedIds] });
    return [...changedIds];
  }

  /** 清空当前、归档及回收记录中的全部任务。 */
  async clear(): Promise<void> {
    this.items.clear();
    this.archivedItems.clear();
    this.trashBatches = [];
    await this.persistTaskCollections();
    this.emit({ type: 'change', ids: [] });
  }

  /**
   * 加载数据（包括归档）
   */
  async load(): Promise<void> {
    const [data, archive, trash] = await Promise.all([
      this.plugin.loadData(this.fileName),
      this.plugin.loadData(this.archiveFileName),
      this.plugin.loadData(this.trashFileName),
    ]);
    const items = this.readCollection(data, this.fileName);
    const archivedItems = this.readCollection(archive, this.archiveFileName);
    if ([...items.keys()].some(id => archivedItems.has(id))) throw new Error('当前任务和归档中存在重复 ID，未覆盖数据。');
    if (trash != null && trash !== '' && !Array.isArray(trash)) throw new Error('Invalid Things trash');
    const batches = trash || [];
    for (const batch of batches) {
      if (!batch || typeof batch.id !== 'string' || !Array.isArray(batch.tasks) ||
        batch.tasks.some((task: Task) => !task || typeof task.id !== 'string' || !task.id.trim())) {
        throw new Error('Invalid Things trash batch');
      }
    }
    // Publish all three collections only after every collection passes validation.
    this.items = items;
    this.archivedItems = archivedItems;
    this.trashBatches = batches;
    this.emit({ type: 'change', ids: [] });
  }

  /** Move tasks (including checklist children) to a recoverable trash file. */
  async trashTasks(ids: string[]): Promise<number> {
    const selected = new Set(ids);
    let added: boolean;
    do {
      added = false;
      for (const task of this.items.values()) {
        if (task.parentId && selected.has(task.parentId) && !selected.has(task.id)) {
          selected.add(task.id); added = true;
        }
      }
    } while (added);
    const tasks = Array.from(selected).map((id) => this.items.get(id)).filter((task): task is Task => !!task);
    if (!tasks.length) return 0;
    this.trashBatches.push({ id: `trash-${Date.now()}`, deletedAt: Date.now(), tasks });
    for (const task of tasks) this.items.delete(task.id);
    await this.persistTaskCollections();
    this.emit({ type: 'delete', ids: tasks.map((task) => task.id) });
    return tasks.filter((task) => !task.parentId).length;
  }

  /** Restore the most recently deleted AI/user batch. */
  async restoreLastTrashedBatch(): Promise<number> {
    const batch = this.trashBatches[this.trashBatches.length - 1];
    if (!batch) return 0;
    if (new Set(batch.tasks.map(task => task.id)).size !== batch.tasks.length ||
      batch.tasks.some(task => this.items.has(task.id) || this.archivedItems.has(task.id))) {
      throw new Error('恢复目标与现有任务 ID 冲突，未覆盖当前任务。');
    }
    this.trashBatches.pop();
    for (const task of batch.tasks) this.items.set(task.id, task);
    await this.persistTaskCollections();
    this.emit({ type: 'change', ids: batch.tasks.map((task) => task.id) });
    return batch.tasks.filter((task) => !task.parentId).length;
  }

  /**
   * 保存归档数据
   */
  private async persistTaskCollections(): Promise<void> {
    try {
      await saveFiles(this.plugin, {
        [this.fileName]: Array.from(this.items.values()),
        [this.archiveFileName]: Array.from(this.archivedItems.values()),
        [this.trashFileName]: this.trashBatches,
      });
      await this.load();
    } catch (error) {
      try { await this.load(); } catch { /* Keep the original failure. */ }
      throw error;
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
    await this.persistTaskCollections();

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
    if (this.items.has(id)) throw new Error('恢复目标与当前任务 ID 冲突，未覆盖当前任务。');

    this.archivedItems.delete(id);
    this.items.set(id, task);

    await this.persistTaskCollections();

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
    const task = this.prepareTask(partial);
    await this.add(task);
    return task;
  }

  /** Allocate identities once so a failed group can be retried without creating duplicates. */
  prepareTaskGroup(partial: Partial<Task> & { title: string }, checklist: readonly { title: string; completed: boolean }[]): Task[] {
    const parent = this.prepareTask(partial);
    const children = checklist.filter(item => item.title.trim()).map((item, index) => this.prepareTask({
      title: item.title, parentId: parent.id, status: item.completed ? 'done' : 'todo', order: parent.order + index + 1,
    }));
    return [parent, ...children];
  }

  /** One logical save for the parent and its checklist. Existing identities are never overwritten. */
  async createTaskGroup(group: readonly Task[]): Promise<Task> {
    const parent = group[0];
    if (!parent || parent.parentId || new Set(group.map(task => task.id)).size !== group.length ||
        group.slice(1).some(task => task.parentId !== parent.id)) throw new Error('无效的任务创建记录。');
    // A prior write may have succeeded despite a lost response. Read it back before retrying.
    await this.load();
    const removed = new Set([
      ...this.archivedItems.keys(), ...this.trashBatches.flatMap(batch => batch.tasks.map(task => task.id)),
    ]);
    if (group.some(task => removed.has(task.id))) throw new Error('这次添加的任务已被移走或删除，请先检查任务列表。');
    const missing = group.filter(task => !this.items.has(task.id));
    if (missing.length) {
      await this.batch(() => {
        for (const task of missing) this.items.set(task.id, { ...task, tags: [...task.tags] });
      });
    }
    return this.items.get(parent.id)!;
  }

  private prepareTask(partial: Partial<Task> & { title: string }): Task {
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
      tags: [...(partial.tags || [])],
      order: partial.order ?? this.getNextOrder(),
      blockId: partial.blockId,
    };
    return task;
  }

  /**
   * 更新任务
   */
  async updateTask(id: string, changes: Partial<Task>): Promise<Task | undefined> {
    const task = this.items.get(id);
    if (!task) return undefined;
    const native = usesNativeStorage(this.plugin);

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
    if (!native && changes.status === 'done' && task.status !== 'done') {
      updated.completedDate = Date.now();
    }

    await this.update(updated);

    // The native coordinator commits completion, recurrence and its recovery journal together.
    if (native) return this.get(id);

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
            (next as unknown as Record<string, unknown>)[key] = value;
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
      this.isVisibleInStandardView(t) &&
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
      !t.someday &&
      this.isVisibleInStandardView(t) && (
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
      this.isVisibleInStandardView(t) &&
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
      this.isVisibleInStandardView(t) &&
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
