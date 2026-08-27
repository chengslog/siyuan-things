import type { Plugin } from 'siyuan';
import type { Project, ProjectHeading, ProjectStatus } from '@/types';
import { BaseStore } from './base';
import { genUUID } from '@/utils/id';
import { normalizeProjectGroupOrder } from '@/utils/projectGrouping';

export class ProjectStore extends BaseStore<Project> {
  constructor(plugin: Plugin) {
    super(plugin, 'projects.json');
  }

  /**
   * 创建项目
   */
  async createProject(partial: Partial<Project> & { name: string }): Promise<Project> {
    const now = Date.now();
    const project: Project = {
      id: genUUID(),
      name: partial.name,
      notes: partial.notes || '',
      areaId: partial.areaId,
      status: partial.status || 'active',
      deadline: partial.deadline,
      created: now,
      updated: now,
      order: partial.order ?? this.getNextOrder(),
      headings: partial.headings || [],
      groupOrder: partial.groupOrder,
      collapsedGroups: partial.collapsedGroups,
    };
    await this.add(project);
    return project;
  }

  /**
   * 更新项目
   */
  async updateProject(id: string, changes: Partial<Project>): Promise<Project | undefined> {
    const project = this.items.get(id);
    if (!project) return undefined;

    const updated: Project = {
      ...project,
      ...changes,
      id: project.id,
      created: project.created,
      updated: Date.now(),
    };

    await this.update(updated);
    return updated;
  }

  /**
   * 完成项目
   */
  async completeProject(id: string): Promise<Project | undefined> {
    return this.updateProject(id, { status: 'completed' });
  }

  /**
   * 添加标题分组
   */
  async addHeading(projectId: string, title: string): Promise<ProjectHeading | undefined> {
    const project = this.items.get(projectId);
    if (!project) return undefined;

    const heading: ProjectHeading = {
      id: genUUID(),
      title,
      order: 0,
    };

    const previousOrder = this.getGroupOrder(project);
    project.headings.unshift(heading);
    project.headings.forEach((item, index) => { item.order = index; });
    // 新建分组固定插入最上方；"none"（进行中）仍保留原来的相对位置。
    project.groupOrder = [heading.id, ...previousOrder];
    project.updated = Date.now();
    await this.update(project);
    return heading;
  }

  /**
   * 更新标题分组
   */
  async updateHeading(projectId: string, headingId: string, title: string): Promise<void> {
    const project = this.items.get(projectId);
    if (!project) return;

    const heading = project.headings.find(h => h.id === headingId);
    if (heading) {
      heading.title = title;
      project.updated = Date.now();
      await this.update(project);
    }
  }

  /**
   * 删除标题分组
   */
  async deleteHeading(projectId: string, headingId: string): Promise<void> {
    const project = this.items.get(projectId);
    if (!project) return;

    project.headings = project.headings.filter(h => h.id !== headingId);
    project.groupOrder = this.getGroupOrder(project).filter(id => id !== headingId);
    project.updated = Date.now();
    await this.update(project);
  }

  /**
   * 设置标题分组折叠状态
   */
  async setHeadingCollapsed(projectId: string, headingId: string, collapsed: boolean): Promise<void> {
    const project = this.items.get(projectId);
    if (!project) return;

    const heading = project.headings.find(h => h.id === headingId);
    if (heading && heading.collapsed !== collapsed) {
      heading.collapsed = collapsed;
      project.updated = Date.now();
      await this.update(project);
    }
  }

  /**
   * 重排项目详情分组；groupIds 包含真实标题 id 与特殊的 "none"（进行中）。
   */
  async reorderHeadings(projectId: string, groupIds: string[]): Promise<void> {
    const project = this.items.get(projectId);
    if (!project) return;

    const byId = new Map(project.headings.map(h => [h.id, h]));
    const validIds = new Set([...byId.keys(), 'none']);
    const normalized = groupIds.filter((id, index) => validIds.has(id) && groupIds.indexOf(id) === index);
    for (const id of this.getGroupOrder(project)) {
      if (validIds.has(id) && !normalized.includes(id)) normalized.push(id);
    }
    if (!normalized.includes('none')) normalized.push('none');

    const next: ProjectHeading[] = [];
    for (const id of normalized) {
      const heading = byId.get(id);
      if (heading) {
        next.push(heading);
        byId.delete(id);
      }
    }
    // 容错：未出现在新序列中的分组保留在尾部，避免丢数据
    project.headings = [...next, ...byId.values()];
    project.headings.forEach((h, i) => { h.order = i; });
    project.groupOrder = normalized;
    project.updated = Date.now();
    await this.update(project);
  }

  /** 兼容旧项目数据，生成包含“进行中”的完整分组顺序。 */
  private getGroupOrder(project: Project): string[] {
    return normalizeProjectGroupOrder(project.headings, project.groupOrder);
  }

  /**
   * 获取区域下的项目
   */
  getAreaProjects(areaId: string): Project[] {
    return this.getAll().filter(p => p.areaId === areaId);
  }

  /**
   * 获取活跃项目
   */
  getActiveProjects(): Project[] {
    return this.getAll().filter(p => p.status === 'active');
  }

  /**
   * 获取已完成项目
   */
  getCompletedProjects(): Project[] {
    return this.getAll().filter(p => p.status === 'completed');
  }

  /**
   * 搜索项目
   */
  search(query: string): Project[] {
    const q = query.toLowerCase();
    return this.getAll().filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.notes.toLowerCase().includes(q)
    );
  }

  private getNextOrder(): number {
    const projects = this.getAll();
    if (projects.length === 0) return 0;
    return Math.max(...projects.map(p => p.order)) + 1;
  }
}
