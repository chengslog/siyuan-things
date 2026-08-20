<script lang="ts">
  /**
   * 区域页面板：区域内项目列表（进度/截止，点击进项目）+ 备注。
   * 改名/删除已移到侧边栏区域行（双击改名 / × 删除，含级联），面板不再有 ⋯ 菜单。
   */
  import { onDestroy, tick } from "svelte";
  import type { StoreManager } from "@/stores";
  import type { Area, Project } from "@/types";
  import { formatDateFull } from "@/utils/calendar";
  import { isOverdue } from "@/utils/date";
  import { Icon } from "@/icons";
  import { renderMarkdown } from "@/utils/markdown";

  export let store: StoreManager;
  export let area: Area;
  export let projects: Project[];

  let editingNotes = false;
  let notesDraft = "";
  let notesArea: HTMLTextAreaElement;
  let notesExpanded = false;
  let notesContentEl: HTMLElement;

  $: renderedNotes = renderMarkdown(area.notes || "");
  $: isNotesOverflowing = checkOverflow(notesContentEl);

  function checkOverflow(el: HTMLElement | null): boolean {
    return !!el && el.scrollHeight > el.clientHeight + 2;
  }

  onDestroy(() => document.removeEventListener("mousedown", onNotesOutside));

  function startEditNotes() {
    notesDraft = area.notes || "";
    editingNotes = true;
    tick().then(() => {
      notesArea?.focus();
      if (notesArea) notesArea.selectionStart = notesArea.selectionEnd = notesArea.value.length;
    });
    // 点输入框以外即提交收起——不能只靠 blur：任务卡片 mousedown preventDefault 会吞掉失焦
    setTimeout(() => document.addEventListener("mousedown", onNotesOutside), 0);
  }

  function onNotesOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest(".area-panel__notes-textarea")) return; // 点输入框自身：保持编辑
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

  function autoGrow(node: HTMLTextAreaElement) {
    const resize = () => {
      node.style.height = "auto";
      node.style.height = `${node.scrollHeight}px`;
    };
    resize();
    const timer = setTimeout(resize, 50);
    node.addEventListener("input", resize);
    return { destroy() { clearTimeout(timer); node.removeEventListener("input", resize); } };
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
  <div class="area-panel__notes-section">
    {#if editingNotes}
      <div class="area-panel__notes-wrap area-panel__notes-wrap--editing" on:mousedown|stopPropagation on:mouseup|stopPropagation>
        <textarea
          class="area-panel__notes-textarea"
          bind:this={notesArea}
          bind:value={notesDraft}
          use:autoGrow
          on:blur={commitNotes}
          placeholder="添加备注…（支持 Markdown）"
          rows="2"
        ></textarea>
        <button class="area-panel__notes-done" on:click|stopPropagation={commitNotes} title="完成编辑">✓</button>
      </div>
    {:else}
      <div class="area-panel__notes-wrap" class:area-panel__notes-wrap--has-content={area.notes?.trim()} on:mousedown|stopPropagation on:mouseup|stopPropagation on:click|stopPropagation={startEditNotes}>
        {#if area.notes?.trim()}
          <div class="area-panel__notes-md" class:is-expanded={notesExpanded} bind:this={notesContentEl}>{@html renderedNotes}</div>
          <button class="area-panel__notes-edit" on:click|stopPropagation={startEditNotes} title="编辑备注">
            <Icon name="iconThingsPencil" size={12} />
          </button>
          {#if isNotesOverflowing}
            <button class="area-panel__notes-expand" on:click|stopPropagation={() => notesExpanded = !notesExpanded} title={notesExpanded ? "收起" : "展开"}>
              {notesExpanded ? "收起" : "展开"}
            </button>
          {/if}
        {:else}
          <span class="area-panel__notes-placeholder">添加备注…</span>
        {/if}
      </div>
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

    &__notes-section { margin-top: 10px; }

    &__notes-wrap {
      position: relative;
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 8px;
      cursor: pointer;

      &--has-content { border-color: var(--b3-border-color); }
      &--editing { border-color: var(--b3-theme-primary-light); cursor: default; }
    }

    &__notes-textarea {
      width: 100%;
      padding: 0;
      border: none;
      outline: none;
      font-size: 13px;
      font-family: inherit;
      line-height: 1.5;
      color: var(--b3-theme-on-surface);
      background: transparent;
      resize: none;
      overflow: auto;
      min-height: 20px;

      &::placeholder { color: var(--b3-theme-on-surface-light); }
    }

    &__notes-md {
      width: 100%;
      max-height: 104px;
      overflow: hidden;
      font-size: 13px;
      line-height: 1.6;
      color: var(--b3-theme-on-surface);
      word-break: break-word;

      &.is-expanded { max-height: none; }
      :global(p) { margin: 0 0 6px; }
      :global(ul), :global(ol) { margin: 0 0 6px; padding-left: 20px; }
      :global(code) { background: var(--b3-theme-surface-light); padding: 1px 4px; border-radius: 4px; font-size: 12px; }
      :global(pre) { background: var(--b3-theme-surface-light); padding: 8px; border-radius: 6px; overflow-x: auto; margin: 0 0 6px; }
      :global(blockquote) { margin: 0 0 6px; padding-left: 10px; border-left: 3px solid var(--b3-border-color); color: var(--b3-theme-on-surface-light); }
      :global(img) { max-width: 100%; border-radius: 6px; margin: 4px 0; }
      :global(a) { color: var(--b3-theme-primary); }
    }

    &__notes-edit, &__notes-done, &__notes-expand {
      position: absolute;
      top: 4px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--b3-theme-on-surface-light);
      cursor: pointer;
      opacity: 0;
    }

    &__notes-edit, &__notes-done {
      right: 4px;
      width: 22px;
      height: 22px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    &__notes-expand { right: 30px; padding: 2px 8px; font-size: 11px; }
    &__notes-done { opacity: 1; }
    &__notes-wrap:hover &__notes-edit,
    &__notes-wrap:hover &__notes-expand { opacity: 1; }
    &__notes-edit:hover, &__notes-done:hover, &__notes-expand:hover { background: var(--b3-list-hover); color: var(--b3-theme-on-surface); }

    &__notes-placeholder {
      font-size: 13px;
      color: var(--b3-theme-on-surface-light);
      &:hover { color: var(--b3-theme-on-surface); }
    }
  }
</style>
