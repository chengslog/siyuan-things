<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy, tick } from "svelte";
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
    markAiTaskAdopted,
    updateAiTaskDraft,
    parsedToPrefill,
    confirmAiOperation,
    cancelAiOperation,
    aiComposerContexts,
    addAiComposerContext,
    removeAiComposerContext,
    type AIComposerContext,
  } from "@/stores/aiChat";
  import Icon from "@/icons/Icon.svelte";
  import TaskCard from "./TaskCard.svelte";

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

  // ========== 本地 UI 状态（会话数据在共享 store 中） ==========
  let textareaEl: HTMLTextAreaElement;
  let contentEl: HTMLElement;
  let showModelPicker = false;
  let showThinkingPicker = false;
  let closingTaskKeys = new Set<string>();
  let clockNow = Date.now();
  let clockTimer: ReturnType<typeof setInterval> | undefined;
  let inputDropActive = false;
  const AI_CONTEXT_MIME = 'application/x-siyuan-things-context';

  function getAvailableModels(): Array<{ value: string; label: string }> {
    if (aiConfig.mode === 'custom') {
      // 自定义模式：只用用户配置的模型
      if (aiConfig.model) {
        return [{ value: aiConfig.model, label: aiConfig.model }];
      }
      return [];
    }
    // siyuan 模式：从思源配置读取
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
        return models;
      }
    } catch (e) {
      console.error('[AIChatCore] Failed to get models:', e);
    }
    return [];
  }

  // 注意：availableModels 必须声明在使用它的响应式语句之前（响应式按声明顺序执行）
  $: availableModels = getAvailableModels();

  $: rounds = $aiRounds;
  $: hasAnyRound = $aiRounds.length > 0;
  // 同一会话只展示最新的有效任务集；前面的用户输入和思考记录仍保留。
  $: latestSearchRoundId = [...rounds].reverse().find(
    (round) => round.mode === 'search'
  )?.id;
  $: latestRoundId = rounds[rounds.length - 1]?.id;
  $: inputText = $aiInputText;
  $: selectedModel = $aiSelectedModel || aiConfig.model;
  $: thinkingLevel = $aiThinkingLevel;
  $: isSending = $aiIsSending;

  function handleContextDragOver(event: DragEvent) {
    if (!event.dataTransfer?.types.includes(AI_CONTEXT_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    inputDropActive = true;
  }

  function handleContextDrop(event: DragEvent) {
    event.preventDefault();
    inputDropActive = false;
    try {
      const context = JSON.parse(event.dataTransfer?.getData(AI_CONTEXT_MIME) || '') as AIComposerContext;
      const allowedViews = ['inbox', 'today', 'upcoming', 'anytime', 'someday', 'log'];
      const valid = context?.label && context?.value && (
        (context.kind === 'view' && allowedViews.includes(context.value)) ||
        (context.kind === 'project' && !!context.id && !!store.projects.get(context.id)) ||
        (context.kind === 'area' && !!context.id && !!store.areas.get(context.id)) ||
        (context.kind === 'tag' && !!context.id && !!store.tags.get(context.id))
      );
      if (!valid) return;
      addAiComposerContext(context);
      tick().then(() => textareaEl?.focus());
    } catch {
      // 忽略来自其他应用的普通拖拽内容。
    }
  }

  function handleContextDragLeave(event: DragEvent) {
    const container = event.currentTarget as HTMLElement;
    if (!container.contains(event.relatedTarget as Node | null)) inputDropActive = false;
  }

  function contextIcon(context: AIComposerContext): string {
    if (context.kind === 'project') return 'iconThingsProject';
    if (context.kind === 'area') return 'iconThingsArea';
    if (context.kind === 'tag') return 'iconThingsTagColor';
    const icons: Record<string, string> = {
      inbox: 'iconThingsInbox',
      today: 'iconThingsToday',
      upcoming: 'iconThingsCalendar',
      anytime: 'iconThingsAnytime',
      someday: 'iconThingsSomeday',
      log: 'iconThingsLog',
    };
    return icons[context.value] || 'iconThingsInbox';
  }

  // 模型列表未选中时取第一个可用
  $: if (!$aiSelectedModel && (availableModels?.length || 0) > 0) {
    aiSelectedModel.set(availableModels[0].value);
  }

  // ========== 示例 prompts ==========
  const examplePrompts = [
    '明天上午 9 点开产品评审会，帮我拆分准备事项',
    '我今天有哪些任务？',
    '帮我找出重复任务，并建议保留哪些',
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

  async function scrollToLatest(behavior: ScrollBehavior = 'smooth') {
    await tick();
    requestAnimationFrame(() => {
      contentEl?.scrollTo({ top: contentEl.scrollHeight, behavior });
    });
  }

  // ========== 发送 ==========
  async function handleSend() {
    const text = $aiInputText.trim();
    if (!text || $aiIsSending) {
      return;
    }
    // 命令式地在发送开始/完成各滚动一次，不订阅流式 store，避免此前的响应式滚动死循环。
    const sending = sendAiMessage(text, aiConfig, { view: currentView, viewId: currentViewId });
    await scrollToLatest('smooth');
    await sending;
    await scrollToLatest('smooth');
    tick().then(() => {
      autoGrow();
      textareaEl?.focus();
    });
  }

  // TaskCard 已按手动新建的完整流程保存，这里只更新 AI 会话展示状态。
  function handleTaskCreated(round: any, index: number, e: CustomEvent) {
    const key = `${round.id}:${index}`;
    closingTaskKeys = new Set(closingTaskKeys).add(key);
    showMessage(`✓ 已添加：${round.parsedTasks[index]?.title || ''}`, 2000);
    window.setTimeout(() => {
      markAiTaskAdopted(round, index, e.detail?.task?.id);
      const next = new Set(closingTaskKeys);
      next.delete(key);
      closingTaskKeys = next;
    }, 420);
  }

  function timestampParts(timestamp?: number): { date?: string; time?: string } {
    if (!timestamp) return {};
    const d = new Date(timestamp);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
    return {
      date,
      time: hasTime ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : undefined,
    };
  }

  function handleDraftChange(round: any, index: number, e: CustomEvent) {
    // 创建成功后 TaskCard 会清空自身表单；收缩动画期间不能让这次内部重置覆盖 AI 结果标题。
    if (closingTaskKeys.has(`${round.id}:${index}`) || round.adopted.has(index)) return;
    const draft = e.detail?.draft || {};
    const start = timestampParts(draft.startDate);
    const deadline = timestampParts(draft.deadline);
    const project = draft.projectId ? store.projects.get(draft.projectId) : undefined;
    const area = draft.areaId ? store.areas.get(draft.areaId) : undefined;
    const heading = project?.headings.find((h) => h.id === draft.headingId);
    updateAiTaskDraft(round, index, {
      title: draft.title || '',
      notes: draft.notes || undefined,
      checklist: draft.checklist || [],
      startDate: start.date,
      startTime: start.time,
      deadline: deadline.date,
      deadlineTime: deadline.time,
      someday: draft.someday === true,
      repeatRule: draft.repeatRule,
      project: project?.name,
      area: area?.name,
      heading: heading?.title,
      status: round.parsedTasks[index]?.status,
      tags: (draft.tags || []).map((id: string) => store.tags.get(id)?.name).filter(Boolean),
    });
  }

  function roundStatusText(round: any): string {
    if (round.mode === 'search') {
      if (round.phase === 'thinking') return 'AI 正在检索任务...';
      if (round.phase === 'organizing') return '正在整理查询结果...';
      if (round.phase === 'error') return '查询失败';
      return '查询完成';
    }
    if (round.mode === 'action' || round.mode === 'answer') {
      if (round.phase === 'done') return round.pendingOperation ? '等待确认' : '处理完成';
    }
    if (round.phase === 'thinking' && !round.reasoning) return '正在连接模型...';
    if (round.phase === 'thinking') return '正在理解任务...';
    if (round.phase === 'organizing') return '正在生成任务卡...';
    if (round.phase === 'done') return `已为你整理好 ${round.parsedTasks.length} 个任务`;
    if (round.phase === 'error') return '整理失败';
    return '';
  }

  function assistantLeadText(round: any): string {
    if (round.phase === 'error') return '';
    if (round.mode === 'search') {
      if (round.phase === 'done') return '查询完成，我把结果整理在下面了。';
      return '好的，我来检索并整理相关任务。';
    }
    // 普通问答和任务操作的最终消息由下方 answer-card 统一承载；
    // 处理完成后不再在思考卡内重复渲染同一条 assistantMessage。
    if (round.mode === 'action' || round.mode === 'answer') {
      return round.phase === 'done' ? '' : '好的，我正在理解并处理。';
    }
    return round.assistantMessage || '可以，我会帮你整理成清晰的任务。';
  }

  function friendlyErrorText(round: any): string {
    const message = String(round.errorMsg || 'AI 服务调用失败，请稍后重试。');
    if (!availableModels?.length && aiConfig.mode === 'siyuan') {
      return '当前没有可用模型，请先在思源 AI 设置中启用并配置模型后重试。';
    }
    const modelMatch = message.match(/model['“\s]*([^'”\s]+)['”\s]* does not exist/i);
    if (/model_not_found|does not exist or you do not have access/i.test(message)) {
      const configuredModel = modelMatch?.[1] || $aiSelectedModel || availableModels?.[0]?.value;
      return configuredModel
        ? `模型“${configuredModel}”不存在或当前账号无权访问，请选择一个可用模型后重试。`
        : '当前没有可用模型，请先配置模型后重试。';
    }
    if (/\b404\b/.test(message)) return 'AI 服务地址或模型配置无效（404），请检查模型设置后重试。';
    return message.replace(/^AI\s*服务调用失败[:：]?\s*/i, '');
  }

  function taskLocation(task: any): string {
    if (task.projectId) return `项目：${store.projects.get(task.projectId)?.name || '未知项目'}`;
    if (task.areaId) return `区域：${store.areas.get(task.areaId)?.name || '未知区域'}`;
    if (task.status === 'done') return '已完成任务';
    if (task.someday) return '某天';
    if (task.startDate) return new Date(task.startDate).toLocaleDateString();
    return '收件箱';
  }

  function jumpToTask(task: any) {
    let view: ViewType = 'inbox';
    let viewId: string | undefined;
    if (task.status === 'done') view = 'log';
    else if (task.projectId) { view = 'project'; viewId = task.projectId; }
    else if (task.areaId) { view = 'area'; viewId = task.areaId; }
    else if (task.someday) view = 'someday';
    else if (task.startDate) {
      const end = new Date(); end.setHours(23, 59, 59, 999);
      view = task.startDate <= end.getTime() ? 'today' : 'upcoming';
    }
    window.dispatchEvent(new CustomEvent('things-navigate', { detail: { view, viewId } }));
    dispatch('navigate', { taskId: task.id });
    const focus = () => {
      const elements = Array.from(document.querySelectorAll(`[data-task-id="${task.id}"]`)) as HTMLElement[];
      const target = elements.find((element) => element.offsetParent !== null);
      if (!target) return false;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('is-ai-focused');
      window.setTimeout(() => target.classList.remove('is-ai-focused'), 1800);
      return true;
    };
    window.setTimeout(() => { if (!focus()) window.setTimeout(focus, 700); }, 250);
  }

  function elapsedSeconds(round: any): number {
    if (!round.startedAt) return 0;
    return Math.max(1, Math.ceil(((round.completedAt || clockNow) - round.startedAt) / 1000));
  }

  function thinkingStatusText(round: any): string {
    if (round.phase === 'error') return roundStatusText(round);
    if (round.phase === 'done') return roundStatusText(round);
    if (!round.intentResolved) return '正在思考';
    if (round.mode === 'search') return '正在检索任务';
    if (round.mode === 'organize') return '正在生成任务卡';
    if (round.mode === 'action') return '正在准备任务操作';
    return '正在整理回复';
  }

  // 点击外部关闭下拉选择器
  function handleDocClick(e: MouseEvent) {
    if (!showModelPicker && !showThinkingPicker) return;
    const path = e.composedPath();
    const clickedInsideWrap = path.some(
      (el) => el instanceof HTMLElement && el.classList.contains('ai-chat__dropdown-wrap')
    );
    if (!clickedInsideWrap) {
      showModelPicker = false;
      showThinkingPicker = false;
    }
  }

  onMount(() => {
    autoGrow();
    clockTimer = setInterval(() => { clockNow = Date.now(); }, 1000);
    document.addEventListener('click', handleDocClick, true);
  });

  onDestroy(() => {
    if (clockTimer) clearInterval(clockTimer);
    document.removeEventListener('click', handleDocClick, true);
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
        <div class="ai-chat__guide-title">用自然语言管理你的任务</div>
        <div class="ai-chat__guide-desc">可以创建、查询、修改和整理已有任务，我会结合当前列表和会话上下文处理。</div>
        <div class="ai-chat__guide-examples">
          {#each examplePrompts as p}
            <button class="ai-chat__example-chip" on:click={() => fillExample(p)}>{p}</button>
          {/each}
        </div>
      </div>
    {/if}

    {#each rounds as round (round.id)}
      <div class="ai-chat__thread">
      <!-- 用户输入卡片 -->
      <div class="ai-chat__card ai-chat__user-card">
        <div class="ai-chat__card-label">
          <span class="ai-chat__dot ai-chat__dot--blue"></span>
          <span>你的输入</span>
        </div>
        <div class="ai-chat__user-text">{round.userText}</div>
      </div>

      <!-- AI 思考卡片 -->
      {#if round.id === latestRoundId}
      <div class="ai-chat__card ai-chat__think-card">
        <div class="ai-chat__assistant-row">
          <div class="ai-chat__assistant-avatar"><Icon name="iconThingsSparkles" size={12} color="#ffffff" /></div>
          <div class="ai-chat__assistant-content">
            <div class="ai-chat__thinking-state" class:is-error={round.phase === 'error'} aria-live="polite">
              <div class="ai-chat__thinking-time">
                {round.phase === 'error' ? '处理了' : '已处理'} {elapsedSeconds(round)}秒
              </div>
              <div class="ai-chat__thinking-divider"></div>
              <div class="ai-chat__thinking-current" class:is-active={round.phase !== 'done' && round.phase !== 'error'}>
                {thinkingStatusText(round)}
              </div>
            </div>
            {#if assistantLeadText(round)}
              <div class="ai-chat__assistant-copy ai-chat__assistant-copy--after">{assistantLeadText(round)}</div>
            {/if}
            {#if round.phase === 'error'}
              <div class="ai-chat__error-text">{friendlyErrorText(round)}</div>
            {/if}
          </div>
        </div>
        {#if round.phase !== 'error'}
          {#if round.reasoning && (round.phase === 'thinking' || round.phase === 'organizing')}
            <div class="ai-chat__reasoning">{round.reasoning}</div>
          {/if}
        {/if}

      </div>
      {/if}

      {#if round.mode === 'search' && round.phase === 'done' && round.id === latestSearchRoundId}
        <section class="ai-chat__search-section">
          <div class="ai-chat__card-label"><span>查询结果</span><span class="ai-chat__count-badge">{round.searchResults?.length || 0}</span></div>
          {#if round.assistantMessage}<div class="ai-chat__search-answer">{round.assistantMessage}</div>{/if}
          {#if round.searchResults?.length}
            <div class="ai-chat__search-list">
              {#each round.searchResults as task (task.id)}
                <button class="ai-chat__search-item" on:click={() => jumpToTask(task)}>
                  <span
                    class="ai-chat__search-status"
                    class:is-done={task.status === 'done'}
                    title={task.status === 'done' ? '已勾选' : '未勾选'}
                    aria-label={task.status === 'done' ? '已勾选' : '未勾选'}
                  >
                    {task.status === 'done' ? '已完成' : '未完成'}
                  </span>
                  <span class="ai-chat__search-main"><span class="ai-chat__search-title">{task.title}</span><span class="ai-chat__search-location">{taskLocation(task)}</span></span>
                </button>
              {/each}
            </div>
          {:else}
            <div class="ai-chat__search-empty">没有找到匹配的任务，可以换个关键词再问一次。</div>
          {/if}
        </section>
      {/if}

      {#if (round.mode === 'action' || round.mode === 'answer') && round.phase === 'done' && round.id === latestRoundId}
        <section class="ai-chat__answer-card">
          <div class="ai-chat__answer-text">{round.assistantMessage}</div>
          {#if round.pendingOperation}
            <div class="ai-chat__change-preview">
              <div>{round.pendingOperation.type === 'delete' ? '将删除' : '将修改'} {round.pendingOperation.targetIds.length} 个任务</div>
              {#if round.pendingOperation.type === 'delete'}
                {#each round.pendingOperation.targetIds as id}
                  <div class="ai-chat__change-row"><span>任务</span><strong>{store.tasks.get(id)?.title || id}</strong></div>
                {/each}
                <div class="ai-chat__change-row"><span>保护</span><strong>删除记录可恢复</strong></div>
              {:else}
                {#each Object.entries(round.pendingOperation.changes) as [field, value]}
                  <div class="ai-chat__change-row"><span>{field}</span><strong>{String(value)}</strong></div>
                {/each}
              {/if}
            </div>
            <div class="ai-chat__confirm-actions">
              <button class="ai-chat__confirm-btn" on:click={() => confirmAiOperation(round)}>{round.pendingOperation.type === 'delete' ? '确认删除' : '确认修改'}</button>
              <button class="ai-chat__cancel-btn" on:click={() => cancelAiOperation(round)}>取消</button>
            </div>
          {/if}
        </section>
      {/if}

      <!-- 整理结果卡片 -->
      {#if round.phase === 'done' && round.parsedTasks.length > 0 && round.id === latestRoundId}
        <section class="ai-chat__result-section">
          <div class="ai-chat__card-label">
            <span>整理结果</span>
            <span class="ai-chat__count-badge">{round.parsedTasks.length}</span>
          </div>
          <div class="ai-chat__task-list">
            {#each round.parsedTasks as task, i (i)}
              {#if round.adopted.has(i)}
                <div class="ai-chat__task-item ai-chat__task-item--adopted">
                  <TaskCard
                    mode="create"
                    {store}
                    currentView="inbox"
                    aiPreview={true}
                    collapsedPreview={true}
                    prefilledData={parsedToPrefill(task)}
                  />
                </div>
              {:else}
                <div
                  class="ai-chat__task-item"
                  class:is-closing={closingTaskKeys.has(`${round.id}:${i}`)}
                >
                  <TaskCard
                    mode="create"
                    {store}
                    currentView="inbox"
                    aiPreview={true}
                    createOnBlur={false}
                    createOnEnter={false}
                    showCreateButton={true}
                    createButtonLabel="添加任务"
                    collapsibleCreate={true}
                    prefilledData={parsedToPrefill(task)}
                    on:draftchange={(e) => handleDraftChange(round, i, e)}
                    on:created={(e) => handleTaskCreated(round, i, e)}
                  />
                </div>
              {/if}
            {/each}
          </div>
        </section>
      {/if}

      {#if round.phase === 'done' && round.parsedTasks.length > 0 && round.id === latestRoundId}
        <div class="ai-chat__followup">
          还需要我继续调整吗？
          <div class="ai-chat__quick-row">
            <button on:click={() => fillExample('把准备材料提前到今晚')}>提前准备材料</button>
            <button on:click={() => fillExample('给会议加一个提前15分钟提醒')}>添加提醒</button>
            <button on:click={() => fillExample('把三个任务都加入产品项目')}>加入项目</button>
          </div>
        </div>
      {/if}
      </div>
    {/each}
  </div>

  <!-- 底部输入栏 -->
  <div class="ai-chat__input-bar">
    <div
      class="ai-chat__input-container"
      class:is-context-drop={inputDropActive}
      on:dragover={handleContextDragOver}
      on:dragleave={handleContextDragLeave}
      on:drop={handleContextDrop}
    >
      {#if $aiComposerContexts.length}
        <div class="ai-chat__context-chips" aria-label="新建任务设定项">
          {#each $aiComposerContexts as context (context.kind + ':' + (context.id || context.value))}
            <span class="ai-chat__context-chip">
              <Icon name={contextIcon(context)} size={11} />
              <span>{context.label}</span>
              <button type="button" title="移除设定" on:click={() => removeAiComposerContext(context)}>×</button>
            </span>
          {/each}
        </div>
      {/if}
      <textarea
        bind:this={textareaEl}
        bind:value={$aiInputText}
        on:input={autoGrow}
        on:keydown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
            e.preventDefault();
            handleSend();
          }
        }}
        class="ai-chat__textarea"
        rows="1"
        placeholder="描述你的任务，AI 帮你整理成待办…"
      ></textarea>
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
            on:click={() => {
              if (availableModels.length === 0) return;
              showModelPicker = !showModelPicker; showThinkingPicker = false;
            }}
            title={availableModels.length === 0 ? '无可用模型' : '切换模型'}
            class:is-disabled={availableModels.length === 0}
          >
            <svg width="13" height="13" viewBox="0 0 1024 1024" fill="currentColor">
              <path d="M958.976 612.352c-15.36 0-28.672 12.8-28.672 27.648v77.312c0 16.384-9.728 31.232-25.088 40.448l-369.152 203.776c-15.36 9.216-34.304 9.216-49.664 0L117.76 757.76c-15.36-7.168-25.088-24.064-25.088-40.448v-117.76c19.968-10.24 33.28-30.72 33.28-54.272 0-33.792-28.16-61.44-62.976-61.44-34.816 0-62.976 27.648-62.976 61.44 0 24.064 14.336 45.056 35.84 55.296v116.736c0 36.864 20.992 69.632 53.248 88.064l369.152 205.824c17.408 9.216 34.304 12.8 53.248 12.8 17.408 0 36.352-5.632 53.248-14.848l367.104-203.776c32.256-18.432 53.248-51.2 53.248-88.064V640c0.512-16.384-11.264-27.648-26.112-27.648z"/>
              <path d="M454.144 435.2c-1.536-6.144-3.584-13.824-5.12-25.088h-1.536c0 7.68-3.072 16.896-4.608 25.088l-33.792 99.328h78.848L454.144 435.2z"/>
              <path d="M473.088 866.816l1.536 1.024c23.04 11.776 52.736 11.776 74.752-1.024l262.144-145.408 1.536-1.024c24.064-12.8 36.864-36.352 36.864-63.488v-291.84c-0.512-25.088-15.872-48.128-38.4-62.464l-262.144-145.408-1.536-1.024c-23.04-11.776-52.736-11.776-74.752 1.024L210.944 302.592l-1.536 1.024c-22.016 12.8-36.864 36.352-36.864 63.488v293.888c0.512 25.088 15.872 48.128 38.4 62.464l262.144 143.36z m157.184-505.856h62.464v285.184h-62.464V360.96z m-221.184 1.536h73.728l109.056 285.184h-69.12l-22.528-65.024h-107.52l-22.528 65.024H301.056l108.032-285.184z"/>
              <path d="M987.648 410.112V305.664c0-36.864-20.992-69.632-53.248-88.064L565.248 13.824c-32.256-18.432-74.752-18.432-107.008 0L89.088 217.6C56.832 236.032 35.84 269.312 35.84 305.664v69.632c0 14.848 13.312 27.648 28.672 27.648 15.36 0 28.672-12.8 28.672-27.648V305.664c0-16.384 9.728-31.232 25.088-40.448l368.64-203.776c15.36-9.216 34.304-9.216 49.664 0l367.104 205.824c15.36 7.168 25.088 24.064 25.088 40.448v104.96h1.024c-18.944 10.752-31.744 30.208-31.744 53.248 0 33.792 28.16 61.44 62.976 61.44 34.816 0 62.976-27.648 62.976-61.44 0-24.576-14.848-46.08-36.352-55.808z"/>
            </svg>
            <span>{availableModels.length === 0 ? '无' : ($aiSelectedModel || availableModels[0]?.value || '选择模型')}</span>
            {#if availableModels.length > 0}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 9l6 6 6-6"/>
            </svg>
            {/if}
          </button>

          {#if showModelPicker && availableModels.length > 0}
            <div class="ai-chat__dropdown ai-chat__dropdown--up">
              {#each availableModels as model}
                <button
                  class="ai-chat__dropdown-item"
                  class:is-active={($aiSelectedModel || availableModels[0]?.value) === model.value}
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
</div>

<style lang="scss">
  .ai-chat {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background: transparent;
    font-size: 11px;

  &__header {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 13px 16px 8px;
  }

  &__brand-icon {
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    border-radius: 9px;
    background: linear-gradient(145deg, #4d85f6, #6f58ef);
    box-shadow: 0 7px 16px rgba(81, 91, 238, 0.18);
  }

  &__brand-copy { min-width: 0; }
  &__title { font-size: 12px; line-height: 1.25; font-weight: 700; color: var(--b3-theme-on-background); }
  &__subtitle { margin-top: 2px; font-size: 9px; line-height: 1.2; color: #a1a7b2; }

  &__new-session {
    margin-left: auto;
    height: 28px;
    padding: 0 10px;
    border: 1px solid #e6e9ee;
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.65);
    color: #666;
    font-size: 10px;
    cursor: pointer;
    &:hover { background: #f7f8fa; }
  }

  // ===== 内容区 =====
  &__content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 16px 36px 22px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 0;
    background: transparent;
  }

  // ===== 引导区 =====
  &__guide {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    max-width: none;
    margin: auto;
    padding: 24px 20px 30px;
    text-align: center;
    background: transparent;
  }

  &__guide-icon {
    width: 38px;
    height: 38px;
    border-radius: 11px;
    background: linear-gradient(135deg, #4a8af4, #6c5ce7);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 7px 16px rgba(81, 91, 238, 0.18);
  }

  &__guide-title {
    margin-top: 6px;
    font-size: 15px;
    font-weight: 700;
    color: var(--b3-theme-on-background);
  }

  &__guide-desc {
    font-size: 12px;
    color: var(--b3-theme-on-surface-light);
    text-align: center;
    line-height: 1.7;
    max-width: 360px;
  }

  &__guide-examples {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    margin-top: 10px;
    width: 100%;
    max-width: 470px;
  }

  &__example-chip {
    position: relative;
    padding: 8px 12px;
    border: 1px solid #e7eaf0;
    border-radius: 999px;
    background: #fafbfc;
    font-size: 10px;
    line-height: 1.35;
    color: #757d88;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s;
    box-shadow: 0 4px 14px rgba(42, 61, 96, 0.055);

    &::after {
      content: '›';
      position: absolute;
      top: 50%;
      right: 8px;
      transform: translateY(-52%);
      font-size: 14px;
      line-height: 1;
      color: #9aa1ac;
      transition: transform 0.18s ease;
    }

    &:hover {
      border-color: #d7e1fb;
      color: #476fd0;
      background: #f0f5ff;
      box-shadow: none;

      &::after { transform: translate(3px, -52%); }
    }
  }

  // ===== 卡片 =====
  &__card {
    background: rgba(255, 255, 255, 0.72);
    border: 1px solid #edf0f4;
    border-radius: 13px;
    padding: 14px 16px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.024);
  }

  &__card-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
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
    font-size: 13px;
    line-height: 1.8;
    color: var(--b3-theme-on-surface);
    white-space: pre-wrap;
    word-break: break-word;
  }

  &__thread {
    width: 100%;
    max-width: none;
    margin: 0 auto;
  }

  &__assistant-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 10px;
  }

  &__assistant-avatar {
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    border-radius: 8px;
    background: linear-gradient(145deg, #598cf6, #775df1);
  }

  &__assistant-copy {
    padding-top: 2px;
    font-size: 11px;
    line-height: 1.65;
    color: #555e69;

    &--after {
      margin-top: 12px;
    }
  }

  &__assistant-content {
    flex: 1;
    min-width: 0;
  }

  &__user-card {
    width: fit-content;
    max-width: 88%;
    margin-left: auto;
    border-color: #dbe7ff;
    border-radius: 12px;
    background: #eef4ff;
    box-shadow: none;
    padding: 10px 12px;
  }

  &__user-card &__card-label { display: none; }
  &__user-card &__user-text { font-size: 11px; line-height: 1.55; color: #3d4652; }

  &__think-card {
    background: transparent;
    border: none;
    box-shadow: none;
    padding-left: 8px;
    padding-right: 8px;
  }

  &__followup {
    margin: 15px 0 0 32px;
    font-size: 10px;
    color: #808894;
  }

  &__quick-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;

    button {
      padding: 6px 9px;
      border: 1px solid #e7eaf0;
      border-radius: 999px;
      background: #fafbfc;
      color: #757d88;
      font-size: 9px;
      cursor: pointer;

      &:hover { border-color: #d7e1fb; background: #f0f5ff; color: #476fd0; }
    }
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
    font-size: 11px;
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

  &__progress {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-left: 32px;
    margin-bottom: 10px;
    padding: 2px 0;
  }

  &__thinking-state {
    margin: 0;
    color: #747b85;
  }

  &__thinking-time {
    padding: 0 2px 9px;
    font-size: 11px;
    line-height: 1.4;
    color: #6f7680;
  }

  &__thinking-divider {
    height: 1px;
    background: #e8ebf0;
  }

  &__thinking-current {
    padding: 10px 2px 2px;
    font-size: 11px;
    line-height: 1.5;
    color: #7b838d;

    &.is-active {
      color: #a0a6ae;
      animation: ai-thinking-fade 1.6s ease-in-out infinite;
    }

    .is-error & { color: #dc2626; }
  }

  &__progress-step {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 24px;
    padding: 3px 7px;
    border-radius: 7px;
    font-size: 10px;
    color: #a1a7b0;
    transition: color 180ms ease, background 180ms ease;

    &:not(:last-child)::after {
      content: '';
      position: absolute;
      z-index: 0;
      top: 19px;
      bottom: -9px;
      left: 14px;
      width: 2px;
      border-radius: 2px;
      background: #dfe6f7;
    }

    &.is-complete {
      color: #6f7884;
    }

    &.is-current {
      color: #356fcf;
      background: rgba(59, 127, 240, 0.08);
      animation: ai-progress-glow 1.5s ease-in-out infinite;
    }

    &.is-error {
      color: #dc2626;
      background: rgba(220, 38, 38, 0.06);

      .ai-chat__progress-dot {
        border-color: #dc2626;
        background: rgba(220, 38, 38, 0.1);
        color: #dc2626;
      }
    }
  }

  &__progress-summary { margin-top: 2px; }

  &__progress-dot {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: 1.5px solid #c7ccd3;
    border-radius: 50%;
    font-size: 10px;
    line-height: 1;
    flex-shrink: 0;

    .is-complete & {
      border-color: #52a56e;
      background: #52a56e;
      color: #fff;
    }

    .is-current & {
      border-color: #3b7ff0;
      border-top-color: transparent;
      animation: ai-progress-spin 0.9s linear infinite;
    }
  }

  &__progress-live {
    margin-left: auto;
    font-size: 10px;
    color: #4a7fd8;
  }

  &__error-text {
    margin-top: 12px;
    padding: 10px 12px;
    border: 1px solid rgba(220, 38, 38, 0.14);
    border-radius: 10px;
    background: rgba(220, 38, 38, 0.045);
    font-size: 11px;
    line-height: 1.55;
    color: #b42318;
  }

  // ===== 结果卡片 =====
  &__result-section {
    padding-top: 4px;
    margin-left: 32px;
  }

  &__search-section { margin: 12px 0 0 32px; padding-top: 4px; }
  &__search-list { display: flex; flex-direction: column; gap: 6px; }
  &__search-answer { margin-bottom: 9px; font-size: 12px; line-height: 1.6; color: var(--b3-theme-on-surface); }
  &__search-item { display: flex; align-items: center; gap: 9px; width: 100%; padding: 9px 10px; border: 1px solid var(--b3-border-color); border-radius: 9px; background: var(--b3-theme-background); color: inherit; cursor: pointer; text-align: left; }
  &__search-item:hover { border-color: var(--b3-theme-primary); background: var(--b3-list-hover); }
  &__search-status {
    width: auto;
    height: 20px;
    padding: 0 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    border: 1px solid #e4e7eb;
    border-radius: 999px;
    background: #f7f8fa;
    color: #8a929d;
    font-size: 9px;
    font-weight: 400;
  }
  &__search-status.is-done {
    border-color: rgba(82, 165, 110, 0.24);
    background: rgba(82, 165, 110, 0.08);
    color: #4f9566;
  }
  &__search-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  &__search-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 500; }
  &__search-location { color: var(--b3-theme-on-surface-light); font-size: 10px; }
  &__search-empty { padding: 14px; border-radius: 9px; background: var(--b3-theme-surface-light); color: var(--b3-theme-on-surface-light); font-size: 12px; text-align: center; }
  &__answer-card { margin-left: 32px; padding: 12px 14px; border-radius: 10px; background: var(--b3-theme-background); border: 1px solid var(--b3-border-color); }
  &__answer-text { font-size: 13px; line-height: 1.65; color: var(--b3-theme-on-surface); }
  &__change-preview { margin-top: 10px; padding: 9px 10px; border-radius: 8px; background: var(--b3-theme-surface-light); font-size: 11px; color: var(--b3-theme-on-surface-light); }
  &__change-row { display: flex; justify-content: space-between; gap: 12px; margin-top: 5px; }
  &__confirm-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
  &__confirm-btn, &__cancel-btn { padding: 6px 11px; border-radius: 7px; font-size: 11px; cursor: pointer; }
  &__confirm-btn { border: none; background: #3b7ff0; color: #fff; }
  &__cancel-btn { border: 1px solid var(--b3-border-color); background: var(--b3-theme-background); color: var(--b3-theme-on-surface); }

  &__count-badge {
    background: #3b7ff0;
    color: #ffffff;
    font-size: 10px;
    padding: 1px 7px;
    border-radius: 9px;
  }

  :global(.task-card.is-collapsed-preview) {
    background: rgba(255, 255, 255, 0.58) !important;
    border: 1px solid #e8ebf0 !important;
    box-shadow: none !important;
    border-radius: 10px !important;
    margin: 4px 0 !important;
    padding: 9px 11px !important;
  }

  :global(.task-card.is-create.is-collapsible-create:not(.is-expanded)) {
    background: rgba(255, 255, 255, 0.58) !important;
    border: 1px solid #e8ebf0 !important;
    box-shadow: none !important;
    border-radius: 10px !important;
    margin: 4px 0 !important;
    padding: 9px 11px !important;
  }

  :global(.ai-chat__task-list .task-card:not(.is-expanded) .task-card__title) {
    font-size: 12px !important;
    font-weight: 500 !important;
    line-height: 20px !important;
  }

  :global(.ai-chat__task-list .task-card:not(.is-expanded) .task-card__header) {
    align-items: center !important;
  }

  :global(.ai-chat__task-list .task-card:not(.is-expanded) .task-card__ai-marker) {
    margin-top: 0 !important;
  }

  :global(.ai-chat__task-list .task-card:not(.is-expanded) .task-card__subtitle),
  :global(.ai-chat__task-list .task-card:not(.is-expanded) .task-card__aux),
  :global(.ai-chat__task-list .task-card:not(.is-expanded) .task-card__collapsed-status) {
    font-size: 10px !important;
  }

  &__task-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  &__task-item {
    position: relative;
    max-height: 800px;
    overflow: visible;
    transform-origin: top center;

    &.is-closing {
      pointer-events: none;
      overflow: hidden;
      animation: ai-task-close 420ms ease forwards;
    }

    &--adopted {
      max-height: none;
      animation: ai-adopted-in 180ms ease-out;
    }
  }

  @keyframes ai-task-close {
    0% {
      opacity: 1;
      filter: grayscale(0);
      transform: scale(1);
      max-height: 800px;
    }
    45% {
      opacity: 0.55;
      filter: grayscale(1);
      transform: scale(0.985);
      max-height: 800px;
    }
    100% {
      opacity: 0;
      filter: grayscale(1);
      transform: scale(0.97);
      max-height: 0;
      margin: 0;
    }
  }

  @keyframes ai-adopted-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  // ===== 底部输入栏 =====
  &__input-bar {
    padding: 0 36px 11px;
    background: transparent;
    flex-shrink: 0;
  }

  &__input-container {
    position: relative;
    background: rgba(255, 255, 255, 0.72);
    border: 1px solid #e8ebf0;
    border-radius: 14px;
    box-shadow: 0 2px 8px rgba(39, 57, 91, 0.04);
    transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;

    &:focus-within {
      border-color: #b8c9fb;
      box-shadow: 0 0 0 3px rgba(82, 119, 218, 0.08);
    }

    &.is-context-drop {
      border-color: #6f83ee;
      box-shadow: 0 0 0 4px rgba(92, 112, 232, 0.13), 0 10px 30px rgba(75, 91, 180, 0.12);
      transform: translateY(-1px);
    }
  }

  &__context-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 11px 12px 0;
  }

  &__context-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    padding: 3px 5px 3px 7px;
    border: 1px solid color-mix(in srgb, var(--b3-border-color) 86%, #cbd2df 14%);
    border-radius: 999px;
    background: #fff;
    color: var(--b3-theme-on-background);
    font-size: 9px;
    line-height: 1.2;
    box-shadow: 0 1px 3px rgba(38, 48, 68, 0.06);

    > span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    button {
      display: grid;
      place-items: center;
      width: 15px;
      height: 15px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--b3-theme-on-surface-light);
      cursor: pointer;

      font-size: 11px;

      &:hover { background: rgba(90, 104, 140, 0.1); }
    }
  }

  &__textarea {
    width: 100%;
    border: none;
    outline: none;
    resize: none;
    background: transparent;
    font-size: 13px;
    line-height: 1.6;
    font-family: inherit;
    color: var(--b3-theme-on-background);
    padding: 14px 14px 8px;
    min-height: 72px;
    max-height: 132px;

    &::placeholder {
      color: var(--b3-theme-on-surface-light);
    }
  }

  &__input-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 7px;
    padding: 10px 0 0;
    margin: 8px 12px 12px;
    border-top: 1px solid #f0f1f4;
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
    padding: 6px 9px;
    border: none;
    border-radius: 10px;
    background: #f4f5f7;
    color: #6f7680;
    font-size: 9px;
    cursor: pointer;
    transition: all 0.15s;

    &:hover {
      border-color: color-mix(in srgb, var(--b3-border-color) 78%, #9eb1df 22%);
      background: color-mix(in srgb, var(--b3-theme-primary-light) 45%, var(--b3-theme-background));
    }

    &.is-disabled {
      opacity: 0.5;
      cursor: not-allowed;

      &:hover {
        border-color: transparent;
        background: var(--b3-theme-surface-light);
      }
    }
  }

  &__dropdown {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    z-index: 60;
    background: var(--b3-theme-background);
    border: 1px solid var(--b3-border-color);
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
    width: 34px;
    height: 34px;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 10px;
    background: linear-gradient(135deg, #5689f5, #7167e8);
    color: #ffffff;
    font-size: 0;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    box-shadow: none;
    transition: transform 0.15s, box-shadow 0.15s, filter 0.15s;

    &:hover:not(:disabled) {
      filter: brightness(1.04);
      transform: translateY(-1px);
      box-shadow: 0 7px 18px rgba(83, 102, 224, 0.32);
    }

    &:disabled {
      background: color-mix(in srgb, var(--b3-theme-on-surface-light) 22%, var(--b3-theme-background));
      box-shadow: none;
      cursor: not-allowed;
    }
  }

  @keyframes ai-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.35; transform: scale(0.8); }
  }

  @keyframes ai-thinking-fade {
    0%, 100% { opacity: 0.52; }
    50% { opacity: 1; }
  }

  @keyframes ai-progress-spin {
    to { transform: rotate(360deg); }
  }

  @keyframes ai-progress-glow {
    0%, 100% { background: rgba(59, 127, 240, 0.06); }
    50% { background: rgba(59, 127, 240, 0.13); }
  }
  } // .ai-chat
</style>
