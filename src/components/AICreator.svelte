<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { fly } from "svelte/transition";
  import type { ViewType } from "@/types";
  import type { StoreManager } from "@/stores";
  import type { AIConfig } from "@/services/aiParser";
  import Icon from "@/icons/Icon.svelte";
  import AIChatCore from "./AIChatCore.svelte";
  import { aiIsSending, startNewAiChat } from "@/stores/aiChat";

  export let store: StoreManager;
  export let currentView: ViewType = "inbox";
  export let currentViewId: string | undefined = undefined;
  export let presetStartDate: number | undefined = undefined;
  export let aiConfig: AIConfig = {
    mode: "siyuan",
    endpoint: "",
    apiKey: "",
    model: "gpt-4o-mini"
  };

  const dispatch = createEventDispatcher();

  function handleClose() {
    if ($aiIsSending) return;
    dispatch("cancel");
  }
</script>

<!-- 遮罩层：半透明白灰 + 模糊，点击关闭 -->
<div class="ai-window-overlay" on:click|self={handleClose} transition:fly={{ duration: 220, y: 0 }}>
  <!-- AI 浮窗 -->
  <div class="ai-window" role="dialog" aria-label="AI 任务整理">
    <!-- 头部（固定） -->
    <div class="ai-window__header">
      <div class="ai-window__header-icon">
        <Icon name="iconThingsSparkles" size={18} color="#ffffff" />
      </div>
      <div class="ai-window__header-text">
        <div class="ai-window__title">AI 任务整理</div>
        <div class="ai-window__subtitle">自然语言 → 结构化任务卡片</div>
      </div>
      <button class="ai-window__new-chat" disabled={$aiIsSending} on:click={startNewAiChat} title="开始新会话">新会话</button>
      <button class="ai-window__close" disabled={$aiIsSending} on:click={handleClose} title={$aiIsSending ? '请等待本次整理完成' : '关闭'}>×</button>
    </div>

    <!-- 内容 + 底部输入栏（由 AIChatCore 内部管理滚动与固定输入栏） -->
    <div class="ai-window__body">
      <AIChatCore
        {store}
        {currentView}
        {currentViewId}
        {presetStartDate}
        {aiConfig}
        on:navigate={() => dispatch('cancel')}
      />
    </div>
  </div>
</div>

<style lang="scss">
  .ai-window-overlay {
    // 局部遮罩：覆盖 Things 标签页区域（任务列表之上），不覆盖整个思源窗口
    position: absolute;
    inset: 0;
    z-index: 100;
    background: rgba(228, 232, 238, 0.6);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 10px 30px;
  }

  .ai-window {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: min(920px, 100%);
    background: #f6f7f9;
    border-radius: 20px;
    box-shadow: 0 24px 65px rgba(30, 43, 62, 0.2);
    overflow: hidden;
    animation: ai-window-in 240ms cubic-bezier(0.2, 0.75, 0.25, 1);
    z-index: 105;

    &__header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 18px;
      flex-shrink: 0;
    }

    &__header-icon {
      width: 34px;
      height: 34px;
      border-radius: 9px;
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
      font-size: 14px;
      font-weight: 600;
      color: var(--b3-theme-on-background);
      line-height: 1.3;
    }

    &__subtitle {
      font-size: 10px;
      color: var(--b3-theme-on-surface-light);
    }

    &__close {
      width: 26px;
      height: 26px;
      border: none;
      border-radius: 7px;
      background: transparent;
      color: var(--b3-theme-on-surface-light);
      font-size: 18px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
      flex-shrink: 0;

      &:hover {
        background: rgba(0, 0, 0, 0.05);
        color: var(--b3-theme-on-surface);
      }
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

  @keyframes ai-window-in {
    from {
      opacity: 0;
      transform: translateY(-48%) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
</style>
