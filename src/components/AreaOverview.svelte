<script lang="ts">
  /**
   * 区域总览：全部区域一览（项目数/任务数），点击进区域页。
   */
  import type { StoreManager } from "@/stores";
  import type { Area } from "@/types";
  import { Icon } from "@/icons";

  export let store: StoreManager;
  // 外部刷新计数（areas/projects/tasks 变更时自增）
  export let version: number = 0;

  $: areas = readAreas(store, version);

  function readAreas(s: StoreManager, _v: number): Area[] {
    return s.areas.getAll().sort((a, b) => a.order - b.order);
  }

  function projectCount(area: Area): number {
    return store.projects.getAreaProjects(area.id).length;
  }

  function taskCount(area: Area): number {
    const projectIds = new Set(store.projects.getAreaProjects(area.id).map((p) => p.id));
    return store.tasks.getAll().filter(
      (t) => t.status === "todo" && (t.areaId === area.id || (t.projectId && projectIds.has(t.projectId)))
    ).length;
  }

  function open(area: Area) {
    window.dispatchEvent(new CustomEvent("things-navigate", { detail: { view: "area", viewId: area.id } }));
  }
</script>

<div class="areas-ov">
  {#each areas as area (area.id)}
    <button class="areas-ov__row" on:click={() => open(area)}>
      <Icon name="iconThingsArea" size={18} />
      <span class="areas-ov__name">{area.name}</span>
      <span class="areas-ov__meta">{projectCount(area)} 项目 · {taskCount(area)} 任务</span>
    </button>
  {:else}
    <div class="areas-ov__empty">还没有区域——用侧边栏「区域」旁的 ＋ 创建</div>
  {/each}
</div>

<style lang="scss">
  .areas-ov {
    padding-top: 8px;

    &__row {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 10px 12px;
      border: none;
      border-radius: 8px;
      background: transparent;
      cursor: pointer;
      text-align: left;

      &:hover {
        background: var(--b3-theme-surface-light);
      }
    }

    &__name {
      flex: 1;
      font-size: 14px;
      font-weight: 500;
      color: var(--b3-theme-on-surface);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &__meta {
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
