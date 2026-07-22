<script lang="ts">
  import { setContext } from "svelte";
  import { writable } from "svelte/store";
  import TaskList from "./TaskList.svelte";
  import type { ViewType } from "@/types";
  import type { StoreManager } from "@/stores";

  export let store: StoreManager;
  export let plugin: any;
  export let initialView: ViewType = "inbox";
  export let initialViewId: string | undefined = undefined;

  // 当前视图
  const currentView = writable<ViewType>(initialView);
  const currentViewId = writable<string | undefined>(initialViewId);
  const searchQuery = writable<string>("");

  // 提供给子组件的 context
  setContext("store", store);
  setContext("plugin", plugin);
  setContext("currentView", currentView);
  setContext("currentViewId", currentViewId);
  setContext("searchQuery", searchQuery);

  // 视图标题映射
  const viewTitles: Record<ViewType, string> = {
    inbox: "收件箱",
    today: "今天",
    upcoming: "计划",
    anytime: "任何时候",
    someday: "某天",
    project: "项目",
    area: "区域",
    tag: "标签",
    search: "搜索",
  };

  $: title = getViewTitle($currentView, $currentViewId);

  function getViewTitle(view: ViewType, viewId?: string): string {
    if (view === "project" && viewId) {
      const project = store.projects.get(viewId);
      return project?.name || "项目";
    }
    if (view === "area" && viewId) {
      const area = store.areas.get(viewId);
      return area?.name || "区域";
    }
    if (view === "tag" && viewId) {
      const tag = store.tags.get(viewId);
      return tag?.name || "标签";
    }
    if (view === "search") {
      return `搜索: ${$searchQuery}`;
    }
    return viewTitles[view] || view;
  }

  function handleSearch(query: string) {
    $searchQuery = query;
    if ($searchQuery) {
      $currentView = "search";
    }
  }
</script>

<div class="things-app">
  <!-- 顶部标题栏 -->
  <header class="things-header">
    <div class="things-header__left">
      <svg class="things-header__icon"><use xlink:href="#icon{$currentView === 'inbox' ? 'Inbox' : $currentView === 'today' ? 'Today' : $currentView === 'upcoming' ? 'Calendar' : $currentView === 'anytime' ? 'Anytime' : $currentView === 'someday' ? 'Someday' : $currentView === 'project' ? 'Project' : $currentView === 'area' ? 'Area' : 'Things'}" /></svg>
      <h1 class="things-header__title">{title}</h1>
    </div>
    <div class="things-header__actions">
      <div class="things-search">
        <svg class="things-search__icon">
          <use xlink:href="#iconSearch" />
        </svg>
        <input
          type="text"
          class="things-search__input b3-text-field"
          placeholder="搜索任务..."
          value={$searchQuery}
          on:input={(e) => handleSearch(e.currentTarget.value)}
        />
      </div>
    </div>
  </header>

  <!-- 任务列表 -->
  <div class="things-content">
    <TaskList
      view={$currentView}
      viewId={$currentViewId}
      searchQuery={$searchQuery}
    />
  </div>
</div>

<style lang="scss">
  .things-app {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    font-family: var(--b3-font-family);
    background: var(--b3-theme-background);
  }

  .things-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    border-bottom: 1px solid var(--b3-border-color);
    background: var(--b3-theme-surface);
    flex-shrink: 0;

    &__left {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    &__icon {
      width: 20px;
      height: 20px;
      color: var(--b3-theme-primary);
    }

    &__title {
      font-size: 18px;
      font-weight: 600;
      color: var(--b3-theme-on-background);
      margin: 0;
    }

    &__actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
  }

  .things-search {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: var(--b3-theme-background);
    border: 1px solid var(--b3-border-color);
    border-radius: 6px;

    &__icon {
      width: 14px;
      height: 14px;
      color: var(--b3-theme-on-surface-light);
    }

    &__input {
      border: none;
      background: transparent;
      width: 180px;
      font-size: 13px;

      &:focus {
        outline: none;
      }
    }
  }

  .things-content {
    flex: 1;
    overflow: hidden;
  }
</style>
