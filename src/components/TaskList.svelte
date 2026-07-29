<script lang="ts">
  import { onMount, tick } from "svelte";
  import { cubicOut } from "svelte/easing";
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

  export let view: ViewType;
  export let viewId: string | undefined;
  export let searchQuery: string;
  export let store: StoreManager;

  let showCreateForm = false;
  let showFabMenu = false;
  let showEntityForm: "project" | "area" | null = null;
  let refreshKey = 0;
  let itemsEl: HTMLElement;

  // 跨组拖拽：按分组 key 注册 DragSort 实例与分组块 DOM
  let dragSortRefs: Record<string, DragSort> = {};
  let groupBlockRefs: Record<string, HTMLElement> = {};
  let dragFromGroup: string | null = null;
  let dragOverGroup: string | null = null;

  // 项目标题分组（headings）的内联管理状态
  let editingHeadingId: string | null = null;
  let addingHeading = false;
  let headingDraft = "";

  // 手动切换视图时置 true，抑制旧视图任务的退场动画（见下方视图切换块）
  let suppressOutro = false;

  // 任务移出列表的滑出动画（完成移入日志 / 视图迁移时播放）
  function slideOut(node: HTMLElement, { duration = 300 }: { duration?: number } = {}) {
    return {
      // 切换视图时持续 0（立即移除）：否则旧任务 300ms 退场期间仍占布局高度，
      // 列表高度先胀后缩、滚动位置被钳制，视觉上整个列表"往上弹一下"
      duration: suppressOutro ? 0 : duration,
      easing: cubicOut,
      css: (t: number, u: number) => `opacity: ${t}; transform: translateX(${u * -100}%);`,
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
    return () => unsubs.forEach((u) => u());
  });

  // 计划视图标签筛选：null = 全部
  let upcomingTagFilter: string | null = null;
  let showTagMore = false;

  $: rootTags = store.tags.getRootTags().sort((a: any, b: any) => a.order - b.order);
  // 筛选行直接展示前 5 个标签，其余收进 "···" 下拉
  $: visibleTags = rootTags.slice(0, 5);
  $: moreTags = rootTags.slice(5);

  // 根据视图获取任务列表 - 使用响应式声明确保视图切换时刷新
  $: tasks = getTasks(view, viewId, searchQuery, refreshKey, store.tasks.count, upcomingTagFilter);

  function getTasks(view: ViewType, viewId?: string, query?: string, _key?: number, _count?: number, tagFilter?: string | null): Task[] {
    if (query) {
      return store.tasks.search(query);
    }

    switch (view) {
      case "inbox":
        return store.tasks.getInboxTasks();
      case "today":
        return store.tasks.getTodayTasks();
      case "upcoming": {
        let list = store.tasks.getUpcomingTasks().sort((a, b) => (a.startDate || 0) - (b.startDate || 0));
        if (tagFilter) list = list.filter((t) => t.tags.includes(tagFilter));
        return list;
      }
      case "anytime":
        return store.tasks.getAnytimeTasks();
      case "someday":
        return store.tasks.getSomedayTasks();
      case "log":
        return store.tasks.getCompletedTasks();
      case "projects":
        return []; // 项目总览不渲染任务列表，由 ProjectOverview 接管
      case "project":
        return viewId ? store.tasks.getProjectTasks(viewId) : [];
      case "area":
        if (!viewId) return [];
        const areaProjects = store.projects.getAreaProjects(viewId);
        const projectIds = new Set(areaProjects.map((p) => p.id));
        return store.tasks
          .getAll()
          .filter((t) => t.status === "todo" && (t.areaId === viewId || (t.projectId && projectIds.has(t.projectId))));
      case "tag":
        return viewId ? store.tasks.getTagTasks(viewId) : [];
      default:
        return [];
    }
  }

  // 排序 - 使用 order 字段
  $: sortedTasks = sortTasks(tasks);

  function sortTasks(tasks: Task[]): Task[] {
    return [...tasks].sort((a, b) => {
      if (a.order !== b.order) {
        return a.order - b.order;
      }
      return b.created - a.created;
    });
  }

  // 分组：今天=今天/今晚；计划=日期+月份骨架；项目=标题分组（headings）；其余单组
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

    // 项目视图：按标题分组（headings）展示；没有标题时单组。
    // 组 key = headingId，未分组任务归入 "none"（空则不显示该组）
    if (view === "project" && viewId) {
      const project = store.projects.get(viewId);
      const headings = project?.headings?.length
        ? [...project.headings].sort((a, b) => a.order - b.order)
        : [];
      if (headings.length === 0) return new Map([["all", tasks]]);
      const groups = new Map<string, Task[]>();
      for (const h of headings) groups.set(h.id, []);
      const ungrouped: Task[] = [];
      for (const t of tasks) {
        if (t.headingId && groups.has(t.headingId)) groups.get(t.headingId)!.push(t);
        else ungrouped.push(t);
      }
      if (ungrouped.length) groups.set("none", ungrouped);
      for (const arr of groups.values()) {
        arr.sort((a, b) => (a.order !== b.order ? a.order - b.order : b.created - a.created));
      }
      return groups;
    }

    if (view !== "upcoming") {
      return new Map([["all", tasks]]);
    }

    // 计划视图：固定骨架 = 明天起 7 个日期分组 + 其后 5 个月度分组，有无任务都显示。
    // 日期组 key = 当天 0 点时间戳字符串；月度组 key = "m-YYYY-M"。
    // 月度起点取"第 7 天所在月"，保证 7 天窗口之后无缝衔接、不漏天也不重叠。
    const groups = new Map<string, Task[]>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 1; i <= 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      groups.set(String(d.getTime()), []);
    }
    const dayEnd = new Date(today);
    dayEnd.setDate(dayEnd.getDate() + 7);
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
      arr.sort((a, b) => (a.order !== b.order ? a.order - b.order : b.created - a.created));
    }
    return groups;
  }

  const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  // 分组头：日期组 → 大数字 + 描述（今天/明天/N天后/周几）；月度组（"m-YYYY-M"）→ M/1 + 月份名
  function groupHeader(key: string): { num: string; label: string } {
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
    const label = diff === 0 ? "今天" : diff === 1 ? "明天" : diff < 7 ? `${diff}天后` : WEEKDAYS[d.getDay()];
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
  }

  async function commitHeadingRename(projectId: string, headingId: string) {
    const title = headingDraft.trim();
    if (title) {
      await store.projects.updateHeading(projectId, headingId, title);
    }
    editingHeadingId = null;
  }

  async function removeHeading(projectId: string, headingId: string) {
    // 组内任务回到未分组，再删标题
    for (const t of sortedTasks) {
      if (t.headingId === headingId) {
        await store.tasks.updateTask(t.id, { headingId: undefined });
      }
    }
    await store.projects.deleteHeading(projectId, headingId);
  }

  async function commitAddHeading() {
    const title = headingDraft.trim();
    if (title && view === "project" && viewId) {
      await store.projects.addHeading(viewId, title);
    }
    addingHeading = false;
    headingDraft = "";
  }

  function handleTaskCreated() {
    showCreateForm = false;
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

    // 更新所有任务的 order
    for (let i = 0; i < newTasks.length; i++) {
      await store.tasks.updateTask(newTasks[i].id, { order: i });
    }
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
      if (blockContains(key, e.clientY)) {
        over = key;
        break;
      }
    }
    dragOverGroup = over;
  }

  function handleGroupDragStart(group: string) {
    dragFromGroup = group;
    document.addEventListener("mousemove", trackDragOver);
  }

  function handleGroupDragEnd() {
    dragFromGroup = null;
    dragOverGroup = null;
    document.removeEventListener("mousemove", trackDragOver);
  }

  // 落点不在源分组内 → 把任务日期改到落点分组
  function handleDrop(e: CustomEvent) {
    const { id, clientY, fromGroup, withinSelf } = e.detail;
    if (withinSelf) return;
    for (const key of Object.keys(dragSortRefs)) {
      if (key === fromGroup || !blockContains(key, clientY)) continue;
      const toIndex = dragSortRefs[key] ? dragSortRefs[key].computeInsertIndex(clientY) : 0;
      moveTaskToGroup(id, key, toIndex);
      return;
    }
  }

  // 跨组移动：由落点分组推算新日期，再原位写回全局 order（与 handleReorder 同机制）
  async function moveTaskToGroup(taskId: string, toGroup: string, toIndex: number) {
    const task = sortedTasks.find((t) => t.id === taskId);
    if (!task) return;

    let changes: Partial<Task> | null = null;
    if (view === "upcoming") {
      // 日期组 key = 当天 0 点时间戳；月度组 key = "m-YYYY-M"（落到该月 1 日）。
      // 保留任务原有的时/分（日程行拖到新日期仍是同一时刻）
      const nd = toGroup.startsWith("m-")
        ? (() => {
            const [y, m] = toGroup.slice(2).split("-").map(Number);
            return new Date(y, m, 1);
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

    for (let i = 0; i < newTasks.length; i++) {
      const t = newTasks[i];
      if (t.id === taskId) {
        await store.tasks.updateTask(t.id, { ...changes, order: i });
      } else if (t.order !== i) {
        await store.tasks.updateTask(t.id, { order: i });
      }
    }
  }

  // 悬浮按钮菜单
  function handleFabAction(action: string) {
    showFabMenu = false;

    switch (action) {
      case "task":
        showCreateForm = true;
        break;
      case "project":
        showEntityForm = "project";
        break;
      case "area":
        showEntityForm = "area";
        break;
    }
  }

  // 点击外部关闭菜单
  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.things-fab')) {
      showFabMenu = false;
    }
    if (!target.closest('.task-list__filter-more')) {
      showTagMore = false;
    }
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
</script>

<svelte:window on:click={handleClickOutside} />

<div class="task-list">
  <!-- 大标题 -->
  <div class="task-list__header" class:has-border={view !== "upcoming"}>
    <Icon name={viewIcon} size={28} klass="task-list__title-icon" />
    <h1 class="task-list__title">{viewTitle}</h1>
  </div>

  <!-- 计划视图：筛选标签行（与标题一起固定，不随列表滚动） -->
  {#if view === "upcoming"}
    <div class="task-list__filters">
      <button
        class="task-list__filter-chip"
        class:is-active={upcomingTagFilter === null}
        on:click={() => { upcomingTagFilter = null; showTagMore = false; }}
      >全部</button>
      {#each visibleTags as tag (tag.id)}
        <button
          class="task-list__filter-chip"
          class:is-active={upcomingTagFilter === tag.id}
          on:click={() => { upcomingTagFilter = tag.id; showTagMore = false; }}
        >{tag.name}</button>
      {/each}
      {#if moreTags.length > 0}
        <div class="task-list__filter-more">
          <button
            class="task-list__filter-chip"
            class:is-active={moreTags.some((t) => t.id === upcomingTagFilter)}
            on:click|stopPropagation={() => showTagMore = !showTagMore}
            title="更多标签"
          >···</button>
          {#if showTagMore}
            <div class="task-list__filter-dropdown">
              {#each moreTags as tag (tag.id)}
                <button
                  class="task-list__filter-option"
                  class:is-active={upcomingTagFilter === tag.id}
                  on:click={() => { upcomingTagFilter = tag.id; showTagMore = false; }}
                >
                  {#if tag.color}<span class="task-list__filter-dot" style="background: {tag.color}"></span>{/if}
                  {tag.name}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <!-- 创建项目/区域表单 -->
  {#if showEntityForm}
    <EntityForm
      store={store}
      kind={showEntityForm}
      on:created={() => (showEntityForm = null)}
      on:cancel={() => (showEntityForm = null)}
    />
  {/if}

  <!-- 创建任务表单 -->
  {#if showCreateForm}
    <TaskCard
      mode="create"
      {store}
      currentView={view}
      currentViewId={viewId}
      on:created={handleTaskCreated}
      on:cancel={() => showCreateForm = false}
    />
  {/if}

  <!-- 任务列表 -->
  <div class="task-list__items" bind:this={itemsEl}>
    {#if view === "project" && projectObj}
      <ProjectPanel store={store} project={projectObj} tasks={projectTasks} />
    {/if}
    {#if view === "area" && areaObj}
      <AreaPanel store={store} area={areaObj} projects={areaProjects} />
    {/if}
    {#if view === "projects"}
      <ProjectOverview store={store} version={refreshKey} />
    {/if}
    {#if sortedTasks.length === 0 && view !== "today" && view !== "upcoming" && view !== "projects"}
      <div class="task-list__empty">
        <Icon name={emptyState.icon} size={48} klass="task-list__empty-icon" />
        <p>{emptyState.text}</p>
      </div>
    {:else}
      {#each [...groupedTasks.entries()] as [group, groupItems], gi (group)}
        {@const hd = view === "upcoming" ? groupHeader(group) : null}
        {@const orderedItems = view === "upcoming"
          ? [...groupItems.filter((t) => hasTimeOfDay(t.startDate)), ...groupItems.filter((t) => !hasTimeOfDay(t.startDate))]
          : groupItems}
        <div
          class="task-list__group-block"
          class:is-drop-target={dragOverGroup === group && dragOverGroup !== dragFromGroup}
          bind:this={groupBlockRefs[group]}
        >
          {#if view === "upcoming" && hd}
            <div class="task-list__day" class:is-first={gi === 0}>
              <span class="task-list__day-num">{hd.num}</span>
              <span class="task-list__day-label">{hd.label}</span>
              <div class="task-list__day-line"></div>
            </div>
          {:else if view === "today"}
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
          {:else if view === "project" && projectObj && group !== "all"}
            {#if group === "none"}
              <div class="task-list__heading">
                <span class="task-list__heading-static">未分组</span>
                <div class="task-list__day-line"></div>
              </div>
            {:else if projectObj.headings.find((h) => h.id === group)}
              <div class="task-list__heading">
                {#if editingHeadingId === group}
                  <input
                    class="task-list__heading-input"
                    type="text"
                    bind:value={headingDraft}
                    on:blur={() => commitHeadingRename(projectObj.id, group)}
                    on:keydown={(e) => {
                      if (e.key === "Enter") commitHeadingRename(projectObj.id, group);
                      if (e.key === "Escape") editingHeadingId = null;
                    }}
                  />
                {:else}
                  <button
                    class="task-list__heading-title"
                    title="点击重命名"
                    on:click={() => startHeadingRename(projectObj.headings.find((h) => h.id === group))}
                  >
                    {projectObj.headings.find((h) => h.id === group)?.title}
                  </button>
                {/if}
                <div class="task-list__day-line"></div>
                <button
                  class="task-list__heading-del"
                  title="删除标题分组（任务移入未分组）"
                  on:click={() => removeHeading(projectObj.id, group)}
                >×</button>
              </div>
            {/if}
          {/if}
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
            {#each displayItems as task (task.id)}
              <div
                class="task-list__item-wrapper"
                class:is-dragging={draggedId === task.id}
                out:slideOut
              >
                <TaskCard
                  mode="edit"
                  {task}
                  {store}
                  scheduleMode={view === "upcoming" && hasTimeOfDay(task.startDate)}
                  isDragging={draggedId === task.id}
                  currentView={view}
                  {registerItem}
                  {unregisterItem}
                  on:dragstart={(e) => handleDragStart(e.detail.event, task.id)}
                />
              </div>
            {/each}
          </DragSort>
        </div>
      {/each}

      {#if view === "project" && projectObj}
        {#if addingHeading}
          <div class="task-list__heading-add">
            <input
              class="task-list__heading-input"
              type="text"
              placeholder="标题分组名称"
              bind:value={headingDraft}
              on:blur={commitAddHeading}
              on:keydown={(e) => {
                if (e.key === "Enter") commitAddHeading();
                if (e.key === "Escape") { addingHeading = false; headingDraft = ""; }
              }}
            />
          </div>
        {:else}
          <button class="task-list__heading-addbtn" on:click={() => { addingHeading = true; headingDraft = ""; }}>
            ＋ 添加标题分组
          </button>
        {/if}
      {/if}
    {/if}
  </div>

  <!-- 悬浮按钮 -->
  <div class="things-fab">
    {#if showFabMenu}
      <div class="things-fab__menu">
        <button class="things-fab__menu-item" on:click={() => handleFabAction("task")}>
          <svg><use xlink:href="#iconThingsAdd" /></svg>
          <span>新建待办事项</span>
        </button>
        <button class="things-fab__menu-item" on:click={() => handleFabAction("project")}>
          <svg><use xlink:href="#iconThingsProject" /></svg>
          <span>新建项目</span>
        </button>
        <button class="things-fab__menu-item" on:click={() => handleFabAction("area")}>
          <svg><use xlink:href="#iconThingsArea" /></svg>
          <span>新建区域</span>
        </button>
      </div>
    {/if}
    <button class="things-fab__btn" on:click|stopPropagation={() => showFabMenu = !showFabMenu}>
      <svg><use xlink:href="#iconThingsAdd" /></svg>
    </button>
  </div>
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

    &__header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 80px 0 14px;
      flex-shrink: 0;

      // 计划视图的分隔线挪到筛选行下方，其余视图仍在标题下方
      &.has-border {
        border-bottom: 1px solid var(--b3-border-color);
        padding-bottom: 20px;
      }
    }

    // 计划视图筛选标签行
    &__filters {
      display: flex;
      align-items: center;
      gap: 20px;
      flex-shrink: 0;
      padding: 10px 0 14px;
      border-bottom: 1px solid var(--b3-border-color);
    }

    &__filter-chip {
      height: 30px;
      padding: 0 14px;
      border: none;
      border-radius: 999px;
      background: transparent;
      cursor: pointer;
      font-size: 14px;
      color: var(--b3-theme-on-surface-light);
      transition: background-color 0.15s ease, color 0.15s ease;

      &:hover {
        background: var(--b3-theme-surface-light);
      }

      &.is-active {
        background: var(--b3-theme-surface-light);
        color: var(--b3-theme-on-surface);
        font-weight: 600;
      }
    }

    &__filter-more {
      position: relative;
    }

    &__filter-dropdown {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      z-index: 50;
      min-width: 160px;
      max-height: 240px;
      overflow-y: auto;
      padding: 6px;
      background: var(--b3-theme-surface);
      border: 1px solid var(--b3-border-color);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    &__filter-option {
      display: flex;
      align-items: center;
      gap: 8px;
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

      &.is-active {
        color: var(--b3-theme-primary);
        font-weight: 600;
      }
    }

    &__filter-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    // 分组块：跨组拖拽时作为落点区域，命中高亮
    &__group-block {
      border-radius: 12px;
      transition: background-color 0.15s ease;

      &.is-drop-target {
        background: var(--b3-theme-primary-light);
      }
    }

    // 计划视图日期分组头：大数字 + 描述 + 右侧延伸细线
    &__day {
      display: flex;
      align-items: baseline;
      gap: 8px;
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

    &__day-label {
      font-size: 18px;
      font-weight: 700;
      color: var(--b3-theme-on-background);
    }

    &__day-line {
      flex: 1;
      align-self: flex-start; // 对齐日期数字的上沿
      margin-top: 4px;
      height: 1px;
      background: var(--b3-border-color);
    }

    // 项目标题分组（headings）头
    &__heading {
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
      border: none;
      background: transparent;
      cursor: pointer;
      padding: 2px 0;

      &:hover {
        color: var(--b3-theme-primary);
      }
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

    &__heading-del {
      width: 22px;
      height: 22px;
      border: none;
      border-radius: 4px;
      background: transparent;
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
    }

    &__title-icon {
      color: var(--b3-theme-on-background);
      line-height: 1;
    }

    &__empty-icon {
      color: var(--b3-theme-on-surface-light);
      margin-bottom: 4px;
    }

    &__title {
      font-size: 30px;
      font-weight: 700;
      color: var(--b3-theme-on-background);
      margin: 0;
      text-align: left;
    }

    &__items {
      flex: 1;
      overflow-y: auto;
      padding-top: 12px;
    }

    &__item-wrapper {
      &.is-dragging {
        opacity: 0;
        pointer-events: none;
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
    }
  }

  .things-fab {
    position: absolute;
    bottom: 24px;
    right: 24px;
    z-index: 100;

    &__btn {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: var(--b3-theme-primary);
      color: var(--b3-theme-on-primary);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      transition: transform 0.2s, box-shadow 0.2s;

      &:hover {
        transform: scale(1.05);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
      }

      svg {
        width: 24px;
        height: 24px;
      }
    }

    &__menu {
      position: absolute;
      bottom: 64px;
      right: 0;
      background: var(--b3-theme-surface);
      border: 1px solid var(--b3-border-color);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      padding: 8px;
      min-width: 180px;
    }

    &__menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 8px 12px;
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 13px;
      color: var(--b3-theme-on-surface);
      border-radius: 4px;

      &:hover {
        background: var(--b3-theme-surface-light);
      }

      svg {
        width: 16px;
        height: 16px;
      }
    }
  }
</style>
