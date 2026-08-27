<script lang="ts">
  /**
   * 项目页内容面板：完成进度、截止日期、状态徽章和备注。
   * 项目管理菜单位于页面标题右侧，由 ProjectMenu 独立负责。
   */
  import { onDestroy, tick } from "svelte";
  import type { StoreManager } from "@/stores";
  import type { Project, ProjectStatus, Task } from "@/types";
  import { formatDateFull } from "@/utils/calendar";
  import { isOverdue } from "@/utils/date";
  import { Icon } from "@/icons";
  import { renderMarkdown } from "@/utils/markdown";

  export let store: StoreManager;
  export let project: Project;
  export let tasks: Task[];

  let editingNotes = false;
  let notesDraft = "";
  let notesArea: HTMLTextAreaElement;
  let notesExpanded = false;
  let notesContentEl: HTMLElement;

  $: renderedNotes = renderMarkdown(project.notes || "");
  // 检测备注内容是否超过 2 行（需要展开按钮）
  $: isNotesOverflowing = checkOverflow(notesContentEl);

  function checkOverflow(el: HTMLElement | null): boolean {
    if (!el) return false;
    return el.scrollHeight > el.clientHeight + 2;
  }

  onDestroy(() => {
    document.removeEventListener("mousedown", onNotesOutside);
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

  // —— 备注编辑 ——
  function startEditNotes() {
    notesDraft = project.notes || "";
    editingNotes = true;
    tick().then(() => {
      notesArea?.focus();
      if (notesArea) {
        notesArea.selectionStart = notesArea.selectionEnd = notesArea.value.length;
      }
    });
    // 点输入框以外即提交收起——不能只靠 blur：任务卡片 mousedown preventDefault 会吞掉失焦
    setTimeout(() => document.addEventListener("mousedown", onNotesOutside), 0);
  }

  function onNotesOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest(".project-panel__notes-textarea")) return; // 点输入框自身：保持编辑
    document.removeEventListener("mousedown", onNotesOutside);
    commitNotes();
  }

  // textarea 自动增高
  function autoGrow(node: HTMLTextAreaElement) {
    const resize = () => {
      node.style.height = 'auto';
      node.style.height = node.scrollHeight + 'px';
    };
    resize();
    const t = setTimeout(resize, 50);
    node.addEventListener('input', resize);
    return {
      update: resize,
      destroy() {
        node.removeEventListener('input', resize);
        clearTimeout(t);
      },
    };
  }

  async function commitNotes() {
    if (notesDraft !== (project.notes || "")) {
      await store.projects.updateProject(project.id, { notes: notesDraft });
    }
    editingNotes = false;
    document.removeEventListener("mousedown", onNotesOutside);
  }

</script>

