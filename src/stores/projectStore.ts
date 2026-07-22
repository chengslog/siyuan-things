import type { Plugin } from 'siyuan';
import type { Project, ProjectHeading, ProjectStatus } from '@/types';
import { BaseStore } from './base';
import { genUUID } from '@/utils/id';

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
      order: project.headings.length,
    };

    project.headings.push(heading);
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
    project.updated = Date.now();
    await this.update(project);
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
