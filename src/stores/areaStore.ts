import type { Plugin } from 'siyuan';
import type { Area } from '@/types';
import { BaseStore } from './base';
import { genUUID } from '@/utils/id';

export class AreaStore extends BaseStore<Area> {
  constructor(plugin: Plugin) {
    super(plugin, 'areas.json');
  }

  /**
   * 创建区域
   */
  async createArea(partial: Partial<Area> & { name: string }): Promise<Area> {
    const now = Date.now();
    const area: Area = {
      id: genUUID(),
      name: partial.name,
      notes: partial.notes || '',
      order: partial.order ?? this.getNextOrder(),
      created: now,
      updated: now,
      collapsedGroups: partial.collapsedGroups,
    };
    await this.add(area);
    return area;
  }

  /**
   * 更新区域
   */
  async updateArea(id: string, changes: Partial<Area>): Promise<Area | undefined> {
    const area = this.items.get(id);
    if (!area) return undefined;

    const updated: Area = {
      ...area,
      ...changes,
      id: area.id,
      created: area.created,
      updated: Date.now(),
    };

    await this.update(updated);
    return updated;
  }

  /**
   * 搜索区域
   */
  search(query: string): Area[] {
    const q = query.toLowerCase();
    return this.getAll().filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.notes.toLowerCase().includes(q)
    );
  }

  private getNextOrder(): number {
    const areas = this.getAll();
    if (areas.length === 0) return 0;
    return Math.max(...areas.map(a => a.order)) + 1;
  }
}
