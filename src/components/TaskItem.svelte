<script lang="ts">
  import { createEventDispatcher, onDestroy } from "svelte";
  import type { Task } from "@/types";
  import type { StoreManager } from "@/stores";
  import { formatDateShort, formatTime, hasTime, isOverdue } from "@/utils/date";

  export let task: Task;
  export let showProject: boolean = true;
  export let store: StoreManager;

  const dispatch = createEventDispatcher();

  // 组件销毁时清理事件监听
  onDestroy(() => {
    document.removeEventListener('click', handleOutsideClick);
  });

  let expanded = false;
  let editTitle = task.title;
  let editNotes = task.notes;
  let newSubTaskTitle = "";

  $: subTasks = store.tasks.getSubTasks(task.id);
  $: completedSubTasks = subTasks.filter((t) => t.status === "done");
  $: project = task.projectId ? store.projects.get(task.projectId) : null;
  $: tags = task.tags.map((id) => store.tags.get(id)).filter(Boolean);
  $: isDeadlineOverdue = task.deadline && isOverdue(task.deadline);

  // 点击展开/折叠
  function handleCardClick() {
    expanded = !expanded;
    if (expanded) {
      editTitle = task.title;
      editNotes = task.notes;
      // 监听外部点击
      setTimeout(() => {
        document.addEventListener('click', handleOutsideClick);
      }, 0);
    }
  }

  // 点击外部关闭
  function handleOutsideClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const card = target.closest('.task-card');
    if (!card || card.dataset.taskId !== task.id) {
      saveAndCollapse();
    }
  }

  // 保存并折叠
  async function saveAndCollapse() {
    await saveTitle();
    await saveNotes();
    expanded = false;
    document.removeEventListener('click', handleOutsideClick);
  }

  // 切换完成状态
  let moveTimeout: any = null;
  let isMoving = false;

  async function handleToggle(e: Event) {
    e.stopPropagation();

    if (task.status === "done") {
      // 取消完成，移回今天
      if (moveTimeout) {
        clearTimeout(moveTimeout);
        moveTimeout = null;
      }
      isMoving = false;
      await store.tasks.updateTask(task.id, {
        status: "todo",
        startDate: Date.now(),
        completedDate: undefined,
      });
    } else {
      // 标记完成，延迟3秒后移到日志
      await store.tasks.toggleTask(task.id);
      isMoving = true;

      moveTimeout = setTimeout(async () => {
        await store.tasks.updateTask(task.id, {
          startDate: undefined,
        });
        isMoving = false;
        moveTimeout = null;
      }, 3000);
    }
  }

  // 保存标题
  async function saveTitle() {
    if (editTitle.trim() && editTitle !== task.title) {
      await store.tasks.updateTask(task.id, { title: editTitle.trim() });
    }
  }

  // 保存备注
  async function saveNotes() {
    if (editNotes !== task.notes) {
      await store.tasks.updateTask(task.id, { notes: editNotes });
    }
  }

  // 删除任务
  async function handleDelete(e: Event) {
    e.stopPropagation();
    await store.tasks.delete(task.id);
  }

  // 主任务拖动
  function handleDragStart(e: DragEvent) {
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', task.id);
    // 添加拖动样式
    const el = e.target as HTMLElement;
    el.classList.add('is-dragging');
  }

  function handleDragEnd(e: DragEvent) {
    const el = e.target as HTMLElement;
    el.classList.remove('is-dragging');
    // 移除所有目标样式
    document.querySelectorAll('.task-card--drag-target').forEach(el => {
      el.classList.remove('task-card--drag-target');
    });
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    const el = e.target as HTMLElement;
    el.closest('.task-card')?.classList.add('task-card--drag-target');
  }

  function handleDragLeave(e: DragEvent) {
    const el = e.target as HTMLElement;
    el.closest('.task-card')?.classList.remove('task-card--drag-target');
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();

    const el = e.target as HTMLElement;
    el.closest('.task-card')?.classList.remove('task-card--drag-target');

    const draggedId = e.dataTransfer?.getData('text/plain');
    if (!draggedId || draggedId === task.id) return;

    const draggedTask = store.tasks.get(draggedId);
    if (!draggedTask) return;

    // 交换排序值
    const tempOrder = draggedTask.order;
    await store.tasks.updateTask(draggedId, { order: task.order });
    await store.tasks.updateTask(task.id, { order: tempOrder });
  }

  // 子任务拖动
  let draggedSubId: string | null = null;
  let dragOverSubId: string | null = null;

  function handleSubDragStart(e: DragEvent, subId: string) {
    e.stopPropagation();
    draggedSubId = subId;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', subId);
      e.dataTransfer.setData('application/things-subtask', subId);
    }
    const el = e.target as HTMLElement;
    setTimeout(() => el.style.opacity = '0.5', 0);
  }

  function handleSubDragEnd(e: DragEvent) {
    const el = e.target as HTMLElement;
    el.style.opacity = '1';
    draggedSubId = null;
    dragOverSubId = null;
  }

  function handleSubDragOver(e: DragEvent, targetId: string) {
    e.preventDefault();
    e.stopPropagation();
    if (draggedSubId && draggedSubId !== targetId) {
      dragOverSubId = targetId;
    }
  }

  function handleSubDragLeave() {
    dragOverSubId = null;
  }

  async function handleSubDrop(e: DragEvent, targetId: string) {
    e.preventDefault();
    e.stopPropagation();
    dragOverSubId = null;

    if (!draggedSubId || draggedSubId === targetId) return;

    const draggedTask = store.tasks.get(draggedSubId);
    const targetTask = store.tasks.get(targetId);

    if (draggedTask && targetTask) {
      const tempOrder = draggedTask.order;
      await store.tasks.updateTask(draggedSubId, { order: targetTask.order });
      await store.tasks.updateTask(targetId, { order: tempOrder });
    }
  }

  // 添加子任务
  async function addSubTask() {
    await store.tasks.createTask({
      title: "",
      parentId: task.id,
    });
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div
  class="task-card"
  class:is-done={task.status === "done"}
  class:is-expanded={expanded}
  class:is-moving={isMoving}
  data-task-id={task.id}
  draggable="true"
  on:click={handleCardClick}
  on:dragstart={handleDragStart}
  on:dragend={handleDragEnd}
  on:dragover={handleDragOver}
  on:dragleave={handleDragLeave}
  on:drop={handleDrop}
>
  <!-- 任务头部 -->
  <div class="task-card__header">
    <!-- 完成按钮 -->
    <button
      class="task-card__check"
      class:is-checked={task.status === "done"}
      on:click={handleToggle}
    >
      {#if task.status === "done"}
        <svg><use xlink:href="#iconCheck" /></svg>
      {/if}
    </button>

    <!-- 标题 -->
    {#if expanded}
      <input
        type="text"
        class="task-card__title-input"
        bind:value={editTitle}
        on:blur={saveTitle}
        on:keydown={(e) => e.key === 'Enter' && saveTitle()}
        on:click|stopPropagation
      />
    {:else}
      <div class="task-card__title" class:is-done={task.status === "done"}>
        {task.title}
      </div>
    {/if}

    <!-- 日期（收缩状态显示） -->
    {#if !expanded && task.startDate}
      <span class="task-card__date-badge">
        {formatDateShort(task.startDate)}
      </span>
    {/if}

    <!-- 优先级 -->
    {#if task.priority !== "none"}
      <span class="task-card__priority task-card__priority--{task.priority}">
        {task.priority === "high" ? "!!" : task.priority === "medium" ? "!" : "↓"}
      </span>
    {/if}
  </div>

  <!-- 展开的详情 -->
  {#if expanded}
    <div class="task-card__details" on:click|stopPropagation>
      <!-- 备注编辑（紧贴标题，无标题） -->
      <textarea
        class="task-card__notes"
        bind:value={editNotes}
        on:blur={saveNotes}
        placeholder="添加备注..."
        rows="1"
      ></textarea>

      <!-- 子任务 -->
      <div class="task-card__subtasks">
        {#each subTasks as subTask, index}
          <div
            class="task-card__subtask"
            class:is-drag-over={dragOverSubId === subTask.id}
            draggable="true"
            on:dragstart={(e) => handleSubDragStart(e, subTask.id)}
            on:dragend={handleSubDragEnd}
            on:dragover={(e) => handleSubDragOver(e, subTask.id)}
            on:dragleave={handleSubDragLeave}
            on:drop={(e) => handleSubDrop(e, subTask.id)}
          >
            <div
              class="task-card__subtask-drag"
              title="拖动排序"
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <circle cx="9" cy="6" r="1.5"/>
                <circle cx="15" cy="6" r="1.5"/>
                <circle cx="9" cy="12" r="1.5"/>
                <circle cx="15" cy="12" r="1.5"/>
              </svg>
            </div>
            <button
              class="task-card__subtask-check"
              class:is-done={subTask.status === "done"}
              on:click={() => store.tasks.toggleTask(subTask.id)}
            >
              {#if subTask.status === "done"}
                <svg><use xlink:href="#iconCheck" /></svg>
              {/if}
            </button>
            <input
              type="text"
              class="task-card__subtask-input"
              class:is-done={subTask.status === "done"}
              value={subTask.title}
              on:blur={(e) => {
                if (e.currentTarget.value !== subTask.title) {
                  store.tasks.updateTask(subTask.id, { title: e.currentTarget.value });
                }
              }}
              on:keydown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  store.tasks.updateTask(subTask.id, { title: e.currentTarget.value });
                  const nextInput = e.currentTarget.parentElement?.nextElementSibling?.querySelector('.task-card__subtask-input');
                  if (nextInput) {
                    nextInput.focus();
                  } else {
                    addSubTask();
                  }
                }
              }}
              on:click|stopPropagation
            />
            <button
              class="task-card__subtask-delete"
              on:click|stopPropagation={() => store.tasks.delete(subTask.id)}
            >
              ×
            </button>
          </div>
        {/each}
      </div>

      <!-- 底部操作栏 -->
      <div class="task-card__toolbar" on:click|stopPropagation>
        <!-- 时间选择 -->
        <button class="task-card__tool-btn" title="设置时间">
          <span>⭐</span>
        </button>

        <!-- 标签 -->
        <button class="task-card__tool-btn" title="添加标签">
          <span>🏷</span>
        </button>

        <!-- 子任务 -->
        <button class="task-card__tool-btn" title="添加子任务" on:click={addSubTask}>
          <span>☷</span>
        </button>

        <!-- 截止日期 -->
        <button class="task-card__tool-btn" title="设置截止日期">
          <span>⚑</span>
        </button>

        <!-- 删除 -->
        <button class="task-card__tool-btn task-card__tool-btn--delete" title="删除" on:click={handleDelete}>
          <span>×</span>
        </button>
      </div>
    </div>
  {/if}
</div>

<style lang="scss">
  .task-card {
    background: #ffffff;
    border: 2px solid #e5e7eb;
    border-radius: 12px;
    padding: 14px 18px;
    margin-bottom: 10px;
    cursor: pointer;
    transition: all 0.3s ease;

    &:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    }

    &.is-done {
      opacity: 0.6;
    }

    &.is-moving {
      opacity: 0.4;
      background: #f9fafb;
    }

    &.is-dragging {
      opacity: 0.5;
    }

    &--drag-target {
      border-top: 2px solid #3b82f6;
    }

    &.is-expanded {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    &__header {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    &__check {
      flex-shrink: 0;
      width: 18px;
      height: 18px;
      padding: 0;
      border: 2px solid #d1d5db;
      border-radius: 4px;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;

      svg {
        width: 12px;
        height: 12px;
        color: white;
      }

      &:hover {
        border-color: #3b82f6;
      }

      &.is-checked {
        background: #3b82f6;
        border-color: #3b82f6;
      }
    }

    &__title {
      flex: 1;
      font-size: 15px;
      font-weight: 600;
      color: #1f2937;

      &.is-done {
        text-decoration: line-through;
        color: #9ca3af;
      }
    }

    &__title-input {
      flex: 1;
      font-size: 15px;
      font-weight: 600;
      color: #1f2937;
      border: none;
      outline: none;
      padding: 2px 0;
      background: transparent;
    }

    &__priority {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;

      &--high {
        background: #fee2e2;
        color: #dc2626;
      }

      &--medium {
        background: #fef3c7;
        color: #d97706;
      }

      &--low {
        background: #f3f4f6;
        color: #6b7280;
      }
    }

    &__date-badge {
      font-size: 11px;
      color: #6b7280;
      padding: 2px 8px;
      background: #f3f4f6;
      border-radius: 4px;
      flex-shrink: 0;
    }

    // 展开详情
    &__details {
      margin-top: 8px;
      padding-left: 30px;
    }

    // 备注输入框
    &__notes {
      width: 100%;
      padding: 4px 0;
      border: none;
      outline: none;
      font-size: 13px;
      color: #4b5563;
      background: transparent;
      resize: none;
      overflow: hidden;
      min-height: 20px;

      &::placeholder {
        color: #9ca3af;
      }

      &:focus {
        min-height: 40px;
      }
    }

    // 子任务
    &__subtasks {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    &__subtask {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 0;
      border-top: 2px solid transparent;

      &.is-drag-over {
        border-top-color: #3b82f6;
      }
    }

    &__subtask-drag {
      flex-shrink: 0;
      width: 16px;
      height: 20px;
      cursor: grab;
      color: #9ca3af;
      display: flex;
      align-items: center;
      opacity: 0;
      transition: opacity 0.2s;

      svg {
        width: 14px;
        height: 14px;
      }

      &:active {
        cursor: grabbing;
      }
    }

    .task-card__subtask:hover .task-card__subtask-drag {
      opacity: 1;
    }

    &__subtask-check {
      flex-shrink: 0;
      width: 16px;
      height: 16px;
      padding: 0;
      border: 1.5px solid #d1d5db;
      border-radius: 50%;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;

      svg {
        width: 10px;
        height: 10px;
        color: white;
      }

      &.is-done {
        background: #3b82f6;
        border-color: #3b82f6;
      }
    }

    &__subtask-input {
      flex: 1;
      border: none;
      outline: none;
      font-size: 13px;
      color: #1f2937;
      background: transparent;
      padding: 2px 0;

      &.is-done {
        text-decoration: line-through;
        color: #9ca3af;
      }

      &::placeholder {
        color: #9ca3af;
      }
    }

    &__subtask-delete {
      flex-shrink: 0;
      width: 20px;
      height: 20px;
      padding: 0;
      border: none;
      background: transparent;
      cursor: pointer;
      color: #9ca3af;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      opacity: 0;

      &:hover {
        background: #fee2e2;
        color: #dc2626;
      }
    }

    .task-card__subtask:hover .task-card__subtask-delete {
      opacity: 1;
    }

    // 底部工具栏
    &__toolbar {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #f3f4f6;
    }

    &__tool-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: none;
      background: transparent;
      cursor: pointer;
      border-radius: 6px;
      font-size: 14px;
      color: #6b7280;

      &:hover {
        background: #f3f4f6;
      }

      &--delete {
        margin-left: auto;
        font-size: 18px;
        color: #9ca3af;

        &:hover {
          background: #fee2e2;
          color: #dc2626;
        }
      }
    }
  }
</style>
