<script lang="ts">
  import type { ViewType, Area, Project } from "@/types";
  import type { StoreManager } from "@/stores";
  import { onDestroy } from "svelte";

  export let store: StoreManager;
  export let currentView: ViewType;
  export let currentViewId: string | undefined;
  export let onViewChange: (view: ViewType, id?: string) => void;

  let taskVersion = 0;

  // 监听任务变化
  const unsubscribe = store.tasks.on(() => {
    taskVersion++;
  });

  onDestroy(() => {
    unsubscribe();
  });

  // 获取数量的函数
  function getCounts() {
    const inbox = store.tasks.getInboxTasks().length;
    const today = store.tasks.getTodayTasks().length;
    const upcoming = store.tasks.getUpcomingTasks().length;
    const anytime = store.tasks.getAnytimeTasks().length;
    return { inbox, today, upcoming, anytime };
  }

  // 响应式数量 - 每次任务变化时重新计算
  $: counts = (() => {
    void taskVersion; // 依赖 taskVersion 触发更新
    return getCounts();
  })();

  // 侧边栏项目
  $: mainItems = [
    { view: "inbox" as ViewType, icon: "iconThingsInbox", label: "收件箱", count: counts.inbox },
    { view: "today" as ViewType, icon: "iconThingsToday", label: "今天", count: counts.today },
    { view: "upcoming" as ViewType, icon: "iconThingsCalendar", label: "计划", count: counts.upcoming },
    { view: "anytime" as ViewType, icon: "iconThingsAnytime", label: "任何时候", count: counts.anytime },
    { view: "someday" as ViewType, icon: "iconThingsSomeday", label: "某天", count: 0 },
  ];

  // 获取区域和项目
  $: areas = store.areas.getAll().sort((a, b) => a.order - b.order);
  $: projects = store.projects.getActiveProjects().sort((a, b) => a.order - b.order);
  $: tags = store.tags.getRootTags().sort((a, b) => a.order - b.order);

  // 按区域分组项目
  $: projectsByArea = groupProjectsByArea(projects, areas);

  function groupProjectsByArea(projects: Project[], areas: Area[]): Map<string | undefined, Project[]> {
    const map = new Map<string | undefined, Project[]>();
    map.set(undefined, []);

    for (const area of areas) {
      map.set(area.id, []);
    }

    for (const project of projects) {
      const key = project.areaId;
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(project);
    }

    return map;
  }

  function handleNavClick(view: ViewType, id?: string) {
    if (onViewChange) {
      onViewChange(view, id);
    }
  }

  function handleAddArea() {
    const name = prompt("输入区域名称:");
    if (name) {
      store.areas.createArea({ name });
    }
  }

  function handleAddProject(areaId?: string) {
    const name = prompt("输入项目名称:");
    if (name) {
      store.projects.createProject({ name, areaId });
    }
  }

  function isActive(view: ViewType, id?: string): boolean {
    if (currentView !== view) return false;
    if (id !== undefined) return currentViewId === id;
    return currentViewId === undefined;
  }
</script>

