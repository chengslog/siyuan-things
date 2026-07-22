<script lang="ts">
  import { createEventDispatcher, onMount } from "svelte";
  import type { Task } from "@/types";
  import type { StoreManager } from "@/stores";
  import { formatRelativeDate, getTodayStart, getDaysFromNow } from "@/utils/date";

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
  let showTagPicker = false;
  let showChecklist = true;
  let showTimePicker = false;
  let tagSearchQuery = "";
  let formElement: HTMLElement;

  // 日期选择器状态 - 从今天开始显示一个月
  let today = new Date();
  let calendarMonth = today.getMonth();
  let calendarYear = today.getFullYear();

  // 时间选择器状态
  let selectedHour = 9;
  let selectedMinute = 0;

  // 选中的日期类型
  let selectedDateType: "today" | "tonight" | "someday" | "custom" | "reminder" | null = null;

  // 输入框引用
  let titleInput: HTMLInputElement;

  onMount(() => {
    if (defaultView === "today") {
      startDate = getTodayStart();
      selectedDateType = "today";
    }
    setTimeout(() => titleInput?.focus(), 100);
  });

  // 获取标签列表
  $: allTags = store.tags.getAll();
  $: filteredTags = tagSearchQuery
    ? allTags.filter(t => t.name.toLowerCase().includes(tagSearchQuery.toLowerCase()))
    : allTags;

  // 日期显示文本
  $: startDateText = startDate ? formatRelativeDate(startDate) : "今天";

  // 格式化日期为 YYYY-MM-DD
  function formatDateShort(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // 格式化时间为 HH:MM
  function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  // 是否有时间设置（非0点）
  function hasTime(timestamp: number): boolean {
    const date = new Date(timestamp);
    return date.getHours() !== 0 || date.getMinutes() !== 0;
  }

  // 日历数据 - 从今天开始显示一个月
  $: calendarDays = generateCalendar(calendarYear, calendarMonth);

  function generateCalendar(year: number, month: number) {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();

    // 周一开始 (0=周日, 1=周一, ..., 6=周六)
    let startWeekday = firstDay.getDay();
    if (startWeekday === 0) startWeekday = 7; // 周日放到最后
    startWeekday = startWeekday - 1; // 转换为周一为0

    const days = [];

    // 上个月的日期
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startWeekday - 1; i >= 0; i--) {
      days.push({
        day: prevMonthLastDay - i,
        month: month - 1,
        year: month === 0 ? year - 1 : year,
        isCurrentMonth: false,
      });
    }

    // 本月的日期
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({
        day: i,
        month,
        year,
        isCurrentMonth: true,
      });
    }

    // 下个月的日期 (补齐到42天，6行)
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      days.push({
        day: i,
        month: month + 1,
        year: month === 11 ? year + 1 : year,
        isCurrentMonth: false,
      });
    }

    return days;
  }

  function prevMonth() {
    if (calendarMonth === 0) {
      calendarMonth = 11;
      calendarYear--;
    } else {
      calendarMonth--;
    }
  }

  function nextMonth() {
    if (calendarMonth === 11) {
      calendarMonth = 0;
      calendarYear++;
    } else {
      calendarMonth++;
    }
  }

  function selectCalendarDay(day: any) {
    const date = new Date(day.year, day.month, day.day);
    date.setHours(0, 0, 0, 0);
    startDate = date.getTime();
    selectedDateType = "custom";
    showDatePicker = false;
  }

  function isToday(day: any): boolean {
    return day.day === today.getDate() &&
           day.month === today.getMonth() &&
           day.year === today.getFullYear();
  }

  function isSelected(day: any): boolean {
    if (!startDate) return false;
    const selected = new Date(startDate);
    return day.day === selected.getDate() &&
           day.month === selected.getMonth() &&
           day.year === selected.getFullYear();
  }

  // 日期快捷选项
  function handleDateQuickOption(option: string) {
    switch (option) {
      case "today":
        startDate = getTodayStart();
        selectedDateType = "today";
        showDatePicker = false;
        break;
      case "tonight": {
        const tonight = new Date();
        tonight.setHours(18, 0, 0, 0);
        startDate = tonight.getTime();
        selectedDateType = "tonight";
        showDatePicker = false;
        break;
      }
      case "someday":
        startDate = undefined;
        selectedDateType = "someday";
        showDatePicker = false;
        break;
      case "reminder":
        // 展开时间选择器
        showTimePicker = !showTimePicker;
        break;
    }
  }

  // 时间选择
  function applyTime() {
    if (startDate) {
      const date = new Date(startDate);
      date.setHours(selectedHour, selectedMinute, 0, 0);
      startDate = date.getTime();
    } else {
      // 如果没有选择日期，默认今天
      const date = new Date();
      date.setHours(selectedHour, selectedMinute, 0, 0);
      startDate = date.getTime();
    }
    selectedDateType = "reminder";
    showTimePicker = false;
    showDatePicker = false;
  }

  // 小时选项 0-23
  const hourOptions = Array.from({ length: 24 }, (_, i) => i);

  // 分钟选项 0, 5, 10, 15, ..., 55
  const minuteOptions = Array.from({ length: 12 }, (_, i) => i * 5);

  function toggleTag(tagId: string) {
    const index = selectedTags.indexOf(tagId);
    if (index >= 0) {
      selectedTags = selectedTags.filter(id => id !== tagId);
    } else {
      selectedTags = [...selectedTags, tagId];
    }
  }

  // 更新检查项
  function updateChecklistItem(id: string, title: string) {
    checklist = checklist.map(item =>
      item.id === id ? { ...item, title } : item
    );

    // 如果最后一个检查项有内容了，添加新的空检查项
    const lastItem = checklist[checklist.length - 1];
    if (lastItem && lastItem.title.trim()) {
      checklist = [...checklist, { id: Date.now().toString(), title: "", completed: false }];
    }
  }

  function removeChecklistItem(id: string) {
    checklist = checklist.filter(item => item.id !== id);
    // 确保至少有一个空检查项
    if (checklist.length === 0) {
      checklist = [{ id: Date.now().toString(), title: "", completed: false }];
    }
  }

  function toggleChecklistItem(id: string) {
    checklist = checklist.map(item =>
      item.id === id ? { ...item, completed: !item.completed } : item
    );
  }

  // 检查是否有内容
  function hasContent(): boolean {
    if (title.trim()) return true;
    if (notes.trim()) return true;
    if (checklist.some(item => item.title.trim())) return true;
    return false;
  }

  // 自动保存（焦点移出时）
  function handleBlur(e: FocusEvent) {
    // 检查焦点是否移到了表单外
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
      // 如果标题为空但有检查项，用第一个检查项作为标题
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

    // 创建检查项（过滤空的）
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
    selectedDateType = defaultView === "today" ? "today" : null;

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

  // 点击外部关闭下拉菜单
  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.task-create__action-group')) {
      showDatePicker = false;
      showTagPicker = false;
      showTimePicker = false;
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
      {#each checklist as item (item.id)}
        <div class="task-create__checklist-item">
          <button
            class="task-create__checklist-check"
            class:is-done={item.completed}
            on:click={() => toggleChecklistItem(item.id)}
          >
            {#if item.completed}
              <svg><use xlink:href="#iconCheck" /></svg>
            {:else}
              <svg><use xlink:href="#iconCircle" /></svg>
            {/if}
          </button>
          <input
            type="text"
            class="task-create__checklist-input"
            class:is-done={item.completed}
            placeholder="检查项"
            value={item.title}
            on:input={(e) => updateChecklistItem(item.id, e.currentTarget.value)}
          />
          {#if item.title || checklist.length > 1}
            <button
              class="task-create__checklist-remove"
              on:click={() => removeChecklistItem(item.id)}
            >
              ×
            </button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <!-- 属性栏 -->
  <div class="task-create__actions">
    <!-- 日期选择 -->
    <div class="task-create__action-group" on:click|stopPropagation>
      <button
        class="task-create__action-btn"
        class:is-active={startDate || selectedDateType === "someday"}
        on:click={() => { showDatePicker = !showDatePicker; showTagPicker = false; }}
      >
        {#if selectedDateType === "someday"}
          <span class="task-create__action-icon">💭</span>
          <span>某天</span>
        {:else if startDate && hasTime(startDate)}
          <span class="task-create__action-icon">🗓</span>
          <span>{formatDateShort(startDate)} 🔔 {formatTime(startDate)}</span>
        {:else if startDate}
          <span class="task-create__action-icon">🗓</span>
          <span>{formatDateShort(startDate)}</span>
        {:else}
          <span class="task-create__action-icon">⭐</span>
          <span>今天</span>
        {/if}
      </button>

      {#if showDatePicker}
        <div class="task-create__dropdown task-create__dropdown--date">
          <!-- 今天 -->
          <button
            class="task-create__date-option"
            class:is-selected={selectedDateType === "today"}
            on:click={() => handleDateQuickOption("today")}
          >
            <span class="task-create__date-icon">⭐</span>
            <span class="task-create__date-label">今天</span>
            {#if selectedDateType === "today"}
              <span class="task-create__date-check">✓</span>
            {/if}
          </button>

          <!-- 今晚 -->
          <button
            class="task-create__date-option"
            class:is-selected={selectedDateType === "tonight"}
            on:click={() => handleDateQuickOption("tonight")}
          >
            <span class="task-create__date-icon">🌙</span>
            <span class="task-create__date-label">今晚</span>
            {#if selectedDateType === "tonight"}
              <span class="task-create__date-check">✓</span>
            {/if}
          </button>

          <!-- 日历 -->
          <div class="task-create__calendar">
            <div class="task-create__calendar-header">
              <button class="task-create__calendar-nav" on:click={prevMonth}>‹</button>
              <span class="task-create__calendar-title">{calendarYear}年{calendarMonth + 1}月</span>
              <button class="task-create__calendar-nav" on:click={nextMonth}>›</button>
            </div>
            <div class="task-create__calendar-weekdays">
              <span>一</span>
              <span>二</span>
              <span>三</span>
              <span>四</span>
              <span>五</span>
              <span>六</span>
              <span>日</span>
            </div>
            <div class="task-create__calendar-days">
              {#each calendarDays as day}
                <button
                  class="task-create__calendar-day"
                  class:is-other-month={!day.isCurrentMonth}
                  class:is-today={isToday(day)}
                  class:is-selected={isSelected(day)}
                  on:click={() => selectCalendarDay(day)}
                >
                  {day.day}
                </button>
              {/each}
            </div>
          </div>

          <!-- 某天 -->
          <button
            class="task-create__date-option"
            class:is-selected={selectedDateType === "someday"}
            on:click={() => handleDateQuickOption("someday")}
          >
            <span class="task-create__date-icon">💭</span>
            <span class="task-create__date-label">某天</span>
            {#if selectedDateType === "someday"}
              <span class="task-create__date-check">✓</span>
            {/if}
          </button>

          <div class="task-create__date-separator"></div>

          <!-- 添加提醒 -->
          <button
            class="task-create__date-option"
            class:is-selected={selectedDateType === "reminder"}
            on:click={() => handleDateQuickOption("reminder")}
          >
            <span class="task-create__date-icon">🔔</span>
            <span class="task-create__date-label">添加提醒</span>
            {#if selectedDateType === "reminder"}
              <span class="task-create__date-check">✓</span>
            {/if}
          </button>

          <!-- 时间选择器（展开） -->
          {#if showTimePicker}
            <div class="task-create__time-picker">
              <div class="task-create__time-scrolls">
                <div class="task-create__time-scroll">
                  <div class="task-create__time-label">时</div>
                  <div class="task-create__time-options">
                    {#each hourOptions as hour}
                      <button
                        class="task-create__time-option"
                        class:is-selected={selectedHour === hour}
                        on:click={() => selectedHour = hour}
                      >
                        {hour.toString().padStart(2, '0')}
                      </button>
                    {/each}
                  </div>
                </div>
                <div class="task-create__time-separator">:</div>
                <div class="task-create__time-scroll">
                  <div class="task-create__time-label">分</div>
                  <div class="task-create__time-options">
                    {#each minuteOptions as minute}
                      <button
                        class="task-create__time-option"
                        class:is-selected={selectedMinute === minute}
                        on:click={() => selectedMinute = minute}
                      >
                        {minute.toString().padStart(2, '0')}
                      </button>
                    {/each}
                  </div>
                </div>
              </div>
              <div class="task-create__time-actions">
                <button class="task-create__time-btn" on:click={() => showTimePicker = false}>取消</button>
                <button class="task-create__time-btn task-create__time-btn--primary" on:click={applyTime}>确定</button>
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- 标签选择 -->
    <div class="task-create__action-group" on:click|stopPropagation>
      <button
        class="task-create__action-btn"
        class:is-active={selectedTags.length > 0}
        on:click={() => { showTagPicker = !showTagPicker; showDatePicker = false; }}
      >
        <span class="task-create__action-icon">🏷</span>
        <span>{selectedTags.length > 0 ? `${selectedTags.length}个标签` : ''}</span>
      </button>

      {#if showTagPicker}
        <div class="task-create__dropdown task-create__dropdown--tags">
          <div class="task-create__tag-search">
            <input
              type="text"
              class="b3-text-field fn__block"
              placeholder="搜索标签..."
              bind:value={tagSearchQuery}
            />
          </div>
          <div class="task-create__tag-list">
            {#each filteredTags as tag}
              <button
                class="task-create__tag-item"
                class:is-selected={selectedTags.includes(tag.id)}
                on:click={() => toggleTag(tag.id)}
              >
                <span class="task-create__tag-check">
                  {#if selectedTags.includes(tag.id)}✓{/if}
                </span>
                <span>{tag.name}</span>
              </button>
            {:else}
              <div class="task-create__tag-empty">暂无标签</div>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <!-- 检查清单 -->
    <button
      class="task-create__action-btn"
      class:is-active={showChecklist}
      on:click={() => showChecklist = !showChecklist}
    >
      <span class="task-create__action-icon">☷</span>
    </button>
  </div>
</div>

<style lang="scss">
  .task-create {
    background: var(--b3-theme-surface);
    border: 1px solid var(--b3-border-color);
    border-radius: 8px;
    padding: 12px;
    margin: 8px;

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
      padding: 4px 0;

      &::placeholder {
        color: #9ca3af;
      }
    }

    &__checklist {
      margin-bottom: 12px;
      padding-left: 26px;
    }

    &__checklist-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
      font-size: 13px;

      .is-done {
        text-decoration: line-through;
        color: var(--b3-theme-on-surface-light);
      }
    }

    &__checklist-check {
      width: 16px;
      height: 16px;
      padding: 0;
      border: 1.5px solid var(--b3-border-color);
      border-radius: 50%;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;

      svg {
        width: 10px;
        height: 10px;
      }

      &.is-done {
        background: var(--b3-theme-primary);
        border-color: var(--b3-theme-primary);
        color: var(--b3-theme-on-primary);
      }
    }

    &__checklist-remove {
      margin-left: auto;
      width: 20px;
      height: 20px;
      border: none;
      background: transparent;
      cursor: pointer;
      color: var(--b3-theme-on-surface-light);
      font-size: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;

      &:hover {
        background: var(--b3-theme-surface-light);
        color: var(--b3-theme-error);
      }
    }

    &__checklist-add {
      margin-top: 4px;
    }

    &__checklist-input {
      width: 100%;
      border: none;
      background: transparent;
      font-size: 13px;
      outline: none;
      padding: 4px 0;
      color: #1f2937;

      &::placeholder {
        color: #9ca3af;
      }
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
      min-width: 150px;
      background: var(--b3-theme-surface);
      border: 1px solid var(--b3-border-color);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      padding: 8px;
      margin-top: 4px;

      &--date {
        width: 280px;
      }

      &--tags {
        width: 200px;
        max-height: 250px;
        display: flex;
        flex-direction: column;
      }
    }

    // 日期选项
    &__date-option {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 8px 12px;
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 13px;
      text-align: left;
      color: var(--b3-theme-on-surface);
      border-radius: 4px;

      &:hover {
        background: var(--b3-theme-surface-light);
      }

      &.is-selected {
        color: var(--b3-theme-primary);
      }
    }

    &__date-icon {
      width: 20px;
      text-align: center;
    }

    &__date-label {
      flex: 1;
    }

    &__date-check {
      color: var(--b3-theme-primary);
      font-weight: 600;
    }

    &__date-separator {
      height: 1px;
      background: var(--b3-border-color);
      margin: 4px 0;
    }

    // 日历
    &__calendar {
      margin: 8px 0;
    }

    &__calendar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 0;
      margin-bottom: 8px;
    }

    &__calendar-title {
      font-size: 13px;
      font-weight: 500;
    }

    &__calendar-nav {
      width: 28px;
      height: 28px;
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 18px;
      color: var(--b3-theme-on-surface);
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;

      &:hover {
        background: var(--b3-theme-surface-light);
      }
    }

    &__calendar-weekdays {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 2px;
      margin-bottom: 4px;

      span {
        text-align: center;
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        padding: 4px;
      }
    }

    &__calendar-days {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 2px;
    }

    &__calendar-day {
      width: 32px;
      height: 32px;
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 12px;
      color: var(--b3-theme-on-surface);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto;

      &:hover {
        background: var(--b3-theme-surface-light);
      }

      &.is-other-month {
        color: var(--b3-theme-on-surface-light);
        opacity: 0.5;
      }

      &.is-today {
        font-weight: 600;
        color: var(--b3-theme-primary);
      }

      &.is-selected {
        background: var(--b3-theme-primary);
        color: var(--b3-theme-on-primary);
      }
    }

    // 时间选择器
    &__time-picker {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--b3-border-color);
    }

    &__time-scrolls {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-bottom: 12px;
    }

    &__time-scroll {
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    &__time-label {
      font-size: 11px;
      color: var(--b3-theme-on-surface-light);
      margin-bottom: 4px;
    }

    &__time-options {
      height: 120px;
      overflow-y: auto;
      width: 60px;
      border: 1px solid var(--b3-border-color);
      border-radius: 6px;
      scrollbar-width: thin;
    }

    &__time-separator {
      font-size: 24px;
      font-weight: 600;
      padding-bottom: 20px;
    }

    &__time-option {
      display: block;
      width: 100%;
      padding: 6px;
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 14px;
      text-align: center;
      color: var(--b3-theme-on-surface);

      &:hover {
        background: var(--b3-theme-surface-light);
      }

      &.is-selected {
        background: var(--b3-theme-primary);
        color: var(--b3-theme-on-primary);
        font-weight: 600;
      }
    }

    &__time-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    &__time-btn {
      padding: 6px 16px;
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 13px;
      color: var(--b3-theme-on-surface);
      border-radius: 4px;

      &:hover {
        background: var(--b3-theme-surface-light);
      }

      &--primary {
        background: var(--b3-theme-primary);
        color: var(--b3-theme-on-primary);

        &:hover {
          opacity: 0.9;
        }
      }
    }

    // 标签选择
    &__tag-search {
      padding: 4px;
      border-bottom: 1px solid var(--b3-border-color);

      input {
        font-size: 12px;
      }
    }

    &__tag-list {
      flex: 1;
      overflow-y: auto;
      max-height: 200px;
    }

    &__tag-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 6px 8px;
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 12px;
      color: var(--b3-theme-on-surface);
      border-radius: 4px;

      &:hover {
        background: var(--b3-theme-surface-light);
      }

      &.is-selected {
        color: var(--b3-theme-primary);
      }
    }

    &__tag-check {
      width: 16px;
      font-size: 12px;
    }

    &__tag-empty {
      padding: 12px;
      text-align: center;
      font-size: 12px;
      color: var(--b3-theme-on-surface-light);
    }

    &__submit {
      margin-left: auto;
      padding: 6px 16px;
      border: none;
      background: var(--b3-theme-primary);
      color: var(--b3-theme-on-primary);
      font-size: 13px;
      border-radius: 4px;
      cursor: pointer;
      transition: opacity 0.2s;

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      &:hover:not(:disabled) {
        opacity: 0.9;
      }
    }
  }
</style>
