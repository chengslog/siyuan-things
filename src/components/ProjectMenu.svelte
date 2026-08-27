<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from "svelte";
  import type { StoreManager } from "@/stores";
  import type { Project, ProjectStatus } from "@/types";
  import DeadlinePicker from "./DeadlinePicker.svelte";
  import { smartPosition } from "@/utils/popup";

  export let store: StoreManager;
  export let project: Project;

  const dispatch = createEventDispatcher();
  let showMenu = false;
  let showPanel: "deadline" | "area" | null = null;
  let menuEl: HTMLElement;
  let areaStoreVersion = 0;

  onMount(() => store.areas.on(() => areaStoreVersion++));
  onDestroy(() => document.removeEventListener("click", closeOnOutside));

  $: areas = readAreas(store, areaStoreVersion);

  function readAreas(manager: StoreManager, _version: number) {
    return manager.areas.getAll().sort((a, b) => a.order - b.order);
  }

  function toggleMenu() {
    showMenu = !showMenu;
    showPanel = null;
    syncListener();
  }

  function openPanel(panel: "deadline" | "area") {
    showMenu = false;
    showPanel = panel;
    syncListener();
  }

  function syncListener() {
    document.removeEventListener("click", closeOnOutside);
    if (showMenu || showPanel) {
      setTimeout(() => document.addEventListener("click", closeOnOutside), 0);
    }
  }

  function closeOnOutside(event: MouseEvent) {
    if (menuEl && !menuEl.contains(event.target as HTMLElement)) {
      showMenu = false;
      showPanel = null;
      document.removeEventListener("click", closeOnOutside);
    }
  }

  function menuAction(fn: () => void) {
    return (event: MouseEvent) => {
      event.stopPropagation();
      fn();
    };
  }

  async function setStatus(status: ProjectStatus) {
    await store.projects.updateProject(project.id, { status });
    showMenu = false;
  }

  async function moveToArea(areaId?: string) {
    await store.projects.updateProject(project.id, { areaId });
    showPanel = null;
  }

  function handleDeadlineChange(event: CustomEvent) {
    store.projects.updateProject(project.id, { deadline: event.detail.timestamp });
    showPanel = null;
  }
</script>

<div class="project-menu" bind:this={menuEl} on:click|stopPropagation>
  <button
    type="button"
    class="project-menu__trigger"
    class:is-open={showMenu || showPanel}
    title="项目管理"
    aria-label="项目管理"
    aria-expanded={showMenu || showPanel}
    on:click={toggleMenu}
  >
    <span class="project-menu__dots" aria-hidden="true"><i></i><i></i><i></i></span>
  </button>

  {#if showMenu}
    <div class="project-menu__popup" use:smartPosition>
      <button class="project-menu__item" on:click={menuAction(() => openPanel("deadline"))}>
        设定截止日期{project.deadline ? "（已有）" : ""}
      </button>
      <button class="project-menu__item" on:click={menuAction(() => openPanel("area"))}>移动到区域 ▸</button>
      <button class="project-menu__item" on:click={menuAction(() => { showMenu = false; dispatch("addheading"); })}>添加标题分组</button>

      <div class="project-menu__separator"></div>

      {#if project.status === "active"}
        <button class="project-menu__item" on:click={menuAction(() => setStatus("completed"))}>标记为完成</button>
        <button class="project-menu__item" on:click={menuAction(() => setStatus("onhold"))}>暂停项目</button>
        <button class="project-menu__item" on:click={menuAction(() => setStatus("canceled"))}>设为作废</button>
      {:else}
        <button class="project-menu__item" on:click={menuAction(() => setStatus("active"))}>恢复为活跃</button>
      {/if}
    </div>
  {/if}

  {#if showPanel === "deadline"}
    <div class="project-menu__popup" use:smartPosition>
      <DeadlinePicker
        timestamp={project.deadline}
        on:change={handleDeadlineChange}
        on:close={() => (showPanel = null)}
      />
    </div>
  {/if}

  {#if showPanel === "area"}
    <div class="project-menu__popup project-menu__popup--area" use:smartPosition>
      <button
        class="project-menu__item"
        class:is-selected={!project.areaId}
        on:click={menuAction(() => moveToArea(undefined))}
      >无</button>
      {#each areas as area (area.id)}
        <button
          class="project-menu__item"
          class:is-selected={project.areaId === area.id}
          on:click={menuAction(() => moveToArea(area.id))}
        >{area.name}</button>
      {/each}
    </div>
  {/if}
</div>

<style lang="scss">
  .project-menu {
    position: relative;
    flex: 0 0 auto;
    align-self: center;

    &__trigger {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 24px;
      padding: 0;
      border: 1px solid transparent;
      border-radius: 7px;
      background: transparent;
      color: var(--b3-theme-on-surface-light);
      cursor: pointer;
      transition: color 0.15s ease, background-color 0.15s ease, border-color 0.15s ease;

      &:hover,
      &.is-open {
        border-color: color-mix(in srgb, #3b7ff0 34%, var(--b3-border-color));
        background: color-mix(in srgb, #3b7ff0 10%, var(--b3-theme-background));
        color: #3b7ff0;
      }

      &:focus-visible {
        outline: 2px solid color-mix(in srgb, #3b7ff0 72%, white);
        outline-offset: 2px;
      }
    }

    &__dots {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 3px;
      line-height: 0;

      i {
        display: block;
        width: 3px;
        height: 3px;
        border-radius: 50%;
        background: currentColor;
      }
    }

    &__popup {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      z-index: 60;
      min-width: 180px;
      padding: 6px;
      background: var(--b3-theme-surface);
      border: 1px solid var(--b3-border-color);
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);

      &--area {
        max-height: 240px;
        overflow-y: auto;
      }
    }

    &__item {
      display: block;
      width: 100%;
      padding: 7px 10px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--b3-theme-on-surface);
      cursor: pointer;
      font-size: 13px;
      text-align: left;

      &:hover {
        background: var(--b3-theme-surface-light);
      }

      &.is-selected {
        color: var(--b3-theme-primary);
        font-weight: 600;
      }
    }

    &__separator {
      height: 1px;
      margin: 5px 4px;
      background: var(--b3-border-color);
    }
  }
</style>
