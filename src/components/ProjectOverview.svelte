<script lang="ts">
  /**
   * 项目总览：按状态分组（进行中/已暂停/已完成/已作废），每行显示
   * 名称、所属区域、截止、进度；点击进项目页。
   */
  import type { StoreManager } from "@/stores";
  import type { Project, ProjectStatus } from "@/types";
  import { formatDateFull } from "@/utils/calendar";
  import { isOverdue } from "@/utils/date";
  import { Icon } from "@/icons";

  export let store: StoreManager;
  // 外部传入的刷新计数（projects store 变更时自增），保证本组件重算
  export let version: number = 0;

  const GROUPS: { status: ProjectStatus; label: string }[] = [
    { status: "active", label: "进行中" },
    { status: "onhold", label: "已暂停" },
    { status: "completed", label: "已完成" },
    { status: "canceled", label: "已作废" },
  ];

  $: projects = readProjects(store, version);

  function readProjects(s: StoreManager, _v: number): Project[] {
    return s.projects.getAll().sort((a, b) => a.order - b.order);
  }

  function groupOf(s: ProjectStatus, all: Project[]): Project[] {
    return all.filter((p) => p.status === s);
  }

  function progress(p: Project): { done: number; total: number } {
    const ts = store.tasks.getProjectTasks(p.id);
    return { done: ts.filter((t) => t.status === "done").length, total: ts.length };
  }

  function areaName(p: Project): string {
    return p.areaId ? store.areas.get(p.areaId)?.name || "" : "";
  }

  function open(p: Project) {
    window.dispatchEvent(new CustomEvent("things-navigate", { detail: { view: "project", viewId: p.id } }));
  }
</script>

<div class="projects-ov">
  {#each GROUPS as g (g.status)}
    {@const list = groupOf(g.status, projects)}
    {#if list.length > 0}
      <div class="projects-ov__group">{g.label} · {list.length}</div>
      {#each list as p (p.id)}
        {@const prog = progress(p)}
        <button class="projects-ov__row" on:click={() => open(p)}>
          <Icon name="iconThingsProject" size={16} />
          <div class="projects-ov__main">
            <span class="projects-ov__name">{p.name}</span>
            {#if areaName(p)}
              <span class="projects-ov__area">{areaName(p)}</span>
            {/if}
          </div>
          {#if p.deadline && (p.status === "active" || p.status === "onhold")}
            <span class="projects-ov__deadline" class:is-overdue={p.status === "active" && isOverdue(p.deadline)}>
              <Icon name="iconThingsFlag" size={11} />{formatDateFull(p.deadline)}
            </span>
          {/if}
          {#if prog.total > 0}
            <span class="projects-ov__count">{prog.done}/{prog.total}</span>
            <span class="projects-ov__bar">
              <span class="projects-ov__bar-fill" style="width: {Math.round((prog.done / prog.total) * 100)}%"></span>
            </span>
          {/if}
        </button>
      {/each}
    {/if}
  {/each}

  {#if projects.length === 0}
    <div class="projects-ov__empty">还没有项目——用右下角 ＋ 创建第一个吧</div>
  {/if}
</div>

<style lang="scss">
  .projects-ov {
    padding-top: 8px;

    &__group {
      font-size: 12px;
      font-weight: 600;
      color: var(--b3-theme-on-surface-light);
      text-transform: uppercase;
      letter-spacing: 0.03em;
      margin: 24px 0 8px;

      &:first-child {
        margin-top: 8px;
      }
    }

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

    &__main {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: baseline;
      gap: 8px;
    }

    &__name {
      font-size: 14px;
      color: var(--b3-theme-on-surface);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &__area {
      font-size: 12px;
      color: var(--b3-theme-on-surface-light);
      white-space: nowrap;
    }

    &__deadline {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 12px;
      color: #dc2626;
      white-space: nowrap;

      &.is-overdue {
        font-weight: 600;
      }
    }

    &__count {
      font-size: 12px;
      color: var(--b3-theme-on-surface-light);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    &__bar {
      width: 70px;
      height: 5px;
      border-radius: 3px;
      background: var(--b3-theme-surface-light);
      overflow: hidden;
      flex-shrink: 0;
    }

    &__bar-fill {
      display: block;
      height: 100%;
      background: var(--b3-theme-primary);
      border-radius: 3px;
    }

    &__empty {
      padding: 48px 0;
      text-align: center;
      font-size: 13px;
      color: var(--b3-theme-on-surface-light);
    }
  }
</style>