<div class="project-panel" on:click|stopPropagation>
  <!-- 完成进度与项目状态 -->
  <div class="project-panel__row">
    <span class="project-panel__progress-text">{done}/{total} 已完成</span>
    <div
      class="project-panel__progress-bar"
      role="progressbar"
      aria-label={`项目完成进度 ${progress}%`}
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={progress}
    >
      <div class="project-panel__progress-fill" style="width: {progress}%"></div>
    </div>
    <span class="project-panel__progress-percent">{progress}%</span>
    {#if project.deadline}
      <span class="project-panel__deadline" class:is-overdue={deadlineOverdue}>
        <Icon name="iconThingsFlag" size={12} />
        {formatDateFull(project.deadline)}
      </span>
    {/if}
    {#if statusMeta}
      <span class="project-panel__badge {statusMeta.klass}">{statusMeta.label}</span>
    {/if}

  </div>

  <!-- 备注 -->
  <div class="project-panel__notes-section">
    {#if editingNotes}
      <div class="project-panel__notes-wrap project-panel__notes-wrap--editing" on:mousedown|stopPropagation on:mouseup|stopPropagation>
        <textarea
          class="project-panel__notes-textarea"
          bind:this={notesArea}
          bind:value={notesDraft}
          use:autoGrow
          on:blur={commitNotes}
          placeholder="添加备注...（支持 Markdown，可粘贴/拖入图片）"
          rows="2"
        ></textarea>
        <button class="project-panel__notes-done" on:click|stopPropagation={commitNotes} title="完成编辑">✓</button>
      </div>
    {:else}
      <div class="project-panel__notes-wrap" class:project-panel__notes-wrap--has-content={project.notes?.trim()} on:mousedown|stopPropagation on:mouseup|stopPropagation on:click|stopPropagation={startEditNotes}>
        {#if project.notes?.trim()}
          <div class="project-panel__notes-md" class:is-expanded={notesExpanded} bind:this={notesContentEl}>{@html renderedNotes}</div>
          <button class="project-panel__notes-edit" on:click|stopPropagation={startEditNotes} title="编辑备注">
            <Icon name="iconThingsPencil" size={12} />
          </button>
          {#if isNotesOverflowing}
            <button class="project-panel__notes-expand" on:click|stopPropagation={() => notesExpanded = !notesExpanded} title={notesExpanded ? "收起" : "展开"}>
              {notesExpanded ? "收起" : "展开"}
            </button>
          {/if}
        {:else}
          <span class="project-panel__notes-placeholder">添加备注…</span>
        {/if}
      </div>
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
      width: 100%;
    }

    &__progress-text {
      font-size: 13px;
      color: var(--b3-theme-on-surface-light);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    &__progress-bar {
      flex: 1;
      min-width: 72px;
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

    &__progress-percent {
      min-width: 34px;
      color: var(--b3-theme-primary);
      font-size: 12px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
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

    &__deadline {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: #dc2626;
      white-space: nowrap;

      &.is-overdue {
        background: #fee2e2;
        padding: 2px 8px;
        border-radius: 999px;
        font-weight: 600;
      }
    }

    // 备注区域
    &__notes-section {
      margin-top: 10px;
    }

    &__notes-wrap {
      position: relative;
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 8px;
      cursor: pointer;

      &--has-content {
        border-color: #f0f0f0;
      }

      &--editing {
        border-color: #e0e0e0;
        cursor: default;
      }
    }

    &__notes-textarea {
      width: 100%;
      padding: 0;
      border: none;
      outline: none;
      font-size: 13px;
      font-family: inherit;
      color: #4b5563;
      background: transparent;
      resize: none;
      overflow: auto;
      min-height: 20px;
      line-height: 1.5;

      &::placeholder {
        color: #9ca3af;
      }
    }

    &__notes-md {
      width: 100%;
      font-size: 13px;
      line-height: 1.6;
      color: #4b5563;
      word-break: break-word;
      // 展示态固定高度，超出截断
      max-height: 104px; // 约5行高度 (13px * 1.6 * 5 = 104px)
      overflow: hidden;
      position: relative;

      &.is-expanded {
        max-height: none;
      }

      :global(p) {
        margin: 0 0 6px;
      }

      :global(ul),
      :global(ol) {
        margin: 0 0 6px;
        padding-left: 20px;
      }

      :global(code) {
        background: var(--b3-theme-surface-light);
        padding: 1px 4px;
        border-radius: 4px;
        font-size: 12px;
      }

      :global(pre) {
        background: var(--b3-theme-surface-light);
        padding: 8px;
        border-radius: 6px;
        overflow-x: auto;
        margin: 0 0 6px;
      }

      :global(blockquote) {
        margin: 0 0 6px;
        padding-left: 10px;
        border-left: 3px solid var(--b3-border-color);
        color: var(--b3-theme-on-surface-light);
      }

      :global(img) {
        max-width: 100%;
        border-radius: 6px;
        margin: 4px 0;
      }

      :global(a) {
        color: var(--b3-theme-primary);
      }
    }

    &__notes-expand {
      position: absolute;
      top: 4px;
      right: 30px; // 编辑按钮右侧，编辑按钮在 right: 4px
      padding: 2px 8px;
      border: none;
      background: transparent;
      color: #9ca3af;
      font-size: 11px;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s;
      opacity: 0;

      .project-panel__notes-wrap:hover & {
        opacity: 1;
      }

      &:hover {
        background: #f3f4f6;
        color: #374151;
      }
    }

    &__notes-edit,
    &__notes-done {
      position: absolute;
      top: 4px;
      right: 4px;
      width: 22px;
      height: 22px;
      padding: 0;
      border: none;
      background: transparent;
      cursor: pointer;
      color: #9ca3af;
      font-size: 13px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: all 0.2s;
      opacity: 0;

      .project-panel__notes-wrap:hover & {
        opacity: 1;
      }
    }

    &__notes-edit:hover,
    &__notes-done:hover {
      background: #f3f4f6;
      color: #374151;
    }

    &__notes-done {
      opacity: 1; // 编辑态始终显示
    }

    &__notes-placeholder {
      font-size: 13px;
      color: #9ca3af;
      cursor: pointer;

      &:hover {
        color: #6b7280;
      }
    }
  }
</style>
