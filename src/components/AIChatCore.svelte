<script lang="ts">
  import { onMount, tick } from "svelte";
  import { showMessage } from "siyuan";
  import type { ViewType } from "@/types";
  import type { StoreManager } from "@/stores";
  import { THINKING_LEVELS, type AIConfig } from "@/services/aiParser";
  import {
    aiRounds,
    aiInputText,
    aiSelectedModel,
    aiThinkingLevel,
    aiIsSending,
    sendAiMessage,
    adoptAiTask,
    parsedToPrefill,
    adoptLabel,
  } from "@/stores/aiChat";
  import Icon from "@/icons/Icon.svelte";
  import TaskCard from "./TaskCard.svelte";

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

  // ========== 本地 UI 状态（会话数据在共享 store 中） ==========
  let textareaEl: HTMLTextAreaElement;
  let contentEl: HTMLElement;
  let showModelPicker = false;
  let showThinkingPicker = false;
  let lastRoundsLen = 0;

  function getAvailableModels(): Array<{ value: string; label: string }> {
    if (aiConfig.mode === 'siyuan') {
      try {
        const siyuanConfig = (window as any).siyuan?.config;
        if (siyuanConfig?.ai?.providers) {
          const models: Array<{ value: string; label: string }> = [];
          for (const provider of siyuanConfig.ai.providers) {
            if (provider.enabled && provider.models) {
              for (const model of provider.models) {
                if (model.enabled) {
                  models.push({
                    value: model.name,
                    label: model.displayName || model.name
                  });
                }
              }
            }
          }
          if (models.length > 0) return models;
        }
      } catch (e) {
        console.error('[AIChatCore] Failed to get models:', e);
      }
    }
    return [
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' }
    ];
  }

  // 注意：availableModels 必须声明在使用它的响应式语句之前（响应式按声明顺序执行）
  $: availableModels = getAvailableModels();

  $: rounds = $aiRounds;
  $: hasAnyRound = $aiRounds.length > 0;
  $: inputText = $aiInputText;
  $: selectedModel = $aiSelectedModel || aiConfig.model;
  $: thinkingLevel = $aiThinkingLevel;
  $: isSending = $aiIsSending;

  // 模型列表未选中时取第一个可用
  $: if (!$aiSelectedModel && (availableModels?.length || 0) > 0) {
    aiSelectedModel.set(availableModels[0].value);
  }

  // ========== 示例 prompts ==========
  const examplePrompts = [
    '明天上午9点开产品评审会，需要准备竞品分析数据和用户反馈汇总，本周五截止',
    '整理本周会议记录中的待办事项，重要事项优先',
    '下周一前完成季度报告：收集各部门数据、整理财务数据、撰写总结',
  ];

  function fillExample(p: string) {
    aiInputText.set(p);
    tick().then(() => {
      textareaEl?.focus();
      autoGrow();
    });
  }

  // 输入框自动增高（上限 100px）
  function autoGrow() {
    if (!textareaEl) return;
    textareaEl.style.height = 'auto';
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, 100) + 'px';
  }

  // 滚动跟随最新内容（仅在发送中自动滚，避免打断用户回看）
  $: if ($aiIsSending || rounds.length > lastRoundsLen) {
    lastRoundsLen = rounds.length;
    tick().then(() => {
      if (contentEl) contentEl.scrollTop = contentEl.scrollHeight;
    });
  }

  // ========== 发送 ==========
  async function handleSend() {
    const text = $aiInputText.trim();
    if (!text || $aiIsSending) return;
    await sendAiMessage(text, aiConfig);
    tick().then(() => {
      autoGrow();
      textareaEl?.focus();
    });
  }

  // ========== 采纳 ==========
  async function handleAdopt(round: any, index: number) {
    await adoptAiTask(round, index, { currentView, currentViewId, presetStartDate });
    showMessage(`✓ 已添加：${round.parsedTasks[index]?.title || ''}`, 2000);
  }

  function roundStatusText(round: any): string {
    if (round.phase === 'thinking') return 'AI 正在思考...';
    if (round.phase === 'organizing') return '正在整理任务...';
    if (round.phase === 'done') return `✓ 已为你整理好 ${round.parsedTasks.length} 个任务`;
    if (round.phase === 'error') return '整理失败';
    return '';
  }

  onMount(() => {
    autoGrow();
  });
