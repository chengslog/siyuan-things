<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount, tick } from "svelte";
  import { fade } from "svelte/transition";
  import { showMessage } from "siyuan";
  import type { Task, Priority, RepeatRule } from "@/types";
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
  import { renderMarkdown } from "@/utils/markdown";
  import { uploadImage } from "@/utils/upload";
  import { smartPosition } from "@/utils/popup";

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
  // 月度分组内联日期（计划视图月度组）：收缩态勾选框后显示任务的 M/D 日期
  export let inlineDate: boolean = false;
  // 新建模式继承拖拽落点的日期（今晚→18:00、日期组→当天、月度组→月初）
  export let presetStartDate: number | undefined = undefined;
  // 项目视图插入式新建：继承落点标题分组（"none" 组传 undefined）
  export let presetHeadingId: string | undefined = undefined;
  // 创建卡显式携带的目标视图上下文（拖 + 切视图与挂载有时序差，优先于 currentView）
  export let presetView: string | undefined = undefined;
  export let presetViewId: string | undefined = undefined;
  // 创建触发方式分开控制：手动新建默认都启用，AI 结果只保留显式按钮。
  export let createOnBlur: boolean = true;
  export let createOnEnter: boolean = true;
  // 新建卡片工具栏中的显式提交按钮（AI 整理结果使用）
  export let showCreateButton: boolean = false;
  export let createButtonLabel: string = "添加";
  // AI 预览卡允许像任务列表卡片一样收缩；普通手动新建卡保持原有固定展开行为。
  export let collapsibleCreate: boolean = false;
  // 已添加的 AI 结果复用任务卡收缩态，仅展示摘要，不允许再次展开或编辑。
  export let collapsedPreview: boolean = false;
  export let collapsedStatusLabel: string = "";
  export let aiPreview: boolean = false;
  // AI 预填充数据：create 模式下用这些数据初始化本地状态
  export let prefilledData: {
    title?: string;
    notes?: string;
    checklist?: string[];
    startDate?: number;
    deadline?: number;
    someday?: boolean;
    repeatRule?: RepeatRule;
    tags?: string[];
    priority?: string;
    projectId?: string;
    areaId?: string;
    headingId?: string;
    unresolved?: string[];
  } | undefined = undefined;

  const dispatch = createEventDispatcher();

  let cardEl: HTMLElement;

  // 表单数据
  let title = prefilledData?.title || "";
  let notes = prefilledData?.notes || "";
  let startDate: number | undefined = prefilledData?.startDate;
  let deadline: number | undefined = prefilledData?.deadline;
  let repeatRule: RepeatRule | undefined = prefilledData?.repeatRule;
  let someday: boolean = prefilledData?.someday || false;
  let selectedTags: string[] = prefilledData?.tags || [];
  let projectId: string | undefined = prefilledData?.projectId;
  let areaId: string | undefined = prefilledData?.areaId;
  let headingId: string | undefined = prefilledData?.headingId;
  let priority: Priority = (prefilledData?.priority as Priority) || 'none';
  let checklist: Array<{ id: string; title: string; completed: boolean }> = prefilledData?.checklist && prefilledData.checklist.length > 0
    ? prefilledData.checklist.map((t, i) => ({ id: `ck-${Date.now()}-${i}`, title: t, completed: false }))
    : [{ id: "empty", title: "", completed: false }];

  // AI 卡片用此事件把用户直接编辑后的草稿同步回会话上下文。
  $: if (mode === 'create' && prefilledData) {
    dispatch('draftchange', {
      draft: {
        title,
        notes,
        checklist: checklist.filter(i => i.title.trim()).map(i => i.title.trim()),
        startDate,
        deadline,
        someday,
        repeatRule,
        tags: selectedTags,
        priority,
        projectId,
        areaId,
        headingId,
      }
    });
  }

  // UI 状态
  let expanded = mode === 'create' && !collapsedPreview; // 普通新建默认展开；已添加预览固定收缩
  let showDatePicker = false;
  let showDeadlinePicker = false;
  let showRepeatPicker = false;
  let showTagPicker = false;
  let showProjectAreaPicker = false;
  let showChecklist = true;
  let isInteracting = false;
  let isMovingOut = false;
  let titleInput: HTMLTextAreaElement;

  $: if (showDatePicker || showDeadlinePicker || showTagPicker || showProjectAreaPicker) {
    showRepeatPicker = false;
  }

  // 标题输入框自动增高：编辑态长文本换行可见（收缩态仍是单行+省略号）
  function autoGrow(node: HTMLTextAreaElement) {
    const resize = () => {
      node.style.height = 'auto';
      node.style.height = node.scrollHeight + 'px';
    };
    resize();
    const t = setTimeout(resize, 50); // 字体/布局稳定后再测一次
    node.addEventListener('input', resize);
    return {
      update: resize,
      destroy() {
        node.removeEventListener('input', resize);
        clearTimeout(t);
      },
    };
  }

  // 拖拽状态
  let dragTimer: any = null;
  let isClick = true;
  let pointerDownHere = false; // 本次按下是否发生在卡片自身（区分外部拖拽，如 + 按钮拖到卡片上松手）

  // 初始化
  onMount(() => {
    // 监听其他卡片的展开事件，实现卡片互斥（展开一个时其他自动收起）
    window.addEventListener('card-expanded', handleCardExpanded as EventListener);
    document.addEventListener('mousedown', handleDropdownOutside, true);
    if (mode === 'edit' && task) {
      title = task.title;
      notes = task.notes || "";
      startDate = task.startDate;
      deadline = task.deadline;
      repeatRule = task.repeatRule;
      someday = task.someday || false;
      selectedTags = [...(task.tags || [])];
      priority = task.priority || 'none';
      // 初始化项目/区域归属（之前漏掉了，导致编辑后失去焦点会清除归属）
      projectId = task.projectId;
      areaId = task.areaId;
      repeatRule = task.repeatRule;
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
      // 日期继承拖拽落点（今晚/日期/月度分组）；无落点时回退到视图默认
      if (presetStartDate != null) {
        startDate = presetStartDate;
      } else if (currentView === 'today') {
        startDate = getTodayStart();
      }
      // 项目/区域视图里新建的任务预置归属；某天视图置为 someday
      // 目标视图以显式 preset 为准（拖 + 切视图时 currentView 可能还是旧视图）
      const destView = presetView || currentView;
      const destViewId = presetViewId ?? currentViewId;
      if (destView === 'project' && destViewId) projectId = destViewId;
      if (destView === 'area' && destViewId) areaId = destViewId;
      // 项目视图：继承插入落点的标题分组（此前缺这步，分组下新建的任务全掉进未分组）
      if (destView === 'project' && presetHeadingId) headingId = presetHeadingId;
      if (destView === 'someday') someday = true;
      if (!collapsedPreview) setTimeout(() => titleInput?.focus(), 100);
      if (collapsibleCreate) {
        setTimeout(() => document.addEventListener('click', handleOutsideClick), 10);
      }
    }
  });

  onDestroy(() => {
    window.removeEventListener('card-expanded', handleCardExpanded as EventListener);
    document.removeEventListener('mousedown', handleDropdownOutside, true);
    if (mode === 'edit' && task) {
      unregisterItem(task.id);
      // 组件销毁前保存待处理的变更（如切换视图时）
      savePendingChanges();
    }
    if (moveTimeout) clearTimeout(moveTimeout);
    // 若组件在完成延迟结束前被销毁（如切换视图），立即完成任务，避免丢失用户的勾选操作
    if (pendingDone && !completionApplied && task) {
      store.tasks.toggleTask(task.id);
    }
  });

  // 保存待处理的变更（不执行动画，直接写 store）
  async function savePendingChanges() {
    if (mode !== 'edit' || !task) return;

    const changes: Partial<Task> = {};
    if (title !== task.title) changes.title = title;
    if (notes !== (task.notes || "")) changes.notes = notes;
    if (startDate !== task.startDate) changes.startDate = startDate;
    if (deadline !== task.deadline) changes.deadline = deadline;
    if (repeatRule !== task.repeatRule) changes.repeatRule = repeatRule;
    if (someday !== (task.someday || false)) changes.someday = someday;
    if (projectId !== task.projectId) changes.projectId = projectId;
    if (areaId !== task.areaId) changes.areaId = areaId;

    const oldTags = task.tags || [];
    const tagsChanged = selectedTags.length !== oldTags.length ||
      selectedTags.some(t => !oldTags.includes(t));
    if (tagsChanged) changes.tags = selectedTags;

    if (Object.keys(changes).length > 0) {
      await store.tasks.updateTask(task.id, changes);
    }
  }

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

  // 日期格式化为 M/D（如 8/7），用于月度分组的内联日期
  function formatMonthDay(ts?: number): string {
    if (!ts) return "";
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  // 计划视图月度组的行首日期列：统一格式 "M月D日"（不显示时间）
  function formatMonthDate(ts?: number): string {
    if (!ts) return "";
    const d = new Date(ts);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  // 响应式数据
  // 使用本地状态 selectedTags 而非 task.tags，因为编辑时只更新本地状态
  $: tags = selectedTags.map((id) => store.tags.get(id)).filter(Boolean);
  $: isDeadlineOverdue = mode === 'edit' && task?.deadline && isOverdue(task.deadline);

  // 编辑模式：本地维护检查清单状态，避免 store 更新导致重置
  let localChecklist: Array<{ id: string; title: string; completed: boolean }> = [];
  $: checklistItems = mode === 'edit' ? localChecklist : checklist;

  // 收缩态：标题后的所属项目/区域（图标+名称，项目=文件夹、区域=图层，单色随文字灰）
  $: subtitleDisplay = getSubtitleDisplay(mode, task);
  // 收缩态：检查清单条数（用于右侧辅助图标）
  $: checklistCount = (mode === 'edit' ? localChecklist : checklist).filter(i => i.title && i.title.trim()).length;

  function getSubtitleDisplay(mode: 'create' | 'edit', task: Task | null): { icon: string; name: string } | null {
    if (mode !== 'edit' || !task) return null;
    if (task.projectId) {
      const p = store.projects.get(task.projectId);
      if (p) return { icon: "iconThingsFolder", name: p.name };
    }
    if (task.areaId) {
      const a = store.areas.get(task.areaId);
      if (a) return { icon: "iconThingsLayers", name: a.name };
    }
    return null;
  }

  // 日程行的时间列：HH:mm
  function formatTime(ts?: number): string {
    if (!ts) return "";
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  }

  // 日志视图的完成日期列：今天完成显示"今天"，其余"M月D日"
  function formatLogDate(ts?: number): string {
    if (!ts) return "";
    const d = new Date(ts);
    const now = new Date();
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
      return "今天";
    }
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  // 是否带具体时刻（时/分非零）
  function hasTimeOfDay(ts?: number): boolean {
    if (!ts) return false;
    const d = new Date(ts);
    return d.getHours() !== 0 || d.getMinutes() !== 0;
  }

  // 是否为“今晚”默认时刻 18:00（今天视图“今晚”组头已传达，无需重复提醒徽章）
  function isEveningTime(ts?: number): boolean {
    if (!ts) return false;
    const d = new Date(ts);
    return d.getHours() === 18 && d.getMinutes() === 0;
  }

  // 日期显示
  // 注意：必须把响应式变量作为参数显式传入。Svelte 的 $: 不会穿透函数调用追踪依赖，
  // 若写成无参调用，只会在组件初始化时计算一次，设置/清除日期后胶囊不会刷新。
  // 展示逻辑统一在 utils/display.ts：返回 { icon: symbolId, text, color? }，模板用 <Icon> 渲染。
  // 编辑模式下也使用本地状态（而非 task.xxx），因为修改日期时只更新本地状态，失去焦点时才写 store
  $: resolvedStartDate = startDate;
  $: resolvedSomeday = someday;
  $: resolvedDeadline = deadline;
  $: dateDisplay = getStartDateDisplay(resolvedStartDate, resolvedSomeday, currentView);
  $: dateReminderDisplay = resolvedSomeday ? null : getReminderDisplay(resolvedStartDate);
  $: deadlineDisplay = getDeadlineDisplay(resolvedDeadline);
  $: deadlineReminderDisplay = getReminderDisplay(resolvedDeadline);

  // 收缩态提醒徽章：开始时间统一显示为“小铃铛 + 时间”胶囊。
  // 今天的“今晚”默认时刻已由组头表达，因此不重复显示。
  $: showTimeBadge = hasTimeOfDay(resolvedStartDate) && !(currentView === 'today' && isEveningTime(resolvedStartDate));
  // 收缩态内联日期：所在视图不传达日期（项目/区域/标签/搜索/随时等）时显示。
  // 月度分组（inlineDate）改用行首日期列（日志同款），不再用内联徽章
  // 日志视图已有行首完成日期列，不再叠加开始日期徽章
  // 收缩态内联日期：今天/今晚视图不显示，随时/标签/项目/区域视图显示非今天任务的日期
  $: showCollapsedDate = mode === 'edit' && !!task?.startDate && currentView !== 'log' && currentView !== 'today' && currentView !== 'upcoming';

  // 项目/区域归属（编辑模式取 task，新建模式取本地状态）
  $: assignment = getAssignment(mode, task, projectId, areaId);
  $: assignmentProject = getAssignmentProject(store, assignment.projectId);
  $: assignmentArea = getAssignmentArea(store, assignment.areaId);

  function getAssignment(mode: 'create' | 'edit', task: Task | null, pid: string | undefined, aid: string | undefined) {
    // 编辑模式下也使用本地状态（而非 task.xxx），因为修改归属时只更新本地状态
    return {
      projectId: pid,
      areaId: aid,
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
    // 无论 create 还是 edit 模式，都只更新本地状态
    // edit 模式的 store 更新延迟到 saveAndCollapse 时执行
    projectId = pid;
    areaId = aid;
    showProjectAreaPicker = false;
    if (mode === 'create') {
      tick().then(() => titleInput?.focus());
    }
  }

  function clearAssignment() {
    handleProjectAreaChange(new CustomEvent("x", { detail: { projectId: undefined, areaId: undefined } }));
  }

  function toggleProjectAreaPicker() {
    showProjectAreaPicker = !showProjectAreaPicker;
    showDatePicker = false;
    showDeadlinePicker = false;
    showTagPicker = false;
    showRepeatPicker = false;
  }

  const repeatOptions: Array<{ value?: RepeatRule; label: string }> = [
    { value: undefined, label: "不重复" },
    { value: "daily", label: "每天" },
    { value: "weekdays", label: "每个工作日" },
    { value: "weekly", label: "每周" },
    { value: "monthly", label: "每月" },
    { value: "yearly", label: "每年" },
  ];
  $: repeatLabel = repeatOptions.find(option => option.value === repeatRule)?.label || "重复";

  function toggleRepeatPicker() {
    showRepeatPicker = !showRepeatPicker;
    showDatePicker = false;
    showDeadlinePicker = false;
    showTagPicker = false;
    showProjectAreaPicker = false;
  }

  function selectRepeatRule(value?: RepeatRule) {
    repeatRule = value;
    showRepeatPicker = false;
    if (mode === 'create') tick().then(() => titleInput?.focus());
  }

  // 卡片点击
  function handleCardClick(e?: Event) {
    if (collapsedPreview) return;
    if (mode === 'create' && !collapsibleCreate) return;

    const target = e?.target as HTMLElement | undefined;

    // 弹窗打开时：卡片内任何点击（弹窗自身除外，其内部已 stopPropagation）先关弹窗，
    // 不触发展开/折叠。修复"打开日期选择器后点卡片空白处弹窗不消失"。
    const hasOpenDropdown = showDatePicker || showDeadlinePicker || showRepeatPicker || showTagPicker || showProjectAreaPicker;
    if (hasOpenDropdown && (!target || !target.closest('.task-card__dropdown'))) {
      showDatePicker = false;
      showDeadlinePicker = false;
      showTagPicker = false;
      showRepeatPicker = false;
      showProjectAreaPicker = false;
      showRepeatPicker = false;
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
    if (expanded && mode === 'create' && collapsibleCreate) {
      setTimeout(() => document.addEventListener('click', handleOutsideClick), 10);
    } else if (expanded && task) {
      title = task.title;
      notes = task.notes || "";
      // 主任务创建会先触发列表渲染，检查项随后才逐条写入。
      // 每次展开都从 store 重载，避免首次挂载时读到空清单后一直不更新。
      const subTasks = store.tasks.getSubTasks(task.id);
      localChecklist = subTasks.length > 0
        ? subTasks.map(t => ({
            id: t.id,
            title: t.title,
            completed: t.status === 'done'
          }))
        : [{ id: "empty", title: "", completed: false }];
      // 重新加载归属状态，防止外部更新后本地状态不同步
      projectId = task.projectId;
      areaId = task.areaId;
      window.dispatchEvent(new CustomEvent('card-expanded', { detail: { cardId: task.id } }));
      setTimeout(() => {
        document.addEventListener('click', handleOutsideClick);
      }, 10);
    } else {
      notesExpanded = false; // 收起卡片时重置备注展开状态
      document.removeEventListener('click', handleOutsideClick);
    }
  }

  // 点击外部关闭
  function handleOutsideClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    // Dropdowns are portaled to document.body by smartPosition, so they are no
    // longer descendants of cardEl. Treat interaction inside a portaled picker
    // as card interaction; the picker change/close handler owns its lifecycle.
    if (target.closest('.task-card__dropdown')) return;
    if (!cardEl?.contains(target)) {
      showDatePicker = false;
      showDeadlinePicker = false;
      showTagPicker = false;
      if (mode === 'create' && collapsibleCreate) {
        expanded = false;
        notesExpanded = false;
        document.removeEventListener('click', handleOutsideClick);
      } else {
        saveAndCollapse();
      }
    }
  }

  // 保存并折叠
  async function saveAndCollapse() {
    if (mode === 'edit' && task) {
      // 构建变更对象：比较本地状态与 task
      const changes: Partial<Task> = {};

      if (title !== task.title) changes.title = title;
      if (notes !== (task.notes || "")) changes.notes = notes;
      if (startDate !== task.startDate) changes.startDate = startDate;
      if (deadline !== task.deadline) changes.deadline = deadline;
      if (repeatRule !== task.repeatRule) changes.repeatRule = repeatRule;
      if (someday !== (task.someday || false)) changes.someday = someday;
      if (projectId !== task.projectId) changes.projectId = projectId;
      if (areaId !== task.areaId) changes.areaId = areaId;
      if (priority !== (task.priority || 'none')) changes.priority = priority;

      // 比较标签数组
      const oldTags = task.tags || [];
      const tagsChanged = selectedTags.length !== oldTags.length ||
        selectedTags.some(t => !oldTags.includes(t));
      if (tagsChanged) changes.tags = selectedTags;

      // 先保存标题和备注（不触发动画）
      await saveTitle();
      await saveNotes();

      // 检查是否有日期/标签/归属等变更需要处理
      const hasOtherChanges = Object.keys(changes).some(k =>
        k !== 'title' && k !== 'notes'
      );

      if (hasOtherChanges && willChangeCauseMove(changes)) {
        // 需要迁移：执行动画
        isMovingOut = true;
        expanded = false;
        notesExpanded = false;
        await new Promise(resolve => setTimeout(resolve, 300));
        // 写入 store（排除已单独保存的 title/notes）
        const { title: _, notes: __, ...restChanges } = changes;
        if (Object.keys(restChanges).length > 0) {
          await store.tasks.updateTask(task.id, restChanges);
        }
        isMovingOut = false;
      } else {
        // 不需要迁移：直接保存
        const { title: _, notes: __, ...restChanges } = changes;
        if (Object.keys(restChanges).length > 0) {
          await store.tasks.updateTask(task.id, restChanges);
        }
        expanded = false;
        notesExpanded = false;
      }
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

  // —— 备注 Markdown 展示/编辑 + 图片粘贴/拖拽 ——
  let editingNotes = false;
  let notesArea: HTMLTextAreaElement;
  let notesExpanded = false;
  let notesContentEl: HTMLElement;
  $: renderedNotes = renderMarkdown(notes);
  // 检测备注内容是否超过 2 行（需要展开按钮）
  $: isNotesOverflowing = checkOverflow(notesContentEl);
  // 显示今天/今晚标识的视图（随时、标签、项目、区域）
  $: showTodayIndicator = currentView === 'anytime' || currentView === 'tag' || currentView === 'project' || currentView === 'area';
  // 今天任务（⭐️）和今晚任务（🌙）检测
  $: isTodayInAnytime = showTodayIndicator && task?.startDate && isTodayTask(task.startDate) && !isEveningTime(task.startDate);
  $: isTonightInAnytime = showTodayIndicator && task?.startDate && isTodayTask(task.startDate) && isEveningTime(task.startDate);

  function checkOverflow(el: HTMLElement | null): boolean {
    if (!el) return false;
    return el.scrollHeight > el.clientHeight + 2;
  }

  // 判断任务日期是否是今天
  function isTodayTask(startDate: number): boolean {
    const now = new Date();
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    return startDate <= todayEnd.getTime();
  }

  function startEditNotes() {
    editingNotes = true;
    tick().then(() => {
      notesArea?.focus();
      if (notesArea) {
        notesArea.selectionStart = notesArea.selectionEnd = notesArea.value.length;
      }
    });
  }

  function handleNotesBlur() {
    if (mode === 'edit') saveNotes();
    editingNotes = false;
  }

  function saveAndCloseNotes() {
    if (mode === 'edit') saveNotes();
    editingNotes = false;
  }

  // 在光标处插入文本（图片上传完成后回填 md 引用）
  function insertAtCursor(text: string) {
    const el = notesArea;
    const start = el ? el.selectionStart ?? notes.length : notes.length;
    const end = el ? el.selectionEnd ?? notes.length : notes.length;
    notes = notes.slice(0, start) + text + notes.slice(end);
    tick().then(() => {
      if (el) {
        el.selectionStart = el.selectionEnd = start + text.length;
        el.focus();
      }
    });
  }

  async function uploadAndInsert(file: File) {
    const url = await uploadImage(file);
    if (url) {
      insertAtCursor(`![](${url})`);
      if (mode === 'edit') saveNotes();
    } else {
      showMessage("图片上传失败", 7000);
    }
  }

  function handleNotesPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) uploadAndInsert(file);
        return;
      }
    }
  }

  function handleNotesDrop(e: DragEvent) {
    const files = e.dataTransfer?.files;
    if (!files || !files.length) return;
    const imgs = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (!imgs.length) return;
    e.preventDefault();
    for (const f of imgs) uploadAndInsert(f);
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
    } else if (pendingDone && !completionApplied) {
      // 置灰等待期间再点一次 = 取消勾选（3s 窗口内的反悔机会）
      if (moveTimeout) {
        clearTimeout(moveTimeout);
        moveTimeout = null;
      }
      pendingDone = false;
      isMoving = false;
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
    // 无论 create 还是 edit 模式，都只更新本地状态
    // edit 模式的 store 更新延迟到 saveAndCollapse 时执行
    startDate = e.detail.timestamp;
    someday = e.detail.someday || false;
    showDatePicker = false;
    // create 模式下，关闭选择器后把焦点返回标题输入框，避免 handleBlur 触发 cancel
    if (mode === 'create') {
      tick().then(() => titleInput?.focus());
    }
  }

  // 截止日期变化
  async function handleDeadlineChange(e: CustomEvent) {
    deadline = e.detail.timestamp;
    showDeadlinePicker = false;
    if (mode === 'create') {
      tick().then(() => titleInput?.focus());
    }
  }

  // 标签变化
  async function handleTagChange(e: CustomEvent) {
    selectedTags = e.detail.tags;
    showTagPicker = false;
    if (mode === 'create') {
      tick().then(() => titleInput?.focus());
    }
  }

  function handleDropdownOutside(e: MouseEvent) {
    if (!showDatePicker && !showDeadlinePicker && !showTagPicker && !showProjectAreaPicker) return;
    const target = e.target as HTMLElement;
    if (target.closest('.task-card__dropdown')) return;
    // 入口按钮自身负责切换，捕获阶段不要抢先关闭。
    if (cardEl?.contains(target) && (
      target.closest('.task-card__tool-btn') ||
      target.closest('.task-card__tag-btn') ||
      target.closest('.task-card__tag-remove')
    )) return;
    showDatePicker = false;
    showDeadlinePicker = false;
    showTagPicker = false;
    showProjectAreaPicker = false;
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
    startDate = undefined;
    someday = false;
  }

  // 清除标签
  async function clearTags() {
    selectedTags = [];
  }

  // 清除截止日期
  async function clearDeadline() {
    deadline = undefined;
  }

  async function clearStartReminder(e?: Event) {
    e?.stopPropagation();
    if (!resolvedStartDate) return;
    const value = new Date(resolvedStartDate);
    value.setHours(0, 0, 0, 0);
    startDate = value.getTime();
    if (mode === 'edit' && task && !expanded) {
      await applyChangeWithAnimation({ startDate });
    }
  }

  async function clearDeadlineReminder(e?: Event) {
    e?.stopPropagation();
    if (!resolvedDeadline) return;
    const value = new Date(resolvedDeadline);
    value.setHours(0, 0, 0, 0);
    deadline = value.getTime();
    if (mode === 'edit' && task && !expanded) {
      await applyChangeWithAnimation({ deadline });
    }
  }

  // 判断给定变更是否会使任务移出当前视图（基于当前任务与变更的合并结果）
  function willChangeCauseMove(changes: Partial<Task>): boolean {
    if (!task) return false;

    // In Upcoming, changing the scheduled date can keep the task in the same
    // view while moving it to another day/month group or sort position. Treat
    // that as a move too, so the user sees the same collapse/fade transition
    // before the list is reordered.
    if (currentView === 'upcoming' && (
      ('startDate' in changes && changes.startDate !== task.startDate) ||
      ('someday' in changes && changes.someday !== task.someday)
    )) {
      return true;
    }

    // 项目/区域/标签视图：任务按归属分类，不会因日期/标签变化而迁出
    if (currentView === 'project' || currentView === 'area' || currentView === 'tag') {
      // 只有当归属字段被显式修改时才检查
      if (currentView === 'project' && 'projectId' in changes) {
        const newProjectId = changes.projectId;
        return newProjectId !== task.projectId;
      }
      if (currentView === 'area' && 'areaId' in changes) {
        const newAreaId = changes.areaId;
        return newAreaId !== task.areaId;
      }
      if (currentView === 'tag' && 'tags' in changes) {
        const newTags = changes.tags || [];
        const oldTags = task.tags || [];
        if (newTags.length !== oldTags.length) return true;
        return newTags.some(t => !oldTags.includes(t));
      }
      return false;
    }

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
      notesExpanded = false; // 重置备注展开状态
      await new Promise(resolve => setTimeout(resolve, 300)); // 等待置灰动画
      await store.tasks.updateTask(task.id, changes); // 写入 store → 任务移出当前视图 → outro 滑出
      isMovingOut = false;
    } else {
      await store.tasks.updateTask(task.id, changes);
    }
  }

  // 拖拽处理
  function handleMouseDown(e: MouseEvent) {
    if (collapsedPreview) return;
    if (mode === 'create' && !collapsibleCreate) return;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input') || target.closest('textarea')) return;

    pointerDownHere = true;
    isClick = true;
    if (mode === 'create') return;
    dragTimer = setTimeout(() => {
      if (isClick) {
        isClick = false;
        dispatch('dragstart', { event: e });
      }
    }, 200);
  }

  function handleMouseUp(e: MouseEvent) {
    if (collapsedPreview) return;
    if (mode === 'create' && !collapsibleCreate) return;
    if (dragTimer) {
      clearTimeout(dragTimer);
      dragTimer = null;
    }
    // 按下不在本卡片上（如 + 按钮拖到此处松手）→ 不视为点击，避免误展开成“第二个卡片”
    const wasDown = pointerDownHere;
    pointerDownHere = false;
    if (!wasDown) return;
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
        repeatRule,
        someday,
        tags: selectedTags,
        projectId,
        areaId,
        headingId,
        priority,
      };

      // 目标视图以显式 preset 为准（拖 + 切视图时 currentView 可能还是旧视图），
      // 杜绝"拖到某天却建进收件箱"一类的落错视图事故
      const destView = presetView || currentView;

      if (destView === "today" && !startDate) {
        taskData.startDate = getTodayStart();
      }
      // 某天视图里新建的任务必须是 someday——兜底防挂载时序偏差导致状态丢失
      if (destView === "someday" && !startDate) {
        taskData.someday = true;
      }
      // 计划视图没设具体日期 → 默认明天（否则裸任务不满足计划条件会掉进收件箱）
      if (destView === "upcoming" && !startDate) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + 1);
        taskData.startDate = d.getTime();
      }

      const newTask = await store.tasks.createTask(taskData);

      // 随时视图要求任务带项目/区域/标签，都不带时任务实际归收件箱，明确告知用户
      if (
        destView === "anytime" &&
        !taskData.projectId && !taskData.areaId &&
        (!taskData.tags || taskData.tags.length === 0)
      ) {
        showMessage("任务未设置项目/区域/标签，已归入收件箱（随时视图只显示带项目/区域/标签的任务）", 7000);
      }

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
      repeatRule = undefined;
      someday = false;
      selectedTags = [];
      projectId = currentView === "project" ? currentViewId : undefined;
      areaId = currentView === "area" ? currentViewId : undefined;
      headingId = currentView === "project" ? presetHeadingId : undefined;
      checklist = [{ id: "empty", title: "", completed: false }];
      titleInput?.focus();
    } finally {
      isCreating = false;
    }
  }

  // 键盘事件
  function handleKeydown(e: KeyboardEvent) {
    // 中文输入法组词确认的回车不当作提交
    if (e.key === "Enter" && (e.isComposing || e.keyCode === 229)) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!createOnEnter) return;
      if (mode === 'create') {
        handleCreate();
      } else {
        // 编辑模式：回车 = 保存并收起（与新建的回车行为一致）
        saveAndCollapse();
      }
      return;
    }
    if (e.key === "Escape") {
      if (mode === 'create') {
        dispatch("cancel");
      } else {
        saveAndCollapse();
      }
    }
  }

  // 焦点丢失
  function handleBlur(e: FocusEvent) {
    if (mode !== 'create' || isInteracting || !createOnBlur) return;
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
  class:is-collapsible-create={mode === 'create' && collapsibleCreate}
  class:is-collapsed-preview={collapsedPreview}
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
    <!-- 日志视图：行首固定宽度完成日期列（今天完成的显示"今天"，其余"M月D日"），仅收缩态显示 -->
    {#if currentView === 'log' && mode === 'edit' && !expanded}
      <span class="task-card__log-date">{formatLogDate(task?.completedDate || task?.updated)}</span>
    {/if}
    <!-- 计划视图月度组：行首固定宽度开始日期列（同日志样式，x月x日），仅收缩态显示 -->
    {#if inlineDate && mode === 'edit' && !expanded}
      <span class="task-card__month-date">{formatMonthDate(task?.startDate)}</span>
    {/if}
    <!-- 复选框 -->
    {#if mode === 'edit'}
      <button
        class="task-card__check"
        class:is-checked={task?.status === "done" || pendingDone}
        on:click={handleToggle}
      >
        {#if task?.status === "done" || pendingDone}
          <svg><use xlink:href="#iconThingsCheck" /></svg>
        {/if}
      </button>
    {:else}
      {#if aiPreview}
        <span
          class="task-card__ai-marker"
          class:is-added={collapsedPreview}
          class:is-pending={!collapsedPreview}
          title={collapsedPreview ? '已添加' : '未添加'}
          aria-label={collapsedPreview ? '已添加' : '未添加'}
        >
          {collapsedPreview ? '已添加' : '待添加'}
        </span>
      {:else}
        <span class="task-card__check-placeholder"></span>
      {/if}
    {/if}

    <!-- 日期/图标（有日期或今天图标时显示，无日期不渲染） -->
    {#if !expanded && showTodayIndicator}
      {#if isTodayInAnytime}
        <span class="task-card__date-col"><Icon name="iconThingsStarFilled" size={14} color="#FFB900" klass="task-card__today-indicator" /></span>
      {:else if isTonightInAnytime}
        <span class="task-card__date-col"><Icon name="iconThingsMoonFilled" size={14} color="#5A7FE0" klass="task-card__today-indicator" /></span>
      {:else if showCollapsedDate}
        <span class="task-card__date-col task-card__inline-date">{formatMonthDay(task?.startDate)}</span>
      {/if}
    {:else if showCollapsedDate && !expanded}
      <span class="task-card__date-col task-card__inline-date">{formatMonthDay(task?.startDate)}</span>
    {/if}

    <!-- 标题 -->
    {#if expanded}
      <textarea
        bind:this={titleInput}
        class="task-card__title-input"
        placeholder={mode === 'create' ? "新建待办事项" : "任务标题"}
        rows="1"
        bind:value={title}
        use:autoGrow
        on:blur={mode === 'create' ? undefined : saveTitle}
        on:keydown={handleKeydown}
        on:click|stopPropagation
      ></textarea>
    {:else}
      <div class="task-card__info">
        <div class="task-card__title" class:is-done={task?.status === "done" || pendingDone}>
          {mode === 'create' ? title : task?.title}
        </div>
        {#if subtitleDisplay}
          <span class="task-card__subtitle">
            <Icon name={subtitleDisplay.icon} size={13} />
            <span class="task-card__subtitle-name">{subtitleDisplay.name}</span>
          </span>
        {/if}
      </div>

      <!-- 右侧辅助信息（收缩态，弱化显示） -->
      <div class="task-card__aux">
          {#if showTimeBadge}
            <span class="task-card__aux-item task-card__aux-time" title="开始提醒（到点通知）">
              <Icon name="iconThingsBell" size={12} />
              <span>{formatTime(resolvedStartDate)}</span>
              <button class="task-card__aux-remove" title="清除开始提醒，保留日期" on:click|stopPropagation={clearStartReminder}>×</button>
            </span>
          {/if}
          {#if resolvedDeadline}
            <span class="task-card__aux-item task-card__aux-deadline" class:is-overdue={isDeadlineOverdue} title={hasTimeOfDay(resolvedDeadline) ? `截止提醒 ${formatTime(resolvedDeadline)}（到点通知）` : "截止日期"}>
              <Icon name="iconThingsFlag" size={12} />
              <span>{formatRelativeDate(resolvedDeadline)}{hasTimeOfDay(resolvedDeadline) ? ` ${formatTime(resolvedDeadline)}` : ""}</span>
              {#if hasTimeOfDay(resolvedDeadline)}
                <button class="task-card__aux-remove" title="清除截止提醒，保留日期" on:click|stopPropagation={clearDeadlineReminder}>×</button>
              {/if}
            </span>
          {/if}
          {#if checklistCount > 0}
            <span class="task-card__aux-item" title="检查清单"><Icon name="iconThingsChecklist" size={12} />{checklistCount}</span>
          {/if}
          {#if mode === 'create' ? notes.trim() : task?.notes}
            <span class="task-card__aux-item" title="备注"><Icon name="iconThingsNote" size={12} /></span>
          {/if}
          {#if selectedTags.length > 0}
            <span class="task-card__aux-item task-card__tags-inline" title={tags.length ? `标签：${tags.map((t) => t.name).join('、')}` : '标签'}>
              {#each tags as tag}
                <span class="task-card__tag-dot" style="background: {tag.color || '#999'}"></span>
                <span class="task-card__tag-name">{tag.name}</span>
              {/each}
            </span>
          {/if}
      </div>
    {/if}
    {#if collapsedPreview && collapsedStatusLabel}
      <span class="task-card__collapsed-status">{collapsedStatusLabel}</span>
    {/if}
  </div>

  <!-- 展开详情 -->
  {#if expanded}
    <div class="task-card__details" on:click|stopPropagation transition:fade={{ duration: 150 }}>
      {#if mode === 'create' && prefilledData?.unresolved?.length}
        <div class="task-card__ai-warning">
          未找到{prefilledData.unresolved.join('、')}，添加前可手动选择已有项。
        </div>
      {/if}
      <!-- 备注：展示态（渲染 Markdown + 编辑按钮）↔ 编辑态（textarea + 完成按钮） -->
      {#if mode === 'edit'}
        {#if editingNotes}
          <div class="task-card__notes-wrap task-card__notes-wrap--editing" on:mousedown|stopPropagation on:mouseup|stopPropagation>
            <textarea
              class="task-card__notes"
              bind:this={notesArea}
              bind:value={notes}
              use:autoGrow
              on:blur={handleNotesBlur}
              on:paste={handleNotesPaste}
              on:dragover|preventDefault
              on:drop={handleNotesDrop}
              placeholder="添加备注...（支持 Markdown，可粘贴/拖入图片）"
              rows="2"
            ></textarea>
            <button class="task-card__notes-done" on:click|stopPropagation={saveAndCloseNotes} title="完成编辑">✓</button>
          </div>
        {:else}
          <div class="task-card__notes-wrap" class:task-card__notes-wrap--has-content={notes.trim()} on:mousedown|stopPropagation on:mouseup|stopPropagation on:click|stopPropagation={startEditNotes}>
            {#if notes.trim()}
              <div class="task-card__notes-md" class:is-expanded={notesExpanded} bind:this={notesContentEl}>{@html renderedNotes}</div>
              <button class="task-card__notes-edit" on:click|stopPropagation={startEditNotes} title="编辑备注">
                <Icon name="iconThingsPencil" size={12} />
              </button>
              {#if isNotesOverflowing}
                <button class="task-card__notes-expand" on:click|stopPropagation={() => notesExpanded = !notesExpanded} title={notesExpanded ? "收起" : "展开"}>
                  {notesExpanded ? "收起" : "展开"}
                </button>
              {/if}
            {:else}
              <span class="task-card__notes-placeholder">添加备注…</span>
            {/if}
          </div>
        {/if}
      {:else}
        <textarea
          class="task-card__notes"
          bind:this={notesArea}
          bind:value={notes}
          use:autoGrow
          on:paste={handleNotesPaste}
          on:dragover|preventDefault
          on:drop={handleNotesDrop}
          placeholder="添加备注...（支持 Markdown，可粘贴/拖入图片）"
          rows="2"
        ></textarea>
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
                <div class="task-card__dropdown" use:smartPosition>
                  <DatePicker
                    timestamp={startDate}
                    on:change={handleDateChange}
                    on:close={() => showDatePicker = false}
                  />
                </div>
              {/if}
            </div>
          {/if}

          <!-- 日期提醒 -->
          {#if dateReminderDisplay}
            <div class="task-card__tag-item task-card__tag-item--reminder" title="开始提醒">
              <Icon name={dateReminderDisplay.icon} size={12} />
              <span>{dateReminderDisplay.text}</span>
              <button class="task-card__tag-remove" title="清除开始提醒，保留日期" on:click|stopPropagation={clearStartReminder}>×</button>
            </div>
          {/if}

          <!-- 标签 -->
          {#if tags.length > 0}
            <div class="task-card__tag-item">
              <button
                class="task-card__tag-btn"
                on:click|stopPropagation={() => { showTagPicker = !showTagPicker; showDatePicker = false; showDeadlinePicker = false; showProjectAreaPicker = false; }}
              >
                {#each tags as tag, i}
                  <span class="task-card__tag-dot" style="background: {tag.color || '#999'}"></span>
                  <span>{tag.name}</span>
                  {#if i < tags.length - 1}<span>, </span>{/if}
                {/each}
              </button>
              <button class="task-card__tag-remove" on:click|stopPropagation={clearTags}>×</button>

              {#if showTagPicker}
                <div class="task-card__dropdown" use:smartPosition>
                  <TagPicker
                    store={store}
                    selectedTags={selectedTags}
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
                <div class="task-card__dropdown" use:smartPosition>
                  <DeadlinePicker
                    timestamp={deadline}
                    on:change={handleDeadlineChange}
                    on:close={() => showDeadlinePicker = false}
                  />
                </div>
              {/if}
            </div>
          {/if}

          <!-- 截止日期提醒 -->
          {#if deadlineReminderDisplay}
            <div class="task-card__tag-item task-card__tag-item--reminder-deadline" title="截止提醒">
              <Icon name={deadlineReminderDisplay.icon} size={12} />
              <span>{deadlineReminderDisplay.text}</span>
              <button class="task-card__tag-remove" title="清除截止提醒，保留日期" on:click|stopPropagation={clearDeadlineReminder}>×</button>
            </div>
          {/if}

          {#if repeatRule}
            <div class="task-card__tag-item">
              <button class="task-card__tag-btn" title="重复设置" on:click|stopPropagation={toggleRepeatPicker}>
                <span class="task-card__repeat-icon">↻</span>
                <span>{repeatLabel}</span>
              </button>
              <button class="task-card__tag-remove" title="取消重复" on:click|stopPropagation={() => selectRepeatRule(undefined)}>×</button>
              {#if showRepeatPicker}
                <div class="task-card__dropdown task-card__repeat-menu" use:smartPosition>
                  {#each repeatOptions as option}
                    <button class:is-active={option.value === repeatRule} on:click|stopPropagation={() => selectRepeatRule(option.value)}>
                      <span>{option.label}</span><span>{option.value === repeatRule ? "✓" : ""}</span>
                    </button>
                  {/each}
                </div>
              {/if}
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
                <div class="task-card__dropdown" use:smartPosition>
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
                <div class="task-card__dropdown task-card__dropdown--right" use:smartPosition>
                  <DatePicker
                    timestamp={startDate}
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
                <div class="task-card__dropdown task-card__dropdown--right" use:smartPosition>
                  <DeadlinePicker
                    timestamp={deadline}
                    on:change={handleDeadlineChange}
                    on:close={() => showDeadlinePicker = false}
                  />
                </div>
              {/if}
            </div>
          {/if}

          {#if !repeatRule}
            <div class="task-card__action-group">
              <button class="task-card__tool-btn" title="重复" on:click|stopPropagation={toggleRepeatPicker}>
                <span class="task-card__repeat-icon task-card__repeat-icon--tool">↻</span>
              </button>
              {#if showRepeatPicker}
                <div class="task-card__dropdown task-card__dropdown--right task-card__repeat-menu" use:smartPosition>
                  {#each repeatOptions as option}
                    <button class:is-active={option.value === repeatRule} on:click|stopPropagation={() => selectRepeatRule(option.value)}>
                      <span>{option.label}</span><span>{option.value === repeatRule ? "✓" : ""}</span>
                    </button>
                  {/each}
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
                <div class="task-card__dropdown task-card__dropdown--right" use:smartPosition>
                  <TagPicker
                    store={store}
                    selectedTags={selectedTags}
                    on:change={handleTagChange}
                  />
                </div>
              {/if}
            </div>
          {:else if mode === 'create' && selectedTags.length === 0}
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
                <div class="task-card__dropdown task-card__dropdown--right" use:smartPosition>
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
                <div class="task-card__dropdown task-card__dropdown--right" use:smartPosition>
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

          {#if mode === 'create' && showCreateButton}
            <button
              class="task-card__create-btn"
              disabled={isCreating}
              on:mousedown|preventDefault|stopPropagation
              on:click|stopPropagation={handleCreate}
            >
              {isCreating ? "添加中…" : createButtonLabel}
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

    &.is-collapsible-create:not(.is-expanded) {
      padding: 10px 12px;
      margin: 4px 8px;
      border-radius: 10px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.07);
      cursor: pointer;
    }

    &.is-collapsed-preview {
      padding: 10px 12px;
      margin: 4px 8px;
      border-radius: 10px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
      opacity: 0.58;
      filter: grayscale(0.85);
      pointer-events: none;

      .task-card__title {
        text-decoration: line-through;
      }
    }

    &__collapsed-status {
      flex-shrink: 0;
      margin-top: 2px;
      font-size: 11px;
      color: #7b8490;
      white-space: nowrap;
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
      background: var(--b3-list-hover);
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
      gap: 10px;
    }

    // 标题与所属项目/区域同行展示（项目名灰色小字跟在标题后），保持单行紧凑
    &__info {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: baseline;
      gap: 8px;
    }

    &__subtitle {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex: 0 1 auto;
      max-width: 50%;
      min-width: 0;
      font-size: 13px;
      font-weight: 400;
      color: #9ca3af;
      white-space: nowrap;
    }

    &__subtitle-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &__aux {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
      margin-top: 3px;
    }

    &__aux-item {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 12px;
      color: #9ca3af;
      white-space: nowrap;
    }

    // 收缩态标签内联显示（彩色圆点 + 标签名）
    &__tags-inline {
      gap: 4px;
    }

    &__tag-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    &__tag-name {
      font-size: 12px;
      color: #6b7280;
    }

    &__aux-deadline {
      color: #dc2626;

      &.is-overdue {
        font-weight: 600;
      }
    }

    // 提醒徽章（具体时刻）：与日程行时间列同蓝色，醒目但不抢眼
    // 收缩态开始时间徽章：琥珀色 = 开始提醒（与展开态开始提醒胶囊、选择器铃铛同义）
    &__aux-time {
      color: #b45309;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }

    // 日志视图行首完成日期列：固定宽度保证各行复选框对齐
    &__log-date {
      flex-shrink: 0;
      width: 56px;
      margin-top: 2px;
      font-size: 12px;
      color: var(--b3-theme-on-surface-light);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    // 计划视图月度组行首开始日期列：固定宽度与日志视图对齐
    &__month-date {
      flex-shrink: 0;
      width: 56px;
      margin-top: 2px;
      font-size: 12px;
      color: var(--b3-theme-on-surface-light);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    // 月度分组内联日期（勾选框与标题之间的 M/D，弱化但可扫读，等宽对齐）
    &__inline-date {
      flex-shrink: 0;
      min-width: 38px;
      margin-top: 2px;
      font-size: 13px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--b3-theme-on-surface-light);
    }

    &__check {
      flex-shrink: 0;
      width: 18px;
      height: 18px;
      margin-top: 3px;
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

    &__aux-remove {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 14px;
      height: 14px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: currentColor;
      font-size: 11px;
      line-height: 1;
      cursor: pointer;
      opacity: 0.55;

      &:hover {
        opacity: 1;
        background: rgba(0, 0, 0, 0.08);
      }
    }

    &:global(.is-ai-focused) {
      animation: task-ai-focus 1.8s ease-out;
    }

    &__ai-marker {
      flex-shrink: 0;
      width: auto;
      height: 20px;
      padding: 0 6px;
      margin-top: 2px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(74, 138, 244, 0.32);
      background: rgba(74, 138, 244, 0.08);
      color: #4a8af4;
      font-size: 9px;
      font-weight: 400;
      line-height: 1;

      &.is-added {
        border-color: rgba(82, 165, 110, 0.24);
        background: rgba(82, 165, 110, 0.08);
        color: #4f9566;
      }
    }

    &__title {
      font-size: 16px;
      font-weight: 500;
      color: #1f2937;
      // 收缩态单行 + 省略号（换行只在编辑态的输入框里）
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
      flex: 1;

      &.is-done {
        text-decoration: line-through;
        color: #9ca3af;
        opacity: 0.7;
      }
    }

    // 随时视图中的今天任务黄色星标
    &__today-star {
      flex-shrink: 0;
    }

    // 随时视图中的今天/今晚标识（勾选框和标题之间）
    &__today-indicator {
      flex-shrink: 0;
    }

    // 日期/图标（固定宽度保证标题对齐）
    &__date-col {
      display: inline-flex;
      align-items: center;
      justify-content: flex-start;
      flex-shrink: 0;
      min-width: 20px;
      margin-top: 4px;
    }

    &__title-input {
      flex: 1;
      font-size: 15px;
      font-weight: 600;
      font-family: inherit;
      line-height: 1.4;
      color: #1f2937;
      border: none;
      outline: none;
      padding: 2px 0;
      background: transparent;
      min-width: 0;
      resize: none; // 靠 autoGrow 自动增高
      overflow: hidden;
      word-break: break-word;
      white-space: pre-wrap;
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
      font-family: inherit;
      color: var(--b3-theme-on-surface);
      background: transparent;
      resize: none;
      overflow: hidden;
      min-height: 20px;
      line-height: 1.5;

      &::placeholder {
        color: #9ca3af;
      }
    }

    // 备注 Markdown 展示态
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

      &:focus {
        min-height: 40px;
      }
    }

    // 备注包裹容器（有内容时显示浅色线框 + 编辑/完成按钮）
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

      // 编辑态 textarea 去掉顶部内边距（由 wrap 提供）
      .task-card__notes {
        padding: 0;
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

      .task-card__notes-wrap:hover & {
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

      .task-card__notes-wrap:hover & {
        opacity: 1;
      }

      &:hover {
        background: #f3f4f6;
        color: #374151;
      }
    }

    &__notes-placeholder {
      font-size: 13px;
      color: #9ca3af;
      cursor: pointer;

      &:hover {
        color: #6b7280;
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

    &__ai-warning {
      margin-bottom: 8px;
      padding: 6px 8px;
      border-radius: 6px;
      background: var(--b3-card-warning-background, #fff7e6);
      color: var(--b3-card-warning-color, #8a5a00);
      font-size: 11px;
      line-height: 1.5;
    }

    &__create-btn {
      min-width: 56px;
      height: 28px;
      margin-left: 4px;
      padding: 0 12px;
      border: 0;
      border-radius: 7px;
      background: var(--b3-theme-primary);
      color: var(--b3-theme-on-primary);
      font: inherit;
      font-size: 12px;
      cursor: pointer;

      &:hover { filter: brightness(0.94); }
      &:disabled { opacity: 0.6; cursor: default; }
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

      // 截止提醒：红色系，与开始提醒（琥珀色）区分
      &--reminder-deadline {
        gap: 4px;
        padding: 2px 8px;
        background: #fee2e2;
        color: #dc2626;
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
        background: var(--b3-list-hover);
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
      color: var(--b3-theme-on-surface-light);
      font-size: 12px;
      border-radius: 50%;

      &:hover {
        background: var(--b3-list-hover);
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

  @keyframes task-ai-focus {
    0%, 35% { background: rgba(59, 127, 240, 0.18); box-shadow: 0 0 0 3px rgba(59, 127, 240, 0.16); }
    100% { background: transparent; box-shadow: none; }
  }

  .task-card__repeat-icon {
    font-size: 15px;
    line-height: 1;
  }

  .task-card__repeat-icon--tool {
    font-size: 19px;
  }

  .task-card__repeat-menu {
    width: 172px;
    padding: 6px;
  }

  .task-card__repeat-menu button {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border: 0;
    border-radius: 6px;
    padding: 7px 9px;
    color: var(--b3-theme-on-background);
    background: transparent;
    cursor: pointer;
    font-size: 13px;
  }

  .task-card__repeat-menu button:hover,
  .task-card__repeat-menu button.is-active {
    background: var(--b3-list-hover);
    color: var(--b3-theme-primary);
  }
</style>
