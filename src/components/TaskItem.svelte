<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from "svelte";
  import type { Task } from "@/types";
  import type { StoreManager } from "@/stores";
  import { formatDateShort, isOverdue } from "@/utils/date";
  import { isTodayDate, isTomorrowDate, formatDateFull } from "@/utils/calendar";
  import DatePicker from "./DatePicker.svelte";
  import DeadlinePicker from "./DeadlinePicker.svelte";
  import TagPicker from "./TagPicker.svelte";
  import Checklist from "./Checklist.svelte";

  export let task: Task;
  export let showProject: boolean = true;
  export let store: StoreManager;
  export let isDragging: boolean = false;
  export let registerItem: (id: string, el: HTMLElement) => void = () => {};
  export let unregisterItem: (id: string) => void = () => {};

  const dispatch = createEventDispatcher();

  let cardEl: HTMLElement;

  // 注册元素
  $: if (cardEl && task.id) {
    registerItem(task.id, cardEl);
  }

  // 监听其他卡片展开事件
  function handleCardExpanded(e: CustomEvent) {
    const { cardId } = e.detail;
    if (cardId !== task.id && expanded) {
      // 其他卡片展开了，收起当前卡片
      saveAndCollapse();
    }
  }

  onMount(() => {
    window.addEventListener('card-expanded', handleCardExpanded as EventListener);
  });

  onDestroy(() => {
    document.removeEventListener('click', handleOutsideClick);
    window.removeEventListener('card-expanded', handleCardExpanded as EventListener);
    if (moveTimeout) clearTimeout(moveTimeout);
    unregisterItem(task.id);
  });

  let expanded = false;
  let editTitle = task.title;
  let editNotes = task.notes;

  // UI 状态
  let showDatePicker = false;
  let showDeadlinePicker = false;
  let showTagPicker = false;

  $: subTasks = store.tasks.getSubTasks(task.id);
  $: completedSubTasks = subTasks.filter((t) => t.status === "done");
  $: project = task.projectId ? store.projects.get(task.projectId) : null;
  $: tags = task.tags.map((id) => store.tags.get(id)).filter(Boolean);
  $: isDeadlineOverdue = task.deadline && isOverdue(task.deadline);

  // 点击展开/折叠
  function handleCardClick(e?: Event) {
    // 如果卡片已展开，点击卡片内部不折叠
    if (expanded) {
      // 只处理功能卡片的关闭
      const hasOpenDropdown = showDatePicker || showDeadlinePicker || showTagPicker;
      if (hasOpenDropdown) {
        showDatePicker = false;
        showDeadlinePicker = false;
        showTagPicker = false;
      }
      return;
    }

    // 如果有事件，检查点击位置
    if (e) {
      const target = e.target as HTMLElement;

      // 如果点击的是工具栏按钮，不触发展开
      if (target.closest('.task-card__tool-btn')) {
        return;
      }

      // 如果点击的是下拉菜单内部，不触发展开
      if (target.closest('.task-card__dropdown')) {
        return;
      }

      // 如果点击的是完成按钮，不触发展开
      if (target.closest('.task-card__check')) {
        return;
      }
    }

    // 卡片未展开时，点击展开卡片
    expanded = true;
    editTitle = task.title;
    editNotes = task.notes;
    // 通知其他卡片收起
    window.dispatchEvent(new CustomEvent('card-expanded', { detail: { cardId: task.id } }));
    // 延迟添加事件监听，避免立即触发
    setTimeout(() => {
      document.addEventListener('click', handleOutsideClick);
    }, 10);
  }

  // 保存标题
  async function saveTitle() {
    if (editTitle !== task.title) {
      await store.tasks.updateTask(task.id, { title: editTitle });
    }
  }

  // 保存备注
  async function saveNotes() {
    if (editNotes !== task.notes) {
      await store.tasks.updateTask(task.id, { notes: editNotes });
    }
  }

  // 切换完成状态
  let moveTimeout: any = null;
  let isMoving = false;

  async function handleToggle(e: Event) {
    e.stopPropagation();
    if (task.status === "done") {
      await store.tasks.toggleTask(task.id);
      await store.tasks.updateTask(task.id, { completedDate: undefined });
    } else {
      await store.tasks.toggleTask(task.id);
      isMoving = true;
      moveTimeout = setTimeout(async () => {
        await store.tasks.updateTask(task.id, { startDate: undefined });
        isMoving = false;
      }, 3000);
    }
  }

  // 删除任务
  async function handleDelete(e: Event) {
    e.stopPropagation();
    await store.tasks.delete(task.id);
  }

  // 点击外部关闭
  function handleOutsideClick(e: MouseEvent) {
    const target = e.target as HTMLElement;

    // 点击卡片外部时，关闭所有下拉菜单并折叠卡片
    const card = target.closest('.task-card');
    if (!card || card.dataset.taskId !== task.id) {
      showDatePicker = false;
      showDeadlinePicker = false;
      showTagPicker = false;
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

  // 主任务拖动 - 向父组件派发事件
  let dragTimer: any = null;
  let isClick = true;

  function handleMouseDown(e: MouseEvent) {
    // 只有左键触发拖动
    if (e.button !== 0) return;
    // 如果点击的是按钮或输入框，不触发拖动
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input') || target.closest('textarea')) return;

    isClick = true;

    // 延迟判断：200ms后如果还没mouseup，则认为是拖动
    dragTimer = setTimeout(() => {
      if (isClick) {
        isClick = false;
        dispatch('dragstart', { event: e });
      }
    }, 200);
  }

  function handleMouseUp(e: MouseEvent) {
    // 如果在200ms内松开，则是点击
    if (dragTimer) {
      clearTimeout(dragTimer);
      dragTimer = null;
    }

    if (isClick) {
      // 是点击，触发展开/折叠（传递事件对象用于检查）
      handleCardClick(e);
    }

    isClick = true;
  }

  function handleTouchStart(e: TouchEvent) {
    // 如果点击的是按钮或输入框，不触发拖动
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input') || target.closest('textarea')) return;

    isClick = true;

    dragTimer = setTimeout(() => {
      if (isClick) {
        isClick = false;
        dispatch('dragstart', { event: e });
      }
    }, 200);
  }

  function handleTouchEnd(e: TouchEvent) {
    if (dragTimer) {
      clearTimeout(dragTimer);
      dragTimer = null;
    }

    if (isClick) {
      handleCardClick();
    }

    isClick = true;
  }

  // 添加子任务
  async function addSubTask() {
    await store.tasks.createTask({
      title: "",
      parentId: task.id,
    });
  }

  // 日期变化处理
  async function handleDateChange(e: CustomEvent) {
    await store.tasks.updateTask(task.id, { startDate: e.detail.timestamp });
  }

  // 日期选择器关闭
  function handleDatePickerClose() {
    showDatePicker = false;
  }

  // 截止日期变化处理
  async function handleDeadlineChange(e: CustomEvent) {
    await store.tasks.updateTask(task.id, { deadline: e.detail.timestamp });
  }

  // 截止日期选择器关闭
  function handleDeadlinePickerClose() {
    showDeadlinePicker = false;
  }

  // 标签变化处理
  async function handleTagChange(e: CustomEvent) {
    await store.tasks.updateTask(task.id, { tags: e.detail.tags });
  }

  // 子任务变化处理
  async function handleSubtasksChange(e: CustomEvent) {
    const { items: newItems } = e.detail;
    if (!newItems) return;

    // 获取当前子任务
    const currentSubTasks = store.tasks.getSubTasks(task.id);

    // 遍历新items，更新变更的子任务
    for (const newItem of newItems) {
      const oldItem = currentSubTasks.find(t => t.id === newItem.id);

      if (oldItem) {
        // 检查是否有变更
        if (oldItem.title !== newItem.title || (oldItem.status === 'done') !== newItem.completed) {
          await store.tasks.updateTask(newItem.id, {
            title: newItem.title,
            status: newItem.completed ? 'done' : 'todo'
          });
        }
      } else {
        // 新增的子任务
        if (newItem.title.trim()) {
          await store.tasks.createTask({
            title: newItem.title,
            parentId: task.id,
            status: newItem.completed ? 'done' : 'todo'
          });
        }
      }
    }

    // 检查是否有删除的子任务
    for (const oldItem of currentSubTasks) {
      if (!newItems.find((n: any) => n.id === oldItem.id)) {
        await store.tasks.delete(oldItem.id);
      }
    }
  }

  // 获取日期按钮文本
  function getDateButtonText(): string {
    if (!task.startDate) return "";
    if (isTodayDate(task.startDate)) return "今天";
    if (isTomorrowDate(task.startDate)) return "明天";
    const date = new Date(task.startDate);
    if (date.getHours() !== 0 || date.getMinutes() !== 0) {
      return `${formatDateFull(task.startDate)} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    }
    return formatDateFull(task.startDate);
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div
  class="task-card"
  class:is-done={task.status === "done"}
  class:is-expanded={expanded}
  class:is-moving={isMoving}
  class:is-dragging={isDragging}
  data-task-id={task.id}
  bind:this={cardEl}
  on:mousedown={handleMouseDown}
  on:mouseup={handleMouseUp}
  on:touchstart={handleTouchStart}
  on:touchend={handleTouchEnd}
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
  </div>

  <!-- 备注预览（收缩状态，有内容时显示） -->
  {#if !expanded && task.notes}
    <div class="task-card__notes-preview">
      {task.notes}
    </div>
  {/if}

  <!-- 标签预览（收缩状态，有标签时显示） -->
  {#if !expanded && tags.length > 0}
    <div class="task-card__tags-preview">
      {#each tags as tag}
        <span class="task-card__tag">{tag.name}</span>
      {/each}
    </div>
  {/if}

  <!-- 展开的详情 -->
  {#if expanded}
    <div class="task-card__details" on:click|stopPropagation>
      <!-- 备注编辑 -->
      <textarea
        class="task-card__notes"
        bind:value={editNotes}
        on:blur={saveNotes}
        placeholder="添加备注..."
        rows="2"
      ></textarea>

      <!-- 标签 -->
      {#if tags.length > 0}
        <div class="task-card__tags">
          {#each tags as tag}
            <span class="task-card__tag">{tag.name}</span>
          {/each}
        </div>
      {/if}

      <!-- 子任务/检查清单 -->
      <div class="task-card__subtasks">
        <Checklist
          items={subTasks.map(t => ({ id: t.id, title: t.title, completed: t.status === 'done' }))}
          showDragHandle={true}
          on:change={handleSubtasksChange}
        />
      </div>

      <!-- 底部操作栏 -->
      <div class="task-card__toolbar">
        <!-- 日期选择 -->
        <div class="task-card__action-group">
          <button
            class="task-card__tool-btn"
            class:is-active={task.startDate}
            title="设置日期"
            on:click|stopPropagation={() => { showDatePicker = !showDatePicker; showDeadlinePicker = false; showTagPicker = false; }}
          >
            <span>⭐</span>
          </button>

          {#if showDatePicker}
            <div class="task-card__dropdown">
              <DatePicker
                timestamp={task.startDate}
                on:change={handleDateChange}
                on:close={handleDatePickerClose}
              />
            </div>
          {/if}
        </div>

        <!-- 标签 -->
        <div class="task-card__action-group">
          <button
            class="task-card__tool-btn"
            class:is-active={task.tags.length > 0}
            title="标签"
            on:click|stopPropagation={() => { showTagPicker = !showTagPicker; showDatePicker = false; showDeadlinePicker = false; }}
          >
            <span>🏷</span>
          </button>

          {#if showTagPicker}
            <div class="task-card__dropdown">
              <TagPicker
                store={store}
                selectedTags={task.tags}
                on:change={handleTagChange}
              />
            </div>
          {/if}
        </div>

        <!-- 子任务 -->
        <button class="task-card__tool-btn" title="添加子任务" on:click|stopPropagation={addSubTask}>
          <span>☷</span>
        </button>

        <!-- 截止日期 -->
        <div class="task-card__action-group">
          <button
            class="task-card__tool-btn"
            class:is-active={task.deadline}
            title="设置截止日期"
            on:click|stopPropagation={() => { showDeadlinePicker = !showDeadlinePicker; showDatePicker = false; showTagPicker = false; }}
          >
            <span>⚑</span>
          </button>

          {#if showDeadlinePicker}
            <div class="task-card__dropdown">
              <DeadlinePicker
                timestamp={task.deadline}
                on:change={handleDeadlineChange}
                on:close={handleDeadlinePickerClose}
              />
            </div>
          {/if}
        </div>

        <!-- 删除 -->
        <button class="task-card__tool-btn task-card__tool-btn--delete" title="删除" on:click|stopPropagation={handleDelete}>
          <span>×</span>
        </button>
      </div>
    </div>
  {/if}
</div>

<style lang="scss">
  .task-card {
    background: transparent;
    border: none;
    border-bottom: 1px solid #f3f4f6;
    border-radius: 0;
    padding: 10px 0;
    margin-bottom: 0;
    cursor: pointer;
    transition: all 0.2s ease;

    &:hover {
      background: #f9fafb;
    }

    &.is-done {
      opacity: 0.6;
    }

    &.is-moving {
      opacity: 0.4;
      background: #f9fafb;
    }

    &.is-dragging {
      opacity: 0;
      pointer-events: none;
    }

    &.is-expanded {
      background: #ffffff;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
      border-radius: 16px;
      border: none;
      padding: 16px 20px;
      position: relative;
      z-index: 10;
      margin: 8px 12px;
    }

    &__header {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    &__check {
      flex-shrink: 0;
      width: 16px;
      height: 16px;
      padding: 0;
      border: 1.5px solid #d1d5db;
      border-radius: 4px;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;

      svg {
        width: 10px;
        height: 10px;
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
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;

      &.is-done {
        text-decoration: line-through;
        color: #9ca3af;
        opacity: 0.7;
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
      min-width: 0;
    }

    &__date-badge {
      font-size: 11px;
      color: #6b7280;
      padding: 2px 8px;
      background: #f3f4f6;
      border-radius: 4px;
      flex-shrink: 0;
    }

    &__notes-preview {
      margin-top: 6px;
      padding-left: 28px;
      font-size: 13px;
      color: #6b7280;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    &__tags-preview {
      margin-top: 6px;
      padding-left: 28px;
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    &__tag {
      font-size: 11px;
      padding: 2px 8px;
      background: #f3f4f6;
      color: #6b7280;
      border-radius: 10px;
    }

    &__details {
      margin-top: 12px;
      padding-left: 28px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

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
      line-height: 1.5;

      &::placeholder {
        color: #9ca3af;
      }

      &:focus {
        min-height: 40px;
      }
    }

    &__tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    &__subtasks {
      margin-top: 4px;
    }

    &__toolbar {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 4px;
      padding-top: 8px;
      border-top: 1px solid #f3f4f6;
    }

    &__action-group {
      position: relative;
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
      transition: all 0.2s;

      &:hover {
        background: #f3f4f6;
      }

      &.is-active {
        color: #3b82f6;
        background: #eff6ff;
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

    &__dropdown {
      position: absolute;
      top: 100%;
      left: 0;
      z-index: 100;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      padding: 8px;
      margin-top: 4px;
    }
  }
</style>
