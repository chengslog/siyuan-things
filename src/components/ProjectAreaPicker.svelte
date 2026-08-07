<script lang="ts">
  /**
   * 项目/区域选择器（Things 3 的 "Projects and Areas" 行）。
   * 选项目 → projectId（areaId 清空，区域随项目的 areaId 间接体现）；
   * 选区域 → areaId（projectId 清空）。
   */
  import { createEventDispatcher } from "svelte";
  import type { StoreManager } from "@/stores";
  import { Icon } from "@/icons";

  export let store: StoreManager;
  export let selectedProjectId: string | undefined = undefined;
  export let selectedAreaId: string | undefined = undefined;

  const dispatch = createEventDispatcher();
  let query = "";

  $: q = query.trim().toLowerCase();
  $: areas = store.areas.getAll().sort((a, b) => a.order - b.order);
  $: projects = store.projects.getActiveProjects().sort((a, b) => a.order - b.order);
  // 搜索时：按名称过滤项目；区域保留"名称命中或包含命中项目"的
  $: matchedProjects = q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects;
  $: visibleAreas = q
    ? areas.filter((a) => a.name.toLowerCase().includes(q) || matchedProjects.some((p) => p.areaId === a.id))
    : areas;
  $: validAreaIds = new Set(areas.map((a) => a.id));
  $: orphanProjects = matchedProjects.filter((p) => !p.areaId || !validAreaIds.has(p.areaId));

  function pickProject(id: string) {
    dispatch("change", { projectId: id, areaId: undefined });
    dispatch("close");
  }

  function pickArea(id: string) {
    dispatch("change", { projectId: undefined, areaId: id });
    dispatch("close");
  }
</script>

<div class="pa-picker" on:click|stopPropagation>
  <div class="pa-picker__search">
    <input
      type="text"
      placeholder="搜索项目与区域"
      bind:value={query}
      on:click|stopPropagation
    />
  </div>

  <div class="pa-picker__list">
    {#each visibleAreas as area (area.id)}
      {@const areaProjects = matchedProjects.filter((p) => p.areaId === area.id)}
      <button
        class="pa-picker__option pa-picker__option--area"
        class:is-selected={selectedAreaId === area.id}
        on:click={() => pickArea(area.id)}
      >
        <Icon name="iconThingsArea" size={16} />
        <span>{area.name}</span>
      </button>
      {#each areaProjects as p (p.id)}
        <button
          class="pa-picker__option pa-picker__option--project"
          class:is-selected={selectedProjectId === p.id}
          on:click={() => pickProject(p.id)}
        >
          <Icon name="iconThingsProject" size={14} />
          <span>{p.name}</span>
        </button>
      {/each}
    {/each}

    {#if orphanProjects.length > 0}
      <div class="pa-picker__separator">无区域</div>
      {#each orphanProjects as p (p.id)}
        <button
          class="pa-picker__option pa-picker__option--project"
          class:is-selected={selectedProjectId === p.id}
          on:click={() => pickProject(p.id)}
        >
          <Icon name="iconThingsProject" size={14} />
          <span>{p.name}</span>
        </button>
      {/each}
    {/if}
  </div>
</div>

<style lang="scss">
  .pa-picker {
    width: 260px;

    &__search {
      padding: 8px 10px;
      border-bottom: 1px solid var(--b3-border-color);

      input {
        width: 100%;
        border: none;
        outline: none;
        background: transparent;
        font-size: 13px;
        color: var(--b3-theme-on-surface);

        &::placeholder {
          color: var(--b3-theme-on-surface-light);
        }
      }
    }

    &__list {
      max-height: 300px;
      overflow-y: auto;
      padding: 6px;
    }

    &__separator {
      padding: 8px 10px 4px;
      font-size: 11px;
      font-weight: 500;
      color: var(--b3-theme-on-surface-light);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    &__option {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 7px 10px;
      border: none;
      border-radius: 6px;
      background: transparent;
      cursor: pointer;
      font-size: 13px;
      text-align: left;
      color: var(--b3-theme-on-surface);

      &:hover {
        background: var(--b3-theme-surface-light);
      }

      &--area {
        font-weight: 500;
      }

      &--project {
        padding-left: 30px;
        font-size: 13px;
      }

      &.is-selected {
        color: var(--b3-theme-primary);
        font-weight: 600;
        background: var(--b3-theme-primary-light);
      }
    }
  }
</style>
