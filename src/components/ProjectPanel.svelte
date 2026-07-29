<script lang="ts">
  /**
   * 项目页头部面板：进度、截止日期、备注、状态徽章、⋯ 管理菜单
   * （改名/截止日期/移动区域/完成/暂停/作废/删除——对齐 Things 3 项目管理）。
   */
  import { createEventDispatcher, onDestroy } from "svelte";
  import type { StoreManager } from "@/stores";
  import type { Project, ProjectStatus, Task } from "@/types";
  import { formatDateFull } from "@/utils/calendar";
  import { isOverdue } from "@/utils/date";
  import { Icon } from "@/icons";
  import DeadlinePicker from "./DeadlinePicker.svelte";

  export let store: StoreManager;
  export let project: Project;
  export let tasks: Task[];

  const dispatch = createEventDispatcher();

  let showMenu = false;
  let showAreaPicker = false;
  let showDeadlinePicker = false;
  let renaming = false;
  let nameDraft = "";
  let editingNotes = false;
  let notesDraft = "";
  let confirmDelete = false;
  let menuEl: HTMLElement;

  onDestroy(() => {
    document.removeEventListener("click", closeMenuOnOutside);
  });

  $: total = tasks.filter((t) => !t.parentId).length;
  $: done = tasks.filter((t) => !t.parentId && t.status === "done").length;
  $: progress = total === 0 ? 0 : Math.round((done / total) * 100);
  $: statusMeta = getStatusMeta(project.status);
  $: deadlineOverdue = project.deadline ? isOverdue(project.deadline) && project.status === "active" : false;

  function getStatusMeta(status: ProjectStatus): { label: string; klass: string } | null {
    switch (status) {
      case "onhold": return { label: "已暂停", klass: "is-onhold" };
      case "completed": return { label: "已完成", klass: "is-completed" };
      case "canceled": return { label: "已作废", klass: "is-canceled" };
      default: return null;
    }
  }

  // —— 菜单开关 ——
  function toggleMenu() {
    showMenu = !showMenu;
    confirmDelete = false;
    showAreaPicker = false;
    if (showMenu) {
      setTimeout(() => document.addEventListener("click", closeMenuOnOutside), 0);
    } else {
      document.removeEventListener("click", closeMenuOnOutside);
    }
  }

  function closeMenuOnOutside(e: MouseEvent) {
    if (menuEl && !menuEl.contains(e.target as HTMLElement)) {
      showMenu = false;
      confirmDelete = false;
      showAreaPicker = false;
      document.removeEventListener("click", closeMenuOnOutside);
    }
  }

  function menuAction(fn: () => void) {
    return (e: MouseEvent) => {
      e.stopPropagation();
      fn();
    };
  }

  // —— 管理操作 ——
  function startRename() {
    nameDraft = project.name;
    renaming = true;
    showMenu = false;
  }

  async function commitRename() {
    const name = nameDraft.trim();
    if (name && name !== project.name) {
      await store.projects.updateProject(project.id, { name });
    }
    renaming = false;
  }

  function startEditNotes() {
    notesDraft = project.notes || "";
    editingNotes = true;
  }

  async function commitNotes() {
    if (notesDraft !== (project.notes || "")) {
      await store.projects.updateProject(project.id, { notes: notesDraft });
    }
    editingNotes = false;
  }

  async function setStatus(status: ProjectStatus) {
    await store.projects.updateProject(project.id, { status });
    showMenu = false;
    dispatch("statuschange", { status });
  }

  async function moveToArea(areaId?: string) {
    await store.projects.updateProject(project.id, { areaId });
    showAreaPicker = false;
    showMenu = false;
  }

  function handleDeadlineChange(e: CustomEvent) {
    store.projects.updateProject(project.id, { deadline: e.detail.timestamp });
    showDeadlinePicker = false;
  }

  async function deleteProject() {
    // 其下任务清掉 projectId（回归收件箱），子任务随父任务保留、不单独处理
    for (const t of store.tasks.getProjectTasks(project.id)) {
      await store.tasks.updateTask(t.id, { projectId: undefined });
    }
    await store.projects.delete(project.id);
    showMenu = false;
    // 通知外壳导航离开（index.ts 监听 things-navigate）
    window.dispatchEvent(new CustomEvent("things-navigate", { detail: { view: "inbox" } }));
  }

  $: areas = store.areas.getAll().sort((a, b) => a.order - b.order);
