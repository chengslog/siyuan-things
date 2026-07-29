<script lang="ts">
  /**
   * 区域页面板：区域内项目列表（进度/截止，点击进项目）+ 备注 + ⋯ 管理（改名/删除，含级联）。
   */
  import { onDestroy } from "svelte";
  import type { StoreManager } from "@/stores";
  import type { Area, Project } from "@/types";
  import { formatDateFull } from "@/utils/calendar";
  import { isOverdue } from "@/utils/date";
  import { Icon } from "@/icons";

  export let store: StoreManager;
  export let area: Area;
  export let projects: Project[];

  let showMenu = false;
  let renaming = false;
  let nameDraft = "";
  let confirmDelete = false;
  let editingNotes = false;
  let notesDraft = "";
  let menuEl: HTMLElement;

  onDestroy(() => {
    document.removeEventListener("click", closeMenuOnOutside);
  });

  function toggleMenu() {
    showMenu = !showMenu;
    confirmDelete = false;
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
      document.removeEventListener("click", closeMenuOnOutside);
    }
  }

  function menuAction(fn: () => void) {
    return (e: MouseEvent) => {
      e.stopPropagation();
      fn();
    };
  }

  function startRename() {
    nameDraft = area.name;
    renaming = true;
    showMenu = false;
  }

  async function commitRename() {
    const name = nameDraft.trim();
    if (name && name !== area.name) {
      await store.areas.updateArea(area.id, { name });
    }
    renaming = false;
  }

  function startEditNotes() {
    notesDraft = area.notes || "";
    editingNotes = true;
  }

  async function commitNotes() {
    if (notesDraft !== (area.notes || "")) {
      await store.areas.updateArea(area.id, { notes: notesDraft });
    }
    editingNotes = false;
  }

  function openProject(id: string) {
    window.dispatchEvent(new CustomEvent("things-navigate", { detail: { view: "project", viewId: id } }));
  }

  // 删除区域：其下项目与任务解除归属（不删数据），然后导航回收件箱
  async function deleteArea() {
    for (const p of projects) {
      await store.projects.updateProject(p.id, { areaId: undefined });
    }
    for (const t of store.tasks.getAll()) {
      if (t.areaId === area.id) {
        await store.tasks.updateTask(t.id, { areaId: undefined });
      }
    }
    await store.areas.delete(area.id);
    window.dispatchEvent(new CustomEvent("things-navigate", { detail: { view: "inbox" } }));
  }

  function projectProgress(p: Project): { done: number; total: number } {
    const ts = store.tasks.getProjectTasks(p.id);
    return { done: ts.filter((t) => t.status === "done").length, total: ts.length };
  }
</script>

<div class="area-panel" on:click|stopPropagation>
  <div class="area-panel__header">
    {#if renaming}
      <input
        class="area-panel__rename"
        type="text"
        bind:value={nameDraft}
        on:blur={commitRename}
        on:keydown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") renaming = false; }}
        autofocus
      />
    {:else}
      <span class="area-panel__section-title">项目</span>
    {/if}

    <div class="area-panel__menu-wrap" bind:this={menuEl}>
      <button class="area-panel__menu-btn" title="区域管理" on:click|stopPropagation={toggleMenu}>⋯</button>
      {#if showMenu}
        <div class="area-panel__menu">
          <button class="area-panel__menu-item" on:click={menuAction(startRename)}>修改名称</button>
          <div class="area-panel__menu-sep"></div>
          {#if confirmDelete}
            <div class="area-panel__confirm">
              <p>删除后，区域内项目与任务将解除归属（数据保留）。</p>
              <button class="area-panel__confirm-btn" on:click={menuAction(deleteArea)}>确认删除</button>
            </div>
          {:else}
            <button class="area-panel__menu-item is-danger" on:click={menuAction(() => { confirmDelete = true; })}>删除区域…</button>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  {#each projects as p (p.id)}
    {@const prog = projectProgress(p)}
    <button class="area-panel__project" on:click={() => openProject(p.id)}>
      <Icon name="iconThingsProject" size={16} />
      <span class="area-panel__project-name">{p.name}</span>
      {#if p.deadline}
        <span class="area-panel__project-deadline" class:is-overdue={p.status === "active" && isOverdue(p.deadline)}>
          <Icon name="iconThingsFlag" size={11} />{formatDateFull(p.deadline)}
        </span>
      {/if}
      <span class="area-panel__project-count">{prog.done}/{prog.total}</span>
    </button>
  {:else}
    <div class="area-panel__empty">此区域暂无项目</div>
  {/each}

  <div class="area-panel__notes-row">
    {#if editingNotes}
      <textarea
        class="area-panel__notes-input"
        bind:value={notesDraft}
        on:blur={commitNotes}
        placeholder="区域备注…"
        rows="2"
      ></textarea>
    {:else if area.notes}
      <button class="area-panel__notes" on:click={startEditNotes} title="点击编辑备注">{area.notes}</button>
    {:else}
      <button class="area-panel__notes is-empty" on:click={startEditNotes}>添加备注…</button>
    {/if}
  </div>
</div>

<style lang="scss">
  .area-panel {
    padding: 4px 0 14px;

    &__header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    &__section-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--b3-theme-on-surface-light);
      text-transform: uppercase;
      letter-spacing: 0.03em;
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
      width: 28px;
      height: 28px;
      border: none;
      border-radius: 6px;
      background: transparent;
      cursor: pointer;
      font-size: 15px;
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

      &.is-danger {
        color: var(--b3-theme-error);
      }
    }

    &__menu-sep {
      height: 1px;
      background: var(--b3-border-color);
      margin: 5px 4px;
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

    &__project {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 8px 10px;
      border: none;
      border-radius: 8px;
      background: transparent;
      cursor: pointer;
      text-align: left;

      &:hover {
        background: var(--b3-theme-surface-light);
      }
    }

    &__project-name {
      flex: 1;
      font-size: 14px;
      color: var(--b3-theme-on-surface);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &__project-deadline {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 12px;
      color: #dc2626;

      &.is-overdue {
        font-weight: 600;
      }
    }

    &__project-count {
      font-size: 12px;
      color: var(--b3-theme-on-surface-light);
      font-variant-numeric: tabular-nums;
    }

    &__empty {
      padding: 8px 10px;
      font-size: 13px;
      color: var(--b3-theme-on-surface-light);
    }

    &__notes-row {
      margin-top: 8px;
    }

    &__notes {
      width: 100%;
      border: none;
      background: transparent;
      cursor: pointer;
      text-align: left;
      font-size: 13px;
      color: var(--b3-theme-on-surface-light);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      padding: 4px 10px;

      &.is-empty {
        opacity: 0.6;
      }

      &:hover {
        color: var(--b3-theme-on-surface);
      }
    }

    &__notes-input {
      width: 100%;
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
