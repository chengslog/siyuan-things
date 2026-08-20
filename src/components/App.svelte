<script lang="ts">
  import { onMount, onDestroy, setContext } from "svelte";
  import TaskList from "./TaskList.svelte";
  import AIPanel from "./AIPanel.svelte";
  import AICreator from "./AICreator.svelte";
  import type { ViewType } from "@/types";
  import type { StoreManager } from "@/stores";
  import type { AIConfig } from "@/services/aiParser";
  import { initAiChat } from "@/stores/aiChat";

  export let store: StoreManager;
  export let plugin: any;
  export let view: ViewType = "today";
  export let viewId: string | undefined = undefined;
  export let searchQuery: string = "";

  setContext("store", store);
  setContext("plugin", plugin);
  initAiChat(store);

  // ========== 空间计算 ==========
  // ThingsAvailableWidth = 标签页容器实际宽度（思源两侧 dock 开合都会反映到这里）
  const TASK_RATIO = 0.25;           // 任务列表最小宽度 = 整个页面宽度的 1/4
  const AI_RATIO = 0.2;              // AI 面板最小宽度 = 整个页面宽度的 1/5
  const DEFAULT_AI_RATIO = 0.45;     // 默认双栏：任务列表约 55%，AI 面板约 45%
  const DIVIDER_WIDTH = 6;           // 分隔条 2 宽度

  let rootEl: HTMLElement;
  let thingsWidth = 0;
  let viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1200;

  // 任务列表最小宽度：整个页面（思源窗口）的 2/5
  $: taskListMinWidth = Math.round(viewportWidth * TASK_RATIO);
  // AI 面板最小宽度：整个页面（思源窗口）的 1/5
  $: aiPanelMinWidth = Math.round(viewportWidth * AI_RATIO);

  // 状态机（三态）：
  // full      —— 任务列表 ≥2/5 且 AI 面板 ≥1/5：两列并排
  // button    —— AI 面板缩到 1/5 后消失变按钮，任务列表全宽
  // secondary —— 任务列表窄于页面的 2/5：隐藏任务列表，侧边栏为一级页面，点导航才展示
  //
  // 挤占优先级：任务列表先缩小 → 到 2/5 不再缩 → AI 面板缩小 → 到 1/5 消失变按钮。
  // 网格中 TaskList 是 1fr（先吸收收缩），AI 面板宽度由 effectivePanelWidth 钳制，
  // 钳制下限保证 TaskList ≥ 2/5、AI ≥ 1/5；两者都到下限时 FULL 条件打破，面板退出。
  $: canShowPanel =
    thingsWidth >= taskListMinWidth + aiPanelMinWidth + DIVIDER_WIDTH;
  $: aiState = canShowPanel
    ? 'full'
    : thingsWidth >= taskListMinWidth
      ? 'button'
      : 'secondary';

  // ========== 二级页面：侧边栏一级、任务列表二级 ==========
  let navOpened = false; // 用户在二级模式下是否点过侧边栏导航

  function onNavigate() {
    if (aiState === 'secondary') {
      navOpened = true;
    }
  }

  $: taskListVisible = aiState !== 'secondary' || navOpened;

  // 离开二级模式时重置，下次进入重新隐藏
  $: if (aiState !== 'secondary' && navOpened) {
    navOpened = false;
  }

  // ========== 分隔条 2（TaskList ↔ AIChatCore）拖动 ==========
  let aiPanelWidth = 0; // 0 = 未初始化，首次进入 FULL 时按设置/平分初始化
  let dividerStartX = 0;
  let dividerStartWidth = 0;
  let isDraggingDivider = false;

  // 当前生效的 AI 面板宽度（钳制：AI ≥360，TaskList ≥ 页面 2/5）
  $: effectivePanelWidth = aiState === 'full'
    ? Math.max(aiPanelMinWidth, Math.min(aiPanelWidth, thingsWidth - taskListMinWidth - DIVIDER_WIDTH))
    : 0;

  function onDividerDown(e: MouseEvent) {
    if (e.button !== 0 || aiState !== 'full') return;
    e.preventDefault();
    isDraggingDivider = true;
    dividerStartX = e.clientX;
    dividerStartWidth = effectivePanelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onDividerMove);
    document.addEventListener('mouseup', onDividerUp);
  }

  function onDividerMove(e: MouseEvent) {
    if (!isDraggingDivider) return;
    const dx = dividerStartX - e.clientX;
    let w = dividerStartWidth + dx;
    w = Math.max(aiPanelMinWidth, Math.min(w, thingsWidth - taskListMinWidth - DIVIDER_WIDTH));
    aiPanelWidth = w;
  }

  function onDividerUp() {
    isDraggingDivider = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onDividerMove);
    document.removeEventListener('mouseup', onDividerUp);
    plugin?.settingUtils?.setAndSave?.('aiPanelWidth', Math.round(aiPanelWidth));
  }

  // 双击分隔条：恢复默认比例（任务列表约 55%，AI 面板约 45%）
  function onDividerDblClick() {
    if (aiState !== 'full') return;
    aiPanelWidth = Math.round((thingsWidth - DIVIDER_WIDTH) * DEFAULT_AI_RATIO);
    plugin?.settingUtils?.setAndSave?.('aiPanelWidth', Math.round(aiPanelWidth));
  }

  // ========== 宽度监听 ==========
  let resizeObserver: ResizeObserver | null = null;

  function measureWidth() {
    if (!rootEl) return;
    let w = rootEl.clientWidth;
    if (!w) {
      let p = rootEl.parentElement;
      while (p && !w) {
        w = p.clientWidth;
        p = p.parentElement;
      }
    }
    if (!w) w = window.innerWidth;
    if (Math.abs(w - thingsWidth) > 1) {
      thingsWidth = w;
    }
  }

  function handleWindowResize() {
    viewportWidth = window.innerWidth;
  }

  onMount(() => {
    if (rootEl) {
      measureWidth();
      requestAnimationFrame(measureWidth);
      setTimeout(measureWidth, 100);
      setTimeout(measureWidth, 500);
      resizeObserver = new ResizeObserver(() => measureWidth());
      resizeObserver.observe(rootEl);
    }
    window.addEventListener("resize", handleWindowResize);
    window.addEventListener("things-open-ai", handleOpenAI as EventListener);
    window.addEventListener("things-navigate", onNavigate as EventListener);
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    window.removeEventListener("resize", handleWindowResize);
    window.removeEventListener("things-open-ai", handleOpenAI as EventListener);
    window.removeEventListener("things-navigate", onNavigate as EventListener);
  });

  // 诊断日志
  $: console.log(
    "[Things Layout] thingsWidth:", thingsWidth,
    "viewport:", viewportWidth,
    "taskMin:", taskListMinWidth,
    "state:", aiState,
    "visible:", taskListVisible
  );

  // ========== 全局 AI Workspace（浮窗） ==========
  let aiWindowOpen = false;
  let aiWindowDest: { destView?: ViewType; destViewId?: string } = {};

  function handleOpenAI(e: CustomEvent) {
    const detail = e.detail || {};
    aiWindowDest = detail;
    aiWindowOpen = true;
  }

  function handleCloseAI() {
    aiWindowOpen = false;
    aiWindowDest = {};
  }

  // ========== AI 配置 ==========
  function getAIConfig(): AIConfig {
    if (!plugin?.settingUtils) {
      return { mode: "siyuan", endpoint: "", apiKey: "", model: "gpt-4o-mini" };
    }
    return {
      mode: plugin.settingUtils.get("aiMode") || "siyuan",
      endpoint: plugin.settingUtils.get("aiApiEndpoint") || "https://api.openai.com/v1/chat/completions",
      apiKey: plugin.settingUtils.get("aiApiKey") || "",
      model: plugin.settingUtils.get("aiModel") || "gpt-4o-mini"
    };
  }
  $: aiConfig = getAIConfig();

  // 首次进入 FULL 时初始化 AI 面板宽度：有保存值则用保存值，
  // 否则让 AI 面板略窄于任务列表（约 45:55）。
  $: {
    if (aiPanelWidth === 0 && thingsWidth > 0) {
      const saved = plugin?.settingUtils?.get?.('aiPanelWidth');
      if (typeof saved === 'number' && saved > 0) {
        aiPanelWidth = saved;
      } else {
        aiPanelWidth = Math.round((thingsWidth - DIVIDER_WIDTH) * DEFAULT_AI_RATIO);
      }
    }
  }
