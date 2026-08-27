<script lang="ts">
  import { onMount, tick, getContext } from "svelte";
  import { cubicOut } from "svelte/easing";
  import { flip } from "svelte/animate";
  import { slide } from "svelte/transition";
  import TaskCard from "./TaskCard.svelte";
  import DragSort from "./DragSort.svelte";
  import type { ViewType, Task } from "@/types";
  import type { StoreManager } from "@/stores";
  import { showMessage } from "siyuan";
  import { Icon, getViewIconId, ICON_COLORS } from "@/icons";
  import ProjectPanel from "./ProjectPanel.svelte";
  import AreaPanel from "./AreaPanel.svelte";
  import EntityForm from "./EntityForm.svelte";
  import ProjectOverview from "./ProjectOverview.svelte";
  import AreaOverview from "./AreaOverview.svelte";
  import TagOverview from "./TagOverview.svelte";
  import { normalizeProjectGroupOrder } from "@/utils/projectGrouping";

  export let view: ViewType;
  export let viewId: string | undefined;
  export let searchQuery: string;
  export let store: StoreManager;
  // AI 展示形态（设计文档状态机）：
  // full=AI 面板独立列；button=右下角 ✧ FAB；header=Header 内 ✦＋；compact=Header 仅小 ✦
  export let aiMode: 'full' | 'button' | 'header' | 'compact' = 'button';
  export let aiEnabled: boolean = true;
  // AI 浮窗打开时隐藏整个 FAB 组
  export let hideFabs: boolean = false;

  // 获取 plugin 实例（从 App.svelte 的 context 中）
  const plugin = getContext<any>("plugin");

  let showCreateForm = false;
  let showEntityForm: "project" | "area" | null = null;
  const COMPLETED_GROUP = "__completed__";

  // 创建卡片在列表中的插入位置（null = 顶部）；仅当对应分组存在时生效
  let createTarget: { group: string; index: number } | null = null;
  $: activeCreateSlot = showCreateForm && createTarget && groupedTasks.has(createTarget.group) ? createTarget : null;
  // 创建卡片继承落点分组的日期：今晚→18:00、日期组→当天、月度组→月初（或窗口后一天）
  $: createPreset = computeCreatePreset(activeCreateSlot, view);

  function computeCreatePreset(slot: { group: string; index: number } | null, v: string): { startDate: number | undefined } {
    if (!slot) return { startDate: undefined };
    const g = slot.group;
    if (v === "today") {
      const d = new Date();
      d.setHours(g === "今晚" ? 18 : 0, 0, 0, 0);
      return { startDate: d.getTime() };
    }
    if (v === "upcoming") {
      if (g.startsWith("m-")) {
        const parts = g.slice(2).split("-").map(Number);
        const monthStart = new Date(parts[0], parts[1], 1);
        const afterWindow = new Date();
        afterWindow.setHours(0, 0, 0, 0);
        afterWindow.setDate(afterWindow.getDate() + 8); // 月度组从近 7 天窗口后一天接棒
        const d = monthStart.getTime() < afterWindow.getTime() ? afterWindow : monthStart;
        return { startDate: d.getTime() };
      }
      const ts = Number(g); // 日期组的 key 即当天 0 点时间戳
      if (!isNaN(ts)) return { startDate: ts };
    }
    return { startDate: undefined };
  }
  let refreshKey = 0;
  let itemsEl: HTMLElement;
  let searchInput: HTMLInputElement;

  // 跨组拖拽：按分组 key 注册 DragSort 实例与分组块 DOM
  let dragSortRefs: Record<string, DragSort> = {};
  let groupBlockRefs: Record<string, HTMLElement> = {};
  let dragFromGroup: string | null = null;
  let dragOverGroup: string | null = null;

  // 项目标题分组（headings）的内联管理状态
  let editingHeadingId: string | null = null;
  let addingHeading = false;
  let headingDraft = "";
  let headingAddInputEl: HTMLInputElement;

  // 手动切换视图时置 true，抑制旧视图任务的退场动画（见下方视图切换块）
  let suppressOutro = false;

  // 任务移出列表的退场动画（完成移入日志 / 视图迁移时播放）：
  // 收缩+淡出（高度塌缩、列表自动收拢），替代原来的快速左滑
  function slideOut(node: HTMLElement, { duration = 300 }: { duration?: number } = {}) {
    const h = node.offsetHeight;
    return {
      // 切换视图时持续 0（立即移除）：否则旧任务 300ms 退场期间仍占布局高度，
      // 列表高度先胀后缩、滚动位置被钳制，视觉上整个列表"往上弹一下"
      duration: suppressOutro ? 0 : duration,
      easing: cubicOut,
      css: (t: number) => `opacity: ${t}; height: ${Math.max(0, t * h)}px; overflow: hidden; margin: 0;`,
    };
  }

  // 监听全部 store 变化（任务/项目/区域/标签——项目改名、状态切换、标签增删等都要实时刷新）
  onMount(() => {
    const bump = () => refreshKey++;
    const unsubs = [
      store.tasks.on(bump),
      store.projects.on(bump),
      store.areas.on(bump),
      store.tags.on(bump),
    ];
    return () => {
      unsubs.forEach((u) => u());
      document.removeEventListener("mousedown", onHeadingInputOutside);
    };
  });

  $: if (view === "search" && searchInput) {
    tick().then(() => searchInput?.focus());
  }

  // 根据视图获取任务列表 - 使用响应式声明确保视图切换时刷新
  $: tasks = getTasks(view, viewId, searchQuery, refreshKey, store.tasks.count);

  // 随时视图排序逻辑（也用于标签/项目/区域视图）
  // 顺序：今天白天⭐️ → 今晚🌙 → 其他有日期（升序） → 无日期（保留order） → 已完成沉底
  function sortByAnytimeRules(tasks: Task[]): Task[] {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartTs = todayStart.getTime();
    const todayEndTs = todayStartTs + 86400000;
    const isToday = (ts?: number) => !!ts && ts >= todayStartTs && ts < todayEndTs;
    const isTonight = (ts?: number) => {
      if (!ts) return false;
      const d = new Date(ts);
      return d.getHours() === 18 && d.getMinutes() === 0;
    };
    return [...tasks].sort((a, b) => {
      // 已完成任务沉底
      const aDone = a.status === 'done' ? 1 : 0;
      const bDone = b.status === 'done' ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;

      const aDate = a.startDate || a.deadline;
      const bDate = b.startDate || b.deadline;
      const aIsToday = isToday(aDate);
      const bIsToday = isToday(bDate);
      const aIsTonight = isTonight(aDate);
      const bIsTonight = isTonight(bDate);
      // 今天白天（⭐️）在最上面
      const aIsDaytime = aIsToday && !aIsTonight;
      const bIsDaytime = bIsToday && !bIsTonight;
      if (aIsDaytime && !bIsDaytime) return -1;
      if (!aIsDaytime && bIsDaytime) return 1;
      if (aIsDaytime && bIsDaytime) return b.created - a.created;
      // 今晚（🌙）在第二
      if (aIsTonight && !bIsTonight) return -1;
      if (!aIsTonight && bIsTonight) return 1;
      if (aIsTonight && bIsTonight) return b.created - a.created;
      // 其他今天任务
      if (aIsToday && !bIsToday) return -1;
      if (!aIsToday && bIsToday) return 1;
      if (aIsToday && bIsToday) return b.created - a.created;
      // 无日期的排在最后（保留order排序，支持拖拽）
      if (!aDate && !bDate) return a.order - b.order;
      if (!aDate) return 1;
      if (!bDate) return -1;
      // 其他有日期的：时间越靠前越在上面
      return aDate - bDate;
    });
  }

  function getTasks(view: ViewType, viewId?: string, query?: string, _key?: number, _count?: number): Task[] {
    if (view === "search") {
      return searchTasks(query || "");
    }

    switch (view) {
      case "inbox":
        return store.tasks.getInboxTasks();
      case "today":
        return store.tasks.getTodayTasks();
      case "upcoming":
        return store.tasks.getUpcomingTasks().sort((a, b) => (a.startDate || 0) - (b.startDate || 0));
      case "anytime":
        return sortByAnytimeRules(store.tasks.getAnytimeTasks());
      case "someday":
        return store.tasks.getSomedayTasks();
      case "log":
        return store.tasks.getCompletedTasks();
      case "projects":
        return []; // 项目总览不渲染任务列表，由 ProjectOverview 接管
      case "areas":
        return []; // 区域总览由 AreaOverview 接管
      case "tags":
        return []; // 标签总览由 TagOverview 接管
      case "project":
        return viewId
          ? sortByAnytimeRules(store.tasks.getProjectTasks(viewId).filter((task) => task.status !== 'canceled'))
          : [];
      case "area":
        if (!viewId) return [];
        return sortByAnytimeRules(store.tasks
          .getAll()
          .filter((t) => t.status !== 'canceled' && !t.parentId && t.areaId === viewId && !t.projectId));
      case "tag":
        return viewId
          ? sortByAnytimeRules(store.tasks.getAll().filter((task) =>
              task.status !== 'canceled' && !task.parentId && task.tags.includes(viewId)
            ))
          : [];
      default:
        return [];
    }
  }

  function normalizeSearchText(value: unknown): string {
    return String(value || "").toLocaleLowerCase().replace(/\s+/g, " ").trim();
  }

  function searchTasks(query: string): Task[] {
    const terms = normalizeSearchText(query).split(" ").filter(Boolean);
    if (!terms.length) return [];

    // 建立产品视图语义索引：用户搜索“今天”等词时，应得到该视图中的任务，
    // 而不是要求标题或备注里真的写有“今天”。
    const inboxIds = new Set(store.tasks.getInboxTasks().map((task) => task.id));
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setHours(23, 59, 59, 999);
    const todayIds = new Set([
      ...store.tasks.getTodayTasks().map((task) => task.id),
      // 日志中的“今天”按完成时间分组；搜索“今天”也应包含今天完成的任务。
      ...store.tasks.getCompletedTasks()
        .filter((task) => !!task.completedDate && task.completedDate >= todayStart.getTime() && task.completedDate <= todayEnd.getTime())
        .map((task) => task.id),
    ]);
    const upcomingIds = new Set(store.tasks.getUpcomingTasks().map((task) => task.id));
    const anytimeIds = new Set(store.tasks.getAnytimeTasks().map((task) => task.id));
    const somedayIds = new Set(store.tasks.getSomedayTasks().map((task) => task.id));
    const completedIds = new Set(store.tasks.getCompletedTasks().map((task) => task.id));
    const canceledIds = new Set(store.tasks.getCanceledTasks().map((task) => task.id));

    return store.tasks.getAll()
      .filter((task) => !task.parentId)
      .map((task) => {
        const project = task.projectId ? store.projects.get(task.projectId) : undefined;
        const directArea = task.areaId ? store.areas.get(task.areaId) : undefined;
        const projectArea = project?.areaId ? store.areas.get(project.areaId) : undefined;
        const heading = project?.headings?.find((item) => item.id === task.headingId);
        const tags = (task.tags || []).map((id) => store.tags.get(id)?.name || "");
        const checklist = store.tasks.getSubTasks(task.id).map((item) => item.title);
        const statusText = task.status === "done" ? "已完成 完成 日志" : task.status === "canceled" ? "已取消 取消" : "未完成 待办 进行中";
        const viewText = [
          inboxIds.has(task.id) ? "收件箱" : "",
          todayIds.has(task.id) ? "今天 今日" : "",
          upcomingIds.has(task.id) ? "计划 未来 即将到来" : "",
          anytimeIds.has(task.id) ? "随时" : "",
          somedayIds.has(task.id) ? "某天" : "",
          completedIds.has(task.id) ? "日志 已完成" : "",
          canceledIds.has(task.id) ? "已取消" : "",
        ];
        const dateText = [task.startDate, task.deadline, task.completedDate]
          .filter((value): value is number => typeof value === "number")
          .map((value) => new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }));
        const fields = [
          task.title, task.notes, project?.name, directArea?.name, projectArea?.name,
          heading?.title, ...tags, ...checklist, statusText, ...viewText,
          task.someday ? "某天" : "", task.repeatRule ? `重复 ${task.repeatRule}` : "", ...dateText,
        ];
        const haystack = normalizeSearchText(fields.join(" "));
        if (!terms.every((term) => haystack.includes(term))) return null;
        const title = normalizeSearchText(task.title);
        const score = terms.reduce((total, term) => total + (title.startsWith(term) ? 4 : title.includes(term) ? 2 : 0), 0);
        return { task, score };
      })
      .filter((item): item is { task: Task; score: number } => item !== null)
      .sort((a, b) => b.score - a.score || Number(a.task.status === "done") - Number(b.task.status === "done") || b.task.updated - a.task.updated)
      .map((item) => item.task);
  }

  function getSearchMatchLabels(task: Task): string[] {
    const query = normalizeSearchText(searchQuery);
    if (!query) return [];
    const labels: string[] = [];
    const project = task.projectId ? store.projects.get(task.projectId) : undefined;
    const area = task.areaId ? store.areas.get(task.areaId) : project?.areaId ? store.areas.get(project.areaId) : undefined;
    const tags = (task.tags || []).map((id) => store.tags.get(id)?.name || "").filter(Boolean);
    const checklistMatch = store.tasks.getSubTasks(task.id).some((item) => normalizeSearchText(item.title).includes(query));
    if (normalizeSearchText(task.notes).includes(query)) labels.push("备注");
    if (project && normalizeSearchText(project.name).includes(query)) labels.push(`项目 · ${project.name}`);
    if (area && normalizeSearchText(area.name).includes(query)) labels.push(`区域 · ${area.name}`);
    const tag = tags.find((name) => normalizeSearchText(name).includes(query));
    if (tag) labels.push(`标签 · ${tag}`);
    if (checklistMatch) labels.push("检查项");
    return labels.slice(0, 3);
  }

  // 排序 - 使用 order 字段（随时/标签/项目/区域视图已在 getTasks 中按日期排序，不再重排）
  $: sortedTasks = (view === 'anytime' || view === 'tag' || view === 'project' || view === 'area') ? tasks : sortTasks(tasks);

  function sortTasks(tasks: Task[]): Task[] {
    return [...tasks].sort((a, b) => {
      // 已完成任务沉底
      const aDone = a.status === 'done' ? 1 : 0;
      const bDone = b.status === 'done' ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      // 同状态内按 order 排
      if (a.order !== b.order) return a.order - b.order;
      return b.created - a.created;
    });
  }

  // 分组：今天=今天/今晚；计划=日期+月份骨架；项目=标题分组；项目/区域/标签另设已完成组
  $: groupedTasks = groupTasks(sortedTasks, view, viewId);

  // 视图切换（侧边栏点击走 thingsApp.$set，组件不重建，只改 view/viewId/searchQuery）：
  // ① 抑制退场动画防弹跳；② 滚动回顶部（新视图从头看）。
  // 时序安全：响应式在 DOM 更新前执行，outro 在 DOM 更新中创建，suppressOutro 来得及生效。
  let lastNavKey = `${view}|${viewId}|${searchQuery}`;
  $: {
    const navKey = `${view}|${viewId}|${searchQuery}`;
    if (navKey !== lastNavKey) {
      lastNavKey = navKey;
      suppressOutro = true;
      // 切换侧边栏视图时关闭当前视图的临时编辑态，避免新建卡片被带到新页面。
      showCreateForm = false;
      createTarget = null;
      createDestView = undefined;
      createDestViewId = undefined;
      addingHeading = false;
      editingHeadingId = null;
      headingDraft = "";
      document.removeEventListener("mousedown", onHeadingInputOutside);
      if (itemsEl) itemsEl.scrollTop = 0;
      tick().then(() => { suppressOutro = false; });
    }
  }

  // 判断是否为“今晚”任务（今天 18:00）
  function isThisEvening(ts?: number): boolean {
    if (!ts) return false;
    const d = new Date(ts);
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate() &&
      d.getHours() === 18 &&
      d.getMinutes() === 0
    );
  }

  function groupTasks(tasks: Task[], view: ViewType, viewId?: string): Map<string, Task[]> {
    // 今天视图：今天/今晚两组始终显示（即使没有任务）
    if (view === "today") {
      const day: Task[] = [];
      const evening: Task[] = [];
      for (const t of tasks) {
        if (isThisEvening(t.startDate)) evening.push(t);
        else day.push(t);
      }
      return new Map<string, Task[]>([["今天", day], ["今晚", evening]]);
    }

    // 项目视图：按标题分组（headings）展示，组 key = headingId，无标题的任务归入 "none"。
    // "未分组" 始终显示（与今天/今晚常驻一致）——否则没有标题时任务平铺、
    // 加第一个标题后所有任务突然挪进"未分组"，观感像"添加了东西任务才出现"
    if (view === "project" && viewId) {
      const project = store.projects.get(viewId);
      const headings = project?.headings?.length
        ? [...project.headings].sort((a, b) => a.order - b.order)
        : [];
      const displayOrder = normalizeProjectGroupOrder(headings, project?.groupOrder);
      const groups = new Map<string, Task[]>();
      for (const groupId of displayOrder) groups.set(groupId, []);
      const completed: Task[] = [];
      for (const t of tasks) {
        if (t.status === "done") {
          completed.push(t);
          continue;
        }
        if (t.headingId && groups.has(t.headingId)) groups.get(t.headingId)!.push(t);
        else groups.get("none")!.push(t);
      }
      for (const arr of groups.values()) {
        arr.sort((a, b) => {
          if (a.order !== b.order) return a.order - b.order;
          return b.created - a.created;
        });
      }
      if (completed.length) {
        completed.sort((a, b) => (b.completedDate || b.updated) - (a.completedDate || a.updated));
        groups.set(COMPLETED_GROUP, completed);
      }
      return groups;
    }

    // 日志视图：按完成时间分组——最上面"今天"，其后按月份倒序（同计划视图月度组头样式）
    if (view === "log") {
      const groups = new Map<string, Task[]>();
      const today: Task[] = [];
      const byMonth = new Map<string, Task[]>();
      const now = new Date();
      const tsOf = (t: Task) => t.completedDate || t.updated;
      for (const t of tasks) {
        const d = new Date(tsOf(t));
        if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
          today.push(t);
        } else {
          const mk = `${d.getFullYear()}-${d.getMonth()}`;
          if (!byMonth.has(mk)) byMonth.set(mk, []);
          byMonth.get(mk)!.push(t);
        }
      }
      const descByDone = (a: Task, b: Task) => tsOf(b) - tsOf(a);
      if (today.length) groups.set("log-today", today.sort(descByDone));
      const monthKeys = [...byMonth.keys()].sort((a, b) => {
        const [ay, am] = a.split("-").map(Number);
        const [by, bm] = b.split("-").map(Number);
        return by * 12 + bm - (ay * 12 + am); // 月份倒序
      });
      for (const mk of monthKeys) {
        const [y, m] = mk.split("-").map(Number);
        groups.set(`m-${y}-${m}`, byMonth.get(mk)!.sort(descByDone));
      }
      return groups;
    }

    // 区域、标签详情：未完成任务保持原有顺序，已完成任务集中到底部分组，
    // 并按完成时间倒序，最近完成的排在最前。
    if (view === "area" || view === "tag") {
      const active = tasks.filter((task) => task.status !== "done");
      const completed = tasks
        .filter((task) => task.status === "done")
        .sort((a, b) => (b.completedDate || b.updated) - (a.completedDate || a.updated));
      const groups = new Map<string, Task[]>([["all", active]]);
      if (completed.length) groups.set(COMPLETED_GROUP, completed);
      return groups;
    }

    if (view !== "upcoming") {
      return new Map([["all", tasks]]);
    }

    // 计划视图：固定骨架 = 明天起 7 个日期分组 + 其后 5 个月度分组，有无任务都显示。
    // 日期组 key = 当天 0 点时间戳字符串；月度组 key = "m-YYYY-M"。
    // 月度起点取"近 7 天窗口后一天（第 8 天）所在月"：窗口跨月或正好到月底时，
    // 月度组都从窗口结束后的下一天所在月开始，避免与窗口重叠或出现空白月份组；
    // 若窗口已含某月 1 号，那几天已在日期组里，月份组只承接其后的任务。
    const groups = new Map<string, Task[]>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 1; i <= 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      groups.set(String(d.getTime()), []);
    }
    const dayEnd = new Date(today);
    dayEnd.setDate(dayEnd.getDate() + 8);
    for (let i = 0; i < 5; i++) {
      const md = new Date(dayEnd.getFullYear(), dayEnd.getMonth() + i, 1);
      groups.set(`m-${md.getFullYear()}-${md.getMonth()}`, []);
    }

    // 任务归属：7 天内按天入组，更远按月入组（超出 5 个月窗口的不显示）；
    // 组内按 order 字段排序（保住手动拖拽排序的结果），组间顺序即骨架顺序。
    for (const task of tasks) {
      if (!task.startDate) continue;
      const d = new Date(task.startDate);
      d.setHours(0, 0, 0, 0);
      const dayKey = String(d.getTime());
      const bucket = groups.has(dayKey) ? dayKey : `m-${d.getFullYear()}-${d.getMonth()}`;
      groups.get(bucket)?.push(task);
    }
    for (const arr of groups.values()) {
      arr.sort((a, b) => {
        // 已完成任务沉底
        const aDone = a.status === 'done' ? 1 : 0;
        const bDone = b.status === 'done' ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        if (a.order !== b.order) return a.order - b.order;
        return b.created - a.created;
      });
    }
    return groups;
  }

  const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  // 分组头：日期组 → 大数字 + 描述（今天/明天/N天后/周几）；月度组（"m-YYYY-M"）→ M/1 + 月份名
  function groupHeader(key: string): { num: string; label: string } {
    // 日志视图"今天"组（今天完成的任务置顶）
    if (key === "log-today") return { num: "", label: "今天" };
    if (key.startsWith("m-")) {
      const [y, m] = key.slice(2).split("-").map(Number);
      return {
        num: `${m + 1}/1`,
        label: new Date(y, m, 1).toLocaleDateString("zh-CN", { month: "long" }),
      };
    }
    const d = new Date(Number(key));
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const diff = Math.round((d.getTime() - now.getTime()) / 86400000);
    // 近 7 天日期组：第一项显示"明天"，其余 6 项显示星期几
    const label = diff === 0 ? "今天" : diff === 1 ? "明天" : WEEKDAYS[d.getDay()];
    return { num: String(d.getDate()), label };
  }

  // 是否带具体时刻（时/分非零）→ 计划视图中渲染为日程行
  function hasTimeOfDay(ts?: number): boolean {
    if (!ts) return false;
    const d = new Date(ts);
    return d.getHours() !== 0 || d.getMinutes() !== 0;
  }

  // —— 项目标题分组管理 ——
  function startHeadingRename(heading?: { id: string; title: string }) {
    if (!heading) return;
    editingHeadingId = heading.id;
    headingDraft = heading.title;
    // 点输入框以外即提交收起——不能只靠 blur：任务卡片 mousedown preventDefault 会吞掉失焦
    setTimeout(() => document.addEventListener("mousedown", onHeadingInputOutside), 0);
  }

  function startAddHeading() {
    addingHeading = true;
    headingDraft = "";
    setTimeout(() => document.addEventListener("mousedown", onHeadingInputOutside), 0);
    // 输入框渲染在项目内容最上方，只需等待 DOM 挂载后聚焦。
    tick().then(() => headingAddInputEl?.focus());
  }

  function onHeadingInputOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest(".task-list__heading-input")) return; // 点输入框自身：保持编辑
    document.removeEventListener("mousedown", onHeadingInputOutside);
    if (editingHeadingId && projectObj) {
      commitHeadingRename(projectObj.id, editingHeadingId);
    } else if (addingHeading) {
      addingHeading = false;
      headingDraft = "";
    }
  }

  async function commitHeadingRename(projectId: string, headingId: string) {
    const title = headingDraft.trim();
    // 先清空状态再写库：输入框卸载触发的 blur 会再调一次，状态已空即为空操作，不会重复改名
    headingDraft = "";
    editingHeadingId = null;
    if (title) {
      await store.projects.updateHeading(projectId, headingId, title);
    }
  }

  async function removeHeading(projectId: string, headingId: string) {
    // 组内任务回到未分组（批量一次提交），再删标题
    const members = sortedTasks.filter((t) => t.headingId === headingId);
    if (members.length) {
      await store.tasks.updateTasksBatch(
        members.map((t) => ({ id: t.id, changes: { headingId: undefined } })),
      );
    }
    await store.projects.deleteHeading(projectId, headingId);
  }

  async function commitAddHeading() {
    const title = headingDraft.trim();
    // 先清空状态再写库：blur 重复触发即为空操作，不会重复建分组
    addingHeading = false;
    headingDraft = "";
    if (title && view === "project" && viewId) {
      await store.projects.addHeading(viewId, title);
    }
  }

  // —— 分组折叠：真实标题写入 heading.collapsed；进行中/已完成写入所属实体 ——

  function isGroupCollapsed(group: string): boolean {
    if (!viewId) return false;
    if (view === "project" && group !== "none" && group !== COMPLETED_GROUP) {
      return !!projectObj?.headings.find((heading) => heading.id === group)?.collapsed;
    }
    const stateKey = group === COMPLETED_GROUP ? "completed" : "active";
    if (view === "project") return !!projectObj?.collapsedGroups?.[stateKey];
    if (view === "area") return !!areaObj?.collapsedGroups?.[stateKey];
    if (view === "tag") return !!store.tags.get(viewId)?.collapsedGroups?.[stateKey];
    return false;
  }

  async function toggleGroupCollapse(group: string) {
    if (!viewId) return;
    if (view === "project" && group !== "none" && group !== COMPLETED_GROUP) {
      const heading = projectObj?.headings.find((item) => item.id === group);
      if (heading) await store.projects.setHeadingCollapsed(viewId, group, !heading.collapsed);
      return;
    }

    const stateKey = group === COMPLETED_GROUP ? "completed" : "active";
    const collapsed = !isGroupCollapsed(group);
    if (view === "project" && projectObj) {
      await store.projects.updateProject(viewId, { collapsedGroups: { ...(projectObj.collapsedGroups || {}), [stateKey]: collapsed } });
    } else if (view === "area" && areaObj) {
      await store.areas.updateArea(viewId, { collapsedGroups: { ...(areaObj.collapsedGroups || {}), [stateKey]: collapsed } });
    } else if (view === "tag") {
      const tag = store.tags.get(viewId);
      if (tag) await store.tags.updateTag(viewId, { collapsedGroups: { ...(tag.collapsedGroups || {}), [stateKey]: collapsed } });
    }
  }

  // —— 标题分组拖拽排序（HTML5 DnD；任务拖拽走 DragSort 的鼠标模拟，二者互不影响） ——
  let headingDragId: string | null = null;
  let headingDropTarget: { id: string; pos: "before" | "after" } | null = null;

  function handleHeadingDragStart(e: DragEvent, group: string) {
    if (group === COMPLETED_GROUP || editingHeadingId === group) return;
    headingDragId = group;
    e.dataTransfer?.setData("text/plain", group); // Firefox 需要 setData 才会启动拖拽
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }

  function handleHeadingDragOver(e: DragEvent, group: string) {
    if (group === COMPLETED_GROUP || !headingDragId || headingDragId === group) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pos = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
    if (headingDropTarget?.id !== group || headingDropTarget?.pos !== pos) {
      headingDropTarget = { id: group, pos };
    }
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  }

  async function handleHeadingDrop() {
    const dragId = headingDragId;
    const target = headingDropTarget;
    headingDragId = null;
    headingDropTarget = null;
    if (!projectObj || !viewId || !dragId || !target || dragId === target.id) return;

    const groups = [...groupedTasks.keys()].filter((id) => id !== COMPLETED_GROUP);
    const fromIdx = groups.indexOf(dragId);
    if (fromIdx < 0) return;
    const [moved] = groups.splice(fromIdx, 1);
    let toIdx = groups.indexOf(target.id);
    if (toIdx < 0) {
      groups.push(moved);
    } else {
      if (target.pos === "after") toIdx += 1;
      groups.splice(toIdx, 0, moved);
    }
    await store.projects.reorderHeadings(viewId, groups);
  }

  function handleHeadingDragEnd() {
    headingDragId = null;
    headingDropTarget = null;
  }

  function handleCancelCreate() {
    showCreateForm = false;
    createTarget = null;
  }

  // 创建卡片的目标视图上下文（显式携带，不从渲染状态推断——
  // 拖 + 切视图与卡片挂载存在时序差，靠 currentView 推断会让任务落错视图）
  let createDestView: ViewType | undefined = undefined;
  let createDestViewId: string | undefined = undefined;

  // 打开创建卡片：target=null → 顶部；否则插入到指定分组/索引处
  function openCreate(target: { group: string; index: number } | null, dest?: { view: ViewType; viewId?: string }) {
    createTarget = target;
    createDestView = dest?.view;
    createDestViewId = dest?.viewId;
    showCreateForm = true;
  }

  // 区域详情页的任务有独立区块，普通“+”新建应在该区块内展开，
  // 而不是出现在区域备注上方。其他视图维持原有顶部新建行为。
  function getDefaultCreateTarget(targetView: ViewType): { group: string; index: number } | null {
    return targetView === "area" ? { group: "all", index: 0 } : null;
  }

  // ========== AI 创建器入口：派发事件，由 App 外壳打开浮窗 ==========
  function openAICreator(target: { group: string; index: number } | null, dest?: { view: ViewType; viewId?: string }) {
    // 计算预设日期（同 createPreset 逻辑）
    const presetDate = computeCreatePreset(target, dest?.view || view)?.startDate;
    window.dispatchEvent(new CustomEvent("things-open-ai", {
      detail: {
        destView: dest?.view,
        destViewId: dest?.viewId,
        presetDate,
      },
    }));
  }

  // Header 内 AI 按钮点击（无落点上下文）
  function openAICreatorDefault() {
    openAICreator(null, { view, viewId });
  }

  // 创建完成后：把新任务挪到插入位置（在当前视图内重写 order）
  async function handleTaskCreated(e: CustomEvent) {
    const created = e?.detail?.task;
    const target = createTarget;
    showCreateForm = false;
    createTarget = null;
    if (!created || !target) return;
    await tick(); // 等待列表把新任务纳入
    const list = sortedTasks;
    const curIdx = list.findIndex((t) => t.id === created.id);
    if (curIdx < 0) return; // 新任务不属于当前视图（如计划视图里建了无日期任务），不处理
    let flatIdx = 0;
    let found = false;
    for (const [gk, items] of groupedTasks) {
      if (gk === target.group) {
        flatIdx += Math.min(target.index, items.length);
        found = true;
        break;
      }
      flatIdx += items.length;
    }
    if (!found || flatIdx === curIdx) return;
    const reordered = [...list];
    const [moved] = reordered.splice(curIdx, 1);
    reordered.splice(flatIdx, 0, moved);
    await store.tasks.updateTasksBatch(reordered.map((t, i) => ({ id: t.id, changes: { order: i } })));
  }

  // 处理拖拽排序
  // DragSort 的 fromIndex/toIndex 是组内相对索引（每个分组各有一个 DragSort 实例），
  // 必须先映射回全局列表，否则多分组视图（今天/今晚、计划按日期分组）会移错任务。
  async function handleReorder(e: CustomEvent, groupItems: Task[]) {
    const { fromIndex, toIndex } = e.detail;
    if (fromIndex === toIndex || !groupItems?.length) return;

    // 组内应用本次移动（DragSort 插入语义：先从原位移除，再插入目标位）
    const reordered = [...groupItems];
    const [movedTask] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, movedTask);

    // 将分组新顺序原位写回全局列表：组外任务（含未在当前视图展示的任务）槽位不变
    const groupIds = new Set(groupItems.map((t) => t.id));
    let gi = 0;
    const newTasks = [...sortedTasks].map((t) => (groupIds.has(t.id) ? reordered[gi++] : t));

    // 更新任务的 order：整批一次提交（单次落盘 + 单次通知）。
    // 逐条 updateTask 会触发 N 次全量重渲染，中间态排序来回穿插，列表会抖动数秒。
    await store.tasks.updateTasksBatch(newTasks.map((t, i) => ({ id: t.id, changes: { order: i } })));
  }

  // —— 跨组拖拽（今天视图：今天/今晚；计划视图：各日期分组）→ 任务日期随落点分组调整 ——
  function blockContains(group: string, clientY: number): boolean {
    const el = groupBlockRefs[group];
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return clientY >= r.top && clientY <= r.bottom;
  }

  function trackDragOver(e: MouseEvent) {
    let over: string | null = null;
    for (const key of Object.keys(dragSortRefs)) {
      if (key === COMPLETED_GROUP) continue;
      if (blockContains(key, e.clientY)) {
        over = key;
        break;
      }
    }
    // 悬停组变化时，收起上一个目标组的避让槽位与指引线
    if (dragOverGroup && dragOverGroup !== over && dragOverGroup !== dragFromGroup) {
      dragSortRefs[dragOverGroup]?.clearGap();
    }
    dragOverGroup = over;
    // 跨组拖拽：在目标组内撑开槽位（后续任务下移避让）+ 指引线；
    // 槽位高度 = 被拖任务高度（从源组 DragSort 取）
    if (over && over !== dragFromGroup && dragSortRefs[over]) {
      const gapH = dragSortRefs[dragFromGroup!]?.getItemHeight() || 40;
      dragSortRefs[over].showGapAt(e.clientY, gapH);
    }
  }

  function handleGroupDragStart(group: string) {
    dragFromGroup = group;
    document.addEventListener("mousemove", trackDragOver);
    document.addEventListener("mousemove", trackNavHover);
  }

  function handleGroupDragEnd() {
    // 清理所有分组可能残留的避让位移与指引线（源组位移由 DragSort cleanup 处理，目标组在这里）
    for (const key of Object.keys(dragSortRefs)) {
      dragSortRefs[key]?.clearGap();
    }
    dragFromGroup = null;
    dragOverGroup = null;
    document.removeEventListener("mousemove", trackDragOver);
    clearNavHover();
  }

  // 落点不在源分组内 → 把任务日期改到落点分组
  function handleDrop(e: CustomEvent) {
    const { id, clientX, clientY, fromGroup, withinSelf } = e.detail;
    if (withinSelf) return;

    // 优先判定侧边栏落点：拖任务到「某天/收件箱/今天/随时/日志/项目/区域」直接转换归属
    const nav = acceptableNavAt(clientX, clientY);
    if (nav) {
      moveTaskToView(id, nav.dataset.view as ViewType, nav.dataset.id);
      return;
    }

    // 其余：列表内跨组落点
    for (const key of Object.keys(dragSortRefs)) {
      if (key === COMPLETED_GROUP || key === fromGroup || !blockContains(key, clientY)) continue;
      const toIndex = dragSortRefs[key] ? dragSortRefs[key].computeInsertIndex(clientY) : 0;
      moveTaskToGroup(id, key, toIndex);
      return;
    }
  }

  // 侧边栏上可接收任务拖入的视图（计划需要具体日期不接收、标签/总览页不接收）
  function acceptableNavAt(x: number, y: number): HTMLElement | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const nav = el?.closest(".things-nav__item[data-view]") as HTMLElement | null;
    if (!nav) return null;
    const nv = nav.dataset.view;
    if (nv === "someday" || nv === "inbox" || nv === "today" || nv === "anytime" || nv === "log") return nav;
    if ((nv === "project" || nv === "area") && nav.dataset.id) return nav;
    return null;
  }

  // 任务拖拽中：悬停可接收的侧边栏视图时高亮（与 FAB 拖拽同款 is-drop-hover）
  function trackNavHover(e: MouseEvent) {
    document.querySelectorAll(".things-nav__item.is-drop-hover").forEach((n) => n.classList.remove("is-drop-hover"));
    const nav = acceptableNavAt(e.clientX, e.clientY);
    if (nav) nav.classList.add("is-drop-hover");
  }

  function clearNavHover() {
    document.querySelectorAll(".things-nav__item.is-drop-hover").forEach((n) => n.classList.remove("is-drop-hover"));
    document.removeEventListener("mousemove", trackNavHover);
  }

  // 拖任务到侧边栏视图：按目标视图语义转换任务（移动后给出 toast，避免"任务消失了"的错觉）
  async function moveTaskToView(taskId: string, targetView: ViewType, targetId?: string) {
    const task = sortedTasks.find((t) => t.id === taskId);
    if (!task) return;

    let changes: Partial<Task> | null = null;
    let toast = "";
    switch (targetView) {
      case "someday":
        changes = { someday: true, startDate: undefined };
        toast = "已移到某天";
        break;
      case "today": {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        changes = { someday: false, startDate: d.getTime() };
        toast = "已移到今天";
        break;
      }
      case "inbox":
        changes = { someday: false, startDate: undefined, projectId: undefined, areaId: undefined };
        toast = "已移到收件箱";
        break;
      case "anytime":
        changes = { someday: false, startDate: undefined };
        toast = "已移到随时";
        break;
      case "log":
        changes = { status: "done", completedDate: Date.now() };
        toast = "已完成，移入日志";
        break;
      case "project":
        if (targetId) {
          changes = { projectId: targetId, someday: false };
          toast = "已移到项目";
        }
        break;
      case "area":
        if (targetId) {
          changes = { areaId: targetId, someday: false };
          toast = "已移到区域";
        }
        break;
      default:
        return; // 计划/标签/总览页不接收拖入（计划需要具体日期，在视图内按日期组拖）
    }
    if (!changes) return;

    await store.tasks.updateTask(taskId, changes);
    if (toast) showMessage(toast);
  }

  // 跨组移动：由落点分组推算新日期，再原位写回全局 order（与 handleReorder 同机制）
  async function moveTaskToGroup(taskId: string, toGroup: string, toIndex: number) {
    if (toGroup === COMPLETED_GROUP) return;
    const task = sortedTasks.find((t) => t.id === taskId);
    if (!task) return;

    let changes: Partial<Task> | null = null;
    if (view === "upcoming") {
      // 日期组 key = 当天 0 点时间戳；月度组 key = "m-YYYY-M"。
      // 保留任务原有的时/分（日程行拖到新日期仍是同一时刻）。
      // 注意：拖到月度组时目标日期取「月初」与「近 7 天窗口后一天」的较晚者——
      // 若月初（如 8/1）还在日期窗口内，直接落 1 号会让任务掉回日期组而"消失"。
      const nd = toGroup.startsWith("m-")
        ? (() => {
            const [y, m] = toGroup.slice(2).split("-").map(Number);
            const monthStart = new Date(y, m, 1);
            const afterWindow = new Date();
            afterWindow.setHours(0, 0, 0, 0);
            afterWindow.setDate(afterWindow.getDate() + 8); // 近 7 天窗口（明天起 7 天）的后一天
            return monthStart.getTime() < afterWindow.getTime() ? afterWindow : monthStart;
          })()
        : new Date(Number(toGroup));
      if (isNaN(nd.getTime())) return;
      const orig = task.startDate ? new Date(task.startDate) : new Date();
      nd.setHours(orig.getHours(), orig.getMinutes(), 0, 0);
      changes = { startDate: nd.getTime() };
    } else if (view === "today") {
      // 今天组 = 当天 0 点；今晚组 = 当天 18:00（isThisEvening 的判定条件）
      const nd = new Date();
      nd.setHours(toGroup === "今晚" ? 18 : 0, 0, 0, 0);
      changes = { startDate: nd.getTime() };
    } else if (view === "project") {
      // 标题分组互拖：改 headingId（"none"/"all" = 未分组）
      changes = { headingId: toGroup === "none" || toGroup === "all" ? undefined : toGroup };
    } else {
      return;
    }

    const targetMembers = groupedTasks.get(toGroup) || [];
    const newSeq = [...targetMembers];
    newSeq.splice(toIndex, 0, task);
    const affected = new Set([...targetMembers.map((t) => t.id), task.id]);
    let si = 0;
    const newTasks = [...sortedTasks].map((t) => (affected.has(t.id) ? newSeq[si++] : t));

    await store.tasks.updateTasksBatch(
      newTasks.map((t, i) => ({
        id: t.id,
        changes: t.id === taskId ? { ...changes, order: i } : { order: i },
      })),
    );
  }

  // —— 悬浮 + 按钮：点击=当前视图新建；按住可拖到侧边栏视图 / 任务列表，松手即在对应视图新建 ——
  let fabBtnEl: HTMLButtonElement;
  let aiFabBtnEl: HTMLButtonElement;

  // 允许新建任务的侧边栏落点（排除日志/总览页；项目/区域/标签须有具体 id）
  function isCreatableNav(nav: HTMLElement): boolean {
    const view = nav.dataset.view;
    if (!view) return false;
    // 日志、各类总览页、标签视图都不作为拖拽新建落点（标签不承载新建任务）
    if (view === "log" || view === "projects" || view === "areas" || view === "tags" || view === "tag") return false;
    if (view === "project" || view === "area") return !!nav.dataset.id;
    return true; // inbox/today/upcoming/anytime/someday
  }

  // 通用拖拽处理器：支持 "+" 和 "✨" 两个按钮
  function handleFabDragDown(e: MouseEvent, fab: HTMLButtonElement, onDrop: (target: { group: string; index: number } | null, dest: { view: ViewType; viewId?: string }) => void) {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const home = fab.getBoundingClientRect(); // 按钮原位（用于回弹）
    let dragging = false;
    let hoverNav: HTMLElement | null = null;
    let overList = false;
    let openTimer: any = null;        // 侧边栏悬停→延迟切换视图（避免扫过快速切换）
    let indicator: HTMLElement | null = null; // 列表插入位置指示线
    let insertTarget: { group: string; index: number } | null = null; // 插入目标（分组 + 组内索引）

    // 计算插入目标：光标落在哪个分组 + 分组内的索引
    const computeInsertTarget = (cursorY: number): { group: string; index: number } | null => {
      const entries = Object.entries(groupBlockRefs).filter(([key, el]) => key !== COMPLETED_GROUP && el) as [string, HTMLElement][];
      if (entries.length === 0) return null;
      for (const [gk, el] of entries) {
        const r = el.getBoundingClientRect();
        if (cursorY >= r.top && cursorY <= r.bottom) {
          const rows = Array.from(el.querySelectorAll(".task-list__item-wrapper"));
          let idx = rows.length;
          for (let i = 0; i < rows.length; i++) {
            const rc = rows[i].getBoundingClientRect();
            if (cursorY < rc.top + rc.height / 2) { idx = i; break; }
          }
          return { group: gk, index: idx };
        }
      }
      // 兜底：在所有分组之上 → 第一分组最前；在所有分组之下 → 最后分组末尾
      if (cursorY < entries[0][1].getBoundingClientRect().top) return { group: entries[0][0], index: 0 };
      const last = entries[entries.length - 1];
      return { group: last[0], index: last[1].querySelectorAll(".task-list__item-wrapper").length };
    };

    const clearNav = () => {
      document.querySelectorAll(".things-nav__item.is-drop-hover").forEach((el) => el.classList.remove("is-drop-hover"));
      hoverNav = null;
    };
    const cancelOpen = () => {
      if (openTimer) { clearTimeout(openTimer); openTimer = null; }
    };
    const clearIndicator = () => {
      if (indicator) { indicator.remove(); indicator = null; }
      if (itemsEl) itemsEl.classList.remove("is-drop-hover");
      overList = false;
    };

    // 插入指示线：靠近任务行间隙时吸附到插入边界；空分组（无任务行）内则跟随光标，
    // 保证计划视图里每个日期/月份组（含空组）都有提示。移动带过渡动画。
    const moveIndicator = (cursorY: number) => {
      if (!itemsEl) return;
      const rows = Array.from(itemsEl.querySelectorAll(".task-list__item-wrapper")) as HTMLElement[];
      const box = itemsEl.getBoundingClientRect();
      const left = box.left + 72;       // items 有 72px 内边距
      const width = box.width - 144;
      const minTop = box.top + 16;
      const maxBottom = box.bottom - 16;

      let y = cursorY; // 默认跟随光标（空分组里也始终有提示）
      if (rows.length > 0) {
        // 光标所在的行间隙（插入边界）
        let idx = rows.length;
        for (let i = 0; i < rows.length; i++) {
          const rc = rows[i].getBoundingClientRect();
          if (cursorY < rc.top + rc.height / 2) { idx = i; break; }
        }
        let boundary: number;
        if (idx === 0) boundary = rows[0].getBoundingClientRect().top - 5;
        else if (idx >= rows.length) boundary = rows[rows.length - 1].getBoundingClientRect().bottom + 5;
        else boundary = (rows[idx - 1].getBoundingClientRect().bottom + rows[idx].getBoundingClientRect().top) / 2;
        // 光标靠近行间隙就吸附到边界；离得远（落在空分组）则跟随光标
        if (Math.abs(cursorY - boundary) <= 30) y = boundary;
      }
      y = Math.max(minTop, Math.min(maxBottom, y));
      insertTarget = computeInsertTarget(cursorY);

      if (!indicator) {
        indicator = document.createElement("div");
        indicator.style.cssText = "position:fixed;height:3px;border-radius:2px;background:var(--b3-theme-primary);box-shadow:0 0 10px var(--b3-theme-primary);z-index:10000;pointer-events:none;transition:top 0.15s ease,left 0.15s ease,width 0.15s ease;";
        document.body.appendChild(indicator);
      }
      indicator.style.left = `${left}px`;
      indicator.style.width = `${width}px`;
      indicator.style.top = `${y - 1.5}px`;
      itemsEl.classList.add("is-drop-hover");
      overList = true;
    };

    const onMove = (ev: MouseEvent) => {
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) < 5 && Math.abs(ev.clientY - startY) < 5) return; // 阈值：区分点击与拖动
        // 进入拖拽：按钮本体脱离原布局跟随光标（不做幽灵）
        dragging = true;
        fab.classList.add("is-dragging");
        fab.style.position = "fixed";
        fab.style.left = `${home.left}px`;
        fab.style.top = `${home.top}px`;
        fab.style.zIndex = "10000";
        fab.style.pointerEvents = "none"; // 让命中检测"透过"按钮看到下方内容
      }
      // 按钮跟随光标（保持抓取时偏移，不跳变）
      fab.style.left = `${home.left + (ev.clientX - startX)}px`;
      fab.style.top = `${home.top + (ev.clientY - startY)}px`;

      // 命中检测：侧边栏导航项 / 任务列表
      clearNav();
      cancelOpen();
      clearIndicator();
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      if (!el) return;
      const nav = el.closest(".things-nav__item[data-view]") as HTMLElement | null;
      if (nav && isCreatableNav(nav)) {
        nav.classList.add("is-drop-hover");
        hoverNav = nav;
        // 悬停 120ms 打开对应页（已是当前视图则不重复切换）
        const nv = nav.dataset.view as ViewType;
        const nid = nav.dataset.id;
        if (nv !== view || (nid || undefined) !== viewId) {
          openTimer = setTimeout(() => {
            window.dispatchEvent(new CustomEvent("things-navigate", { detail: { view: nv, viewId: nid } }));
          }, 120);
        }
        return;
      }
      if (itemsEl && itemsEl.contains(el)) {
        moveIndicator(ev.clientY);
      }
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      cancelOpen();
      if (!dragging) {
        onDrop(null, { view, viewId }); // 直接点击 → 当前视图顶部
        return;
      }
      const nav = hoverNav;
      const list = overList;
      clearNav();
      clearIndicator();

      // 回弹原位：弹性动画归位后恢复原有布局样式
      fab.style.transition = "left 0.4s cubic-bezier(0.34,1.56,0.64,1), top 0.4s cubic-bezier(0.34,1.56,0.64,1), transform 0.4s cubic-bezier(0.34,1.56,0.64,1)";
      fab.style.left = `${home.left}px`;
      fab.style.top = `${home.top}px`;
      fab.style.transform = "scale(1)";
      setTimeout(() => {
        fab.style.cssText = ""; // 清空内联样式，交还 CSS（absolute 右下角）
        fab.classList.remove("is-dragging");
      }, 420);

      if (nav) {
        // 在侧边栏视图上松手 → 打开该视图并在顶部弹出
        const nv = nav.dataset.view as ViewType;
        const nid = nav.dataset.id;
        window.dispatchEvent(new CustomEvent("things-navigate", { detail: { view: nv, viewId: nid } }));
        onDrop(null, { view: nv, viewId: nid });
      } else if (list) {
        // 在任务列表上松手 → 在插入位置弹出
        onDrop(insertTarget, { view, viewId });
      }
      // 两者都不是：仅回弹，不做任何操作
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // "+" 按钮拖拽
  function handleFabMouseDown(e: MouseEvent) {
    handleFabDragDown(e, fabBtnEl, (target, dest) => openCreate(target || getDefaultCreateTarget(dest.view), dest));
  }

  // "✨" 按钮拖拽
  function handleAIFabMouseDown(e: MouseEvent) {
    handleFabDragDown(e, aiFabBtnEl, (target, dest) => openAICreator(target, dest));
  }

  // 视图标题（依赖 refreshKey：项目改名后标题同步刷新）
  $: viewTitle = getViewTitle(view, viewId, refreshKey);

  // 项目视图：项目对象与全部任务（供 ProjectPanel 显示进度）
  $: projectObj = readProject(view, viewId, refreshKey, store);
  $: projectTasks = readProjectTasks(view, viewId, refreshKey, store);
  // 区域视图：区域对象与区域内项目（供 AreaPanel 显示）
  $: areaObj = readArea(view, viewId, refreshKey, store);
  $: areaProjects = readAreaProjects(view, viewId, refreshKey, store);

  function readProject(v: ViewType, id: string | undefined, _key: number, s: typeof store) {
    return v === "project" && id ? s.projects.get(id) : undefined;
  }

  function readProjectTasks(v: ViewType, id: string | undefined, _key: number, s: typeof store) {
    return v === "project" && id ? s.tasks.getProjectTasks(id) : [];
  }

  function readArea(v: ViewType, id: string | undefined, _key: number, s: typeof store) {
    return v === "area" && id ? s.areas.get(id) : undefined;
  }

  function readAreaProjects(v: ViewType, id: string | undefined, _key: number, s: typeof store) {
    return v === "area" && id ? s.projects.getAreaProjects(id).sort((a, b) => a.order - b.order) : [];
  }

  function getViewTitle(view: ViewType, viewId?: string, _key?: number): string {
    const titles: Record<string, string> = {
      inbox: "收件箱",
      today: "今天",
      upcoming: "计划",
      anytime: "随时",
      someday: "某天",
      log: "日志",
      projects: "项目",
      areas: "区域",
      tags: "标签",
      search: "搜索",
    };

    if (view === "project" && viewId) {
      const p = store.projects.get(viewId);
      return p?.name || "项目";
    }
    if (view === "area" && viewId) {
      const a = store.areas.get(viewId);
      return a?.name || "区域";
    }
    if (view === "tag" && viewId) {
      const t = store.tags.get(viewId);
      return t?.name || "标签";
    }

    return titles[view] || "Things";
  }

  // 视图图标（映射表唯一来源：src/icons/index.ts，与侧边栏/标签页共用同一套 SVG）
  $: viewIcon = getViewIconId(view);

  // 空状态图标 + 文案
  $: emptyState = getEmptyState(view);

  function getEmptyState(view: ViewType): { icon: string; text: string } {
    const map: Record<string, { icon: string; text: string }> = {
      inbox: { icon: "iconThingsInbox", text: "收件箱为空" },
      today: { icon: "iconThingsToday", text: "今天没有任务" },
      upcoming: { icon: "iconThingsCalendar", text: "没有计划任务" },
      anytime: { icon: "iconThingsAnytime", text: "没有随时任务" },
      someday: { icon: "iconThingsSomeday", text: "没有某天任务" },
      log: { icon: "iconThingsLog", text: "日志簿为空" },
      search: { icon: "iconThingsSearch", text: "未找到匹配任务" },
    };
    return map[view] || { icon: "iconThings", text: "暂无任务" };
  }

  // 视图收纳逻辑说明
  function getViewDescription(v: ViewType): string {
    const desc: Record<string, string> = {
      inbox: "未分配日期、项目、区域或标签的任务会出现在这里",
      today: "开始日期或截止日期为今天的任务",
      upcoming: "开始日期在未来的任务，到日期后自动进入今天",
      anytime: "所有现在能做的活跃任务，包括今天的任务",
      someday: "暂无计划的灵感想法，定期回顾",
      log: "已完成的任务存档",
    };
    return desc[v] || "";
  }