</script>

<div class="ai-chat">
  <!-- 内容区（卡片流） -->
  <div class="ai-chat__content" bind:this={contentEl}>
    {#if !hasAnyRound}
      <!-- 引导区 -->
      <div class="ai-chat__guide">
        <div class="ai-chat__guide-icon">
          <Icon name="iconThingsSparkles" size={26} color="#ffffff" />
        </div>
        <div class="ai-chat__guide-title">用自然语言描述你的任务</div>
        <div class="ai-chat__guide-desc">AI 会自动理解你的描述，拆分成可执行的任务，并补充检查项。</div>
        <div class="ai-chat__guide-examples">
          {#each examplePrompts as p}
            <button class="ai-chat__example-chip" on:click={() => fillExample(p)}>{p}</button>
          {/each}
        </div>
      </div>
    {/if}

    {#each rounds as round (round.id)}
      <!-- 用户输入卡片 -->
      <div class="ai-chat__card ai-chat__user-card">
        <div class="ai-chat__card-label">
          <span class="ai-chat__dot ai-chat__dot--blue"></span>
          <span>你的输入</span>
        </div>
        <div class="ai-chat__user-text">{round.userText}</div>
      </div>

      <!-- AI 思考卡片 -->
      <div class="ai-chat__card ai-chat__think-card">
        <div class="ai-chat__card-label">
          <Icon name="iconThingsSparkles" size={12} />
          <span>AI 思考与整理</span>
          <span class="ai-chat__badge" class:is-done={round.phase === 'done'} class:is-error={round.phase === 'error'}>
            {roundStatusText(round)}
          </span>
        </div>

        {#if round.phase === 'thinking' || round.phase === 'organizing'}
          {#if round.reasoning}
            <div class="ai-chat__reasoning">{round.reasoning}</div>
          {:else}
            <div class="ai-chat__streaming-placeholder">
              <span class="ai-chat__pulse-dot"></span>
              正在连接模型...
            </div>
          {/if}
          {#if round.phase === 'organizing'}
            <div class="ai-chat__divider"></div>
            <div class="ai-chat__organizing">
              {#if round.content}
                <div class="ai-chat__reasoning ai-chat__reasoning--content">{round.content}</div>
              {:else}
                <span class="ai-chat__pulse-dot"></span> 正在整理任务...
              {/if}
            </div>
          {/if}
        {/if}

        {#if round.phase === 'error'}
          <div class="ai-chat__error-text">{round.errorMsg}</div>
        {/if}
      </div>

      <!-- 整理结果卡片 -->
      {#if round.phase === 'done' && round.parsedTasks.length > 0}
        <div class="ai-chat__card ai-chat__result-card">
          <div class="ai-chat__card-label">
            <span>整理结果</span>
            <span class="ai-chat__count-badge">{round.parsedTasks.length}</span>
          </div>
          <div class="ai-chat__task-list">
            {#each round.parsedTasks as task, i (i)}
              <div class="ai-chat__task-item" class:is-adopted={round.adopted.has(i)}>
                <TaskCard
                  mode="create"
                  {store}
                  currentView={currentView}
                  currentViewId={currentViewId}
                  noAutoSave={true}
                  prefilledData={parsedToPrefill(task)}
                />
                {#if round.adopted.has(i)}
                  <div class="ai-chat__adopted-badge">
                    <Icon name="iconThingsCheck" size={12} />
                    已添加
                  </div>
                {:else}
                  <button class="ai-chat__adopt-btn" on:click={() => handleAdopt(round, i)}>
                    {adoptLabel(currentView)}
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {/each}
  </div>

  <!-- 底部输入栏 -->
  <div class="ai-chat__input-bar">
    <div class="ai-chat__input-container">
      <textarea
        bind:this={textareaEl}
        bind:value={$aiInputText}
        on:input={autoGrow}
        on:keydown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
        class="ai-chat__textarea"
        rows="1"
        placeholder="描述你的任务，AI 帮你整理成待办…"
      ></textarea>
    </div>
    <div class="ai-chat__input-toolbar">
      <div class="ai-chat__input-toolbar-left">
        <!-- 思考强度按钮 -->
        <div class="ai-chat__dropdown-wrap">
          <button
            class="ai-chat__tool-btn"
            on:click={() => { showThinkingPicker = !showThinkingPicker; showModelPicker = false; }}
            title="思考强度"
          >
            <svg width="13" height="13" viewBox="0 0 1024 1024" fill="currentColor">
              <path d="M168.64 168.64C263.424 73.792 494.08 150.72 683.712 340.288c189.632 189.696 266.56 420.288 171.712 515.136-94.848 94.848-325.44 17.92-515.136-171.712C150.656 494.08 73.792 263.424 168.64 168.64z m469.824 216.96C470.592 217.728 275.2 152.576 213.888 213.888c-61.312 61.312 3.84 256.704 171.712 424.576 167.872 167.872 363.264 232.96 424.576 171.712 61.312-61.312-3.84-256.704-171.712-424.576z"/>
              <path d="M340.288 340.288C529.984 150.656 760.576 73.792 855.424 168.64c94.848 94.784 17.92 325.44-171.712 515.072S263.424 950.272 168.64 855.424C73.792 760.576 150.72 529.92 340.288 340.288z m469.888-126.4c-61.312-61.312-256.704 3.84-424.576 171.712C217.728 553.472 152.576 748.8 213.888 810.176c61.312 61.312 256.704-3.84 424.576-171.712 167.872-167.872 232.96-363.264 171.712-424.576z"/>
              <path d="M512 512m-69.376 0a69.376 69.376 0 1 0 138.752 0 69.376 69.376 0 1 0-138.752 0Z"/>
            </svg>
            <span>{thinkingLevel.label}</span>
          </button>

          {#if showThinkingPicker}
            <div class="ai-chat__dropdown ai-chat__dropdown--up">
              {#each THINKING_LEVELS as level}
                <button
                  class="ai-chat__dropdown-item"
                  class:is-active={thinkingLevel.value === level.value}
                  on:click={() => { aiThinkingLevel.set(level); showThinkingPicker = false; }}
                >
                  <span class="ai-chat__dropdown-item-label">{level.label}</span>
                  <span class="ai-chat__dropdown-item-desc">{level.desc}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <!-- 模型切换按钮 -->
        <div class="ai-chat__dropdown-wrap">
          <button
            class="ai-chat__tool-btn"
            on:click={() => { showModelPicker = !showModelPicker; showThinkingPicker = false; }}
            title="切换模型"
          >
            <svg width="13" height="13" viewBox="0 0 1024 1024" fill="currentColor">
              <path d="M958.976 612.352c-15.36 0-28.672 12.8-28.672 27.648v77.312c0 16.384-9.728 31.232-25.088 40.448l-369.152 203.776c-15.36 9.216-34.304 9.216-49.664 0L117.76 757.76c-15.36-7.168-25.088-24.064-25.088-40.448v-117.76c19.968-10.24 33.28-30.72 33.28-54.272 0-33.792-28.16-61.44-62.976-61.44-34.816 0-62.976 27.648-62.976 61.44 0 24.064 14.336 45.056 35.84 55.296v116.736c0 36.864 20.992 69.632 53.248 88.064l369.152 205.824c17.408 9.216 34.304 12.8 53.248 12.8 17.408 0 36.352-5.632 53.248-14.848l367.104-203.776c32.256-18.432 53.248-51.2 53.248-88.064V640c0.512-16.384-11.264-27.648-26.112-27.648z"/>
              <path d="M454.144 435.2c-1.536-6.144-3.584-13.824-5.12-25.088h-1.536c0 7.68-3.072 16.896-4.608 25.088l-33.792 99.328h78.848L454.144 435.2z"/>
              <path d="M473.088 866.816l1.536 1.024c23.04 11.776 52.736 11.776 74.752-1.024l262.144-145.408 1.536-1.024c24.064-12.8 36.864-36.352 36.864-63.488v-291.84c-0.512-25.088-15.872-48.128-38.4-62.464l-262.144-145.408-1.536-1.024c-23.04-11.776-52.736-11.776-74.752 1.024L210.944 302.592l-1.536 1.024c-22.016 12.8-36.864 36.352-36.864 63.488v293.888c0.512 25.088 15.872 48.128 38.4 62.464l262.144 143.36z m157.184-505.856h62.464v285.184h-62.464V360.96z m-221.184 1.536h73.728l109.056 285.184h-69.12l-22.528-65.024h-107.52l-22.528 65.024H301.056l108.032-285.184z"/>
              <path d="M987.648 410.112V305.664c0-36.864-20.992-69.632-53.248-88.064L565.248 13.824c-32.256-18.432-74.752-18.432-107.008 0L89.088 217.6C56.832 236.032 35.84 269.312 35.84 305.664v69.632c0 14.848 13.312 27.648 28.672 27.648 15.36 0 28.672-12.8 28.672-27.648V305.664c0-16.384 9.728-31.232 25.088-40.448l368.64-203.776c15.36-9.216 34.304-9.216 49.664 0l367.104 205.824c15.36 7.168 25.088 24.064 25.088 40.448v104.96h1.024c-18.944 10.752-31.744 30.208-31.744 53.248 0 33.792 28.16 61.44 62.976 61.44 34.816 0 62.976-27.648 62.976-61.44 0-24.576-14.848-46.08-36.352-55.808z"/>
            </svg>
            <span>{selectedModel || '选择模型'}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>

          {#if showModelPicker}
            <div class="ai-chat__dropdown ai-chat__dropdown--up">
              {#each availableModels as model}
                <button
                  class="ai-chat__dropdown-item"
                  class:is-active={selectedModel === model.value}
                  on:click={() => { aiSelectedModel.set(model.value); showModelPicker = false; }}
                >
                  <span class="ai-chat__dropdown-item-label">{model.label}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <div class="ai-chat__input-toolbar-right">
        <button
          class="ai-chat__send-btn"
          disabled={!$aiInputText.trim() || $aiIsSending}
          on:click={handleSend}
        >
          <Icon name="iconThingsSend" size={14} />
          <span>发送</span>
        </button>
      </div>
    </div>
  </div>
</div>

<style lang="scss">
  .ai-chat {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;

  // ===== 内容区 =====
  &__content {
    flex: 1;
    overflow-y: auto;
    padding: 20px 20px 12px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 0;
  }

  // ===== 引导区 =====
  &__guide {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 48px 24px;
    text-align: center;
  }

  &__guide-icon {
    width: 56px;
    height: 56px;
    border-radius: 16px;
    background: linear-gradient(135deg, #4a8af4, #6c5ce7);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 8px 24px rgba(74, 138, 244, 0.3);
  }

  &__guide-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--b3-theme-on-background);
  }

  &__guide-desc {
    font-size: 11px;
    color: var(--b3-theme-on-surface-light);
    text-align: center;
    line-height: 1.7;
    max-width: 320px;
  }

  &__guide-examples {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin-top: 12px;
    width: 100%;
    max-width: 480px;
  }

  &__example-chip {
    padding: 7px 12px;
    border: 1px solid #e0e4e9;
    border-radius: 9px;
    background: #fff;
    font-size: 11px;
    color: var(--b3-theme-on-surface);
    cursor: pointer;
    text-align: left;
    transition: all 0.15s;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.024);

    &:hover {
      border-color: #3b7ff0;
      color: #3b7ff0;
      background: #f0f5ff;
    }
  }

  // ===== 卡片 =====
  &__card {
    background: #fff;
    border: 1px solid #e4e8ec;
    border-radius: 13px;
    padding: 14px 16px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.024);
  }

  &__card-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    font-weight: 500;
    color: var(--b3-theme-on-surface-light);
    margin-bottom: 8px;
    letter-spacing: 0.5px;
  }

  &__dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;

    &--blue {
      background: #4a8af4;
    }
  }

  &__user-text {
    font-size: 12px;
    line-height: 1.8;
    color: var(--b3-theme-on-surface);
    white-space: pre-wrap;
    word-break: break-word;
  }

  // ===== 思考卡片 =====
  &__badge {
    margin-left: auto;
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 6px;
    background: #eef4ff;
    color: #4c82df;

    &.is-done {
      background: rgba(25, 185, 87, 0.12);
      color: #19b957;
    }

    &.is-error {
      background: rgba(220, 38, 38, 0.1);
      color: #dc2626;
    }
  }

  &__reasoning {
    font-size: 12px;
    line-height: 1.7;
    color: var(--b3-theme-on-surface-light);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 200px;
    overflow-y: auto;

    &--content {
      color: var(--b3-theme-on-surface);
    }
  }

  &__streaming-placeholder,
  &__organizing {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--b3-theme-on-surface-light);
  }

  &__pulse-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #3b7ff0;
    flex-shrink: 0;
    animation: ai-pulse 1.2s ease-in-out infinite;
  }

  &__divider {
    height: 1px;
    background: #f0f2f5;
    margin: 10px 0;
  }

  &__error-text {
    font-size: 12px;
    color: #dc2626;
  }

  // ===== 结果卡片 =====
  &__count-badge {
    background: #3b7ff0;
    color: #ffffff;
    font-size: 10px;
    padding: 1px 7px;
    border-radius: 9px;
  }

  &__task-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  &__task-item {
    position: relative;

    &.is-adopted {
      opacity: 0.65;
    }
  }

  &__adopt-btn {
    position: absolute;
    bottom: 12px;
    right: 12px;
    z-index: 5;
    padding: 5px 14px;
    border: none;
    border-radius: 6px;
    background: #3b7ff0;
    color: #ffffff;
    font-size: 10px;
    cursor: pointer;
    transition: background 0.15s;

    &:hover {
      background: #2e6bd6;
    }
  }

  &__adopted-badge {
    position: absolute;
    bottom: 12px;
    right: 12px;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 12px;
    border-radius: 6px;
    background: #e8f5e9;
    color: #4caf50;
    font-size: 10px;
    font-weight: 500;
  }

  // ===== 底部输入栏 =====
  &__input-bar {
    border-top: 1px solid #e4e8ec;
    padding: 10px 16px 14px;
    background: #f6f7f9;
    flex-shrink: 0;
  }

  &__input-container {
    background: #ffffff;
    border: 1px solid #e0e4e9;
    border-radius: 13px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.024);
    margin-bottom: 8px;
    transition: border-color 0.2s;

    &:focus-within {
      border-color: #3b7ff0;
    }
  }

  &__textarea {
    width: 100%;
    border: none;
    outline: none;
    resize: none;
    background: transparent;
    font-size: 12px;
    line-height: 1.6;
    font-family: inherit;
    color: var(--b3-theme-on-background);
    padding: 12px 14px 6px;
    min-height: 40px;
    max-height: 100px;

    &::placeholder {
      color: var(--b3-theme-on-surface-light);
    }
  }

  &__input-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 7px;
  }

  &__input-toolbar-left,
  &__input-toolbar-right {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  &__dropdown-wrap {
    position: relative;
  }

  &__tool-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 9px;
    border: 1px solid #e4e8ec;
    border-radius: 7px;
    background: #fafbfc;
    color: var(--b3-theme-on-surface);
    font-size: 10px;
    cursor: pointer;
    transition: all 0.15s;

    &:hover {
      border-color: #c8d0d8;
      background: #f0f2f5;
    }
  }

  &__dropdown {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    z-index: 60;
    background: #ffffff;
    border: 1px solid #e4e8ec;
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(30, 43, 62, 0.15);
    padding: 5px;
    min-width: 170px;
    max-height: 260px;
    overflow-y: auto;
  }

  &__dropdown-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    padding: 7px 9px;
    border: none;
    background: transparent;
    cursor: pointer;
    border-radius: 6px;
    text-align: left;
    transition: background 0.1s;

    &:hover {
      background: #f3f5f7;
    }

    &.is-active {
      background: #f0f5ff;
    }

    &-label {
      font-size: 11px;
      font-weight: 500;
      color: var(--b3-theme-on-surface);

      .is-active & {
        color: #3b7ff0;
      }
    }

    &-desc {
      font-size: 10px;
      color: var(--b3-theme-on-surface-light);
      margin-top: 1px;
    }
  }

  &__send-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 14px;
    border: none;
    border-radius: 7px;
    background: #3b7ff0;
    color: #ffffff;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s;

    &:hover:not(:disabled) {
      background: #2e6bd6;
    }

    &:disabled {
      background: #c8d6f0;
      cursor: not-allowed;
    }
  }

  @keyframes ai-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.35; transform: scale(0.8); }
  }
  } // .ai-chat
</style>
