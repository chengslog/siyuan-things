<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { StoreManager } from "@/stores";

  export let store: StoreManager;
  export let selectedTags: string[] = [];

  const dispatch = createEventDispatcher();

  let tagSearchQuery = "";

  // 获取标签列表
  $: allTags = store.tags.getAll();
  $: filteredTags = tagSearchQuery
    ? allTags.filter(t => t.name.toLowerCase().includes(tagSearchQuery.toLowerCase()))
    : allTags;

  function toggleTag(tagId: string) {
    const index = selectedTags.indexOf(tagId);
    if (index >= 0) {
      selectedTags = selectedTags.filter(id => id !== tagId);
    } else {
      selectedTags = [...selectedTags, tagId];
    }
    dispatch("change", { tags: selectedTags });
  }
</script>

<div class="tag-picker" on:click|stopPropagation>
  <div class="tag-picker__search">
    <input
      type="text"
      class="tag-picker__search-input"
      placeholder="搜索标签..."
      bind:value={tagSearchQuery}
    />
  </div>
  <div class="tag-picker__list">
    {#each filteredTags as tag}
      <button
        class="tag-picker__item"
        class:is-selected={selectedTags.includes(tag.id)}
        on:click={() => toggleTag(tag.id)}
      >
        <span class="tag-picker__check">
          {#if selectedTags.includes(tag.id)}✓{/if}
        </span>
        <span>{tag.name}</span>
      </button>
    {:else}
      <div class="tag-picker__empty">暂无标签</div>
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

    &__empty {
      padding: 12px;
      text-align: center;
      font-size: 12px;
      color: var(--b3-theme-on-surface-light);
    }
  }
</style>
