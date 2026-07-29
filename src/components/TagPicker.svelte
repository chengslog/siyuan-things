<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { StoreManager } from "@/stores";
  import { nextTagColor } from "@/utils/colors";

  export let store: StoreManager;
  export let selectedTags: string[] = [];

  const dispatch = createEventDispatcher();

  let tagSearchQuery = "";

  // 标签列表：DFS 树序（父在前、子缩进），同级按 order
  $: allTags = store.tags.getAll();
  $: orderedTags = buildTagOrder(allTags);
  $: q = tagSearchQuery.trim().toLowerCase();
  $: filteredTags = q
    ? orderedTags.filter(({ tag }) => tag.name.toLowerCase().includes(q))
    : orderedTags;
  // 搜索词与现有标签都不精确同名 → 允许即席创建
  $: canCreate = q.length > 0 && !allTags.some((t) => t.name.toLowerCase() === q);

  function buildTagOrder(tags: typeof allTags): { tag: (typeof allTags)[number]; depth: number }[] {
    const byParent = new Map<string, typeof allTags>();
    for (const t of tags) {
      const key = t.parentId || "";
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(t);
    }
    const out: { tag: (typeof allTags)[number]; depth: number }[] = [];
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

  function toggleTag(tagId: string) {
    const index = selectedTags.indexOf(tagId);
    if (index >= 0) {
      selectedTags = selectedTags.filter(id => id !== tagId);
    } else {
      selectedTags = [...selectedTags, tagId];
    }
    dispatch("change", { tags: selectedTags });
  }

  // 即席创建标签并自动选中（颜色按调色板循环）
  async function createTag() {
    const name = tagSearchQuery.trim();
    if (!name) return;
    const tag = await store.tags.createTag({ name, color: nextTagColor(store.tags.count) });
    tagSearchQuery = "";
    if (!selectedTags.includes(tag.id)) {
      selectedTags = [...selectedTags, tag.id];
      dispatch("change", { tags: selectedTags });
    }
  }
</script>

<div class="tag-picker" on:click|stopPropagation>
  <div class="tag-picker__search">
    <input
      type="text"
      class="tag-picker__search-input"
      placeholder="搜索或创建标签…"
      bind:value={tagSearchQuery}
      on:keydown={(e) => { if (e.key === "Enter" && canCreate) createTag(); }}
    />
  </div>
  <div class="tag-picker__list">
    {#if canCreate}
      <button class="tag-picker__item tag-picker__create" on:click={createTag}>
        <span class="tag-picker__check">＋</span>
        <span>创建标签「{tagSearchQuery.trim()}」</span>
      </button>
    {/if}
    {#each filteredTags as { tag, depth } (tag.id)}
      <button
        class="tag-picker__item"
        class:is-selected={selectedTags.includes(tag.id)}
        style="padding-left: {8 + depth * 16}px"
        on:click={() => toggleTag(tag.id)}
      >
        <span class="tag-picker__check">
          {#if selectedTags.includes(tag.id)}✓{/if}
        </span>
        {#if tag.color}
          <span class="tag-picker__dot" style="background: {tag.color}"></span>
        {/if}
        <span>{tag.name}</span>
      </button>
    {:else}
      {#if !canCreate}
        <div class="tag-picker__empty">暂无标签</div>
      {/if}
    {/each}
  </div>
</div>

<style lang="scss">
  .tag-picker {
    width: 200px;
    max-height: 250px;
    display: flex;
    flex-direction: column;

    &__search {
      padding: 4px;
      border-bottom: 1px solid var(--b3-border-color);
    }

    &__search-input {
      width: 100%;
      border: none;
      background: transparent;
      font-size: 12px;
      padding: 6px 8px;
      outline: none;
      color: var(--b3-theme-on-surface);

      &::placeholder {
        color: var(--b3-theme-on-surface-light);
      }
    }

    &__list {
      flex: 1;
      overflow-y: auto;
      max-height: 200px;
    }

    &__item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 6px 8px;
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 12px;
      color: var(--b3-theme-on-surface);
      border-radius: 4px;

      &:hover {
        background: var(--b3-theme-surface-light);
      }

      &.is-selected {
        color: var(--b3-theme-primary);
      }
    }

    &__check {
      width: 16px;
      font-size: 12px;
    }

    &__dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    &__create {
      color: var(--b3-theme-primary);
      font-weight: 500;
    }

    &__empty {
      padding: 12px;
      text-align: center;
      font-size: 12px;
      color: var(--b3-theme-on-surface-light);
    }
  }
</style>
