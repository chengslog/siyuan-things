<script lang="ts">
  import { onDestroy, onMount, setContext, tick } from "svelte";
  import { showMessage } from "siyuan";
  import EntityForm from "./EntityForm.svelte";
  import { touchSort } from "@/utils/touchSort";
  import type { StoreManager } from "@/stores";
  import type { Area, Project, Tag, ViewType } from "@/types";

  export let store: StoreManager;
  export let version = "";
  export let plugin: any = null;

  setContext("store", store);
  setContext("plugin", plugin);

  type CreateKind = "project" | "area" | "tag";
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
    plugin?.openMobileTaskPage?.(view, viewId, query);
  }

  export async function showNavigation() {
    createKind = null;
    await tick();
    if (navigationScroll) navigationScroll.scrollTop = savedScrollTop;
  }

  export function refresh() {
    revision += 1;
  }

  async function reorderEntities({ group, id, beforeId }: { group: string; id: string; beforeId: string | null }) {
    const kind = group.split(':')[0];
    let siblings: Array<Project | Area | Tag> = [];
    if (kind === "project") siblings = [...projects];
    if (kind === "area") siblings = [...areas];
    if (kind === "tag") {
      const selected = store.tags.get(id);
      siblings = store.tags.getAll()
        .filter((tag) => (tag.parentId || undefined) === (selected?.parentId || undefined))
        .sort((a, b) => a.order - b.order);
    }
    const index = siblings.findIndex((item) => item.id === id);
    if (index < 0 || beforeId === id) return;
    const original = siblings.map(item => item.id).join(',');
    const [moved] = siblings.splice(index, 1);
    const target = beforeId === null ? siblings.length : siblings.findIndex(item => item.id === beforeId);
    if (target < 0) return;
    siblings.splice(target, 0, moved);
    if (siblings.map(item => item.id).join(',') === original) return;
    const entityStore = kind === 'project' ? store.projects : kind === 'area' ? store.areas : store.tags;
    await entityStore.batch(() => {
      siblings.forEach((item, order) => { item.order = order; item.updated = Date.now(); });
    });
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

    <main class="mobile-things__navigation" bind:this={navigationScroll} use:touchSort={reorderEntities}>
      {#each mainGroups as group, groupIndex}
        <section class="mobile-things__group" class:is-search={groupIndex === 0}>
          {#each group as item}
            <button class="mobile-things__nav-row" class:is-search-row={item.view === "search"} on:click={() => showTasks(item.view)}>
              <svg class="mobile-things__nav-icon" aria-hidden="true"><use xlink:href={`#${item.icon}`} /></svg>
              <span class="mobile-things__nav-label">{item.label}</span>
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
            <button aria-label="新建项目" on:click={(event) => openCreate("project", event)}><svg aria-hidden="true"><use xlink:href="#iconThingsAdd" /></svg></button>
          </span>
        </div>
        {#each projects as project (project.id)}
          <div class="mobile-things__nav-row mobile-things__nav-row--child" data-sort-id={project.id} data-sort-group="project" role="button" tabindex="0" on:click={() => showTasks("project", project.id)} on:keydown={(event) => event.key === "Enter" && showTasks("project", project.id)}>
            <svg class="mobile-things__nav-icon" aria-hidden="true"><use xlink:href="#iconThingsFolder" /></svg>
            <span class="mobile-things__nav-label" title={project.name}>{project.name}</span>
            <svg class="mobile-things__chevron" aria-hidden="true"><use xlink:href="#iconRight" /></svg>
          </div>
        {/each}
      </section>

      <section class="mobile-things__section">
        <div class="mobile-things__section-title">
          <button class="mobile-things__section-open" on:click={() => showTasks("areas")}>
            <svg aria-hidden="true"><use xlink:href="#iconThingsArea" /></svg><span>区域</span>
          </button>
          <span class="mobile-things__section-actions">
            <button aria-label="新建区域" on:click={(event) => openCreate("area", event)}><svg aria-hidden="true"><use xlink:href="#iconThingsAdd" /></svg></button>
          </span>
        </div>
        {#each areas as area (area.id)}
          <div class="mobile-things__nav-row mobile-things__nav-row--child" data-sort-id={area.id} data-sort-group="area" role="button" tabindex="0" on:click={() => showTasks("area", area.id)} on:keydown={(event) => event.key === "Enter" && showTasks("area", area.id)}>
            <svg class="mobile-things__nav-icon" aria-hidden="true"><use xlink:href="#iconThingsLayers" /></svg>
            <span class="mobile-things__nav-label" title={area.name}>{area.name}</span>
            <svg class="mobile-things__chevron" aria-hidden="true"><use xlink:href="#iconRight" /></svg>
          </div>
        {/each}
      </section>

      <section class="mobile-things__section">
        <div class="mobile-things__section-title">
          <button class="mobile-things__section-open" on:click={() => showTasks("tags")}>
            <svg aria-hidden="true"><use xlink:href="#iconThingsTagColor" /></svg><span>标签</span>
          </button>
          <span class="mobile-things__section-actions">
            <button aria-label="新建标签" on:click={(event) => openCreate("tag", event)}><svg aria-hidden="true"><use xlink:href="#iconThingsAdd" /></svg></button>
          </span>
        </div>
        {#each tagRows as row (row.tag.id)}
          <div
            class="mobile-things__nav-row mobile-things__nav-row--child"
            data-sort-id={row.tag.id}
            data-sort-group={`tag:${row.tag.parentId || ''}`}
            data-sort-depth={row.depth}
            role="button"
            tabindex="0"
            style={`padding-left:${20 + Math.min(row.depth, 4) * 12}px`}
            on:click={() => showTasks("tag", row.tag.id)}
            on:keydown={(event) => event.key === "Enter" && showTasks("tag", row.tag.id)}
          >
            <span class="mobile-things__tag-dot" style:background-color={row.tag.color || "var(--b3-theme-primary)"}></span>
            <span class="mobile-things__nav-label" title={row.tag.name}>{row.tag.name}</span>
            <svg class="mobile-things__chevron" aria-hidden="true"><use xlink:href="#iconRight" /></svg>
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
    min-width: 0;
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
      overflow-y: auto;
      overflow-x: hidden;
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

    &__group:not(.is-search) &__nav-row {
      font-size: 16px;
      font-weight: 650;
    }

    &__group.is-search &__nav-row {
      font-size: 15px;
      font-weight: 400;
    }

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

    &__nav-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    &__nav-row.is-search-row {
      min-height: 42px;
      border-radius: 11px;
      color: var(--b3-theme-on-surface-light);
      background: var(--b3-theme-surface-light);

      .mobile-things__nav-icon { color: var(--b3-theme-on-surface-light); }
    }

    &__nav-row--child {
      min-height: 48px;
      padding: 5px 10px 5px 18px;
      font-size: 15px;
      font-weight: 400;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
    }

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
      font-size: 16px;
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
      padding-right: 10px;

      button {
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        border: 0;
        border-radius: 10px;
        color: var(--b3-theme-on-surface-light);
        background: transparent;
        -webkit-tap-highlight-color: transparent;

        svg { width: 16px; height: 16px; color: inherit; fill: currentColor; opacity: .65; }

        &:active {
          color: var(--b3-theme-primary);
          background: var(--b3-theme-primary-light);
          transform: scale(.96);
        }
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
      overscroll-behavior: contain;

      :global(.entity-form) { margin: 0; padding: 16px 8px; box-shadow: none; background: transparent; }
      :global(.entity-form__input), :global(.entity-form__select) { box-sizing: border-box; min-width: 0; min-height: 44px; font-size: 16px; }
      :global(.entity-form__btn) { min-height: 44px; }
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
