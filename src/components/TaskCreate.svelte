<script lang="ts">
  import { createEventDispatcher, onMount } from "svelte";
  import type { Task } from "@/types";
  import type { StoreManager } from "@/stores";
  import { getTodayStart, formatRelativeDate } from "@/utils/date";
  import { isTodayDate, isTomorrowDate, formatDateFull } from "@/utils/calendar";
  import DatePicker from "./DatePicker.svelte";
  import DeadlinePicker from "./DeadlinePicker.svelte";
  import TagPicker from "./TagPicker.svelte";
  import Checklist from "./Checklist.svelte";

  export let store: StoreManager;
  export let defaultView: string = "inbox";

  const dispatch = createEventDispatcher();

  let title = "";
  let notes = "";
  let startDate: number | undefined = undefined;
  let deadline: number | undefined = undefined;
  let selectedTags: string[] = [];
  let checklist: Array<{ id: string; title: string; completed: boolean }> = [
    { id: "empty", title: "", completed: false }
  ];

  // UI 状态
  let showDatePicker = false;
  let showDeadlinePicker = false;
  let showTagPicker = false;
  let showChecklist = true;
  let isInteracting = false;
  let formElement: HTMLElement;
  let titleInput: HTMLInputElement;

  onMount(() => {
    if (defaultView === "today") {
      startDate = getTodayStart();
    }
    setTimeout(() => titleInput?.focus(), 100);
  });

  // 获取日期按钮显示文本和图标
  function getDateButtonText(): { icon: string; text: string } {
    if (!startDate) {
      return { icon: "⭐", text: "今天" };
    }

    if (isTodayDate(startDate)) {
      return { icon: "⭐", text: "今天" };
    }

    if (isTomorrowDate(startDate)) {
      return { icon: "⭐", text: "明天" };
    }

    const date = new Date(startDate);
    if (date.getHours() !== 0 || date.getMinutes() !== 0) {
      return { icon: "⭐", text: `${formatDateFull(startDate)} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}` };
    }

    return { icon: "⭐", text: formatDateFull(startDate) };
  }

  $: dateButtonDisplay = getDateButtonText();

  // 检查是否有内容
  function hasContent(): boolean {
    if (title.trim()) return true;
    if (notes.trim()) return true;
    if (checklist.some(item => item.title.trim())) return true;
    return false;
  }

  // 自动保存（焦点移出时）
  function handleBlur(e: FocusEvent) {
    if (isInteracting) return;

    setTimeout(() => {
      const activeElement = document.activeElement;
      if (formElement && !formElement.contains(activeElement)) {
        if (hasContent()) {
          handleCreate();
        } else {
          dispatch("cancel");
        }
      }
    }, 100);
  }

  async function handleCreate() {
    if (!title.trim()) {
      const firstChecklist = checklist.find(item => item.title.trim());
      if (firstChecklist) {
        title = firstChecklist.title;
        checklist = checklist.filter(item => item.id !== firstChecklist.id);
      } else {
        return;
      }
    }

    const taskData: Partial<Task> & { title: string } = {
      title: title.trim(),
      notes: notes.trim(),
      startDate,
      deadline,
      tags: selectedTags,
    };

    if (defaultView === "today" && !startDate) {
      taskData.startDate = getTodayStart();
    }

    const task = await store.tasks.createTask(taskData);

    // 创建检查项
    for (const item of checklist) {
      if (item.title.trim()) {
        await store.tasks.createTask({
          title: item.title,
          parentId: task.id,
          status: item.completed ? "done" : "todo",
        });
      }
    }

    dispatch("created", { task });

    // 重置
    title = "";
    notes = "";
    startDate = defaultView === "today" ? getTodayStart() : undefined;
    deadline = undefined;
    selectedTags = [];
    checklist = [{ id: Date.now().toString(), title: "", completed: false }];

    titleInput?.focus();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleCreate();
    }
    if (e.key === "Escape") {
      dispatch("cancel");
    }
  }

  // 日期变化处理
  function handleDateChange(e: CustomEvent) {
    startDate = e.detail.timestamp;
    showDatePicker = false;
    isInteracting = false;
  }

  // 截止日期变化处理
  function handleDeadlineChange(e: CustomEvent) {
    deadline = e.detail.timestamp;
    showDeadlinePicker = false;
    isInteracting = false;
  }

  // 标签变化处理
  function handleTagChange(e: CustomEvent) {
    selectedTags = e.detail.tags;
  }

  // 检查清单变化处理
  function handleChecklistChange(e: CustomEvent) {
    checklist = e.detail.items;
  }

  // 点击外部关闭下拉菜单
  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.task-create__action-group')) {
      showDatePicker = false;
      showDeadlinePicker = false;
      showTagPicker = false;
      isInteracting = false;
    }
  }
</script>

<svelte:window on:click={handleClickOutside} />

