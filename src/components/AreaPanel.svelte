<script lang="ts">
  /**
   * 区域页面板：区域内项目列表（进度/截止，点击进项目）+ 备注。
   * 改名/删除已移到侧边栏区域行（双击改名 / × 删除，含级联），面板不再有 ⋯ 菜单。
   */
  import type { StoreManager } from "@/stores";
  import type { Area, Project } from "@/types";
  import { formatDateFull } from "@/utils/calendar";
  import { isOverdue } from "@/utils/date";
  import { Icon } from "@/icons";

  export let store: StoreManager;
  export let area: Area;
  export let projects: Project[];

  let editingNotes = false;
  let notesDraft = "";

  function startEditNotes() {
    notesDraft = area.notes || "";
    editingNotes = true;
    // 点输入框以外即提交收起——不能只靠 blur：任务卡片 mousedown preventDefault 会吞掉失焦
    setTimeout(() => document.addEventListener("mousedown", onNotesOutside), 0);
  }

  function onNotesOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest(".area-panel__notes-input")) return; // 点输入框自身：保持编辑
    document.removeEventListener("mousedown", onNotesOutside);
    commitNotes();
  }

  async function commitNotes() {
    if (notesDraft !== (area.notes || "")) {
      await store.areas.updateArea(area.id, { notes: notesDraft });
    }
    editingNotes = false;
    document.removeEventListener("mousedown", onNotesOutside);
  }

  function openProject(id: string) {
    window.dispatchEvent(new CustomEvent("things-navigate", { detail: { view: "project", viewId: id } }));
  }

  function projectProgress(p: Project): { done: number; total: number } {
    const ts = store.tasks.getProjectTasks(p.id);
    return { done: ts.filter((t) => t.status === "done").length, total: ts.length };
  }
</script>

<div class="area-panel" on:click|stopPropagation>
  <!-- 区域备注：置于项目列表上方（Things 3 的备注在标题下方，不压在子项后面） -->
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

  <div class="area-panel__header">
    <span class="area-panel__section-title">项目</span>
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

    &__project {
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

    &__project-name {
      flex: 1;
      font-size: 14px;
      font-weight: 500;
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
      white-space: nowrap;

      &.is-overdue {
        font-weight: 600;
      }
    }

    &__project-count {
      font-size: 12px;
      color: var(--b3-theme-on-surface-light);
      white-space: nowrap;
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
      box-sizing: border-box;
    }
  }
</style>
