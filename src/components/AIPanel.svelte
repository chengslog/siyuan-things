<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { ViewType } from "@/types";
  import type { StoreManager } from "@/stores";
  import type { AIConfig } from "@/services/aiParser";
  import Icon from "@/icons/Icon.svelte";
  import AIChatCore from "./AIChatCore.svelte";
  import { aiIsSending, startNewAiChat } from "@/stores/aiChat";

  export let store: StoreManager;
  export let currentView: ViewType = "inbox";
  export let currentViewId: string | undefined = undefined;
  export let aiConfig: AIConfig = {
    mode: "siyuan",
    endpoint: "",
    apiKey: "",
    model: "gpt-4o-mini"
  };

  const dispatch = createEventDispatcher();
</script>

<!-- 右侧常驻 AI 面板（全屏模式 ≥1200px） -->
<div class="ai-panel">
  <div class="ai-panel__inner">
    <!-- 头部 -->
    <div class="ai-panel__header">
      <div class="ai-panel__header-icon">
        <Icon name="iconThingsSparkles" size={16} color="#ffffff" />
      </div>
      <div class="ai-panel__header-text">
        <div class="ai-panel__title">AI 任务整理</div>
        <div class="ai-panel__subtitle">自然语言 → 结构化任务卡片</div>
      </div>
      <button class="ai-panel__new-chat" disabled={$aiIsSending} on:click={startNewAiChat} title="开始新会话" aria-label="开始新会话">
        <Icon name="iconThingsAdd" size={15} />
      </button>
      <button class="ai-panel__minimize" on:click={() => dispatch("minimize")} title="最小化 AI 面板" aria-label="最小化 AI 面板">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
      </button>
    </div>

    <!-- 内容 + 底部输入栏 -->
    <div class="ai-panel__body">
      <AIChatCore
        {store}
        {currentView}
        {currentViewId}
        {aiConfig}
      />
    </div>
  </div>
</div>

<style lang="scss">
  .ai-panel {
    height: 100%;
    margin: 0; // 外边距由 App 外壳的卡片容器负责，避免双重 margin 导致高度不一致
    border-radius: var(--b3-border-radius-b, 12px);
    // 右上角由思源标签宿主裁切，避免两层圆角抗锯齿叠加。
    border-top-right-radius: 0;
    border: 1px solid var(--b3-border-color);
    background: var(--b3-theme-background);
    box-shadow:
      0 1px 2px rgba(15, 23, 42, 0.06),
      0 8px 24px rgba(15, 23, 42, 0.08);
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    overflow: hidden;

    &__inner {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      width: 100%;
      margin: 0;
    }

    &__header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 32px 24px 18px;
      flex-shrink: 0;
    }

    &__header-icon {
      width: 30px;
      height: 30px;
      border-radius: 8px;
      background: linear-gradient(135deg, #4a8af4, #6c5ce7);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    &__header-text {
      flex: 1;
      min-width: 0;
    }

    &__title {
      font-size: 20px;
      font-weight: 600;
      color: var(--b3-theme-on-background);
      line-height: 1.3;
    }

    &__subtitle {
      margin-top: 3px;
      font-size: 12px;
      color: var(--b3-theme-on-surface-light);
    }

    &__new-chat,
    &__minimize {
      width: 28px;
      height: 28px;
      padding: 0;
      border: none;
      border-radius: 7px;
      background: transparent;
      color: var(--b3-theme-on-surface-light);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.15s, color 0.15s;

      &:hover {
        background: var(--b3-theme-surface-light);
        color: var(--b3-theme-on-surface);
      }

      &:focus-visible {
        outline: 2px solid var(--b3-theme-primary);
        outline-offset: 1px;
      }
    }

    &__new-chat {
      :global(.things-icon) { fill: currentColor; }
      &:disabled { opacity: 0.5; cursor: default; }
    }

    &__minimize {
      svg {
        width: 16px;
        height: 16px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
      }
    }

    &__body {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
  }
</style>