<div class="task-create" bind:this={formElement} on:focusout={handleBlur}>
  <!-- 标题输入 -->
  <div class="task-create__title">
    <span class="task-create__check"></span>
    <input
      bind:this={titleInput}
      type="text"
      class="task-create__title-input"
      placeholder="新建待办事项"
      bind:value={title}
      on:keydown={handleKeydown}
    />
  </div>

  <!-- 备注输入 -->
  <div class="task-create__notes">
    <textarea
      class="task-create__notes-input"
      placeholder="备注"
      bind:value={notes}
      rows="2"
    />
  </div>

  <!-- 检查清单 -->
  {#if showChecklist}
    <div class="task-create__checklist">
      <Checklist
        items={checklist}
        on:change={handleChecklistChange}
      />
    </div>
  {/if}

  <!-- 属性栏 -->
  <div class="task-create__actions">
    <!-- ⭐ 日期/计划 -->
    <div class="task-create__action-group" on:click|stopPropagation>
      <button
        class="task-create__action-btn"
        class:is-active={startDate}
        on:click={() => { showDatePicker = !showDatePicker; showDeadlinePicker = false; showTagPicker = false; isInteracting = showDatePicker; }}
      >
        <span class="task-create__action-icon">{dateButtonDisplay.icon}</span>
        <span>{dateButtonDisplay.text}</span>
      </button>

      {#if showDatePicker}
        <div class="task-create__dropdown">
          <DatePicker
            timestamp={startDate}
            on:change={handleDateChange}
          />
        </div>
      {/if}
    </div>

    <!-- 🏷 标签 -->
    <div class="task-create__action-group" on:click|stopPropagation>
      <button
        class="task-create__action-btn"
        class:is-active={selectedTags.length > 0}
        on:click={() => { showTagPicker = !showTagPicker; showDatePicker = false; showDeadlinePicker = false; isInteracting = showTagPicker; }}
      >
        <span class="task-create__action-icon">🏷</span>
        {#if selectedTags.length > 0}
          <span>{selectedTags.length}个标签</span>
        {/if}
      </button>

      {#if showTagPicker}
        <div class="task-create__dropdown">
          <TagPicker
            store={store}
            selectedTags={selectedTags}
            on:change={handleTagChange}
          />
        </div>
      {/if}
    </div>

    <!-- ☷ 检查清单 -->
    <button
      class="task-create__action-btn"
      class:is-active={showChecklist}
      on:click={() => showChecklist = !showChecklist}
    >
      <span class="task-create__action-icon">☷</span>
    </button>

    <!-- ⚑ 截止日期 -->
    <div class="task-create__action-group" on:click|stopPropagation>
      <button
        class="task-create__action-btn"
        class:is-active={deadline}
        on:click={() => { showDeadlinePicker = !showDeadlinePicker; showDatePicker = false; showTagPicker = false; isInteracting = showDeadlinePicker; }}
      >
        <span class="task-create__action-icon">⚑</span>
        {#if deadline}
          <span>{formatDateFull(deadline)}</span>
        {/if}
      </button>

      {#if showDeadlinePicker}
        <div class="task-create__dropdown">
          <DeadlinePicker
            timestamp={deadline}
            on:change={handleDeadlineChange}
          />
        </div>
      {/if}
    </div>
  </div>
</div>

<style lang="scss">
  .task-create {
    background: #ffffff;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
    border-radius: 16px;
    padding: 16px 20px;
    margin: 8px;
    position: relative;
    z-index: 10;

    &__title {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    &__check {
      width: 16px;
      height: 16px;
      border: 1.5px solid var(--b3-border-color);
      border-radius: 4px;
      flex-shrink: 0;
    }

    &__title-input {
      flex: 1;
      border: none;
      background: transparent;
      font-size: 15px;
      font-weight: 500;
      color: #1f2937;
      outline: none;
      padding: 4px 0;
      width: 100%;

      &::placeholder {
        color: #9ca3af;
      }
    }

    &__notes {
      margin-bottom: 12px;
      padding-left: 26px;
    }

    &__notes-input {
      width: 100%;
      border: none;
      background: transparent;
      font-size: 13px;
      color: #4b5563;
      outline: none;
      resize: none;
      overflow: hidden;
      min-height: 20px;
      line-height: 1.5;

      &::placeholder {
        color: #9ca3af;
      }
    }

    &__checklist {
      margin-bottom: 12px;
      padding-left: 26px;
    }

    &__actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    &__action-group {
      position: relative;
    }

    &__action-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border: none;
      background: transparent;
      cursor: pointer;
      color: var(--b3-theme-on-surface-light);
      font-size: 12px;
      border-radius: 4px;
      transition: all 0.2s;

      &:hover {
        background: var(--b3-theme-surface-light);
      }

      &.is-active {
        color: var(--b3-theme-primary);
      }
    }

    &__action-icon {
      font-size: 14px;
    }

    &__dropdown {
      position: absolute;
      top: 100%;
      left: 0;
      z-index: 100;
      background: var(--b3-theme-surface);
      border: 1px solid var(--b3-border-color);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      padding: 8px;
      margin-top: 4px;
    }
  }
</style>
