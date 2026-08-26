<script lang="ts">
  /**
   * 项目页头部面板：进度、截止日期、备注、状态徽章、⋯ 管理菜单。
   * 改名/删除已移到侧边栏项目行（双击改名 / × 删除），菜单只保留面板专属操作：
   * 截止日期、移动区域、状态切换。截止日期/区域用独立浮动弹层，避免撑大菜单卡片。
   */
  import { createEventDispatcher, onDestroy, onMount, tick } from "svelte";
  import type { StoreManager } from "@/stores";
  import type { Project, ProjectStatus, Task } from "@/types";
  import { formatDateFull } from "@/utils/calendar";
  import { isOverdue } from "@/utils/date";
  import { Icon } from "@/icons";
  import DeadlinePicker from "./DeadlinePicker.svelte";
  import { smartPosition } from "@/utils/popup";
  import { renderMarkdown } from "@/utils/markdown";

  export let store: StoreManager;
  export let project: Project;
  export let tasks: Task[];

  const dispatch = createEventDispatcher();

  let showMenu = false;
  // 独立浮动弹层：'deadline' | 'area' | null（取代菜单内联展开，菜单卡片尺寸稳定）
  let showPanel: "deadline" | "area" | null = null;
  let editingNotes = false;
  let notesDraft = "";
  let menuEl: HTMLElement;
  let notesArea: HTMLTextAreaElement;
  let notesExpanded = false;
  let notesContentEl: HTMLElement;
  let areaStoreVersion = 0;

  $: renderedNotes = renderMarkdown(project.notes || "");
  // 检测备注内容是否超过 2 行（需要展开按钮）
  $: isNotesOverflowing = checkOverflow(notesContentEl);

  function checkOverflow(el: HTMLElement | null): boolean {
    if (!el) return false;
    return el.scrollHeight > el.clientHeight + 2;
  }

  onDestroy(() => {
    document.removeEventListener("click", closeOnOutside);
    document.removeEventListener("mousedown", onNotesOutside);
  });

  // 项目面板会在项目视图之间复用，store 引用不会随内部 Map 变化。
  // 订阅区域事件，确保“移动到区域”立即包含刚创建的区域。
  onMount(() => store.areas.on(() => areaStoreVersion++));

  $: total = tasks.filter((t) => !t.parentId).length;
  $: done = tasks.filter((t) => !t.parentId && t.status === "done").length;
  $: progress = total === 0 ? 0 : Math.round((done / total) * 100);
  $: statusMeta = getStatusMeta(project.status);
  $: deadlineOverdue = project.deadline ? isOverdue(project.deadline) && project.status === "active" : false;
  $: areas = readAreas(store, areaStoreVersion);

  function readAreas(manager: StoreManager, _version: number) {
    return manager.areas.getAll().sort((a, b) => a.order - b.order);
  }

  function getStatusMeta(status: ProjectStatus): { label: string; klass: string } | null {
    switch (status) {
      case "onhold": return { label: "已暂停", klass: "is-onhold" };
      case "completed": return { label: "已完成", klass: "is-completed" };
      case "canceled": return { label: "已作废", klass: "is-canceled" };
      default: return null;
    }
  }

  // —— 菜单 / 弹层开关 ——
  function toggleMenu() {
    showMenu = !showMenu;
    showPanel = null;
    syncListener();
  }

  function openPanel(panel: "deadline" | "area") {
    showMenu = false;
    showPanel = panel;
    syncListener();
  }

  function syncListener() {
    document.removeEventListener("click", closeOnOutside);
    if (showMenu || showPanel) {
      setTimeout(() => document.addEventListener("click", closeOnOutside), 0);
    }
  }

  function closeOnOutside(e: MouseEvent) {
    if (menuEl && !menuEl.contains(e.target as HTMLElement)) {
      showMenu = false;
      showPanel = null;
      document.removeEventListener("click", closeOnOutside);
    }
  }

  function menuAction(fn: () => void) {
    return (e: MouseEvent) => {
      e.stopPropagation();
      fn();
    };
  }

  // —— 管理操作 ——
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

  async function setStatus(status: ProjectStatus) {
    await store.projects.updateProject(project.id, { status });
    showMenu = false;
    dispatch("statuschange", { status });
  }

  async function moveToArea(areaId?: string) {
    await store.projects.updateProject(project.id, { areaId });
    showPanel = null;
  }

  function handleDeadlineChange(e: CustomEvent) {
    store.projects.updateProject(project.id, { deadline: e.detail.timestamp });
    showPanel = null;
  }
</script>

<div class="project-panel" on:click|stopPropagation>
  <!-- 进度行（含截止日期） -->
  <div class="project-panel__row">
    <span class="project-panel__progress-text">{done}/{total} 已完成</span>
    <div class="project-panel__progress-bar">
      <div class="project-panel__progress-fill" style="width: {progress}%"></div>
    </div>
    {#if project.deadline}
      <span class="project-panel__deadline" class:is-overdue={deadlineOverdue}>
        <Icon name="iconThingsFlag" size={12} />
        {formatDateFull(project.deadline)}
      </span>
    {/if}
    {#if statusMeta}
      <span class="project-panel__badge {statusMeta.klass}">{statusMeta.label}</span>
    {/if}

    <!-- ⋯ 管理菜单 -->
    <div class="project-panel__menu-wrap" bind:this={menuEl}>
      <button class="project-panel__menu-btn" title="项目管理" on:click|stopPropagation={toggleMenu}>⋯</button>

      {#if showMenu}
        <div class="project-panel__menu" use:smartPosition>
          <button class="project-panel__menu-item" on:click={menuAction(() => openPanel("deadline"))}>
            设定截止日期{project.deadline ? "（已有）" : ""}
          </button>
          <button class="project-panel__menu-item" on:click={menuAction(() => openPanel("area"))}>移动到区域 ▸</button>
          <button class="project-panel__menu-item" on:click={menuAction(() => { showMenu = false; dispatch("addheading"); })}>添加标题分组</button>

          <div class="project-panel__menu-sep"></div>

          {#if project.status === "active"}
            <button class="project-panel__menu-item" on:click={menuAction(() => setStatus("completed"))}>标记为完成</button>
            <button class="project-panel__menu-item" on:click={menuAction(() => setStatus("onhold"))}>暂停项目</button>
            <button class="project-panel__menu-item" on:click={menuAction(() => setStatus("canceled"))}>设为作废</button>
          {:else}
            <button class="project-panel__menu-item" on:click={menuAction(() => setStatus("active"))}>恢复为活跃</button>
          {/if}
        </div>
      {/if}

      <!-- 截止日期弹层（独立浮动，不撑大菜单） -->
      {#if showPanel === "deadline"}
        <div class="project-panel__pop" use:smartPosition>
          <DeadlinePicker
            timestamp={project.deadline}
            on:change={handleDeadlineChange}
            on:close={() => (showPanel = null)}
          />
        </div>
      {/if}

      <!-- 区域选择弹层 -->
      {#if showPanel === "area"}
        <div class="project-panel__pop project-panel__pop--area" use:smartPosition>
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
    </div>
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

    // 菜单与浮动弹层共用的卡片外观
    &__menu,
    &__pop {
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

    &__pop--area {
      max-height: 240px;
      overflow-y: auto;
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