<aside class="sidebar">
  <div class="sidebar__header">
    <span class="sidebar__logo">✓</span>
    <span class="sidebar__title">Things</span>
  </div>

  <nav class="sidebar__nav">
    <!-- 主要列表 -->
    <div class="sidebar__section">
      {#each mainItems as item}
        <button
          class="sidebar__item"
          class:is-active={isActive(item.view)}
          on:click={() => handleNavClick(item.view)}
        >
          <svg class="sidebar__icon"><use xlink:href="#{item.icon}" /></svg>
          <span class="sidebar__label">{item.label}</span>
          {#if item.count > 0}
            <span class="sidebar__badge">{item.count}</span>
          {/if}
        </button>
      {/each}
    </div>

    <!-- 区域 -->
    <div class="sidebar__section">
      <div class="sidebar__section-header">
        <span class="sidebar__section-title">区域</span>
        <button class="sidebar__add-btn" on:click={handleAddArea} title="添加区域">
          <svg><use xlink:href="#iconThingsAdd" /></svg>
        </button>
      </div>

      {#each areas as area}
        <div class="sidebar__area">
          <button
            class="sidebar__item sidebar__item--area"
            class:is-active={isActive("area", area.id)}
            on:click={() => handleNavClick("area", area.id)}
          >
            <svg class="sidebar__icon"><use xlink:href="#iconThingsArea" /></svg>
            <span class="sidebar__label">{area.name}</span>
          </button>

          {#each projectsByArea.get(area.id) || [] as project}
            <button
              class="sidebar__item sidebar__item--project"
              class:is-active={isActive("project", project.id)}
              on:click={() => handleNavClick("project", project.id)}
            >
              <svg class="sidebar__icon"><use xlink:href="#iconThingsProject" /></svg>
              <span class="sidebar__label">{project.name}</span>
            </button>
          {/each}

          <button
            class="sidebar__add-btn sidebar__add-btn--sub"
            on:click={() => handleAddProject(area.id)}
            title="在此区域添加项目"
          >
            <svg><use xlink:href="#iconThingsAdd" /></svg>
            <span>添加项目</span>
          </button>
        </div>
      {/each}

      <!-- 无区域的项目 -->
      {#if projectsByArea.get(undefined)?.length}
        <div class="sidebar__area">
          {#each projectsByArea.get(undefined) || [] as project}
            <button
              class="sidebar__item sidebar__item--project"
              class:is-active={isActive("project", project.id)}
              on:click={() => handleNavClick("project", project.id)}
            >
              <svg class="sidebar__icon"><use xlink:href="#iconThingsProject" /></svg>
              <span class="sidebar__label">{project.name}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <!-- 标签 -->
    <div class="sidebar__section">
      <div class="sidebar__section-header">
        <span class="sidebar__section-title">标签</span>
      </div>

      <div class="sidebar__tags">
        {#each tags as tag}
          <button
            class="sidebar__tag"
            class:is-active={isActive("tag", tag.id)}
            on:click={() => handleNavClick("tag", tag.id)}
            style={tag.color ? `background-color: ${tag.color}` : ""}
          >
            {tag.name}
          </button>
        {/each}
      </div>
    </div>
  </nav>
</aside>

<style lang="scss">
  .sidebar {
    width: 220px;
    min-width: 220px;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--b3-theme-surface);
    border-right: 1px solid var(--b3-border-color);
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: transparent transparent;

    &:hover {
      scrollbar-color: var(--b3-border-color) transparent;
    }

    &::-webkit-scrollbar {
      width: 6px;
    }

    &::-webkit-scrollbar-track {
      background: transparent;
    }

    &::-webkit-scrollbar-thumb {
      background-color: transparent;
      border-radius: 3px;
    }

    &:hover::-webkit-scrollbar-thumb {
      background-color: var(--b3-border-color);
    }

    &__header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 16px;
      border-bottom: 1px solid var(--b3-border-color);
    }

    &__logo {
      font-size: 20px;
      color: var(--b3-theme-primary);
    }

    &__title {
      font-size: 16px;
      font-weight: 600;
      color: var(--b3-theme-on-surface);
    }

    &__nav {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
      scrollbar-width: thin;
      scrollbar-color: transparent transparent;

      &:hover {
        scrollbar-color: var(--b3-border-color) transparent;
      }

      &::-webkit-scrollbar {
        width: 6px;
      }

      &::-webkit-scrollbar-track {
        background: transparent;
      }

      &::-webkit-scrollbar-thumb {
        background-color: transparent;
        border-radius: 3px;
      }

      &:hover::-webkit-scrollbar-thumb {
        background-color: var(--b3-border-color);
      }
    }

    &__section {
      margin-bottom: 8px;
    }

    &__section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 12px;
    }

    &__section-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--b3-theme-on-surface-light);
    }

    &__item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 8px 12px;
      border: none;
      background: transparent;
      cursor: pointer;
      color: var(--b3-theme-on-surface);
      font-size: 13px;
      transition: background-color 0.2s;

      &:hover {
        background: var(--b3-theme-surface-light);
      }

      &.is-active {
        background: var(--b3-theme-primary-light);
        color: var(--b3-theme-primary);
      }

      &--area {
        font-weight: 500;
      }

      &--project {
        padding-left: 28px;
        font-size: 12px;
      }
    }

    &__icon {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }

    &__label {
      flex: 1;
      text-align: left;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &__badge {
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 10px;
      background: var(--b3-theme-primary);
      color: var(--b3-theme-on-primary);
    }

    &__add-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px;
      border: none;
      background: transparent;
      cursor: pointer;
      color: var(--b3-theme-on-surface-light);
      border-radius: 4px;

      &:hover {
        background: var(--b3-theme-surface-light);
        color: var(--b3-theme-on-surface);
      }

      svg {
        width: 14px;
        height: 14px;
      }

      &--sub {
        padding: 6px 12px 6px 28px;
        font-size: 11px;
        width: 100%;
        justify-content: flex-start;
      }
    }

    &__tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 8px 12px;
    }

    &__tag {
      padding: 3px 8px;
      border: none;
      border-radius: 10px;
      background: var(--b3-theme-surface-light);
      color: var(--b3-theme-on-surface);
      font-size: 11px;
      cursor: pointer;
      transition: all 0.2s;

      &:hover {
        background: var(--b3-theme-primary-light);
      }

      &.is-active {
        background: var(--b3-theme-primary);
        color: var(--b3-theme-on-primary);
      }
    }
  }
</style>
