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
  export let aiEnabled: boolean = true;

  setContext("store", store);
  setContext("plugin", plugin);
  initAiChat(store);

  // ========== 空间计算 ==========
  // ThingsAvailableWidth = 标签页容器实际宽度（思源两侧 dock 开合都会反映到这里）
  const TASK_RATIO = 0.25;           // 任务列表最小宽度 = 整个页面宽度的 1/4
  const AI_RATIO = 0.2;              // AI 面板最小宽度 = 整个页面宽度的 1/5
  const DEFAULT_AI_RATIO = 0.45;     // 默认双栏：任务列表约 55%，AI 面板约 45%
  const DIVIDER_WIDTH = 4;           // 透明拖动热区宽度；与两侧小间距合计约 10px

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
  $: canShowPanel = aiEnabled &&
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

  function resetLayoutToDefault() {
    measureWidth();
    if (thingsWidth <= 0) return;
    aiPanelWidth = Math.round((thingsWidth - DIVIDER_WIDTH) * DEFAULT_AI_RATIO);
    plugin?.settingUtils?.setAndSave?.('aiPanelWidth', Math.round(aiPanelWidth));
  }

  // 双击分隔条：恢复默认比例（任务列表约 55%，AI 面板约 45%）
  function onDividerDblClick() {
    if (aiState !== 'full') return;
    resetLayoutToDefault();
  }

  function handleResetLayout() {
    // Dock 展开期间由 ResizeObserver 连续保持 55:45，稳定后保存最终宽度。
    followDefaultRatio = true;
    if (layoutFollowTimer !== null) window.clearTimeout(layoutFollowTimer);
    requestAnimationFrame(resetLayoutToDefault);
    layoutFollowTimer = window.setTimeout(() => {
      resetLayoutToDefault();
      followDefaultRatio = false;
      layoutFollowTimer = null;
    }, 700);
  }

  // ========== 宽度监听 ==========
  let resizeObserver: ResizeObserver | null = null;
  let layoutFollowTimer: number | null = null;
  let followDefaultRatio = false;

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
      if (followDefaultRatio) {
        aiPanelWidth = Math.round((w - DIVIDER_WIDTH) * DEFAULT_AI_RATIO);
      }
    }
  }

  function handleWindowResize() {
    viewportWidth = window.innerWidth;
  }

  function handleAIConfigChange() {
    aiConfig = getAIConfig();
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
    window.addEventListener("things-reset-layout", handleResetLayout);
    window.addEventListener("things-ai-config-change", handleAIConfigChange);
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    if (layoutFollowTimer !== null) window.clearTimeout(layoutFollowTimer);
    window.removeEventListener("resize", handleWindowResize);
    window.removeEventListener("things-open-ai", handleOpenAI as EventListener);
    window.removeEventListener("things-navigate", onNavigate as EventListener);
    window.removeEventListener("things-reset-layout", handleResetLayout);
    window.removeEventListener("things-ai-config-change", handleAIConfigChange);
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
    if (!aiEnabled) return;
    const detail = e.detail || {};
    aiWindowDest = detail;
    aiWindowOpen = true;
  }

  function handleCloseAI() {
    aiWindowOpen = false;
    aiWindowDest = {};
  }

  $: if (!aiEnabled && aiWindowOpen) {
    handleCloseAI();
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
  let aiConfig = getAIConfig();

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
        {aiEnabled}
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
  {#if aiEnabled && aiState === 'full'}
    <div
      class="app-shell__divider"
      class:is-dragging={isDraggingDivider}
      on:mousedown={onDividerDown}
      on:dblclick={onDividerDblClick}
      title="拖动调整 AI 面板宽度，双击恢复 55:45"
    ></div>
  {/if}

  <!-- AI 面板卡片区（仅 FULL 状态） -->
  {#if aiEnabled && aiState === 'full'}
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
  {#if aiEnabled && aiWindowOpen}
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
    background: transparent;
    font-family: var(--b3-font-family);

    grid-template-columns: 1fr;

    &.is-full {
      grid-template-columns: 1fr auto auto;
    }

    // ===== 主任务卡片区 =====
    &__main-card {
      margin: 0;
      border-radius: var(--b3-border-radius-b, 12px);
      border: 1px solid var(--b3-border-color);
      background: var(--b3-theme-background);
      box-shadow:
        0 1px 2px rgba(15, 23, 42, 0.06),
        0 8px 24px rgba(15, 23, 42, 0.08);
      box-sizing: border-box;
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      height: 100%;
    }

    // 思源标签宿主负责页面顶部的外侧圆角。与宿主重合的角保持直角，
    // 由宿主做唯一一次裁切；卡片内部和底部仍保留自己的圆角。
    &:not(.is-full) &__main-card,
    &:not(.is-full) &__secondary-placeholder {
      border-top-left-radius: 0;
      border-top-right-radius: 0;
    }

    &.is-full &__main-card {
      border-top-left-radius: 0;
    }

    // ===== 二级模式：收起提示 =====
    &__secondary-placeholder {
      margin: 0;
      border-radius: var(--b3-border-radius-b, 12px);
      border: 1px solid var(--b3-border-color);
      background: var(--b3-theme-background);
      box-shadow:
        0 1px 2px rgba(15, 23, 42, 0.06),
        0 8px 24px rgba(15, 23, 42, 0.08);
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: var(--b3-theme-on-surface-light);
      font-size: 13px;
      height: 100%;

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
      width: 4px;
      margin: 0;
      cursor: col-resize;
      background: transparent;
      transition: background 0.15s;
      position: relative;
      flex-shrink: 0;

      &::after {
        content: '';
        position: absolute;
        left: 50%;
        top: 50%;
        height: 56px;
        width: 2px;
        border-radius: 999px;
        transform: translate(-50%, -50%);
        background: transparent;
        transition: width 0.15s, height 0.15s, background 0.15s, opacity 0.15s;
        opacity: 0;
      }

      &:hover::after,
      &.is-dragging::after {
        background: var(--b3-theme-primary);
        width: 2px;
        height: 72px;
        opacity: 0.62;
      }
    }

    // ===== AI 面板卡片区 =====
    &__ai-card {
      margin: 0;
      min-width: 0;
      min-height: 0;
      height: 100%;
      display: flex;
      flex-direction: column;
    }
  }
</style>
