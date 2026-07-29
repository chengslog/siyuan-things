<script lang="ts">
  /**
   * 标签总览：全部标签（含嵌套层级、任务数），点击进标签视图。
   */
  import type { StoreManager } from "@/stores";
  import type { Tag } from "@/types";
  import { Icon } from "@/icons";

  export let store: StoreManager;
  // 外部刷新计数（tags/tasks 变更时自增）
  export let version: number = 0;

  $: tags = readTags(store, version);
  $: rows = buildRows(tags);

  function readTags(s: StoreManager, _v: number): Tag[] {
    return s.tags.getAll();
  }

  // DFS 树序（父在前、子缩进），同级按 order
  function buildRows(tags: Tag[]): { tag: Tag; depth: number }[] {
    const byParent = new Map<string, Tag[]>();
    for (const t of tags) {
      const key = t.parentId || "";
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(t);
    }
    const out: { tag: Tag; depth: number }[] = [];
    const walk = (pid: string, depth: number) => {
      const list = (byParent.get(pid) || []).slice().sort((a, b) => a.order - b.order);
      for (const t of list) {
        out.push({ tag: t, depth });
        walk(t.id, depth + 1);
      }
    };
    walk("", 0);
    return out;
  }

  function countOf(tagId: string): number {
    return store.tasks.getAll().filter((t) => t.tags.includes(tagId)).length;
  }

  function open(tag: Tag) {
    window.dispatchEvent(new CustomEvent("things-navigate", { detail: { view: "tag", viewId: tag.id } }));
  }
</script>

<div class="tags-ov">
  {#each rows as { tag, depth } (tag.id)}
    <button class="tags-ov__row" style="padding-left: {12 + depth * 20}px" on:click={() => open(tag)}>
      {#if tag.color}
        <span class="tags-ov__dot" style="background: {tag.color}"></span>
      {:else}
        <Icon name="iconThingsTag" size={14} />
      {/if}
      <span class="tags-ov__name">{tag.name}</span>
      <span class="tags-ov__count">{countOf(tag.id)} 任务</span>
    </button>
  {:else}
    <div class="tags-ov__empty">还没有标签——在任务的标签选择器里即席创建</div>
  {/each}
</div>

<style lang="scss">
  .tags-ov {
    padding-top: 8px;

    &__row {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 9px 12px;
      border: none;
      border-radius: 8px;
      background: transparent;
      cursor: pointer;
      text-align: left;

      &:hover {
        background: var(--b3-theme-surface-light);
      }
    }

    &__dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    &__name {
      flex: 1;
      font-size: 14px;
      color: var(--b3-theme-on-surface);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &__count {
      font-size: 12px;
      color: var(--b3-theme-on-surface-light);
      white-space: nowrap;
    }

    &__empty {
      padding: 48px 0;
      text-align: center;
      font-size: 13px;
      color: var(--b3-theme-on-surface-light);
    }
  }
</style>
