<script lang="ts">
  import { onDestroy, onMount, setContext } from "svelte";
  import TaskList from "./TaskList.svelte";
  import type { StoreManager } from "@/stores";
  import type { ViewType } from "@/types";

  export let store: StoreManager;
  export let plugin: any = null;
  export let view: ViewType = "today";
  export let viewId: string | undefined;
  export let searchQuery = "";
  export let title = "Things";

  setContext("store", store);
  setContext("plugin", plugin);

  let historyEntryAdded = false;

  function close() {
    plugin?.closeMobileTaskPage?.();
  }

  function goBack() {
    if (historyEntryAdded && history.state?.thingsMobileTaskPage) {
      history.back();
    } else {
      close();
    }
  }

  function handlePopState() {
    historyEntryAdded = false;
    close();
  }

  onMount(() => {
    document.body.classList.add("things-mobile-page-open");
    try {
      history.pushState({ ...(history.state || {}), thingsMobileTaskPage: true }, "");
      historyEntryAdded = true;
      window.addEventListener("popstate", handlePopState, { once: true });
    } catch {
      historyEntryAdded = false;
    }
  });

  onDestroy(() => {
    document.body.classList.remove("things-mobile-page-open");
    window.removeEventListener("popstate", handlePopState);
  });
</script>

<section class="things-mobile-page" aria-label={title}>
  <header class="things-mobile-page__header">
    <button type="button" class="things-mobile-page__back" aria-label="返回" on:click={goBack}>
      <svg aria-hidden="true"><use xlink:href="#iconLeft" /></svg>
      <span>返回</span>
    </button>
    <strong>Things</strong>
    <span class="things-mobile-page__spacer"></span>
  </header>
  <main class="things-mobile-page__content">
    <TaskList
      {view}
      {viewId}
      {searchQuery}
      {store}
      mobile={true}
      aiMode="compact"
      aiEnabled={false}
      aiPanelRestorable={false}
      hideFabs={false}
    />
  </main>
</section>

<style lang="scss">
  .things-mobile-page {
    position: absolute;
    z-index: 1;
    inset: 0;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 100vw;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    color: var(--b3-theme-on-background);
    background: var(--b3-theme-background);
    font-family: var(--b3-font-family);
    animation: things-mobile-page-in 180ms ease-out;

    &__header {
      flex: 0 0 auto;
      min-height: 50px;
      box-sizing: border-box;
      display: grid;
      grid-template-columns: 72px minmax(0, 1fr) 72px;
      align-items: center;
      padding: max(6px, env(safe-area-inset-top)) 8px 6px;
      border-bottom: 1px solid var(--b3-border-color);
      background: var(--b3-theme-background);

      strong {
        min-width: 0;
        overflow: hidden;
        font-size: 16px;
        text-align: center;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    &__back {
      min-width: 0;
      min-height: 38px;
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 0 4px;
      border: 0;
      color: var(--b3-theme-primary);
      background: transparent;
      font: inherit;
      -webkit-tap-highlight-color: transparent;

      svg { width: 19px; height: 19px; }
    }

    &__spacer { width: 72px; }

    &__content {
      flex: 1 1 auto;
      width: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }
  }

  @keyframes things-mobile-page-in {
    from { opacity: 0; transform: translateX(12px); }
    to { opacity: 1; transform: translateX(0); }
  }
</style>
