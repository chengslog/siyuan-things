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
  import { onMount, onDestroy } from "svelte";

  export let store: StoreManager;
  // 外部传入的刷新计数（projects store 变更时自增），保证本组件重算
  export let version: number = 0;

  const GROUPS: { status: ProjectStatus; label: string }[] = [
    { status: "active", label: "进行中" },
    { status: "onhold", label: "已暂停" },
    { status: "completed", label: "已完成" },
    { status: "canceled", label: "已作废" },
  ];

  const STATUS_LABELS: Record<ProjectStatus, string> = {
    active: "进行中",
    onhold: "已暂停",
    completed: "已完成",
    canceled: "已作废",
  };

  $: projects = readProjects(store, version);

  // 当前打开状态菜单的项目 ID
  let statusMenuProjectId: string | null = null;

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
    // 如果状态菜单打开，点击行时关闭菜单而不是进入项目
    if (statusMenuProjectId === p.id) {
      statusMenuProjectId = null;
      return;
    }
    statusMenuProjectId = null;
    window.dispatchEvent(new CustomEvent("things-navigate", { detail: { view: "project", viewId: p.id } }));
  }

  function toggleStatusMenu(e: MouseEvent, p: Project) {
    e.stopPropagation();
    statusMenuProjectId = statusMenuProjectId === p.id ? null : p.id;
  }

  async function changeStatus(p: Project, newStatus: ProjectStatus) {
    if (p.status === newStatus) {
      statusMenuProjectId = null;
      return;
    }
    await store.projects.updateProject(p.id, { status: newStatus });
    statusMenuProjectId = null;
  }

  // 点击外部关闭状态菜单
  function handleOutsideClick(e: MouseEvent) {
    if (statusMenuProjectId) {
      const target = e.target as HTMLElement;
      if (!target.closest('.projects-ov__status-chip')) {
        statusMenuProjectId = null;
      }
    }
  }

  onMount(() => {
    document.addEventListener('click', handleOutsideClick);
  });

  onDestroy(() => {
    document.removeEventListener('click', handleOutsideClick);
  });
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
          <!-- 状态快速切换 -->
          <div class="projects-ov__status-chip" class:is-open={statusMenuProjectId === p.id} on:click={(e) => toggleStatusMenu(e, p)}>
            <span class="projects-ov__status-label">{STATUS_LABELS[p.status]}</span>
            <span class="projects-ov__status-arrow">▾</span>
            {#if statusMenuProjectId === p.id}
              <div class="projects-ov__status-menu" on:click|stopPropagation>
                {#each GROUPS as opt}
                  <button
                    class="projects-ov__status-option"
                    class:is-active={p.status === opt.status}
                    on:click={() => changeStatus(p, opt.status)}
                  >
                    {opt.label}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
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

    &__status-chip {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 3px 8px;
      font-size: 11px;
      color: var(--b3-theme-on-surface-light);
      background: var(--b3-theme-surface-light);
      border-radius: 10px;
      cursor: pointer;
      flex-shrink: 0;
      transition: all 0.15s;

      &:hover {
        background: var(--b3-theme-border-color, #e5e7eb);
        color: var(--b3-theme-on-surface);
      }

      &.is-open {
        background: var(--b3-theme-primary);
        color: white;
      }
    }

    &__status-label {
      white-space: nowrap;
    }

    &__status-arrow {
      font-size: 10px;
      line-height: 1;
      opacity: 0.7;
    }

    &__status-menu {
      position: absolute;
      top: calc(100% + 4px);
      right: 0;
      z-index: 100;
      min-width: 80px;
      padding: 4px;
      background: white;
      border: 1px solid var(--b3-border-color, #e5e7eb);
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    &__status-option {
      display: block;
      width: 100%;
      padding: 6px 10px;
      font-size: 12px;
      color: var(--b3-theme-on-surface);
      background: transparent;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      text-align: left;
      white-space: nowrap;

      &:hover {
        background: var(--b3-theme-surface-light);
      }

      &.is-active {
        color: var(--b3-theme-primary);
        font-weight: 500;
      }
    }
  }
</style>
