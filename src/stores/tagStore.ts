import type { Plugin } from 'siyuan';
import type { Tag } from '@/types';
import { BaseStore } from './base';
import { genUUID } from '@/utils/id';

export class TagStore extends BaseStore<Tag> {
  constructor(plugin: Plugin, private beforeDelete?: (tagId: string) => Promise<unknown>) {
    super(plugin, 'tags.json');
  }

  /** 标签删除是引用完整性操作：先清任务引用，再删除标签本身。 */
  override async delete(id: string): Promise<void> {
    await this.beforeDelete?.(id);
    await super.delete(id);
  }

  /**
   * 创建标签
   */
  async createTag(partial: Partial<Tag> & { name: string }): Promise<Tag> {
    const tag: Tag = {
      id: genUUID(),
      name: partial.name,
      color: partial.color,
      parentId: partial.parentId,
      order: partial.order ?? this.getNextOrder(),
    };
    await this.add(tag);
    return tag;
  }

  /**
   * 更新标签
   */
  async updateTag(id: string, changes: Partial<Tag>): Promise<Tag | undefined> {
    const tag = this.items.get(id);
    if (!tag) return undefined;

    const updated: Tag = {
      ...tag,
      ...changes,
      id: tag.id,
    };

    await this.update(updated);
    return updated;
  }

  /**
   * 获取子标签
   */
  getChildTags(parentId: string): Tag[] {
    return this.getAll().filter(t => t.parentId === parentId);
  }

  /**
   * 获取顶级标签
   */
  getRootTags(): Tag[] {
    return this.getAll().filter(t => !t.parentId);
  }

  /**
   * 搜索标签
   */
  search(query: string): Tag[] {
    const q = query.toLowerCase();
    return this.getAll().filter(t => t.name.toLowerCase().includes(q));
  }

  /**
   * 根据名称查找标签
   */
  getByName(name: string): Tag | undefined {
    return this.getAll().find(t => t.name === name);
  }

  private getNextOrder(): number {
    const tags = this.getAll();
    if (tags.length === 0) return 0;
    return Math.max(...tags.map(t => t.order)) + 1;
  }
}