</script>

<div class="task-list" class:is-compact={aiMode === 'compact'}>
  <!-- 大标题 -->
  <div class="task-list__header">
    <div class="task-list__header-top has-border">
      {#if view === "tag" && viewId}
        {@const tagObj = store.tags.get(viewId)}
        {#if tagObj?.color}
          <span class="task-list__tag-dot" style="background: {tagObj.color}"></span>
        {:else}
          <Icon name={viewIcon} size={22} klass="task-list__title-icon" />
        {/if}
      {:else}
        <Icon name={viewIcon} size={22} klass="task-list__title-icon" />
      {/if}
      <h1 class="task-list__title">{viewTitle}</h1>

      <!-- Header 操作区（AI_HEADER / COMPACT 状态：AI Button 移到 Header） -->
      {#if aiEnabled && aiMode === 'header'}
        <div class="task-list__header-actions">
          <button class="task-list__header-btn" title="AI 任务整理" on:click={openAICreatorDefault}>
            <svg><use xlink:href="#iconThingsSparkles" /></svg>
            <span>AI</span>
          </button>
          <button class="task-list__header-btn" title="新建任务" on:click={() => openCreate(getDefaultCreateTarget(view), { view, viewId })}>
            <svg><use xlink:href="#iconThingsAdd" /></svg>
          </button>
        </div>
      {:else if aiEnabled && aiMode === 'compact'}
        <div class="task-list__header-actions">
          <button class="task-list__header-btn task-list__header-btn--mini" title="AI 任务整理" on:click={openAICreatorDefault}>
            <svg><use xlink:href="#iconThingsSparkles" /></svg>
          </button>
        </div>
      {/if}
    </div>
    {#if getViewDescription(view)}
      <p class="task-list__description">{getViewDescription(view)}</p>
    {/if}
    {#if view === "search"}
      <div class="task-list__search-box">
        <Icon name="iconThingsSearch" size={17} />
        <input
          bind:this={searchInput}
          bind:value={searchQuery}
          placeholder="搜索标题、备注、检查项、项目、区域或标签"
          aria-label="搜索任务"
          on:keydown={(event) => {
            if (event.key === "Escape") searchQuery = "";
          }}
        />
        {#if searchQuery}
          <button title="清空搜索" aria-label="清空搜索" on:click={() => searchQuery = ""}>×</button>
        {/if}
      </div>
      <div class="task-list__search-summary">
        {#if searchQuery.trim()}
          找到 {sortedTasks.length} 个任务
        {:else}
          支持多个关键词，以空格分隔
        {/if}
      </div>
    {/if}
  </div>

  <!-- 创建项目/区域表单 -->
  {#if showEntityForm}
    <EntityForm
      store={store}
      kind={showEntityForm}
      on:created={() => (showEntityForm = null)}
      on:cancel={() => (showEntityForm = null)}
    />
  {/if}

  <!-- 创建任务表单（顶部）：点击新建、拖到侧边栏切视图后新建等场景；拖到列表的插入式新建在下方对应分组内渲染 -->
  {#if showCreateForm && !activeCreateSlot}
    <TaskCard
      mode="create"
      {store}
      currentView={view}
      currentViewId={viewId}
      presetView={createDestView}
      presetViewId={createDestViewId}
      on:created={handleTaskCreated}
      on:cancel={handleCancelCreate}
    />
  {/if}

  <!-- 任务列表 -->
  <div class="task-list__items" bind:this={itemsEl}>
    {#if view === "search" && !searchQuery.trim()}
      <div class="task-list__empty task-list__empty--search">
        <Icon name="iconThingsSearch" size={42} klass="task-list__empty-icon" />
        <p>输入关键词查找任务</p>
        <span>可以搜索备注、检查项、项目、区域和标签</span>
      </div>
    {:else}
    {#if view === "project" && projectObj}
      <ProjectPanel store={store} project={projectObj} tasks={projectTasks} on:addheading={startAddHeading} />
    {/if}
    {#if view === "area" && areaObj}
      <AreaPanel store={store} area={areaObj} projects={areaProjects} showProjects={false} />
    {/if}
    {#if view === "projects"}
      <ProjectOverview store={store} version={refreshKey} />
    {/if}
    {#if view === "areas"}
      <AreaOverview store={store} version={refreshKey} />
    {/if}
    {#if view === "tags"}
      <TagOverview store={store} version={refreshKey} />
    {/if}
    {#if sortedTasks.length === 0 && !activeCreateSlot && view !== "today" && view !== "upcoming" && view !== "projects" && view !== "areas" && view !== "tags" && view !== "project"}
      <div class="task-list__empty" class:task-list__empty--area={view === "area"}>
        {#if view !== "area"}<Icon name={emptyState.icon} size={48} klass="task-list__empty-icon" />{/if}
        <p>{view === "area" ? "此区域暂无直属任务" : emptyState.text}</p>
      </div>
    {:else}
      {#if view === "project" && projectObj && addingHeading}
        <div class="task-list__heading-add task-list__heading-add--top">
          <input
            class="task-list__heading-input"
            type="text"
            placeholder="标题分组名称"
            bind:value={headingDraft}
            bind:this={headingAddInputEl}
            on:blur={commitAddHeading}
            on:keydown={(e) => {
              // 中文输入法组词中的回车是确认候选词，不提交
              if (e.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") commitAddHeading();
              if (e.key === "Escape") { addingHeading = false; headingDraft = ""; }
            }}
          />
        </div>
      {/if}
      {#each [...groupedTasks.entries()] as [group, groupItems], gi (group)}
        {@const hd = view === "upcoming" || view === "log" ? groupHeader(group) : null}
        {@const orderedItems = view === "upcoming"
          ? [...groupItems.filter((t) => hasTimeOfDay(t.startDate)), ...groupItems.filter((t) => !hasTimeOfDay(t.startDate))]
          : groupItems}
        <div
          class="task-list__group-block"
          class:task-list__group-block--sectioned={view === "project" || view === "area" || view === "tag"}
          class:is-drop-target={dragOverGroup === group && dragOverGroup !== dragFromGroup}
          bind:this={groupBlockRefs[group]}
          on:dragover={(event) => view === "project" && handleHeadingDragOver(event, group)}
          on:drop={(event) => {
            if (view === "project" && group !== COMPLETED_GROUP) {
              event.preventDefault();
              handleHeadingDrop();
            }
          }}
        >
          {#if (view === "upcoming" || view === "log") && hd}
            {#if group.startsWith("m-") || view === "log"}
              <!-- 月度组头（计划）/ 日志分组头：不显示大数字，“M月”/“今天” + 细线整体左对齐 -->
              <div class="task-list__month" class:is-first={gi === 0}>
                <span class="task-list__month-label">{hd.label}</span>
                <div class="task-list__day-line"></div>
              </div>
            {:else}
              <div class="task-list__day" class:is-first={gi === 0}>
                <span class="task-list__day-num">{hd.num}</span>
                <div class="task-list__day-meta">
                  <span class="task-list__day-label">{hd.label}</span>
                  <div class="task-list__day-line"></div>
                </div>
              </div>
            {/if}
          {:else if view === "today" && group === "今晚"}
            <div class="task-list__group task-list__group--fixed" class:is-tonight={group === "今晚"}>
              <Icon
                name={group === "今晚" ? "iconThingsMoonFilled" : "iconThingsToday"}
                size={18}
                color={group === "今晚" ? ICON_COLORS.tonight : ICON_COLORS.today}
                klass="task-list__group-icon"
              />
              <span>{group}</span>
              <div class="task-list__day-line"></div>
            </div>
          {:else if group === "all" && (view === "area" || view === "tag")}
            <div
              class="task-list__heading task-list__heading--active"
              title="点击折叠/展开"
              on:click={() => toggleGroupCollapse(group)}
            >
              <svg class="task-list__heading-chevron" class:is-collapsed={isGroupCollapsed(group)} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
              <span class="task-list__heading-static">进行中</span>
              {#if isGroupCollapsed(group)}<span class="task-list__heading-count">{groupItems.length}</span>{/if}
              <div class="task-list__day-line"></div>
            </div>
          {:else if group === COMPLETED_GROUP && (view === "project" || view === "area" || view === "tag")}
            <div
              class="task-list__heading task-list__heading--completed"
              title="点击折叠/展开"
              on:click={() => toggleGroupCollapse(group)}
            >
              <svg class="task-list__heading-chevron" class:is-collapsed={isGroupCollapsed(group)} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
              <span class="task-list__heading-static">已完成</span>
              {#if isGroupCollapsed(group)}<span class="task-list__heading-count">{groupItems.length}</span>{/if}
              <div class="task-list__day-line"></div>
            </div>
          {:else if view === "project" && projectObj && group !== "all"}
            {#if group === "none"}
              <div
                class="task-list__heading"
                class:is-heading-dragging={headingDragId === group}
                class:is-drop-before={headingDropTarget?.id === group && headingDropTarget?.pos === "before"}
                class:is-drop-after={headingDropTarget?.id === group && headingDropTarget?.pos === "after"}
                draggable="true"
                on:dragstart={(event) => handleHeadingDragStart(event, group)}
                on:dragend={handleHeadingDragEnd}
              >
                <button class="task-list__heading-toggle" title="点击折叠/展开，拖动标题行调整分组顺序" on:click={() => toggleGroupCollapse(group)}>
                  <svg class="task-list__heading-chevron" class:is-collapsed={isGroupCollapsed(group)} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                  <span class="task-list__heading-static">进行中</span>
                  {#if isGroupCollapsed(group)}<span class="task-list__heading-count">{groupItems.length}</span>{/if}
                </button>
                <div class="task-list__day-line"></div>
              </div>
            {:else if projectObj.headings.find((h) => h.id === group)}
              <div
                class="task-list__heading"
                class:is-heading-dragging={headingDragId === group}
                class:is-drop-before={headingDropTarget?.id === group && headingDropTarget?.pos === "before"}
                class:is-drop-after={headingDropTarget?.id === group && headingDropTarget?.pos === "after"}
                draggable={editingHeadingId !== group}
                on:dragstart={(e) => handleHeadingDragStart(e, group)}
                on:dragend={handleHeadingDragEnd}
              >
                {#if editingHeadingId === group}
                  <input
                    class="task-list__heading-input"
                    type="text"
                    bind:value={headingDraft}
                    on:blur={() => commitHeadingRename(projectObj.id, group)}
                    on:keydown={(e) => {
                      // 中文输入法组词中的回车是确认候选词，不提交
                      if (e.isComposing || e.keyCode === 229) return;
                      if (e.key === "Enter") commitHeadingRename(projectObj.id, group);
                      if (e.key === "Escape") editingHeadingId = null;
                    }}
                  />
                {:else}
                  <button
                    class="task-list__heading-toggle"
                    title="点击折叠/展开，拖动标题行调整分组顺序"
                    on:click={() => toggleGroupCollapse(group)}
                  >
                    <svg class="task-list__heading-chevron" class:is-collapsed={isGroupCollapsed(group)} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                    <span class="task-list__heading-title">{projectObj.headings.find((h) => h.id === group)?.title}</span>
                    {#if isGroupCollapsed(group)}<span class="task-list__heading-count">{groupItems.length}</span>{/if}
                  </button>
                {/if}
                <div class="task-list__day-line"></div>
                <div class="task-list__heading-actions">
                  <button
                    class="task-list__heading-edit"
                    title="重命名分组"
                    on:click={() => startHeadingRename(projectObj.headings.find((h) => h.id === group))}
                  ><Icon name="iconThingsPencil" size={11} /></button>
                  <button
                    class="task-list__heading-del"
                    title="删除标题分组（任务移入进行中）"
                    on:click={() => removeHeading(projectObj.id, group)}
                  >×</button>
                </div>
              </div>
            {/if}
          {/if}
          {#if !isGroupCollapsed(group)}
          <DragSort
            bind:this={dragSortRefs[group]}
            groupKey={group}
            items={orderedItems}
            itemKey="id"
            on:reorder={(e) => handleReorder(e, orderedItems)}
            on:drop={handleDrop}
            on:dragstart={() => handleGroupDragStart(group)}
            on:dragend={handleGroupDragEnd}
            let:items={displayItems}
            let:isDragging
            let:draggedId
            let:registerItem
            let:unregisterItem
            let:handleDragStart
          >
            {#each displayItems as task, ti (task.id)}
              <div class="task-list__animated-slot" animate:flip={{ duration: 360, easing: cubicOut }}>
                {#if activeCreateSlot && activeCreateSlot.group === group && activeCreateSlot.index === ti}
                  <TaskCard
                    mode="create"
                    {store}
                    currentView={view}
                    currentViewId={viewId}
                    presetStartDate={createPreset.startDate}
                    presetHeadingId={view === "project" && group !== "none" && group !== "all" && group !== COMPLETED_GROUP ? group : undefined}
                    presetView={createDestView}
                    presetViewId={createDestViewId}
                    on:created={handleTaskCreated}
                    on:cancel={handleCancelCreate}
                  />
                {/if}
                <div
                  class="task-list__item-wrapper"
                  class:is-dragging={draggedId === task.id}
                  out:slideOut
                >
                  {#if view === "search" && getSearchMatchLabels(task).length}
                    <div class="task-list__search-matches">
                      {#each getSearchMatchLabels(task) as label}
                        <span>{label}</span>
                      {/each}
                    </div>
                  {/if}
                  <TaskCard
                    mode="edit"
                    {task}
                    {store}
                    inlineDate={view === "upcoming" && group.startsWith("m-")}
                    isDragging={draggedId === task.id}
                    currentView={view}
                    {registerItem}
                    {unregisterItem}
                    on:dragstart={(e) => {
                      if (view !== "search" && group !== COMPLETED_GROUP) handleDragStart(e.detail.event, task.id);
                    }}
                  />
                </div>
              </div>
            {/each}
            {#if activeCreateSlot && activeCreateSlot.group === group && activeCreateSlot.index >= displayItems.length}
              <TaskCard
                mode="create"
                {store}
                currentView={view}
                currentViewId={viewId}
                presetStartDate={createPreset.startDate}
                presetHeadingId={view === "project" && group !== "none" && group !== "all" && group !== COMPLETED_GROUP ? group : undefined}
                presetView={createDestView}
                presetViewId={createDestViewId}
                on:created={handleTaskCreated}
                on:cancel={handleCancelCreate}
              />
            {/if}
          </DragSort>
          {/if}
        </div>
      {/each}

      {/if}
    {/if}
    {#if view === "area" && areaObj}
      <AreaPanel store={store} area={areaObj} projects={areaProjects} showNotes={false} />
    {/if}
  </div>

  <!-- 悬浮按钮组（状态机）：full=仅＋；button=✧＋；header/compact=隐藏（按钮移到 Header） -->
  {#if aiMode === 'full' || aiMode === 'button'}
    <div class="things-fab-group" class:is-hidden={hideFabs}>
      {#if aiEnabled && aiMode === 'button'}
        <button
          class="things-fab__btn things-fab__btn--ai"
          bind:this={aiFabBtnEl}
          title="AI 智能创建（可拖到侧边栏或列表）"
          on:mousedown={handleAIFabMouseDown}
        >
          <svg><use xlink:href="#iconThingsSparkles" /></svg>
        </button>
      {/if}
      <button
        class="things-fab__btn things-fab__btn--add"
        bind:this={fabBtnEl}
        title="新建任务（可拖到侧边栏或列表）"
        on:mousedown={handleFabMouseDown}
      >
        <svg><use xlink:href="#iconThingsAdd" /></svg>
      </button>
    </div>
  {/if}
</div>

<style lang="scss">
  .task-list {
    flex: 1;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    position: relative;
    padding: 0 72px;

    // COMPACT 状态：间距/文字压缩、次要信息隐藏（设计文档 §十）
    &.is-compact {
      padding: 0 16px;

      .task-list__header {
        padding-top: 24px;
      }

      .task-list__title {
        font-size: 16px;
      }

      .task-list__description {
        display: none;
      }

      .task-list__items {
        padding: 12px 0 32px;
      }

      .task-list__day,
      .task-list__month,
      .task-list__group {
        margin-top: 24px;
      }

      .task-list__day-num {
        font-size: 24px;
      }
    }

    &__header {
      display: flex;
      flex-direction: column;
      padding: 80px 0 0;
      flex-shrink: 0;

      &-top {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding-bottom: 14px;

        // 标题下方分隔线
        &.has-border {
          border-bottom: 1px solid var(--b3-border-color);
          padding-bottom: 14px;
        }
      }
    }

    // 分组块：跨组拖拽时作为落点区域，命中高亮
    &__group-block {
      border-radius: 12px;
      transition: background-color 0.15s ease;

      &.is-drop-target {
        background: var(--b3-theme-primary-light);
      }
    }

    // 项目/区域/标签视图：分组之间的结构性留白，挂在块级元素上，
    // 分组内没有任务（空分组）时间隔也不会塌陷。
    &__group-block--sectioned + &__group-block--sectioned {
      margin-top: 14px;
    }

    // 计划视图日期分组头：左侧大数字 + 右侧（描述 + 其下延伸细线，二者左对齐）
    &__day {
      display: flex;
      align-items: baseline;
      gap: 10px;
      margin-top: 48px;

      &.is-first {
        margin-top: 12px;
      }
    }

    &__day-num {
      font-size: 34px;
      font-weight: 700;
      line-height: 1;
      color: var(--b3-theme-on-background);
    }

    // 描述与细线纵向排列：细线左边与描述文字左边对齐
    &__day-meta {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;

      .task-list__day-line {
        flex: none;
        align-self: stretch;
        margin-top: 0;
      }
    }

    &__day-label {
      font-size: 14px;
      font-weight: 600;
      color: var(--b3-theme-on-surface-light); // 灰色，与分割线同属弱化层级
    }

    &__day-line {
      flex: 1;
      align-self: flex-start; // 行内用法（今天视图组头/标题分组）对齐上沿
      margin-top: 4px;
      height: 1px;
      background: var(--b3-border-color);
    }

    // 月度分组头：去掉大数字，“M月” + 细线整体靠左（与日期数字列同一左边界）
    &__month {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 48px;

      &.is-first {
        margin-top: 12px;
      }

      .task-list__day-line {
        align-self: center;
        margin-top: 0;
      }
    }

    &__month-label {
      flex-shrink: 0;
      font-size: 16px;
      font-weight: 700;
      color: var(--b3-theme-on-background);
    }

    // 项目标题分组（headings）头
    &__heading {
      position: relative; // × 删除按钮绝对定位浮于线尾，不占布局
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 28px;
    }

    &__group-block:first-child &__heading {
      margin-top: 8px;
    }

    &__heading-static,
    &__heading-title {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.03em;
      color: var(--b3-theme-on-surface);
      white-space: nowrap;
    }

    &__heading-title {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    // 分组折叠：箭头 + 标题 + 折叠时的任务数
    &__heading-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      border: none;
      background: transparent;
      padding: 2px 0;
      cursor: pointer;

      &:hover .task-list__heading-title {
        color: var(--b3-theme-primary);
      }
    }

    &__heading-chevron {
      flex-shrink: 0;
      color: var(--b3-theme-on-surface-light);
      transition: transform 0.15s ease;

      &.is-collapsed {
        transform: rotate(-90deg);
      }
    }

    &__heading-count {
      flex-shrink: 0;
      padding-top: 1px;
      font-size: 11px;
      font-weight: 500;
      color: var(--b3-theme-on-surface-light);
    }

    // 操作区始终占据独立空间，横线止于按钮之前，避免重命名/删除按钮压在线上。
    &__heading-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
      visibility: hidden;
      opacity: 0;
      transition: opacity 0.15s ease;
    }

    &__heading:hover &__heading-actions,
    &__heading:focus-within &__heading-actions {
      visibility: visible;
      opacity: 1;
    }

    // ✎ 重命名：与 × 删除同款悬浮按钮
    &__heading-edit {
      width: 22px;
      height: 22px;
      border: none;
      border-radius: 4px;
      background: var(--b3-theme-background);
      cursor: pointer;
      color: var(--b3-theme-on-surface-light);
      display: flex;
      align-items: center;
      justify-content: center;

      &:hover {
        background: var(--b3-theme-primary-light);
        color: var(--b3-theme-primary);
      }
    }

    // 分组拖拽排序：被拖行半透明；落点亮主色指引线（box-shadow 不占布局）
    &__heading[draggable="true"] {
      cursor: grab;
    }

    &__heading.is-heading-dragging {
      opacity: 0.4;
    }

    &__heading.is-drop-before {
      box-shadow: 0 -2px 0 0 var(--b3-theme-primary);
    }

    &__heading.is-drop-after {
      box-shadow: 0 2px 0 0 var(--b3-theme-primary);
    }

    &__heading-input {
      width: 200px;
      font-size: 13px;
      font-weight: 600;
      border: 1px solid var(--b3-theme-primary);
      border-radius: 6px;
      padding: 3px 8px;
      outline: none;
      background: var(--b3-theme-surface);
      color: var(--b3-theme-on-surface);
    }

    // × 删除
    &__heading-del {
      width: 22px;
      height: 22px;
      border: none;
      border-radius: 4px;
      background: var(--b3-theme-background);
      cursor: pointer;
      font-size: 14px;
      color: var(--b3-theme-on-surface-light);
      display: flex;
      align-items: center;
      justify-content: center;

      &:hover {
        background: var(--b3-theme-error-light);
        color: var(--b3-theme-error);
      }
    }

    &__heading-addbtn {
      margin-top: 20px;
      padding: 6px 10px;
      border: none;
      border-radius: 6px;
      background: transparent;
      cursor: pointer;
      font-size: 13px;
      color: var(--b3-theme-on-surface-light);

      &:hover {
        background: var(--b3-theme-surface-light);
        color: var(--b3-theme-on-surface);
      }
    }

    &__heading-add {
      margin-top: 20px;

      &--top {
        margin: 8px 0 6px;
      }
    }

    &__title-icon {
      color: var(--b3-theme-on-background);
      line-height: 1;
      margin-top: 2px;
    }

    &__tag-dot {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      flex-shrink: 0;
      margin-top: 4px;
    }

    &__empty-icon {
      color: var(--b3-theme-on-surface-light);
      margin-bottom: 4px;
    }

    &__title-wrap {
      display: flex;
      flex-direction: column;
      flex: 1;
    }

    &__title {
      font-size: 24px;
      font-weight: 700;
      color: var(--b3-theme-on-background);
      margin: 0;
      text-align: left;
      line-height: 1.2;
    }

    // Header 操作区（AI_HEADER / COMPACT 状态）
    &__header-actions {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    &__header-btn {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 6px 12px;
      border: 1px solid var(--b3-theme-primary);
      border-radius: 7px;
      background: var(--b3-theme-surface);
      color: var(--b3-theme-primary);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;

      svg {
        width: 14px;
        height: 14px;
      }

      &:hover {
        background: var(--b3-theme-primary);
        color: var(--b3-theme-on-primary);
      }

      &--mini {
        padding: 5px;
        border-color: var(--b3-border-color);
        color: var(--b3-theme-on-surface-light);
        background: transparent;
      }
    }

    &__description {
      font-size: 13px;
      color: var(--b3-theme-on-surface-light);
      margin: 10px 0 0;
      text-align: left;
    }

    &__search-box {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 18px;
      padding: 11px 13px;
      border: 1px solid var(--b3-border-color);
      border-radius: 12px;
      background: var(--b3-theme-background);
      color: var(--b3-theme-on-surface-light);
      box-shadow: 0 3px 12px rgba(30, 43, 62, 0.06);

      &:focus-within {
        border-color: var(--b3-theme-primary);
        box-shadow: 0 0 0 3px var(--b3-theme-primary-light);
      }

      input {
        flex: 1;
        min-width: 0;
        border: none;
        outline: none;
        background: transparent;
        color: var(--b3-theme-on-background);
        font: inherit;
        font-size: 14px;

        &::placeholder { color: var(--b3-theme-on-surface-light); }
      }

      button {
        width: 24px;
        height: 24px;
        padding: 0;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--b3-theme-on-surface-light);
        font-size: 17px;
        cursor: pointer;

        &:hover {
          background: var(--b3-theme-surface-light);
          color: var(--b3-theme-on-background);
        }
      }
    }

    &__search-summary {
      margin-top: 9px;
      font-size: 11px;
      color: var(--b3-theme-on-surface-light);
    }

    &__items {
      flex: 1;
      overflow-y: auto;
      // 滚动容器撑满页宽（负外边距抵消外层 72px 内边距），滚动条落在页面右沿；
      // 内容再用内边距拉回，保持原有 72px 左右留白
      margin: 0 -72px;
      padding: 12px 72px 32px;

      // + 按钮拖拽落点：浅色底示意可放置区域
      &.is-drop-hover {
        background: var(--b3-theme-primary-light);
      }
    }

    &__item-wrapper {
      &.is-dragging {
        opacity: 0;
        pointer-events: none;
      }
    }

    &__search-matches {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      padding: 5px 28px 0;

      span {
        padding: 2px 7px;
        border-radius: 999px;
        background: var(--b3-theme-surface-light);
        color: var(--b3-theme-on-surface-light);
        font-size: 10px;
        line-height: 1.4;
      }
    }

    &__group {
      padding: 6px 12px;
      font-size: 11px;
      font-weight: 600;
      color: var(--b3-theme-on-surface-light);
      background: var(--b3-theme-surface);
      border-bottom: 1px solid var(--b3-border-color);
      text-transform: uppercase;

      // 今天视图固定组头（今天/今晚，始终显示）：与计划视图日期头同一视觉语言
      &--fixed {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 12px;
        padding: 4px 0 8px;
        font-size: 18px;
        font-weight: 700;
        color: var(--b3-theme-on-background);
        background: transparent;
        border-bottom: none;
        text-transform: none;

        &.is-tonight {
          margin-top: 36px;
        }

        .task-list__day-line {
          align-self: center;
          margin-top: 0;
        }
      }
    }

    &__group-icon {
      font-size: 20px;
      line-height: 1;
    }

    &__empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px 16px;
      text-align: center;
      color: var(--b3-theme-on-surface-light);

      p {
        margin: 4px 0;
        font-size: 14px;
      }

      span {
        margin-top: 3px;
        font-size: 11px;
      }

      &--search {
        padding-top: 64px;
      }

      &--area {
        align-items: flex-start;
        padding: 10px 12px 14px;
        text-align: left;

        p {
          margin: 0;
          font-size: 13px;
        }
      }
    }
  }

  .things-fab-group {
    position: absolute;
    bottom: 24px;
    right: 24px;
    z-index: 20;
    display: flex;
    gap: 12px;
    transition: all 0.3s ease;

    // AI 浮窗打开时整组隐藏（对齐 demo .fab-group.hidden）
    &.is-hidden {
      opacity: 0;
      pointer-events: none;
      transform: scale(0.8);
    }
  }

  .things-fab__btn {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    transition: transform 0.2s, box-shadow 0.2s;

    svg {
      width: 24px;
      height: 24px;
    }

    &:hover {
      transform: scale(1.05);
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
    }

    // "+" 按钮：主题色
    &--add {
      background: var(--b3-theme-primary);
      color: var(--b3-theme-on-primary);
    }

    // "✨" AI 按钮：扁平化现代风格；从宽屏切换回中屏时弹出（morph 时序）
    &--ai {
      background: var(--b3-theme-surface);
      color: var(--b3-theme-primary);
      border: 1.5px solid var(--b3-theme-primary);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      animation: fab-pop-in 0.3s cubic-bezier(0.2, 0.75, 0.25, 1);

      &:hover {
        background: var(--b3-theme-primary);
        color: var(--b3-theme-on-primary);
      }
    }

    @keyframes fab-pop-in {
      from {
        transform: scale(0);
      }
      to {
        transform: scale(1);
      }
    }

    // 拖拽状态：本体跟随光标，抬起放大（位置由内联样式驱动，见 handleFabDragDown）
    &.is-dragging {
      transform: scale(1.08);
      box-shadow: 0 14px 36px rgba(0, 0, 0, 0.35);
      cursor: grabbing;
    }
  }

</style>
