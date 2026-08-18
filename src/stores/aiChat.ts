/**
 * AI 会话共享状态（AIChatCore 面板与全局浮窗共用，跨形态切换不丢会话）
 */

import { get, writable } from "svelte/store";
import type { ParsedTask, ViewType } from "@/types";
import type { StoreManager } from "@/stores";
import {
  parseTasksWithAIStream,
  parseTasksFromContent,
  THINKING_LEVELS,
  type AIConfig,
  type ThinkingLevel,
} from "@/services/aiParser";
import { parseDate } from "@/utils/date";

export interface ChatRound {
  id: string;
  userText: string;
  reasoning: string;   // 真实流式推理内容
  content: string;     // 流式回答内容
  phase: 'thinking' | 'organizing' | 'done' | 'error';
  parsedTasks: ParsedTask[];
  adopted: Set<number>;
  errorMsg: string;
}

export const aiRounds = writable<ChatRound[]>([]);
export const aiInputText = writable("");
export const aiSelectedModel = writable("");
export const aiThinkingLevel = writable<ThinkingLevel>(THINKING_LEVELS[1]);
export const aiIsSending = writable(false);

let taskStore: StoreManager | null = null;
let roundSeq = 0;

export function initAiChat(store: StoreManager) {
  taskStore = store;
}

function bump(round: ChatRound) {
  aiRounds.update((r) => r.map((x) => (x.id === round.id ? { ...round } : x)));
}

/**
 * 发送消息：新增一轮，流式更新推理/内容，完成后解析任务
 */
export async function sendAiMessage(text: string, config: AIConfig) {
  if (!taskStore) return;

  const round: ChatRound = {
    id: `round-${Date.now()}-${roundSeq++}`,
    userText: text,
    reasoning: "",
    content: "",
    phase: 'thinking',
    parsedTasks: [],
    adopted: new Set(),
    errorMsg: "",
  };
  aiRounds.update((r) => [...r, round]);
  aiInputText.set("");
  aiIsSending.set(true);

  const configWithModel = { ...config, model: get(aiSelectedModel) || config.model };
  const level = get(aiThinkingLevel);

  try {
    const { content } = await parseTasksWithAIStream(text, configWithModel, level, {
      onReasoning: (fullText) => {
        round.reasoning = fullText;
        if (round.phase === 'thinking') bump(round);
      },
      onContent: (fullText) => {
        round.content = fullText;
        if (round.phase === 'thinking') round.phase = 'organizing';
        bump(round);
      },
    });

    if (!content.trim()) {
      round.phase = 'error';
      round.errorMsg = 'AI 未返回有效内容，请重试';
      throw new Error(round.errorMsg);
    }

    const parsedTasks = parseTasksFromContent(content);
    if (parsedTasks.length === 0) {
      round.phase = 'error';
      round.errorMsg = 'AI 未能解析出任务，请尝试更详细的描述';
      throw new Error(round.errorMsg);
    }

    round.parsedTasks = parsedTasks;
    round.phase = 'done';
  } catch (err: any) {
    console.error('[aiChat] send failed:', err);
    if (round.phase !== 'error') {
      round.phase = 'error';
      round.errorMsg = err?.message || 'AI 解析失败，请重试';
    }
  } finally {
    aiIsSending.set(false);
    bump(round);
  }
}

interface AdoptContext {
  currentView: ViewType;
  currentViewId?: string;
  presetStartDate?: number;
}

/**
 * 采纳单个任务：写入任务 store（含检查项子任务），标记已采纳
 */
export async function adoptAiTask(round: ChatRound, index: number, ctx: AdoptContext) {
  if (!taskStore) return;
  if (round.adopted.has(index)) return;
  const parsed = round.parsedTasks[index];
  if (!parsed) return;

  const newTask = await taskStore.tasks.createTask(parsedToTaskData(parsed, ctx));

  if (parsed.checklist && parsed.checklist.length > 0) {
    for (let i = 0; i < parsed.checklist.length; i++) {
      await taskStore.tasks.createTask({
        title: parsed.checklist[i],
        parentId: newTask.id,
        status: 'todo',
        order: i,
      });
    }
  }

  const newAdopted = new Set(round.adopted);
  newAdopted.add(index);
  round.adopted = newAdopted;
  bump(round);
}

/** ParsedTask → 创建任务数据（唯一转换函数） */
export function parsedToTaskData(parsed: ParsedTask, ctx: AdoptContext) {
  let startDate = parseDate(parsed.startDate || '');
  if (startDate && parsed.startTime) {
    const [h, m] = parsed.startTime.split(':').map(Number);
    const d = new Date(startDate);
    d.setHours(h, m, 0, 0);
    startDate = d.getTime();
  }
  if (!startDate && ctx.presetStartDate) {
    startDate = ctx.presetStartDate;
  }
  const deadline = parseDate(parsed.deadline || '');

  const tagIds: string[] = [];
  if (taskStore && parsed.tags && parsed.tags.length > 0) {
    const allTags = taskStore.tags.getAll();
    for (const tagName of parsed.tags) {
      const matched = allTags.find(t =>
        t.name === tagName || t.name.toLowerCase() === tagName.toLowerCase()
      );
      if (matched) tagIds.push(matched.id);
    }
  }

  const taskData: any = {
    title: parsed.title || '未命名任务',
    startDate,
    deadline: deadline || undefined,
    priority: parsed.priority || 'none',
    tags: tagIds,
  };

  if (ctx.currentView === 'project' && ctx.currentViewId) {
    taskData.projectId = ctx.currentViewId;
  } else if (ctx.currentView === 'area' && ctx.currentViewId) {
    taskData.areaId = ctx.currentViewId;
  }

  return taskData;
}

/** ParsedTask → TaskCard 预填充数据（与创建转换共用日期/标签逻辑） */
export function parsedToPrefill(parsed: ParsedTask) {
  let startDate = parseDate(parsed.startDate || '');
  if (startDate && parsed.startTime) {
    const [h, m] = parsed.startTime.split(':').map(Number);
    const d = new Date(startDate);
    d.setHours(h, m, 0, 0);
    startDate = d.getTime();
  }

  const tagIds: string[] = [];
  if (taskStore && parsed.tags && parsed.tags.length > 0) {
    const allTags = taskStore.tags.getAll();
    for (const tagName of parsed.tags) {
      const matched = allTags.find(t =>
        t.name === tagName || t.name.toLowerCase() === tagName.toLowerCase()
      );
      if (matched) tagIds.push(matched.id);
    }
  }

  return {
    title: parsed.title || '',
    checklist: parsed.checklist || [],
    startDate: startDate || undefined,
    deadline: parseDate(parsed.deadline || ''),
    tags: tagIds,
    priority: parsed.priority || 'none',
  };
}

/** 采纳按钮文案（按落点视图动态生成） */
export function adoptLabel(view: ViewType): string {
  const viewLabels: Record<string, string> = {
    today: '添加到今天',
    inbox: '添加到收件箱',
    upcoming: '添加到计划',
    anytime: '添加到随时',
    someday: '添加到某天',
    project: '添加到项目',
    area: '添加到区域',
  };
  return viewLabels[view] || '添加';
}
