<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount, tick } from "svelte";
  import { fade } from "svelte/transition";
  import type { Task } from "@/types";
  import type { StoreManager } from "@/stores";
  import { formatRelativeDate, isOverdue } from "@/utils/date";
  import { isTodayDate, isTomorrowDate, formatDateFull } from "@/utils/calendar";
  import DatePicker from "./DatePicker.svelte";
  import DeadlinePicker from "./DeadlinePicker.svelte";
  import TagPicker from "./TagPicker.svelte";
  import ProjectAreaPicker from "./ProjectAreaPicker.svelte";
  import Checklist from "./Checklist.svelte";
  import Icon from "@/icons/Icon.svelte";
  import { getStartDateDisplay, getDeadlineDisplay, getReminderDisplay } from "@/utils/display";

  // 模式：create 或 edit
  export let mode: 'create' | 'edit' = 'edit';
  // 编辑模式传入的任务
  export let task: Task | null = null;
  export let store: StoreManager;
  export let currentView: string = "inbox";
  // 当前视图上下文 id（项目/区域视图下新建任务时预置归属）
  export let currentViewId: string | undefined = undefined;
  export let isDragging: boolean = false;
  export let registerItem: (id: string, el: HTMLElement) => void = () => {};
  export let unregisterItem: (id: string) => void = () => {};
  // 日程行模式（计划视图中带具体时间的任务）：收缩态用时间列替换 checkbox、隐藏副标题/辅助信息；
  // 展开后恢复正常卡片形态（checkbox 回来，可勾选完成）
  export let scheduleMode: boolean = false;

  const dispatch = createEventDispatcher();

  let cardEl: HTMLElement;

  // 表单数据
  let title = "";
  let notes = "";
  let startDate: number | undefined = undefined;
  let deadline: number | undefined = undefined;
  let someday: boolean = false;
  let selectedTags: string[] = [];
  let projectId: string | undefined = undefined;
  let areaId: string | undefined = undefined;
  let checklist: Array<{ id: string; title: string; completed: boolean }> = [
    { id: "empty", title: "", completed: false }
  ];

  // UI 状态
  let expanded = mode === 'create'; // 新建模式默认展开
  let showDatePicker = false;
  let showDeadlinePicker = false;
  let showTagPicker = false;
  let showProjectAreaPicker = false;
  let showChecklist = true;
  let isInteracting = false;
  let isMovingOut = false;
  let titleInput: HTMLInputElement;

  // 拖拽状态
  let dragTimer: any = null;
  let isClick = true;

  // 初始化
  onMount(() => {
    // 监听其他卡片的展开事件，实现卡片互斥（展开一个时其他自动收起）
    window.addEventListener('card-expanded', handleCardExpanded as EventListener);
    if (mode === 'edit' && task) {
      title = task.title;
      notes = task.notes || "";
      startDate = task.startDate;
      deadline = task.deadline;
      someday = task.someday || false;
      selectedTags = [...(task.tags || [])];
      // 加载子任务到本地状态
      const subTasks = store.tasks.getSubTasks(task.id);
      if (subTasks.length > 0) {
        localChecklist = subTasks.map(t => ({
          id: t.id,
          title: t.title,
          completed: t.status === 'done'
        }));
      } else {
        localChecklist = [{ id: "empty", title: "", completed: false }];
      }
      // 注册元素
      if (cardEl) {
        registerItem(task.id, cardEl);
      }
    } else if (mode === 'create') {
      if (currentView === 'today') {
        startDate = getTodayStart();
      }
      // 项目/区域视图里新建的任务预置归属
      if (currentView === 'project' && currentViewId) projectId = currentViewId;
      if (currentView === 'area' && currentViewId) areaId = currentViewId;
      setTimeout(() => titleInput?.focus(), 100);
    }
  });

  onDestroy(() => {
    window.removeEventListener('card-expanded', handleCardExpanded as EventListener);
    if (mode === 'edit' && task) {
      unregisterItem(task.id);
    }
    if (moveTimeout) clearTimeout(moveTimeout);
    // 若组件在完成延迟结束前被销毁（如切换视图），立即完成任务，避免丢失用户的勾选操作
    if (pendingDone && !completionApplied && task) {
      store.tasks.toggleTask(task.id);
    }
  });

  // 卡片互斥：其他卡片展开时，收起当前卡片
  function handleCardExpanded(e: CustomEvent) {
    const { cardId } = e.detail;
    if (mode === 'edit' && task && cardId !== task.id && expanded) {
      saveAndCollapse();
    }
  }

  // 辅助函数
  function getTodayStart(): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today.getTime();
  }

  // 响应式数据
  $: tags = mode === 'edit' && task ? task.tags.map((id) => store.tags.get(id)).filter(Boolean) : [];
  $: isDeadlineOverdue = mode === 'edit' && task?.deadline && isOverdue(task.deadline);

  // 编辑模式：本地维护检查清单状态，避免 store 更新导致重置
  let localChecklist: Array<{ id: string; title: string; completed: boolean }> = [];
  $: checklistItems = mode === 'edit' ? localChecklist : checklist;

  // 收缩态：标题下方的所属项目/区域名
  $: subtitle = getSubtitle(mode, task);
  // 收缩态：检查清单条数（用于右侧辅助图标）
  $: checklistCount = (mode === 'edit' ? localChecklist : checklist).filter(i => i.title && i.title.trim()).length;

  function getSubtitle(mode: 'create' | 'edit', task: Task | null): string {
    if (mode !== 'edit' || !task) return "";
    if (task.projectId) {
      const p = store.projects.get(task.projectId);
      if (p) return p.name;
    }
    if (task.areaId) {
      const a = store.areas.get(task.areaId);
      if (a) return a.name;
    }
    return "";
  }

  // 日程行的时间列：HH:mm
  function formatTime(ts?: number): string {
    if (!ts) return "";
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  }

  // 日期显示
  // 注意：必须把响应式变量作为参数显式传入。Svelte 的 $: 不会穿透函数调用追踪依赖，
  // 若写成无参调用，只会在组件初始化时计算一次，设置/清除日期后胶囊不会刷新。
  // 展示逻辑统一在 utils/display.ts：返回 { icon: symbolId, text, color? }，模板用 <Icon> 渲染。
  $: resolvedStartDate = mode === 'edit' && task ? task.startDate : startDate;
  $: resolvedSomeday = mode === 'edit' && task ? !!task.someday : someday;
  $: resolvedDeadline = mode === 'edit' && task ? task.deadline : deadline;
  $: dateDisplay = getStartDateDisplay(resolvedStartDate, resolvedSomeday, currentView);
  $: dateReminderDisplay = resolvedSomeday ? null : getReminderDisplay(resolvedStartDate);
  $: deadlineDisplay = getDeadlineDisplay(resolvedDeadline);
  $: deadlineReminderDisplay = getReminderDisplay(resolvedDeadline);

  // 项目/区域归属（编辑模式取 task，新建模式取本地状态）
  $: assignment = getAssignment(mode, task, projectId, areaId);
  $: assignmentProject = getAssignmentProject(store, assignment.projectId);
  $: assignmentArea = getAssignmentArea(store, assignment.areaId);

  function getAssignment(mode: 'create' | 'edit', task: Task | null, pid: string | undefined, aid: string | undefined) {
    return {
      projectId: mode === 'edit' && task ? task.projectId : pid,
      areaId: mode === 'edit' && task ? task.areaId : aid,
    };
  }

  function getAssignmentProject(store: StoreManager, id: string | undefined) {
    return id ? store.projects.get(id) : undefined;
  }

  function getAssignmentArea(store: StoreManager, id: string | undefined) {
    return id ? store.areas.get(id) : undefined;
  }

  // 项目/区域变更
  async function handleProjectAreaChange(e: CustomEvent) {
    const pid = e.detail.projectId as string | undefined;
    const aid = e.detail.areaId as string | undefined;
    if (mode === 'create') {
      projectId = pid;
      areaId = aid;
    } else if (task) {
      await applyChangeWithAnimation({ projectId: pid, areaId: aid });
    }
    showProjectAreaPicker = false;
  }

  function clearAssignment() {
    handleProjectAreaChange(new CustomEvent("x", { detail: { projectId: undefined, areaId: undefined } }));
  }

  function toggleProjectAreaPicker() {
    showProjectAreaPicker = !showProjectAreaPicker;
    showDatePicker = false;
    showDeadlinePicker = false;
    showTagPicker = false;
  }

  // 卡片点击
  function handleCardClick(e?: Event) {
    if (mode === 'create') return; // 新建模式不需要展开/折叠

    const target = e?.target as HTMLElement | undefined;

    // 弹窗打开时：卡片内任何点击（弹窗自身除外，其内部已 stopPropagation）先关弹窗，
    // 不触发展开/折叠。修复"打开日期选择器后点卡片空白处弹窗不消失"。
    const hasOpenDropdown = showDatePicker || showDeadlinePicker || showTagPicker || showProjectAreaPicker;
    if (hasOpenDropdown && (!target || !target.closest('.task-card__dropdown'))) {
      showDatePicker = false;
      showDeadlinePicker = false;
      showTagPicker = false;
      showProjectAreaPicker = false;
      return;
    }

    if (target) {
      if (target.closest('.task-card__toolbar') ||
          target.closest('.task-card__action-group') ||
          target.closest('.task-card__dropdown') ||
          target.closest('.task-card__check') ||
          target.closest('input') ||
          target.closest('textarea') ||
          target.closest('.checklist')) {
        return;
      }
    }

    expanded = !expanded;
    if (expanded && task) {
      title = task.title;
      notes = task.notes || "";
      window.dispatchEvent(new CustomEvent('card-expanded', { detail: { cardId: task.id } }));
      setTimeout(() => {
        document.addEventListener('click', handleOutsideClick);
      }, 10);
    } else {
      document.removeEventListener('click', handleOutsideClick);
    }
  }

  // 点击外部关闭
  function handleOutsideClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const card = target.closest('.task-card');
    if (!card || (task && card.dataset.taskId !== task.id)) {
      showDatePicker = false;
      showDeadlinePicker = false;
      showTagPicker = false;
      saveAndCollapse();
    }
  }

  // 保存并折叠
  async function saveAndCollapse() {
    if (mode === 'edit' && task) {
      await saveTitle();
      await saveNotes();
      expanded = false;
    }
    document.removeEventListener('click', handleOutsideClick);
  }

  // 保存标题
  async function saveTitle() {
    if (task && title !== task.title) {
      await store.tasks.updateTask(task.id, { title });
    }
  }

  // 保存备注
  async function saveNotes() {
    if (task && notes !== (task.notes || "")) {
      await store.tasks.updateTask(task.id, { notes });
    }
  }

  // 切换完成状态
  let moveTimeout: any = null;
  let isMoving = false;
  let pendingDone = false;        // 本地预显示“已完成”状态（勾选框打勾）
  let completionApplied = false;  // 完成操作是否已写入 store

  async function handleToggle(e: Event) {
    e.stopPropagation();
    if (!task) return;

    if (task.status === "done") {
      // 取消完成
      await store.tasks.toggleTask(task.id);
      await store.tasks.updateTask(task.id, { completedDate: undefined });
    } else {
      // 完成：先本地显示打勾 + 置灰，3 秒后才真正写入 store（移入日志）
      pendingDone = true;
      completionApplied = false;
      isMoving = true;
      moveTimeout = setTimeout(async () => {
        completionApplied = true;
        await store.tasks.toggleTask(task.id);
        pendingDone = false;
        isMoving = false;
      }, 3000);
    }
  }

  // 删除任务
  async function handleDelete(e: Event) {
    e.stopPropagation();
    if (task) {
      await store.tasks.delete(task.id);
    }
  }

  // 添加子任务
  async function addSubTask() {
    if (mode === 'create') {
      // 新建模式：显示检查清单并追加空项
      showChecklist = true;
      checklist = [...checklist, { id: Date.now().toString(), title: "", completed: false }];
    } else if (task) {
      // 编辑模式：追加到本地检查清单（编辑/失焦时同步到 store），确保新项立即可见
      localChecklist = [...localChecklist, { id: Date.now().toString(), title: "", completed: false }];
    }
  }

  // 日期变化
  async function handleDateChange(e: CustomEvent) {
    if (mode === 'create') {
      startDate = e.detail.timestamp;
      someday = e.detail.someday || false;
    } else if (task) {
      await applyChangeWithAnimation({ startDate: e.detail.timestamp, someday: e.detail.someday || false });
    }
    showDatePicker = false;
  }

  // 截止日期变化
  async function handleDeadlineChange(e: CustomEvent) {
    if (mode === 'create') {
      deadline = e.detail.timestamp;
    } else if (task) {
      await applyChangeWithAnimation({ deadline: e.detail.timestamp });
    }
    showDeadlinePicker = false;
  }

  // 标签变化
  async function handleTagChange(e: CustomEvent) {
    if (mode === 'create') {
      selectedTags = e.detail.tags;
    } else if (task) {
      await applyChangeWithAnimation({ tags: e.detail.tags });
    }
    showTagPicker = false;
  }

  // 检查清单变化
  async function handleChecklistChange(e: CustomEvent) {
    const { items: newItems } = e.detail;
    if (!newItems) return;

    if (mode === 'create') {
      checklist = newItems;
    } else if (task) {
      // 更新本地状态（保留空项）
      localChecklist = [...newItems];

      // 同步到 store
      const currentSubTasks = store.tasks.getSubTasks(task.id);
      for (const newItem of newItems) {
        const oldItem = currentSubTasks.find(t => t.id === newItem.id);
        if (oldItem) {
          if (oldItem.title !== newItem.title || (oldItem.status === 'done') !== newItem.completed) {
            await store.tasks.updateTask(newItem.id, {
              title: newItem.title,
              status: newItem.completed ? 'done' : 'todo'
            });
          }
        } else {
          if (newItem.title.trim()) {
            await store.tasks.createTask({
              title: newItem.title,
              parentId: task.id,
              status: newItem.completed ? 'done' : 'todo'
            });
          }
        }
      }
      for (const oldItem of currentSubTasks) {
        if (!newItems.find((n: any) => n.id === oldItem.id)) {
          await store.tasks.delete(oldItem.id);
        }
      }
    }
  }

  // 清除日期
  async function clearStartDate() {
    if (mode === 'create') {
      startDate = undefined;
      someday = false;
    } else if (task) {
      await applyChangeWithAnimation({ startDate: undefined, someday: false });
    }
  }

  // 清除标签
  async function clearTags() {
    if (mode === 'create') {
      selectedTags = [];
    } else if (task) {
      await applyChangeWithAnimation({ tags: [] });
    }
  }

  // 清除截止日期
  async function clearDeadline() {
    if (mode === 'create') {
      deadline = undefined;
    } else if (task) {
      await applyChangeWithAnimation({ deadline: undefined });
    }
  }

  // 判断给定变更是否会使任务移出当前视图（基于当前任务与变更的合并结果）
  function willChangeCauseMove(changes: Partial<Task>): boolean {
    if (!task) return false;

    const merged = { ...task, ...changes };

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const todayEndTs = todayEnd.getTime();

    let targetView = 'inbox';
    if (merged.someday) {
      targetView = 'someday';
    } else if (merged.startDate) {
      targetView = merged.startDate <= todayEndTs ? 'today' : 'upcoming';
    } else if (merged.projectId || merged.areaId || (merged.tags && merged.tags.length > 0)) {
      targetView = 'anytime';
    }

    return targetView !== currentView;
  }

  // 应用变更：若会导致视图迁移，先播放置灰动画再写入 store（列表移除的滑出动画由 TaskList 的 outro 负责）
  async function applyChangeWithAnimation(changes: Partial<Task>) {
    if (!task) return;

    if (willChangeCauseMove(changes)) {
      isMovingOut = true;   // 置灰
      expanded = false;     // 收起卡片
      await new Promise(resolve => setTimeout(resolve, 300)); // 等待置灰动画
      await store.tasks.updateTask(task.id, changes); // 写入 store → 任务移出当前视图 → outro 滑出
      isMovingOut = false;
    } else {
      await store.tasks.updateTask(task.id, changes);
    }
  }

  // 拖拽处理
  function handleMouseDown(e: MouseEvent) {
    if (mode === 'create') return;
    if (e.button !== 0) return;
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

  function handleMouseUp(e: MouseEvent) {
    if (mode === 'create') return;
    if (dragTimer) {
      clearTimeout(dragTimer);
      dragTimer = null;
    }
    if (isClick) {
      handleCardClick(e);
    }
    isClick = true;
  }

  // 创建任务
  // 防重入：回车触发后是一串异步写库，期间失焦/再次回车可能再触发一次，
  // 重置又发生在首次创建完成之后——两次并发会造出同名重复任务，
  // 检查项全挂到第一个任务上，用户看到的第二个就是"检查项没了"。
  let isCreating = false;
  async function handleCreate() {
    if (isCreating) return;
    isCreating = true;
    try {
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
        someday,
        tags: selectedTags,
        projectId,
        areaId,
      };

      if (currentView === "today" && !startDate) {
        taskData.startDate = getTodayStart();
      }

      const newTask = await store.tasks.createTask(taskData);

      for (const item of checklist) {
        if (item.title.trim()) {
          await store.tasks.createTask({
            title: item.title,
            parentId: newTask.id,
            status: item.completed ? "done" : "todo",
          });
        }
      }

      dispatch("created", { task: newTask });

      // 重置
      title = "";
      notes = "";
      startDate = currentView === "today" ? getTodayStart() : undefined;
      deadline = undefined;
      someday = false;
      selectedTags = [];
      projectId = currentView === "project" ? currentViewId : undefined;
      areaId = currentView === "area" ? currentViewId : undefined;
      checklist = [{ id: "empty", title: "", completed: false }];
      titleInput?.focus();
    } finally {
      isCreating = false;
    }
  }

  // 键盘事件
  function handleKeydown(e: KeyboardEvent) {
    if (mode !== 'create') return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleCreate();
    }
    if (e.key === "Escape") {
      dispatch("cancel");
    }
  }

  // 焦点丢失
  function handleBlur(e: FocusEvent) {
    if (mode !== 'create' || isInteracting) return;
    setTimeout(() => {
      const activeElement = document.activeElement;
      if (cardEl && !cardEl.contains(activeElement)) {
        const hasContent = title.trim() || notes.trim() || checklist.some(item => item.title.trim());
        if (hasContent) {
          handleCreate();
        } else {
          dispatch("cancel");
        }
      }
    }, 100);
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div
  class="task-card"
  class:is-create={mode === 'create'}
  class:is-edit={mode === 'edit'}
  class:is-done={task?.status === "done"}
  class:is-expanded={expanded}
  class:is-moving={isMoving}
  class:is-dragging={isDragging}
  class:is-moving-out={isMovingOut}
  data-task-id={task?.id}
  bind:this={cardEl}
  on:mousedown={handleMouseDown}
  on:mouseup={handleMouseUp}
  on:focusout={mode === 'create' ? handleBlur : undefined}
>
  <!-- 标题区域 -->
  <div class="task-card__header">
    <!-- 复选框（日程行收缩态显示时间列，展开后换回复选框以便勾选） -->
    {#if mode === 'edit'}
      {#if scheduleMode && !expanded}
        <span class="task-card__schedule-time">{formatTime(task?.startDate)}</span>
      {:else}
        <button
          class="task-card__check"
          class:is-checked={task?.status === "done" || pendingDone}
          on:click={handleToggle}
        >
          {#if task?.status === "done" || pendingDone}
            <svg><use xlink:href="#iconThingsCheck" /></svg>
          {/if}
        </button>
      {/if}
    {:else}
      <span class="task-card__check-placeholder"></span>
    {/if}

    <!-- 标题 -->
    {#if mode === 'create' || expanded}
      <input
        bind:this={titleInput}
        type="text"
        class="task-card__title-input"
        placeholder={mode === 'create' ? "新建待办事项" : "任务标题"}
        bind:value={title}
        on:blur={mode === 'create' ? undefined : saveTitle}
        on:keydown={handleKeydown}
        on:click|stopPropagation
      />
    {:else}
      <div class="task-card__info">
        <div class="task-card__title" class:is-done={task?.status === "done" || pendingDone}>
          {task?.title}
        </div>
        {#if subtitle && !scheduleMode}
          <div class="task-card__subtitle">{subtitle}</div>
        {/if}
      </div>

      <!-- 右侧辅助信息（收缩态，弱化显示；日程行只保留时间+标题，不显示） -->
      {#if !scheduleMode}
        <div class="task-card__aux">
          {#if task?.deadline}
            <span class="task-card__aux-item task-card__aux-deadline" class:is-overdue={isDeadlineOverdue}>
              <Icon name="iconThingsFlag" size={12} />
              <span>{formatRelativeDate(task.deadline)}</span>
            </span>
          {/if}
          {#if checklistCount > 0}
            <span class="task-card__aux-item" title="检查清单"><Icon name="iconThingsChecklist" size={12} />{checklistCount}</span>
          {/if}
          {#if task?.notes}
            <span class="task-card__aux-item" title="备注"><Icon name="iconThingsNote" size={12} /></span>
          {/if}
          {#if task?.tags && task.tags.length > 0}
            <span class="task-card__aux-item" title="标签">
              <Icon name="iconThingsTag" size={12} />
              {#if tags.length > 0}
                <span class="task-card__tag-pill">{tags[0].name}{tags.length > 1 ? ` +${tags.length - 1}` : ""}</span>
              {/if}
            </span>
          {/if}
        </div>
      {/if}
    {/if}
  </div>

  <!-- 展开详情 -->
  {#if expanded}
    <div class="task-card__details" on:click|stopPropagation transition:fade={{ duration: 150 }}>
      <!-- 备注 -->
      <textarea
        class="task-card__notes"
        bind:value={notes}
        on:blur={mode === 'edit' ? saveNotes : undefined}
        placeholder="添加备注..."
        rows="2"
      ></textarea>

      <!-- 标签 -->
      {#if mode === 'edit' && tags.length > 0}
        <div class="task-card__tags">
          {#each tags as tag}
            <span class="task-card__tag">{tag.name}</span>
          {/each}
        </div>
      {/if}

      <!-- 检查清单 -->
      <div class="task-card__subtasks">
        <Checklist
          items={checklistItems}
          showDragHandle={mode === 'edit'}
          on:change={handleChecklistChange}
        />
      </div>

      <!-- 工具栏 -->
      <div class="task-card__toolbar">
        <!-- 左侧：已设置项 -->
        <div class="task-card__toolbar-left">
          <!-- 日期 -->
          {#if dateDisplay}
            <div class="task-card__tag-item">
              <button
                class="task-card__tag-btn"
                on:click|stopPropagation={() => { showDatePicker = !showDatePicker; showDeadlinePicker = false; showTagPicker = false; showProjectAreaPicker = false; }}
              >
                <Icon name={dateDisplay.icon} size={12} color={dateDisplay.color || ""} />
                {#if dateDisplay.text}
                  <span>{dateDisplay.text}</span>
                {/if}
              </button>
              <button class="task-card__tag-remove" on:click|stopPropagation={clearStartDate}>×</button>

              {#if showDatePicker}
                <div class="task-card__dropdown">
                  <DatePicker
                    timestamp={mode === 'edit' && task ? task.startDate : startDate}
                    on:change={handleDateChange}
                    on:close={() => showDatePicker = false}
                  />
                </div>
              {/if}
            </div>
          {/if}

          <!-- 日期提醒 -->
          {#if dateReminderDisplay}
            <div class="task-card__tag-item task-card__tag-item--reminder">
              <Icon name={dateReminderDisplay.icon} size={12} />
              <span>{dateReminderDisplay.text}</span>
            </div>
          {/if}

          <!-- 标签 -->
          {#if mode === 'edit' && tags.length > 0}
            <div class="task-card__tag-item">
              <button
                class="task-card__tag-btn"
                on:click|stopPropagation={() => { showTagPicker = !showTagPicker; showDatePicker = false; showDeadlinePicker = false; showProjectAreaPicker = false; }}
              >
                <Icon name="iconThingsTag" size={12} />
                <span>{tags.map(t => t.name).join(', ')}</span>
              </button>
              <button class="task-card__tag-remove" on:click|stopPropagation={clearTags}>×</button>

              {#if showTagPicker}
                <div class="task-card__dropdown">
                  <TagPicker
                    store={store}
                    selectedTags={task?.tags || []}
                    on:change={handleTagChange}
                  />
                </div>
              {/if}
            </div>
          {/if}

          <!-- 截止日期 -->
          {#if deadlineDisplay}
            <div class="task-card__tag-item" class:is-overdue={isDeadlineOverdue}>
              <button
                class="task-card__tag-btn"
                on:click|stopPropagation={() => { showDeadlinePicker = !showDeadlinePicker; showDatePicker = false; showTagPicker = false; showProjectAreaPicker = false; }}
              >
                <Icon name={deadlineDisplay.icon} size={12} color="#dc2626" />
                <span>{deadlineDisplay.text}</span>
              </button>
              <button class="task-card__tag-remove" on:click|stopPropagation={clearDeadline}>×</button>

              {#if showDeadlinePicker}
                <div class="task-card__dropdown">
                  <DeadlinePicker
                    timestamp={mode === 'edit' && task ? task.deadline : deadline}
                    on:change={handleDeadlineChange}
                    on:close={() => showDeadlinePicker = false}
                  />
                </div>
              {/if}
            </div>
          {/if}

          <!-- 截止日期提醒 -->
          {#if deadlineReminderDisplay}
            <div class="task-card__tag-item task-card__tag-item--reminder">
              <Icon name={deadlineReminderDisplay.icon} size={12} />
              <span>{deadlineReminderDisplay.text}</span>
            </div>
          {/if}

          <!-- 项目/区域 -->
          {#if assignmentProject || assignmentArea}
            <div class="task-card__tag-item">
              <button
                class="task-card__tag-btn"
                on:click|stopPropagation={toggleProjectAreaPicker}
              >
                <Icon name={assignmentProject ? "iconThingsProject" : "iconThingsArea"} size={12} />
                <span>{assignmentProject ? assignmentProject.name : assignmentArea ? assignmentArea.name : ""}</span>
              </button>
              <button class="task-card__tag-remove" on:click|stopPropagation={clearAssignment}>×</button>

              {#if showProjectAreaPicker}
                <div class="task-card__dropdown">
                  <ProjectAreaPicker
                    store={store}
                    selectedProjectId={assignment.projectId}
                    selectedAreaId={assignment.areaId}
                    on:change={handleProjectAreaChange}
                    on:close={() => showProjectAreaPicker = false}
                  />
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- 右侧：功能按钮 -->
        <div class="task-card__toolbar-right">
          <!-- 日期（未设置时） -->
          {#if !dateDisplay}
            <div class="task-card__action-group">
              <button
                class="task-card__tool-btn"
                title="设置日期"
                on:click|stopPropagation={() => { showDatePicker = !showDatePicker; showDeadlinePicker = false; showTagPicker = false; showProjectAreaPicker = false; }}
              >
                <Icon name="iconThingsStar" size={16} />
              </button>

              {#if showDatePicker}
                <div class="task-card__dropdown task-card__dropdown--right">
                  <DatePicker
                    timestamp={mode === 'edit' && task ? task.startDate : startDate}
                    on:change={handleDateChange}
                    on:close={() => showDatePicker = false}
                  />
                </div>
              {/if}
            </div>
          {/if}

          <!-- 截止日期（未设置时） -->
          {#if !deadlineDisplay}
            <div class="task-card__action-group">
              <button
                class="task-card__tool-btn"
                title="设置截止日期"
                on:click|stopPropagation={() => { showDeadlinePicker = !showDeadlinePicker; showDatePicker = false; showTagPicker = false; showProjectAreaPicker = false; }}
              >
                <Icon name="iconThingsFlag" size={16} />
              </button>

              {#if showDeadlinePicker}
                <div class="task-card__dropdown task-card__dropdown--right">
                  <DeadlinePicker
                    timestamp={mode === 'edit' && task ? task.deadline : deadline}
                    on:change={handleDeadlineChange}
                    on:close={() => showDeadlinePicker = false}
                  />
                </div>
              {/if}
            </div>
          {/if}

          <!-- 检查清单（新建模式） -->
          {#if mode === 'create'}
            <button
              class="task-card__tool-btn"
              class:is-active={showChecklist}
              on:click={() => showChecklist = !showChecklist}
            >
              <Icon name="iconThingsSubtask" size={16} />
            </button>
          {:else}
            <button class="task-card__tool-btn" title="添加子任务" on:click|stopPropagation={addSubTask}>
              <Icon name="iconThingsSubtask" size={16} />
            </button>
          {/if}

          <!-- 标签（未设置时） -->
          {#if mode === 'edit' && tags.length === 0}
            <div class="task-card__action-group">
              <button
                class="task-card__tool-btn"
                title="标签"
                on:click|stopPropagation={() => { showTagPicker = !showTagPicker; showDatePicker = false; showDeadlinePicker = false; showProjectAreaPicker = false; }}
              >
                <Icon name="iconThingsTag" size={16} />
              </button>

              {#if showTagPicker}
                <div class="task-card__dropdown task-card__dropdown--right">
                  <TagPicker
                    store={store}
                    selectedTags={task?.tags || []}
                    on:change={handleTagChange}
                  />
                </div>
              {/if}
            </div>
          {:else if mode === 'create'}
            <div class="task-card__action-group">
              <button
                class="task-card__tool-btn"
                class:is-active={selectedTags.length > 0}
                title="标签"
                on:click|stopPropagation={() => { showTagPicker = !showTagPicker; showDatePicker = false; showDeadlinePicker = false; showProjectAreaPicker = false; }}
              >
                <Icon name="iconThingsTag" size={16} />
              </button>

              {#if showTagPicker}
                <div class="task-card__dropdown task-card__dropdown--right">
                  <TagPicker
                    store={store}
                    selectedTags={selectedTags}
                    on:change={handleTagChange}
                  />
                </div>
              {/if}
            </div>
          {/if}

          <!-- 项目/区域（未设置时） -->
          {#if !assignmentProject && !assignmentArea}
            <div class="task-card__action-group">
              <button
                class="task-card__tool-btn"
                title="项目与区域"
                on:click|stopPropagation={toggleProjectAreaPicker}
              >
                <Icon name="iconThingsProject" size={16} />
              </button>

              {#if showProjectAreaPicker}
                <div class="task-card__dropdown task-card__dropdown--right">
                  <ProjectAreaPicker
                    store={store}
                    selectedProjectId={assignment.projectId}
                    selectedAreaId={assignment.areaId}
                    on:change={handleProjectAreaChange}
                    on:close={() => showProjectAreaPicker = false}
                  />
                </div>
              {/if}
            </div>
          {/if}

          <!-- 删除（编辑模式） -->
          {#if mode === 'edit'}
            <button class="task-card__tool-btn task-card__tool-btn--delete" title="删除" on:click|stopPropagation={handleDelete}>
              <Icon name="iconThingsX" size={14} />
            </button>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style lang="scss">
  .task-card {
    background: transparent;
    border: none;
    border-radius: 8px;
    padding: 10px;
    margin-bottom: 2px;
    cursor: pointer;
    transition: background-color 0.15s ease;

    &:hover {
      background: #f9fafb;
    }

    &.is-create {
      background: #ffffff;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
      border-radius: 16px;
      border: none;
      padding: 16px 20px;
      margin: 8px;
      cursor: default;
      position: relative;
      z-index: 10;
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

    &.is-moving-out {
      opacity: 0.5;
      background: #f3f4f6;
      transition: opacity 0.3s ease, background 0.3s ease;
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
      align-items: flex-start;
      gap: 12px;
    }

    &__info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    &__subtitle {
      font-size: 13px;
      font-weight: 400;
      color: #9ca3af;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    &__aux {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
      align-self: center;
    }

    &__aux-item {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 12px;
      color: #9ca3af;
      white-space: nowrap;
    }

    // 辅助区标签名胶囊：浅灰边 + 圆角，弱化显示
    &__tag-pill {
      padding: 1px 8px;
      border: 1px solid var(--b3-border-color);
      border-radius: 999px;
      font-size: 12px;
      line-height: 1.5;
    }

    &__aux-deadline {
      color: #dc2626;

      &.is-overdue {
        font-weight: 600;
      }
    }

    // 日程行左侧时间列（计划视图带时间的任务，收缩态替代 checkbox）
    &__schedule-time {
      flex-shrink: 0;
      width: 46px;
      margin-top: 1px;
      font-size: 15px;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      color: #3b82f6;
    }

    &__check {
      flex-shrink: 0;
      width: 18px;
      height: 18px;
      margin-top: 2px;
      padding: 0;
      border: 1.5px solid #d1d5db;
      border-radius: 5px;
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

    &__check-placeholder {
      flex-shrink: 0;
      width: 18px;
      height: 18px;
      margin-top: 2px;
      border: 1.5px solid #d1d5db;
      border-radius: 5px;
    }

    &__title {
      font-size: 16px;
      font-weight: 500;
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

      .is-create & {
        padding-left: 26px;
      }
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
      justify-content: space-between;
      gap: 8px;
      margin-top: 4px;
      padding-top: 8px;
      border-top: 1px solid #f3f4f6;
    }

    &__toolbar-left {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      flex: 1;
      min-width: 0;
    }

    &__toolbar-right {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    &__tag-item {
      display: flex;
      align-items: center;
      gap: 2px;
      background: #f3f4f6;
      border-radius: 12px;
      padding: 2px 4px 2px 8px;
      font-size: 12px;
      position: relative;

      &--reminder {
        gap: 4px;
        padding: 2px 8px;
        background: #fef3c7;
        color: #b45309;
        font-variant-numeric: tabular-nums;
      }

      &.is-overdue {
        background: #fee2e2;

        .task-card__tag-btn {
          color: #dc2626;
        }
      }
    }

    &__flag {
      color: #dc2626;
    }

    &__tag-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      border: none;
      background: transparent;
      cursor: pointer;
      padding: 2px 4px;
      font-size: 12px;
      color: #4b5563;
      border-radius: 8px;

      &:hover {
        background: #e5e7eb;
      }
    }

    &__tag-remove {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border: none;
      background: transparent;
      cursor: pointer;
      color: #9ca3af;
      font-size: 12px;
      border-radius: 50%;

      &:hover {
        background: #e5e7eb;
        color: #dc2626;
      }
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

      &--right {
        left: auto;
        right: 0;
      }
    }
  }
</style>
