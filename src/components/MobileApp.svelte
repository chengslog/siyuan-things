<script lang="ts">
  import { onDestroy, onMount, setContext, tick } from "svelte";
  import { showMessage } from "siyuan";
  import EntityForm from "./EntityForm.svelte";
  import type { StoreManager } from "@/stores";
  import type { Area, Project, Tag, ViewType } from "@/types";

  export let store: StoreManager;
  export let version = "";
  export let plugin: any = null;

  setContext("store", store);
  setContext("plugin", plugin);

  type CreateKind = "project" | "area" | "tag";
  type ReorderKind = "project" | "area" | "tag";
  type TagRow = { tag: Tag; depth: number };

  const mainGroups: { view: ViewType; icon: string; label: string }[][] = [
    [{ view: "search", icon: "iconThingsSearch", label: "快速查找" }],
    [{ view: "inbox", icon: "iconThingsInbox", label: "收件箱" }],
    [
      { view: "today", icon: "iconThingsToday", label: "今天" },
      { view: "upcoming", icon: "iconThingsCalendar", label: "计划" },
      { view: "anytime", icon: "iconThingsAnytime", label: "随时" },
      { view: "someday", icon: "iconThingsSomeday", label: "某天" },
    ],
    [{ view: "log", icon: "iconThingsLog", label: "日志" }],
  ];

  let revision = 0;
  let navigationScroll: HTMLElement;
  let savedScrollTop = 0;
  let createKind: CreateKind | null = null;
  let reorderKind: ReorderKind | null = null;
  let tagName = "";
  let tagInput: HTMLInputElement;
  let projects: Project[] = [];
  let areas: Area[] = [];
  let tagRows: TagRow[] = [];
  let counts: Record<string, number> = {};
  const unsubscribers: Array<() => void> = [];

  function flattenTags(tags: Tag[]): TagRow[] {
    const children = new Map<string | undefined, Tag[]>();
    for (const tag of tags) {
      const key = tag.parentId || undefined;
      const list = children.get(key) || [];
      list.push(tag);
      children.set(key, list);
    }
    for (const list of children.values()) list.sort((a, b) => a.order - b.order);
    const rows: TagRow[] = [];
    const visit = (parentId: string | undefined, depth: number) => {
      for (const tag of children.get(parentId) || []) {
        rows.push({ tag, depth });
        visit(tag.id, depth + 1);
      }
    };
    visit(undefined, 0);
    return rows;
  }

  $: {
    revision;
    projects = store.projects.getActiveProjects().sort((a, b) => a.order - b.order);
    areas = store.areas.getAll().sort((a, b) => a.order - b.order);
    tagRows = flattenTags(store.tags.getAll());
    counts = {
      inbox: store.tasks.getInboxTasks().length,
      today: store.tasks.getTodayTasks().length,
      upcoming: store.tasks.getUpcomingTasks().length,
      anytime: store.tasks.getAnytimeTasks().length,
      someday: store.tasks.getSomedayTasks().length,
    };
  }

  export function showTasks(view: ViewType, viewId?: string, query = "") {
    if (navigationScroll) savedScrollTop = navigationScroll.scrollTop;
    createKind = null;
    reorderKind = null;
    plugin?.openMobileTaskPage?.(view, viewId, query);
  }

  export async function showNavigation() {
    createKind = null;
    reorderKind = null;
    await tick();
    if (navigationScroll) navigationScroll.scrollTop = savedScrollTop;
  }

  export function refresh() {
    revision += 1;
  }

  function toggleReorder(kind: ReorderKind, event: MouseEvent) {
    event.stopPropagation();
    createKind = null;
    reorderKind = reorderKind === kind ? null : kind;
  }

  async function moveEntity(kind: ReorderKind, id: string, delta: -1 | 1, event: MouseEvent) {
    event.stopPropagation();
    let siblings: Array<{ id: string; order: number }> = [];
    if (kind === "project") siblings = [...projects];
    if (kind === "area") siblings = [...areas];
    if (kind === "tag") {
      const selected = store.tags.get(id);
      siblings = store.tags.getAll()
        .filter((tag) => (tag.parentId || undefined) === (selected?.parentId || undefined))
        .sort((a, b) => a.order - b.order);
    }
    const index = siblings.findIndex((item) => item.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= siblings.length) return;
    [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
    for (let order = 0; order < siblings.length; order += 1) {
      if (kind === "project") await store.projects.updateProject(siblings[order].id, { order });
      if (kind === "area") await store.areas.updateArea(siblings[order].id, { order });
      if (kind === "tag") await store.tags.updateTag(siblings[order].id, { order });
    }
  }

  function openCreate(kind: CreateKind, event: MouseEvent) {
    event.stopPropagation();
    createKind = kind;
    tagName = "";
    if (kind === "tag") tick().then(() => tagInput?.focus());
  }

  async function createTag() {
    const name = tagName.trim();
    if (!name) {
      tagInput?.focus();
      return;
    }
    await store.tags.createTag({ name });
    showMessage(`标签已创建：${name}`);
    createKind = null;
  }

  function handleNavigateEvent(event: Event) {
    const detail = (event as CustomEvent).detail || {};
    if (!detail.view) return;
    showTasks(detail.view as ViewType, detail.viewId, detail.searchQuery || "");
  }

  onMount(() => {
    const refreshAll = () => refresh();
    unsubscribers.push(
      store.tasks.on(refreshAll),
      store.projects.on(refreshAll),
      store.areas.on(refreshAll),
      store.tags.on(refreshAll),
    );
    window.addEventListener("things-navigate", handleNavigateEvent);
  });

  onDestroy(() => {
    for (const unsubscribe of unsubscribers) unsubscribe();
    window.removeEventListener("things-navigate", handleNavigateEvent);
  });
</script>

<div class="mobile-things">
    <header class="mobile-things__header">
      <div class="mobile-things__brand">
        <svg aria-hidden="true"><use xlink:href="#iconThings" /></svg>
        <span>Things</span>
      </div>
      <span class="mobile-things__version">v{version}</span>
    </header>

    <main class="mobile-things__navigation" bind:this={navigationScroll}>
      {#each mainGroups as group, groupIndex}
        <section class="mobile-things__group" class:is-search={groupIndex === 0}>
          {#each group as item}
            <button class="mobile-things__nav-row" class:is-search-row={item.view === "search"} on:click={() => showTasks(item.view)}>
              <svg class="mobile-things__nav-icon" aria-hidden="true"><use xlink:href={`#${item.icon}`} /></svg>
              <span>{item.label}</span>
              {#if counts[item.view]}
                <span class="mobile-things__count">{counts[item.view]}</span>
              {/if}
              {#if item.view !== "search"}<svg class="mobile-things__chevron" aria-hidden="true"><use xlink:href="#iconRight" /></svg>{/if}
            </button>
          {/each}
        </section>
      {/each}

      <section class="mobile-things__section">
        <div class="mobile-things__section-title">
          <button class="mobile-things__section-open" on:click={() => showTasks("projects")}>
            <svg aria-hidden="true"><use xlink:href="#iconThingsProject" /></svg><span>项目</span>
          </button>
          <span class="mobile-things__section-actions">
            <button class="mobile-things__sort-action" class:is-active={reorderKind === "project"} aria-label="调整项目顺序" on:click={(event) => toggleReorder("project", event)}>{reorderKind === "project" ? "完成" : "排序"}</button>
            <button aria-label="新建项目" on:click={(event) => openCreate("project", event)}>＋</button>
          </span>
        </div>
        {#each projects as project (project.id)}
          <div class="mobile-things__nav-row mobile-things__nav-row--child" role="button" tabindex="0" on:click={() => showTasks("project", project.id)} on:keydown={(event) => event.key === "Enter" && showTasks("project", project.id)}>
            <svg class="mobile-things__nav-icon" aria-hidden="true"><use xlink:href="#iconThingsFolder" /></svg>
            <span>{project.name}</span>
            {#if reorderKind === "project"}
              <span class="mobile-things__reorder-actions">
                <button aria-label="上移项目" on:click={(event) => moveEntity("project", project.id, -1, event)}>↑</button>
                <button aria-label="下移项目" on:click={(event) => moveEntity("project", project.id, 1, event)}>↓</button>
              </span>
            {:else}<svg class="mobile-things__chevron" aria-hidden="true"><use xlink:href="#iconRight" /></svg>{/if}
          </div>
        {/each}
      </section>

      <section class="mobile-things__section">
        <div class="mobile-things__section-title">
          <button class="mobile-things__section-open" on:click={() => showTasks("areas")}>
            <svg aria-hidden="true"><use xlink:href="#iconThingsArea" /></svg><span>区域</span>
          </button>
          <span class="mobile-things__section-actions">
            <button class="mobile-things__sort-action" class:is-active={reorderKind === "area"} aria-label="调整区域顺序" on:click={(event) => toggleReorder("area", event)}>{reorderKind === "area" ? "完成" : "排序"}</button>
            <button aria-label="新建区域" on:click={(event) => openCreate("area", event)}>＋</button>
          </span>
        </div>
        {#each areas as area (area.id)}
          <div class="mobile-things__nav-row mobile-things__nav-row--child" role="button" tabindex="0" on:click={() => showTasks("area", area.id)} on:keydown={(event) => event.key === "Enter" && showTasks("area", area.id)}>
            <svg class="mobile-things__nav-icon" aria-hidden="true"><use xlink:href="#iconThingsLayers" /></svg>
            <span>{area.name}</span>
            {#if reorderKind === "area"}
              <span class="mobile-things__reorder-actions">
                <button aria-label="上移区域" on:click={(event) => moveEntity("area", area.id, -1, event)}>↑</button>
                <button aria-label="下移区域" on:click={(event) => moveEntity("area", area.id, 1, event)}>↓</button>
              </span>
            {:else}<svg class="mobile-things__chevron" aria-hidden="true"><use xlink:href="#iconRight" /></svg>{/if}
          </div>
        {/each}
      </section>

      <section class="mobile-things__section">
        <div class="mobile-things__section-title">
          <button class="mobile-things__section-open" on:click={() => showTasks("tags")}>
            <svg aria-hidden="true"><use xlink:href="#iconThingsTagColor" /></svg><span>标签</span>
          </button>
          <span class="mobile-things__section-actions">
            <button class="mobile-things__sort-action" class:is-active={reorderKind === "tag"} aria-label="调整标签顺序" on:click={(event) => toggleReorder("tag", event)}>{reorderKind === "tag" ? "完成" : "排序"}</button>
            <button aria-label="新建标签" on:click={(event) => openCreate("tag", event)}>＋</button>
          </span>
        </div>
        {#each tagRows as row (row.tag.id)}
          <div
            class="mobile-things__nav-row mobile-things__nav-row--child"
            role="button"
            tabindex="0"
            style={`padding-left:${20 + row.depth * 18}px`}
            on:click={() => showTasks("tag", row.tag.id)}
            on:keydown={(event) => event.key === "Enter" && showTasks("tag", row.tag.id)}
          >
            <span class="mobile-things__tag-dot" style:background-color={row.tag.color || "var(--b3-theme-primary)"}></span>
            <span>{row.tag.name}</span>
            {#if reorderKind === "tag"}
              <span class="mobile-things__reorder-actions">
                <button aria-label="上移标签" on:click={(event) => moveEntity("tag", row.tag.id, -1, event)}>↑</button>
                <button aria-label="下移标签" on:click={(event) => moveEntity("tag", row.tag.id, 1, event)}>↓</button>
              </span>
            {:else}<svg class="mobile-things__chevron" aria-hidden="true"><use xlink:href="#iconRight" /></svg>{/if}
          </div>
        {/each}
      </section>
    </main>

  {#if createKind}
    <div class="mobile-things__sheet-backdrop" role="presentation" on:click={() => createKind = null}>
      <div class="mobile-things__sheet" role="dialog" aria-modal="true" on:click|stopPropagation>
        {#if createKind === "tag"}
          <div class="mobile-things__tag-form">
            <h2>新建标签</h2>
            <input
              bind:this={tagInput}
              bind:value={tagName}
              placeholder="标签名称"
              on:keydown={(event) => {
                if (event.key === "Enter") createTag();
                if (event.key === "Escape") createKind = null;
              }}
            />
            <div>
              <button on:click={() => createKind = null}>取消</button>
              <button class="is-primary" on:click={createTag}>创建</button>
            </div>
          </div>
        {:else}
          <EntityForm
            {store}
            kind={createKind}
            on:created={() => createKind = null}
            on:cancel={() => createKind = null}
          />
        {/if}
      </div>
    </div>
  {/if}
</div>

<style lang="scss">
  .mobile-things {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    color: var(--b3-theme-on-background);
    background: var(--b3-theme-background);
    font-family: var(--b3-font-family);

    &__header {
      flex: 0 0 auto;
      min-height: 52px;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: max(8px, env(safe-area-inset-top)) 16px 8px;
      background: var(--b3-theme-background);
    }

    &__brand {
      display: flex;
      align-items: center;
      gap: 9px;
      font-size: 20px;
      font-weight: 650;

      svg { width: 24px; height: 24px; color: var(--b3-theme-primary); }
    }

    &__version {
      color: var(--b3-theme-on-surface-light);
      font-size: 12px;
    }

    &__navigation {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      overscroll-behavior: contain;
      padding: 2px 12px calc(20px + env(safe-area-inset-bottom));
    }

    &__group {
      margin: 0;
      overflow: visible;
      border: 0;
      border-radius: 0;
      background: transparent;
    }

    &__group + &__group { margin-top: 6px; }

    &__group.is-search { margin-bottom: 10px; }

    &__section {
      margin: 12px 0 0;
      padding-top: 5px;
      overflow: visible;
      border: 0;
      border-top: 1px solid color-mix(in srgb, var(--b3-border-color) 72%, transparent);
      border-radius: 0;
      background: transparent;
    }

    &__nav-row,
    &__section-title {
      width: 100%;
      min-height: 44px;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 11px;
      margin: 0;
      padding: 6px 10px;
      border: 0;
      border-radius: 8px;
      color: var(--b3-theme-on-background);
      background: transparent;
      font: inherit;
      text-align: left;
      -webkit-tap-highlight-color: transparent;

      &:active { background: var(--b3-theme-surface-light); }
      > span:not(.mobile-things__count):not(.mobile-things__tag-dot) { flex: 1; min-width: 0; }
    }

    &__nav-row.is-search-row {
      min-height: 42px;
      border-radius: 11px;
      color: var(--b3-theme-on-surface-light);
      background: var(--b3-theme-surface-light);

      .mobile-things__nav-icon { color: var(--b3-theme-on-surface-light); }
    }

    &__nav-row--child { min-height: 40px; padding: 5px 10px 5px 18px; font-size: 14px; }

    &__nav-icon,
    &__section-title svg {
      flex: 0 0 auto;
      width: 20px;
      height: 20px;
      color: var(--b3-theme-primary);
    }

    &__chevron {
      flex: 0 0 auto;
      width: 15px !important;
      height: 15px !important;
      color: var(--b3-theme-on-surface-light) !important;
      opacity: .65;
    }

    &__count {
      min-width: 20px;
      color: var(--b3-theme-on-surface-light);
      font-size: 13px;
      text-align: right;
    }

    &__section-title {
      min-height: 44px;
      display: flex;
      align-items: center;
      gap: 0;
      padding: 0;
      font-weight: 600;
      border: 0;

      > span { display: flex; align-items: center; gap: 2px; }
    }

    &__section-open {
      flex: 1;
      min-width: 0;
      min-height: 44px;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 10px;
      border: 0;
      border-radius: 8px;
      color: inherit;
      background: transparent;
      font: inherit;
      font-weight: inherit;
      text-align: left;

      &:active { background: var(--b3-theme-surface-light); }

      span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    }

    &__section-actions {
      flex: 0 0 auto !important;
      padding-right: 8px;

      button {
        width: 34px;
        height: 34px;
        border: 0;
        border-radius: 50%;
        color: var(--b3-theme-primary);
        background: transparent;
        font-size: 23px;
        line-height: 1;
      }

      button:last-child { display: grid; place-items: center; }
      button.is-active { color: var(--b3-theme-on-primary); background: var(--b3-theme-primary); }

      .mobile-things__sort-action {
        width: auto;
        min-width: 42px;
        padding: 0 7px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 550;
      }
    }

    &__reorder-actions {
      flex: 0 0 auto !important;
      display: flex !important;
      align-items: center;
      gap: 4px;

      button {
        width: 34px;
        height: 34px;
        padding: 0;
        border: 0;
        border-radius: 8px;
        color: var(--b3-theme-primary);
        background: var(--b3-theme-surface-light);
        font: inherit;
        font-size: 17px;
      }
    }

    &__tag-dot {
      flex: 0 0 auto;
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }

    &__sheet-backdrop {
      position: absolute;
      z-index: 20;
      inset: 0;
      display: flex;
      align-items: flex-end;
      background: rgba(0, 0, 0, .34);
    }

    &__sheet {
      width: 100%;
      max-height: calc(100% - 32px);
      box-sizing: border-box;
      overflow: auto;
      padding: 8px 12px calc(12px + env(safe-area-inset-bottom));
      border-radius: 18px 18px 0 0;
      background: var(--b3-theme-background);
    }

    &__tag-form {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 14px 8px;

      h2 { margin: 0; font-size: 17px; }
      input {
        min-height: 44px;
        box-sizing: border-box;
        padding: 8px 12px;
        border: 1px solid var(--b3-border-color);
        border-radius: 9px;
        outline: none;
        color: var(--b3-theme-on-background);
        background: var(--b3-theme-surface);
        font: inherit;
      }
      > div { display: flex; justify-content: flex-end; gap: 8px; }
      button {
        min-width: 72px;
        min-height: 40px;
        border: 0;
        border-radius: 8px;
        color: var(--b3-theme-on-background);
        background: var(--b3-theme-surface);
        font: inherit;
      }
      button.is-primary { color: var(--b3-theme-on-primary); background: var(--b3-theme-primary); }
    }
  }
</style>
