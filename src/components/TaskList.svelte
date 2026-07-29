<script lang="ts">
  import { onMount } from "svelte";
  import { cubicOut } from "svelte/easing";
  import TaskCard from "./TaskCard.svelte";
  import DragSort from "./DragSort.svelte";
  import type { ViewType, Task } from "@/types";
  import type { StoreManager } from "@/stores";
  import { showMessage } from "siyuan";

  export let view: ViewType;
  export let viewId: string | undefined;
  export let searchQuery: string;
  export let store: StoreManager;

  let showCreateForm = false;
  let showFabMenu = false;
  let refreshKey = 0;
  let dragSortRef: DragSort;

  // 任务移出列表的滑出动画（完成移入日志 / 视图迁移时播放）
  function slideOut(node: HTMLElement, { duration = 300 }: { duration?: number } = {}) {
    return {
      duration,
      easing: cubicOut,
      css: (t: number, u: number) => `opacity: ${t}; transform: translateX(${u * -100}%);`,
    };
  }

  // 监听 store 变化
  onMount(() => {
    const unsubTasks = store.tasks.on(() => {
      refreshKey++;
    });
    return () => {
      unsubTasks();
    };
  });

  // 根据视图获取任务列表 - 使用响应式声明确保视图切换时刷新
  $: tasks = getTasks(view, viewId, searchQuery, refreshKey, store.tasks.count);

  function getTasks(view: ViewType, viewId?: string, query?: string, _key?: number, _count?: number): Task[] {
    if (query) {
      return store.tasks.search(query);
    }

    switch (view) {
      case "inbox":
        return store.tasks.getInboxTasks();
      case "today":
        return store.tasks.getTodayTasks();
      case "upcoming":
        return store.tasks.getUpcomingTasks().sort((a, b) => (a.startDate || 0) - (b.startDate || 0));
      case "anytime":
        return store.tasks.getAnytimeTasks();
      case "someday":
        return store.tasks.getSomedayTasks();
      case "log":
        return store.tasks.getCompletedTasks();
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

  // 按日期分组
  $: groupedTasks = groupTasks(sortedTasks, view);

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

  function groupTasks(tasks: Task[], view: ViewType): Map<string, Task[]> {
    // 今天视图：拆分为“今天”和“今晚”两组
    if (view === "today") {
      const day: Task[] = [];
      const evening: Task[] = [];
      for (const t of tasks) {
        if (isThisEvening(t.startDate)) evening.push(t);
        else day.push(t);
      }
      const map = new Map<string, Task[]>();
      if (day.length) map.set("今天", day);
      if (evening.length) map.set("今晚", evening);
      return map;
    }

    if (view !== "upcoming") {
      return new Map([["all", tasks]]);
    }

    const groups = new Map<string, Task[]>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const task of tasks) {
      if (!task.startDate) continue;
      const date = new Date(task.startDate);
      date.setHours(0, 0, 0, 0);

      const diffDays = Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      let key: string;

      if (diffDays === 0) key = "今天";
      else if (diffDays === 1) key = "明天";
      else if (diffDays < 7) key = `${diffDays}天后`;
      else key = date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });

      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(task);
    }

    return groups;
  }

  function handleTaskCreated() {
    showCreateForm = false;
  }

  // 处理拖拽排序
  async function handleReorder(e: CustomEvent) {
    const { fromIndex, toIndex, id } = e.detail;
    const currentTasks = [...sortedTasks];

    // 重新排列
    const [movedTask] = currentTasks.splice(fromIndex, 1);
    currentTasks.splice(toIndex, 0, movedTask);

    // 更新所有任务的 order
    for (let i = 0; i < currentTasks.length; i++) {
      await store.tasks.updateTask(currentTasks[i].id, { order: i });
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
        const projectName = prompt('输入项目名称:');
        if (projectName) {
          store.projects.createProject({ name: projectName }).then(() => {
            showMessage(`项目已创建: ${projectName}`);
          });
        }
        break;
      case "area":
        const areaName = prompt('输入区域名称:');
        if (areaName) {
          store.areas.createArea({ name: areaName }).then(() => {
            showMessage(`区域已创建: ${areaName}`);
          });
        }
        break;
    }
  }

  // 点击外部关闭菜单
  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.things-fab')) {
      showFabMenu = false;
    }
  }

  // 视图标题
  $: viewTitle = getViewTitle(view, viewId);

  function getViewTitle(view: ViewType, viewId?: string): string {
    const titles: Record<string, string> = {
      inbox: "收件箱",
      today: "今天",
      upcoming: "计划",
      anytime: "随时",
      someday: "某天",
      log: "日志",
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

  // 视图图标
  $: viewIcon = getViewIcon(view);

  function getViewIcon(view: ViewType): string {
    const icons: Record<string, string> = {
      inbox: "📥",
      today: "⭐",
      upcoming: "📅",
      anytime: "⏰",
      someday: "💭",
      log: "📋",
      search: "🔍",
    };
    return icons[view] || "📝";
  }
</script>

<svelte:window on:click={handleClickOutside} />

<div class="task-list">
  <!-- 大标题 -->
  <div class="task-list__header">
    <span class="task-list__title-icon">{viewIcon}</span>
    <h1 class="task-list__title">{viewTitle}</h1>
  </div>

  <!-- 创建任务表单 -->
  {#if showCreateForm}
    <TaskCard
      mode="create"
      {store}
      currentView={view}
      on:created={handleTaskCreated}
      on:cancel={() => showCreateForm = false}
    />
  {/if}

  <!-- 任务列表 -->
  <div class="task-list__items">
    {#if sortedTasks.length === 0}
      <div class="task-list__empty">
        {#if view === "inbox"}
          <p>📥 收件箱为空</p>
        {:else if view === "today"}
          <p>☀️ 今天没有任务</p>
        {:else if view === "upcoming"}
          <p>📅 没有计划任务</p>
        {:else if view === "anytime"}
          <p>📋 没有随时任务</p>
        {:else if view === "someday"}
          <p>💭 没有某天任务</p>
        {:else if view === "log"}
          <p>📋 日志簿为空</p>
        {:else if view === "search"}
          <p>🔍 未找到匹配任务</p>
        {:else}
          <p>暂无任务</p>
        {/if}
      </div>
    {:else}
      {#each [...groupedTasks.entries()] as [group, groupTasks]}
        {#if view === "upcoming" && groupedTasks.size > 1}
          <div class="task-list__group">{group}</div>
        {:else if view === "today" && group === "今晚"}
          <div class="task-list__group task-list__group--evening">
            <span class="task-list__group-icon">🌙</span>
            <span>今晚</span>
          </div>
        {/if}
        <DragSort
          bind:this={dragSortRef}
          items={groupTasks}
          itemKey="id"
          on:reorder={handleReorder}
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
                isDragging={draggedId === task.id}
                currentView={view}
                {registerItem}
                {unregisterItem}
                on:dragstart={(e) => handleDragStart(e.detail.event, task.id)}
              />
            </div>
          {/each}
        </DragSort>
      {/each}
    {/if}
  </div>

  <!-- 悬浮按钮 -->
  <div class="things-fab">
    {#if showFabMenu}
      <div class="things-fab__menu">
        <button class="things-fab__menu-item" on:click={() => handleFabAction("task")}>
          <svg><use xlink:href="#iconAdd" /></svg>
          <span>新建待办事项</span>
        </button>
        <button class="things-fab__menu-item" on:click={() => handleFabAction("project")}>
          <svg><use xlink:href="#iconProject" /></svg>
          <span>新建项目</span>
        </button>
        <button class="things-fab__menu-item" on:click={() => handleFabAction("area")}>
          <svg><use xlink:href="#iconArea" /></svg>
          <span>新建区域</span>
        </button>
      </div>
    {/if}
    <button class="things-fab__btn" on:click|stopPropagation={() => showFabMenu = !showFabMenu}>
      <svg><use xlink:href="#iconAdd" /></svg>
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
    padding: 0 48px;

    &__header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 56px 0 28px 24px;
      flex-shrink: 0;
    }

    &__title-icon {
      font-size: 30px;
      line-height: 1;
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

      &--evening {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 32px;
        padding: 8px 12px;
        font-size: 18px;
        font-weight: 700;
        color: var(--b3-theme-on-background);
        background: transparent;
        border-bottom: 1px solid var(--b3-border-color);
        text-transform: none;
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
