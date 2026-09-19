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
  let pageElement: HTMLElement;
  let viewportHeight: number | undefined;

  // WebView 弹出软键盘时，布局视口可能不变；按实际可视区域收缩列表。
  function updateViewport() {
    const viewport = window.visualViewport;
    if (!pageElement || !viewport) return;
    viewportHeight = Math.max(0, viewport.offsetTop + viewport.height - pageElement.getBoundingClientRect().top);
  }

  function close() {
    plugin?.closeMobileTaskPage?.();
  }

  function handlePopState() {
    historyEntryAdded = false;
    close();
  }

  onMount(() => {
    plugin?.eventBus?.on('switch-protyle', close);
    plugin?.eventBus?.on('loaded-protyle-static', close);
    updateViewport();
    window.visualViewport?.addEventListener("resize", updateViewport);
    window.visualViewport?.addEventListener("scroll", updateViewport);
    window.addEventListener("resize", updateViewport);
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
    plugin?.eventBus?.off('switch-protyle', close);
    plugin?.eventBus?.off('loaded-protyle-static', close);
    window.visualViewport?.removeEventListener("resize", updateViewport);
    window.visualViewport?.removeEventListener("scroll", updateViewport);
    window.removeEventListener("resize", updateViewport);
    document.body.classList.remove("things-mobile-page-open");
    window.removeEventListener("popstate", handlePopState);
  });
</script>

<section class="things-mobile-page" aria-label={title} bind:this={pageElement} style:max-height={viewportHeight === undefined ? undefined : `${viewportHeight}px`}>
  <main class="things-mobile-page__content">
    <TaskList
      {view}
      {viewId}
      {searchQuery}
      {store}
      mobile={true}
      aiMode="full"
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
    box-sizing: border-box;
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
    overflow: hidden;
    color: var(--b3-theme-on-background);
    background: var(--b3-theme-background);
    font-family: var(--b3-font-family);
    animation: things-mobile-page-in 180ms ease-out;

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
