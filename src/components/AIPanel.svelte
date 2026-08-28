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
      <button class="ai-panel__new-chat" disabled={$aiIsSending} on:click={startNewAiChat} title="开始新会话">
        新会话
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
    border: 1px solid var(--b3-border-color);
    background: var(--b3-theme-background);
    box-shadow: none;
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

    &__new-chat {
      padding: 5px 9px;
      border: 1px solid var(--b3-border-color);
      border-radius: 7px;
      background: var(--b3-theme-background);
      color: var(--b3-theme-on-surface);
      font-size: 11px;
      cursor: pointer;
      flex-shrink: 0;

      &:hover { background: var(--b3-theme-surface-lighter); }
      &:disabled { opacity: 0.5; cursor: default; }
    }

    &__body {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
  }
</style>