</script>

<div class="app-shell" bind:this={rootEl} class:is-full={aiState === 'full'}>
  <!-- 主任务卡片区（二级模式下默认隐藏，点侧边栏导航后展示） -->
  {#if taskListVisible}
    <div class="app-shell__main-card">
      {#if aiState === 'secondary'}
        <div class="app-shell__secondary-bar">
          <button class="app-shell__secondary-back" on:click={() => navOpened = false} title="收起任务列表，回到侧边栏">
            ← 收起
          </button>
          <span class="app-shell__secondary-title">{view}</span>
        </div>
      {/if}
      <TaskList
        {view}
        {viewId}
        {searchQuery}
        {store}
        aiMode={aiState === 'full' ? 'full' : 'button'}
        hideFabs={aiWindowOpen}
      />
    </div>
  {:else}
    <!-- 二级模式收起态：侧边栏（思源 dock）为一级页面 -->
    <div class="app-shell__secondary-placeholder">
      <svg><use xlink:href="#iconThings" /></svg>
      <p>任务区已收起</p>
      <p class="app-shell__secondary-hint">请在左侧停靠栏选择视图</p>
    </div>
  {/if}

  <!-- 分隔条 2（仅 FULL 状态） -->
  {#if aiState === 'full'}
    <div
      class="app-shell__divider"
      class:is-dragging={isDraggingDivider}
      on:mousedown={onDividerDown}
      on:dblclick={onDividerDblClick}
      title="拖动调整 AI 面板宽度，双击恢复 55:45"
    ></div>
  {/if}

  <!-- AI 面板卡片区（仅 FULL 状态） -->
  {#if aiState === 'full'}
    <div class="app-shell__ai-card" style="width: {effectivePanelWidth}px">
      <AIPanel
        {store}
        currentView={view}
        currentViewId={viewId}
        {aiConfig}
      />
    </div>
  {/if}

  <!-- 全局 AI Workspace -->
  {#if aiWindowOpen}
    <AICreator
      {store}
      currentView={aiWindowDest.destView || view}
      currentViewId={aiWindowDest.destViewId || viewId}
      {aiConfig}
      on:cancel={handleCloseAI}
      on:done={handleCloseAI}
    />
  {/if}
</div>

<style lang="scss">
  .app-shell {
    display: grid;
    height: 100%;
    width: 100%;
    overflow: hidden;
    position: relative; // AI 浮窗遮罩以其为定位上下文（任务列表之上，而非全局）
    background: var(--b3-theme-surface, #e8eaee);
    font-family: var(--b3-font-family);

    grid-template-columns: 1fr;

    &.is-full {
      grid-template-columns: 1fr auto auto;
    }

    // ===== 主任务卡片区 =====
    &__main-card {
      margin: 10px 6px 10px 10px;
      border-radius: 14px;
      background: var(--b3-theme-background, #ffffff);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.03);
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      height: calc(100% - 20px);

      .app-shell:not(.is-full) & {
        margin: 10px;
      }
    }

    // ===== 二级模式：收起提示 =====
    &__secondary-placeholder {
      margin: 10px;
      border-radius: 14px;
      background: var(--b3-theme-background, #ffffff);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.03);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: var(--b3-theme-on-surface-light);
      font-size: 13px;
      height: calc(100% - 20px);

      svg {
        width: 40px;
        height: 40px;
        color: var(--b3-theme-primary);
        opacity: 0.7;
      }

      p {
        margin: 0;
      }
    }

    &__secondary-hint {
      font-size: 12px;
    }

    // ===== 二级模式：顶部返回条 =====
    &__secondary-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--b3-border-color);
      flex-shrink: 0;
    }

    &__secondary-back {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border: none;
      border-radius: 6px;
      background: var(--b3-theme-surface-light);
      color: var(--b3-theme-on-surface);
      font-size: 12px;
      cursor: pointer;

      &:hover {
        background: var(--b3-theme-surface);
        color: var(--b3-theme-primary);
      }
    }

    &__secondary-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--b3-theme-on-surface);
    }

    // ===== 分隔条 2 =====
    &__divider {
      width: 6px;
      margin: 10px 0;
      cursor: col-resize;
      background: transparent;
      transition: background 0.15s;
      position: relative;
      flex-shrink: 0;

      &::after {
        content: '';
        position: absolute;
        left: 50%;
        top: 0;
        bottom: 0;
        width: 2px;
        transform: translateX(-50%);
        background: var(--b3-border-color);
        transition: all 0.15s;
      }

      &:hover::after,
      &.is-dragging::after {
        background: var(--b3-theme-primary);
        width: 3px;
      }
    }

    // ===== AI 面板卡片区 =====
    &__ai-card {
      margin: 10px 10px 10px 6px;
      min-width: 0;
      min-height: 0;
      height: calc(100% - 20px);
      display: flex;
      flex-direction: column;
    }
  }
</style>