</script>

<div class="project-panel" on:click|stopPropagation>
  <!-- 进度行 -->
  <div class="project-panel__row">
    {#if renaming}
      <input
        class="project-panel__rename"
        type="text"
        bind:value={nameDraft}
        on:blur={commitRename}
        on:keydown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") renaming = false; }}
        autofocus
      />
    {:else}
      <span class="project-panel__progress-text">{done}/{total} 已完成</span>
      <div class="project-panel__progress-bar">
        <div class="project-panel__progress-fill" style="width: {progress}%"></div>
      </div>
      {#if statusMeta}
        <span class="project-panel__badge {statusMeta.klass}">{statusMeta.label}</span>
      {/if}
    {/if}

    <!-- ⋯ 管理菜单 -->
    <div class="project-panel__menu-wrap" bind:this={menuEl}>
      <button class="project-panel__menu-btn" title="项目管理" on:click|stopPropagation={toggleMenu}>⋯</button>
      {#if showMenu}
        <div class="project-panel__menu">
          <button class="project-panel__menu-item" on:click={menuAction(startRename)}>修改名称</button>
          <button class="project-panel__menu-item" on:click={menuAction(() => { showDeadlinePicker = !showDeadlinePicker; showAreaPicker = false; })}>
            设定截止日期{project.deadline ? "（已有）" : ""}
          </button>
          <button class="project-panel__menu-item" on:click={menuAction(() => { showAreaPicker = !showAreaPicker; showDeadlinePicker = false; })}>
            移动到区域 ▸
          </button>

          {#if showAreaPicker}
            <div class="project-panel__submenu">
              <button
                class="project-panel__menu-item"
                class:is-selected={!project.areaId}
                on:click={menuAction(() => moveToArea(undefined))}
              >无</button>
              {#each areas as area (area.id)}
                <button
                  class="project-panel__menu-item"
                  class:is-selected={project.areaId === area.id}
                  on:click={menuAction(() => moveToArea(area.id))}
                >{area.name}</button>
              {/each}
            </div>
          {/if}

          {#if showDeadlinePicker}
            <div class="project-panel__submenu">
              <DeadlinePicker
                timestamp={project.deadline}
                on:change={handleDeadlineChange}
                on:close={() => { showDeadlinePicker = false; }}
              />
            </div>
          {/if}

          <div class="project-panel__menu-sep"></div>

          {#if project.status === "active"}
            <button class="project-panel__menu-item" on:click={menuAction(() => setStatus("completed"))}>标记为完成</button>
            <button class="project-panel__menu-item" on:click={menuAction(() => setStatus("onhold"))}>暂停项目</button>
            <button class="project-panel__menu-item" on:click={menuAction(() => setStatus("canceled"))}>设为作废</button>
          {:else}
            <button class="project-panel__menu-item" on:click={menuAction(() => setStatus("active"))}>恢复为活跃</button>
          {/if}

          <div class="project-panel__menu-sep"></div>

          {#if confirmDelete}
            <div class="project-panel__confirm">
              <p>删除后，项目内任务将移回收件箱。</p>
              <button class="project-panel__confirm-btn" on:click={menuAction(deleteProject)}>确认删除</button>
            </div>
          {:else}
            <button class="project-panel__menu-item is-danger" on:click={menuAction(() => { confirmDelete = true; })}>删除项目…</button>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <!-- 截止日期 + 备注 -->
  <div class="project-panel__meta">
    {#if project.deadline}
      <span class="project-panel__deadline" class:is-overdue={deadlineOverdue}>
        <Icon name="iconThingsFlag" size={12} />
        {formatDateFull(project.deadline)}
      </span>
    {/if}
    {#if editingNotes}
      <textarea
        class="project-panel__notes-input"
        bind:value={notesDraft}
        on:blur={commitNotes}
        placeholder="项目备注…"
        rows="2"
      ></textarea>
    {:else if project.notes}
      <button class="project-panel__notes" on:click={startEditNotes} title="点击编辑备注">{project.notes}</button>
    {:else}
      <button class="project-panel__notes is-empty" on:click={startEditNotes}>添加备注…</button>
    {/if}
  </div>
</div>

<style lang="scss">
  .project-panel {
    padding: 4px 0 14px;

    &__row {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    &__progress-text {
      font-size: 13px;
      color: var(--b3-theme-on-surface-light);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    &__progress-bar {
      width: 180px;
      max-width: 30vw;
      height: 6px;
      border-radius: 3px;
      background: var(--b3-theme-surface-light);
      overflow: hidden;
    }

    &__progress-fill {
      height: 100%;
      border-radius: 3px;
      background: var(--b3-theme-primary);
      transition: width 0.3s ease;
    }

    &__badge {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
      white-space: nowrap;

      &.is-onhold {
        background: #fef3c7;
        color: #b45309;
      }
      &.is-completed {
        background: #d1fae5;
        color: #047857;
      }
      &.is-canceled {
        background: var(--b3-theme-surface-light);
        color: var(--b3-theme-on-surface-light);
      }
    }

    &__rename {
      flex: 1;
      font-size: 15px;
      font-weight: 600;
      border: 1px solid var(--b3-theme-primary);
      border-radius: 6px;
      padding: 4px 8px;
      outline: none;
      background: var(--b3-theme-surface);
      color: var(--b3-theme-on-surface);
    }

    &__menu-wrap {
      position: relative;
      margin-left: auto;
    }

    &__menu-btn {
      width: 30px;
      height: 30px;
      border: none;
      border-radius: 6px;
      background: transparent;
      cursor: pointer;
      font-size: 16px;
      color: var(--b3-theme-on-surface-light);
      display: flex;
      align-items: center;
      justify-content: center;

      &:hover {
        background: var(--b3-theme-surface-light);
        color: var(--b3-theme-on-surface);
      }
    }

    &__menu {
      position: absolute;
      top: calc(100% + 4px);
      right: 0;
      z-index: 60;
      min-width: 180px;
      padding: 6px;
      background: var(--b3-theme-surface);
      border: 1px solid var(--b3-border-color);
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
    }

    &__menu-item {
      display: block;
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

      &.is-selected {
        color: var(--b3-theme-primary);
        font-weight: 600;
      }

      &.is-danger {
        color: var(--b3-theme-error);
      }
    }

    &__menu-sep {
      height: 1px;
      background: var(--b3-border-color);
      margin: 5px 4px;
    }

    &__submenu {
      margin: 4px 0;
      padding: 4px;
      border: 1px solid var(--b3-border-color);
      border-radius: 6px;
      background: var(--b3-theme-background);
      max-height: 220px;
      overflow-y: auto;
    }

    &__confirm {
      padding: 8px 10px;

      p {
        margin: 0 0 8px;
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
      }
    }

    &__confirm-btn {
      width: 100%;
      padding: 6px 10px;
      border: none;
      border-radius: 6px;
      background: var(--b3-theme-error);
      color: #fff;
      font-size: 13px;
      cursor: pointer;

      &:hover {
        opacity: 0.9;
      }
    }

    &__meta {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 10px;
      min-height: 20px;
    }

    &__deadline {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: #dc2626;

      &.is-overdue {
        background: #fee2e2;
        padding: 2px 8px;
        border-radius: 999px;
        font-weight: 600;
      }
    }

    &__notes {
      flex: 1;
      border: none;
      background: transparent;
      cursor: pointer;
      text-align: left;
      font-size: 13px;
      color: var(--b3-theme-on-surface-light);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;

      &.is-empty {
        color: var(--b3-theme-on-surface-light);
        opacity: 0.6;
      }

      &:hover {
        color: var(--b3-theme-on-surface);
      }
    }

    &__notes-input {
      flex: 1;
      font-size: 13px;
      border: 1px solid var(--b3-border-color);
      border-radius: 6px;
      padding: 6px 8px;
      outline: none;
      resize: vertical;
      background: var(--b3-theme-surface);
      color: var(--b3-theme-on-surface);
    }
  }
</style>
