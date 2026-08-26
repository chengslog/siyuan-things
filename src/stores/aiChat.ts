/**
 * AI 会话共享状态（AIChatCore 面板与全局浮窗共用，跨形态切换不丢会话）
 */

import { get, writable } from "svelte/store";
import type { ParsedTask, Task, ViewType } from "@/types";
import type { StoreManager } from "@/stores";
import {
  parseTasksWithAIStream,
  queryTasksWithAI,
  routeAiMessage,
  parseTasksFromContent,
  THINKING_LEVELS,
  type AIConfig,
  type ThinkingLevel,
} from "@/services/aiParser";
import { parseDate } from "@/utils/date";
import { normalizeRepeatRule } from "@/utils/recurrence";
import { findExistingTagName, inferExistingTaskTags } from "@/utils/aiTagMatching";
import { omitEchoedDraftsForCreate } from "@/utils/aiDrafts";

export interface ChatRound {
  id: string;
  userText: string;
  reasoning: string;   // 真实流式推理内容
  content: string;     // 流式回答内容
  phase: 'thinking' | 'organizing' | 'done' | 'error';
  parsedTasks: ParsedTask[];
  adopted: Set<number>;
  createdTaskIds: Record<number, string>;
  errorMsg: string;
  mode?: 'organize' | 'search' | 'action' | 'answer';
  intentResolved?: boolean;
  startedAt?: number;
  completedAt?: number;
  searchResults?: Task[];
  assistantMessage?: string;
  pendingOperation?: PendingOperation;
  queryScope?: AIResolvedScope;
  /** 后续轮次明确修订了本轮草稿时，仅展示新版卡片，保留本轮对话文本。 */
  supersededByRoundId?: string;
  clarification?: 'create_or_search';
  clarificationChoice?: 'create' | 'search';
}

export interface AIResolvedScope {
  view: 'all' | 'inbox' | 'today' | 'upcoming' | 'anytime' | 'someday' | 'log' | 'projects' | 'areas' | 'tags' | 'project' | 'area' | 'tag';
  views?: Array<'upcoming' | 'anytime'>;
  viewId?: string;
  headingId?: string;
  label: string;
}

export interface AIPageContext {
  view: ViewType;
  viewId?: string;
}

export type AIComposerContextKind = 'view' | 'project' | 'area' | 'tag';
export interface AIComposerContext {
  kind: AIComposerContextKind;
  value: string;
  label: string;
  id?: string;
}

export interface PendingOperation {
  operationId: string;
  type: 'update' | 'delete';
  targetIds: string[];
  changes: Record<string, any>;
  status: 'pending' | 'executed' | 'canceled';
  baseUpdated: Record<string, number>;
}

export const aiRounds = writable<ChatRound[]>([]);
export const aiInputText = writable("");
export const aiSelectedModel = writable("");
export const aiThinkingLevel = writable<ThinkingLevel>(THINKING_LEVELS[1]);
export const aiIsSending = writable(false);
export const aiComposerContexts = writable<AIComposerContext[]>([]);

export function addAiComposerContext(context: AIComposerContext) {
  aiComposerContexts.update((items) => {
    let next = [...items];
    if (context.kind === 'view') {
      next = next.filter((item) => item.kind !== 'view');
      if (context.value === 'inbox') next = next.filter((item) => item.kind !== 'project' && item.kind !== 'area');
    } else if (context.kind === 'project' || context.kind === 'area') {
      next = next.filter((item) => item.kind !== 'project' && item.kind !== 'area');
      next = next.filter((item) => !(item.kind === 'view' && item.value === 'inbox'));
    } else {
      next = next.filter((item) => !(item.kind === 'tag' && item.id === context.id));
    }
    return [...next, context];
  });
}

export function removeAiComposerContext(context: AIComposerContext) {
  aiComposerContexts.update((items) => items.filter((item) =>
    !(item.kind === context.kind && item.value === context.value && item.id === context.id)
  ));
}

let taskStore: StoreManager | null = null;
let roundSeq = 0;
let pendingOperation: PendingOperation | null = null;
const executedOperationIds = new Set<string>();

export function initAiChat(store: StoreManager) {
  taskStore = store;
}

/** 开始新会话；已写入任务库的任务不受影响。 */
export function startNewAiChat() {
  if (get(aiIsSending)) return;
  if (pendingOperation && !window.confirm('当前还有尚未确认的任务修改，确定开始新会话并放弃它吗？')) return;
  aiRounds.set([]);
  aiInputText.set("");
  pendingOperation = null;
}

/** 重置插件时强制清空会话及尚未执行的操作，不弹出会话级确认。 */
export function resetAiChat() {
  aiRounds.set([]);
  aiInputText.set("");
  aiComposerContexts.set([]);
  aiSelectedModel.set("");
  aiThinkingLevel.set(THINKING_LEVELS[1]);
  aiIsSending.set(false);
  aiComposerContexts.set([]);
  pendingOperation = null;
  executedOperationIds.clear();
}

function bump(round: ChatRound) {
  aiRounds.update((r) => r.map((x) => (x.id === round.id ? { ...round } : x)));
}

/** TaskCard 使用自身完整创建流程后，只更新 AI 会话中的展示状态。 */
export function markAiTaskAdopted(round: ChatRound, index: number, taskId?: string) {
  const adopted = new Set(round.adopted);
  adopted.add(index);
  round.adopted = adopted;
  if (taskId) round.createdTaskIds = { ...(round.createdTaskIds || {}), [index]: taskId };
  bump(round);
}

/** 同步 AI 结果卡上用户手动编辑的草稿，供下一轮对话继续修改。 */
export function updateAiTaskDraft(round: ChatRound, index: number, parsed: ParsedTask) {
  if (!round.parsedTasks[index]) return;
  round.parsedTasks[index] = parsed;
}

/** 统一 Agent 流程：AI 路由意图，再由受限执行器查询、创建或生成修改预览。 */
export async function sendAiMessage(text: string, config: AIConfig, pageContext?: AIPageContext) {
  if (!taskStore || get(aiIsSending)) return;
  const existingRounds = get(aiRounds);
  const creationContexts = get(aiComposerContexts);
  const effectivePageContext = composerContextToPageContext(creationContexts) || pageContext;
  const previousDraftRound = [...existingRounds].reverse().find((r) => r.parsedTasks.length > 0);
  const previousSearchRound = [...existingRounds].reverse().find((r) => r.mode === 'search' && r.searchResults?.length);
  const previousScopedRound = [...existingRounds].reverse().find((r) => r.queryScope);
  const recentConversation = existingRounds.slice(-8).map((item) => ({
    user: item.userText,
    assistant: item.assistantMessage || (item.searchResults?.length ? `查询返回 ${item.searchResults.length} 个任务` : ''),
    mode: item.mode,
  }));
  const round: ChatRound = {
    id: `round-${Date.now()}-${roundSeq++}`,
    userText: text,
    reasoning: '', content: '', phase: 'thinking', parsedTasks: [],
    adopted: new Set(), createdTaskIds: {}, errorMsg: '',
    // 查询意图先做轻量预判，避免模型路由完成前错误显示“生成任务卡”。
    mode: isTaskSearchRequest(text) ? 'search' : 'action',
    intentResolved: false,
    startedAt: Date.now(),
  };
  aiInputText.set('');
  // 设定项只作用于这次已快照的请求；点击发送后立即还原空输入框。
  aiComposerContexts.set([]);
  aiIsSending.set(true);
  aiRounds.update((items) => [...items, round]);

  const sessionContext = {
    recentConversation,
    currentViewContext: describePageContext(effectivePageContext),
    creationConstraints: creationContexts,
    lastQueryScope: previousScopedRound?.queryScope || null,
    drafts: previousDraftRound?.parsedTasks.map((task, index) => ({
      ...task,
      clientId: task.clientId || `draft-${previousDraftRound.id}-${index}`,
      storedTaskId: previousDraftRound.createdTaskIds?.[index],
    })) || [],
    lastSearchResults: previousSearchRound?.searchResults?.map((task, index) => ({
      index: index + 1, id: task.id, title: task.title, status: task.status,
    })) || [],
    focusedTasks: previousSearchRound?.searchResults?.length === 1
      ? [{ id: previousSearchRound.searchResults[0].id, title: previousSearchRound.searchResults[0].title }]
      : [],
    pendingOperation,
    availableClassifications: {
      projects: taskStore.projects.getAll().map((project) => ({
        name: project.name,
        headings: project.headings.map((heading) => heading.title),
      })),
      areas: taskStore.areas.getAll().map((area) => area.name),
      tags: taskStore.tags.getAll().map((tag) => ({
        name: tag.name,
        parent: tag.parentId ? taskStore!.tags.get(tag.parentId)?.name : undefined,
      })),
    },
  };

  const updateStream = {
    onReasoning: (value: string) => { round.reasoning = value; bump(round); },
    onContent: (value: string) => { round.content = value; round.phase = 'organizing' as const; bump(round); },
  };

  try {
    let route = await routeAiMessage(
      text,
      sessionContext,
      { ...config, model: get(aiSelectedModel) || config.model },
      get(aiThinkingLevel),
      updateStream,
    );

    if (route.intent === 'create') {
      route.tasks = omitEchoedDraftsForCreate(route.tasks, previousDraftRound?.parsedTasks);
    }

    // The model decides task structure from the whole utterance. Local validation
    // only catches contradictions between that decision (or an explicit user count)
    // and the number of returned cards.
    const expectedStructure = route.intent === 'create'
      ? resolveExpectedTaskStructure(text, route.structure)
      : undefined;
    if (route.intent === 'create' && taskStructureMismatch(expectedStructure, route.tasks?.length || 0)) {
      round.reasoning = '';
      round.content = '';
      round.phase = 'thinking';
      bump(round);
      const structureValidation = expectedStructure === 'multiple_tasks'
        ? '上一次结果没有遵守用户要求的多个独立任务结构。请重新理解完整语义，返回多个独立 tasks；若每个任务还要求步骤，请写入各自 checklist。'
        : '上一次结果与已判断的单任务结构冲突。请只返回 1 个主任务；若 structure 是 single_with_checklist，请把步骤或准备事项放入该任务的 checklist。';
      route = await routeAiMessage(
        text,
        {
          ...sessionContext,
          structureValidation,
        },
        { ...config, model: get(aiSelectedModel) || config.model },
        get(aiThinkingLevel),
        updateStream,
      );
      if (route.intent === 'create') {
        route.tasks = omitEchoedDraftsForCreate(route.tasks, previousDraftRound?.parsedTasks);
      }
      const repairedStructure = resolveExpectedTaskStructure(text, route.structure || expectedStructure);
      if (route.intent !== 'create' || taskStructureMismatch(repairedStructure, route.tasks?.length || 0)) {
        throw new Error('AI 返回的任务结构与用户要求不一致，请换一种说法后重试');
      }
    }

    // 路由一旦确定，只向现有时间线追加对应执行步骤，不替换前面的公共步骤。
    round.mode = route.intent === 'search'
      ? 'search'
      : (route.intent === 'create' || (route.intent === 'update' && !!route.tasks?.length))
        ? 'organize'
        : ['update', 'delete', 'confirm'].includes(route.intent)
          ? 'action'
          : 'answer';
    round.intentResolved = true;
    bump(round);

    // Product view names are deterministic constraints, not semantic guesses.
    // Preserve them across short clarification replies such as "查看全部".
    if (route.intent === 'search') {
      round.mode = 'search';
      const scope = resolveQueryScope(route.query || {}, text, recentConversation, previousScopedRound?.queryScope, effectivePageContext);
      round.queryScope = scope;
      const candidates = filterTaskCandidates(route.query || {}, scope);
      const summaries = candidates.map(taskSummary);
      round.phase = 'thinking';
      round.reasoning = '';
      round.content = '';
      bump(round);
      const contextualQuestion = recentConversation.length
        ? `上文：${recentConversation.map((item) => `用户：${item.user}\n助手：${item.assistant}`).join('\n')}\n当前问题：${text}`
        : text;
      const result = await queryTasksWithAI(contextualQuestion, summaries, { ...config, model: get(aiSelectedModel) || config.model }, get(aiThinkingLevel), updateStream);
      const byId = new Map(candidates.map((task) => [task.id, task]));
      const directViewEnumeration = /(?:收件箱|今天|计划|随时|某天|日志)(?:列表|页|视图)?(?:中|里|下)?(?:有|都)?(?:哪些|什么|几个|所有|全部)(?:的)?任务/.test(text);
      const scopeEnumeration = !route.query?.duplicate && (
        directViewEnumeration ||
        (!(route.query?.keywords?.length) && /(所有|全部|有几个|哪些任务|有哪些|有什么任务|都有)/.test(contextualQuestion))
      );
      round.searchResults = scopeEnumeration
        ? candidates
        : result.taskIds.map((id) => byId.get(id)).filter((task): task is Task => !!task);
      const needsNarrative = !!route.query?.duplicate || /(分析|总结|区别|差异|原因|建议|为什么)/.test(text);
      round.assistantMessage = needsNarrative ? result.message : '';
    } else if (route.intent === 'create' || (route.intent === 'update' && route.tasks?.length)) {
      round.mode = 'organize';
      const revisesPreviousDraft = route.intent === 'update' && !!route.tasks?.length;
      round.parsedTasks = parseTasksFromContent(JSON.stringify(route.tasks || [])).map((task, index) => ({
        ...task,
        // 独立 create 必须生成新身份，不能按数组位置继承上一轮任务；
        // 只有明确 update 草稿时才延续 clientId。
        clientId: revisesPreviousDraft
          ? task.clientId || previousDraftRound?.parsedTasks[index]?.clientId || `draft-${round.id}-${index}`
          : `draft-${round.id}-${index}`,
      }))
        .map((task) => applyComposerContexts(task, creationContexts))
        .map((task) => ({
          ...task,
          tags: inferExistingTaskTags(
            text,
            taskStore!.tags.getAll().map((tag) => tag.name),
            task.tags || [],
          ),
        }));
      if (!round.parsedTasks.length) throw new Error('AI 未返回有效任务草稿');
      // 已经写入任务库的草稿后续修改仍沿用原任务映射。
      if (previousDraftRound && revisesPreviousDraft) {
        for (const [indexText, taskId] of Object.entries(previousDraftRound.createdTaskIds || {})) {
          const previousIndex = Number(indexText);
          const previousClientId = previousDraftRound.parsedTasks[previousIndex]?.clientId;
          const index = previousClientId
            ? round.parsedTasks.findIndex((task) => task.clientId === previousClientId)
            : previousIndex;
          if (index < 0) continue;
          round.createdTaskIds[index] = taskId;
          round.adopted.add(index);
          const parsed = round.parsedTasks[index];
          if (parsed && taskStore.tasks.get(taskId)) {
            const draft = parsedToPrefill(parsed);
            await taskStore.tasks.updateTask(taskId, {
              title: draft.title, notes: draft.notes, startDate: draft.startDate,
              deadline: draft.deadline, someday: draft.someday, tags: draft.tags,
              projectId: draft.projectId, areaId: draft.areaId, headingId: draft.headingId,
              repeatRule: draft.repeatRule,
              status: draft.status,
            });
            const existingChildren = taskStore.tasks.getSubTasks(taskId);
            const retained = new Set<string>();
            for (let childIndex = 0; childIndex < draft.checklist.length; childIndex++) {
              const title = draft.checklist[childIndex];
              const existing = existingChildren.find((child) => !retained.has(child.id) && child.title === title);
              if (existing) {
                retained.add(existing.id);
                if (existing.order !== childIndex) await taskStore.tasks.updateTask(existing.id, { order: childIndex });
              } else {
                await taskStore.tasks.createTask({ title, parentId: taskId, status: 'todo', order: childIndex });
              }
            }
            for (const child of existingChildren) {
              if (!retained.has(child.id)) await taskStore.tasks.delete(child.id);
            }
          }
        }
        // 对话轮次仍保留，但旧版任务卡由本轮修订结果替代，避免同一任务重复出现。
        previousDraftRound.supersededByRoundId = round.id;
        bump(previousDraftRound);
      }
    } else if (route.intent === 'update') {
      const validIds = (route.targetIds || []).filter((id) => !!taskStore!.tasks.get(id));
      if (!validIds.length || !route.changes) throw new Error('没有确定要修改的任务，请先查询或明确任务名称');
      pendingOperation = {
        operationId: `op-${Date.now()}-${roundSeq++}`,
        type: 'update', targetIds: validIds, changes: route.changes, status: 'pending',
        baseUpdated: Object.fromEntries(validIds.map((id) => [id, taskStore!.tasks.get(id)!.updated])),
      };
      round.mode = 'action';
      round.pendingOperation = pendingOperation;
      round.assistantMessage = route.message || `准备修改 ${validIds.length} 个任务，请确认`;
    } else if (route.intent === 'delete') {
      const validIds = (route.targetIds || []).filter((id) => {
        const task = taskStore!.tasks.get(id);
        return !!task && !task.parentId;
      });
      if (!validIds.length) throw new Error('没有确定要删除的任务，请先查询或明确选择任务');
      pendingOperation = {
        operationId: `op-${Date.now()}-${roundSeq++}`,
        type: 'delete', targetIds: validIds, changes: {}, status: 'pending',
        baseUpdated: Object.fromEntries(validIds.map((id) => [id, taskStore!.tasks.get(id)!.updated])),
      };
      round.mode = 'action';
      round.pendingOperation = pendingOperation;
      const titles = validIds.map((id) => taskStore!.tasks.get(id)?.title).filter(Boolean);
      round.assistantMessage = route.message || `准备删除 ${validIds.length} 个任务：${titles.join('、')}。删除后会保留在回收记录中。`;
    } else if (route.intent === 'confirm') {
      round.mode = 'action';
      round.assistantMessage = await executePendingOperation();
    } else if (route.intent === 'cancel') {
      if (pendingOperation) pendingOperation.status = 'canceled';
      pendingOperation = null;
      round.mode = 'answer';
      round.assistantMessage = '已取消待执行的修改';
    } else {
      round.mode = 'answer';
      round.assistantMessage = route.message || (route.intent === 'clarify' ? '请再说明要操作的任务。' : '我明白了。');
      if (route.intent === 'clarify') {
        const message = round.assistantMessage;
        const asksCreateOrSearch = /(创建|新建|添加).*(搜索|查询|查找)|(搜索|查询|查找).*(创建|新建|添加)/.test(message);
        if (route.clarification === 'create_or_search' || asksCreateOrSearch) {
          round.clarification = 'create_or_search';
        }
      }
    }
    round.phase = 'done';
  } catch (error: any) {
    round.phase = 'error';
    round.errorMsg = error?.message || 'AI 处理失败，请重试';
  } finally {
    round.completedAt = Date.now();
    aiIsSending.set(false);
    bump(round);
  }
}

function composerContextToPageContext(contexts: AIComposerContext[]): AIPageContext | undefined {
  const assignment = [...contexts].reverse().find((item) =>
    item.kind === 'project' || item.kind === 'area' || item.kind === 'tag'
  );
  if (assignment?.id) {
    return { view: assignment.kind as ViewType, viewId: assignment.id };
  }
  const view = [...contexts].reverse().find((item) => item.kind === 'view');
  return view ? { view: view.value as ViewType } : undefined;
}

function localDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 拖入输入框的设定项是确定性约束，模型输出后再次本地覆盖，避免名称或日期被润色丢失。 */
function applyComposerContexts(task: ParsedTask, contexts: AIComposerContext[]): ParsedTask {
  const next: ParsedTask = { ...task, tags: [...(task.tags || [])] };
  const view = contexts.find((item) => item.kind === 'view')?.value;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (view === 'inbox') {
    next.startDate = undefined;
    next.startTime = undefined;
    next.someday = false;
    next.project = undefined;
    next.area = undefined;
    next.heading = undefined;
  } else if (view === 'today') {
    next.startDate = localDateString(today);
    next.someday = false;
  } else if (view === 'upcoming') {
    if (!next.startDate && !next.deadline) {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      next.startDate = localDateString(tomorrow);
    }
    next.someday = false;
  } else if (view === 'anytime') {
    next.startDate = undefined;
    next.startTime = undefined;
    next.someday = false;
  } else if (view === 'someday') {
    next.startDate = undefined;
    next.startTime = undefined;
    next.someday = true;
  } else if (view === 'log') {
    next.status = 'done';
  }

  const assignment = contexts.find((item) => item.kind === 'project' || item.kind === 'area');
  if (assignment?.kind === 'project') {
    next.project = assignment.value;
    next.area = undefined;
  } else if (assignment?.kind === 'area') {
    next.area = assignment.value;
    next.project = undefined;
    next.heading = undefined;
  }

  for (const tag of contexts.filter((item) => item.kind === 'tag')) {
    if (!next.tags!.some((name) => name.toLowerCase() === tag.value.toLowerCase())) next.tags!.push(tag.value);
  }
  return next;
}

type TaskStructure = 'single_task' | 'single_with_checklist' | 'multiple_tasks';

function resolveExpectedTaskStructure(text: string, aiStructure?: TaskStructure): TaskStructure | undefined {
  // These phrases are explicit cardinality constraints, not a semantic parser.
  // They only prevent a model from collapsing a clearly requested multi-task result.
  const explicitMultiple = /(?:[二两三四五六七八九十\d]+个(?:独立)?任务|多个(?:独立)?任务)/.test(text);
  return explicitMultiple ? 'multiple_tasks' : aiStructure;
}

function taskStructureMismatch(structure: TaskStructure | undefined, taskCount: number): boolean {
  if (taskCount === 0) return true;
  if (!structure) return false;
  return structure === 'multiple_tasks' ? taskCount < 2 : taskCount !== 1;
}

function taskSummary(task: Task) {
  return {
    id: task.id, title: task.title, notes: task.notes, status: task.status,
    created: task.created, updated: task.updated, startDate: task.startDate,
    deadline: task.deadline, completedDate: task.completedDate, someday: !!task.someday,
    repeatRule: task.repeatRule,
    project: task.projectId ? taskStore?.projects.get(task.projectId)?.name : undefined,
    area: task.areaId ? taskStore?.areas.get(task.areaId)?.name : undefined,
    tags: (task.tags || []).map((id) => taskStore?.tags.get(id)?.name).filter(Boolean),
  };
}

function describePageContext(context?: AIPageContext) {
  if (!taskStore || !context) return null;
  const labels: Record<string, string> = {
    inbox: '收件箱', today: '今天', upcoming: '计划', anytime: '随时', someday: '某天', log: '日志',
    projects: '项目总览', areas: '区域总览', tags: '标签总览', all: '所有任务',
  };
  let label = labels[context.view] || context.view;
  if (context.view === 'project' && context.viewId) label = `项目：${taskStore.projects.get(context.viewId)?.name || context.viewId}`;
  if (context.view === 'area' && context.viewId) label = `区域：${taskStore.areas.get(context.viewId)?.name || context.viewId}`;
  if (context.view === 'tag' && context.viewId) label = `标签：${taskStore.tags.get(context.viewId)?.name || context.viewId}`;
  return { view: context.view, viewId: context.viewId, label };
}

function resolveNamedId(kind: 'project' | 'area' | 'tag', name?: string): string | undefined {
  if (!taskStore || !name?.trim()) return undefined;
  const stores = { project: taskStore.projects, area: taskStore.areas, tag: taskStore.tags } as const;
  const values = stores[kind].getAll();
  const query = name.trim().toLowerCase();
  const exact = values.filter((item) => item.name.toLowerCase() === query);
  const matches = exact.length ? exact : values.filter((item) => item.name.toLowerCase().includes(query));
  if (matches.length > 1) throw new Error(`找到多个名称接近的${kind === 'project' ? '项目' : kind === 'area' ? '区域' : '标签'}，请说出完整名称`);
  return matches[0]?.id;
}

function resolveQueryScope(plan: any, text: string, recent: Array<{ user: string }>, inherited?: AIResolvedScope, page?: AIPageContext): AIResolvedScope {
  if (!taskStore) return { view: 'all', label: '所有任务' };
  let view = plan.view as AIResolvedScope['view'] | undefined;
  const genericFollowup = /^(?:查看)?(?:全部|所有|都有哪些|有几个|继续)(?:任务)?[?？。\s]*$/.test(text.trim());
  if (genericFollowup && inherited) return inherited;
  const mentionsUpcoming = /计划(?:列表|页|视图|下|里)?/.test(text);
  const mentionsAnytime = /随时(?:列表|页|视图|下|里)?/.test(text);
  if (mentionsUpcoming && mentionsAnytime) {
    return { view: 'all', views: ['anytime', 'upcoming'], label: '随时和计划' };
  }
  // 当前问题里的明确视图优先，不能让最近对话中的旧视图污染本轮查询。
  if (/收件箱/.test(text)) view = 'inbox';
  else if (mentionsUpcoming) view = 'upcoming';
  else if (mentionsAnytime) view = 'anytime';
  else if (/某天(?:列表|页|视图|下|里)?/.test(text)) view = 'someday';
  else if (/(?:日志|已完成)(?:列表|页|视图|下|里)?/.test(text)) view = 'log';
  else if (/今天(?:列表|页|视图|下|里)?/.test(text)) view = 'today';
  if (/(当前|这里|这个列表|本页)/.test(text) && page && page.view !== 'search') {
    view = page.view === 'projects' || page.view === 'areas' || page.view === 'tags' ? page.view : page.view as AIResolvedScope['view'];
    plan.viewId = page.viewId;
  }
  view ||= inherited?.view || 'all';
  let viewId = plan.viewId as string | undefined;
  if (view === 'project') viewId ||= resolveNamedId('project', plan.project);
  if (view === 'area') viewId ||= resolveNamedId('area', plan.area);
  if (view === 'tag') viewId ||= resolveNamedId('tag', plan.tag || plan.keywords?.[0]);
  if ((view === 'project' || view === 'area' || view === 'tag') && !viewId) {
    if (page?.view === view && page.viewId) viewId = page.viewId;
    else throw new Error(`请说明具体的${view === 'project' ? '项目' : view === 'area' ? '区域' : '标签'}名称`);
  }
  let headingId = plan.headingId as string | undefined;
  if (view === 'project' && viewId && plan.heading && !headingId) {
    const headings = taskStore.projects.get(viewId)?.headings || [];
    const matches = headings.filter((item) => item.title.toLowerCase().includes(String(plan.heading).toLowerCase()));
    if (matches.length !== 1) throw new Error(matches.length ? '找到多个同名标题分组，请说得更具体' : '没有找到该项目标题分组');
    headingId = matches[0].id;
  }
  const labels: Record<string, string> = { all: '所有任务', inbox: '收件箱', today: '今天', upcoming: '计划', anytime: '随时', someday: '某天', log: '日志', projects: '项目总览', areas: '区域总览', tags: '标签总览' };
  const entity = view === 'project' ? taskStore.projects.get(viewId!) : view === 'area' ? taskStore.areas.get(viewId!) : view === 'tag' ? taskStore.tags.get(viewId!) : undefined;
  return { view, viewId, headingId, label: entity?.name || labels[view] || view };
}

function filterTaskCandidates(plan: any, scope: AIResolvedScope): Task[] {
  if (!taskStore) return [];
  let tasks: Task[];
  if (scope.views?.length) {
    const union = new Map<string, Task>();
    for (const view of scope.views) {
      const scopedTasks = view === 'upcoming' ? taskStore.tasks.getUpcomingTasks() : taskStore.tasks.getAnytimeTasks();
      for (const task of scopedTasks) union.set(task.id, task);
    }
    tasks = [...union.values()];
  } else switch (scope.view) {
    case 'inbox': tasks = taskStore.tasks.getInboxTasks(); break;
    case 'today': tasks = taskStore.tasks.getTodayTasks(); break;
    case 'upcoming': tasks = taskStore.tasks.getUpcomingTasks(); break;
    case 'anytime': tasks = taskStore.tasks.getAnytimeTasks(); break;
    case 'someday': tasks = taskStore.tasks.getSomedayTasks(); break;
    case 'log': tasks = taskStore.tasks.getCompletedTasks(); break;
    case 'project': tasks = taskStore.tasks.getProjectTasks(scope.viewId!); break;
    case 'area': {
      const projectIds = new Set(taskStore.projects.getAreaProjects(scope.viewId!).map((item) => item.id));
      tasks = taskStore.tasks.getAll().filter((task) => task.status === 'todo' && !task.parentId && (task.areaId === scope.viewId || (!!task.projectId && projectIds.has(task.projectId))));
      break;
    }
    case 'tag': tasks = taskStore.tasks.getTagTasks(scope.viewId!); break;
    case 'projects': tasks = taskStore.tasks.getAll().filter((task) => !task.parentId && !!task.projectId); break;
    case 'areas': {
      const areaProjectIds = new Set(taskStore.projects.getAll().filter((item) => !!item.areaId).map((item) => item.id));
      tasks = taskStore.tasks.getAll().filter((task) => !task.parentId && (!!task.areaId || (!!task.projectId && areaProjectIds.has(task.projectId))));
      break;
    }
    case 'tags': tasks = taskStore.tasks.getAll().filter((task) => !task.parentId && !!task.tags?.length); break;
    default: tasks = taskStore.tasks.getAll().filter((task) => !task.parentId);
  }
  if (scope.headingId) tasks = tasks.filter((task) => task.headingId === scope.headingId);
  if (plan.status && plan.status !== 'any') tasks = tasks.filter((task) => task.status === plan.status);
  if (!scope.views?.length && plan.dateScope === 'today' && plan.status === 'done') {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(); end.setHours(23, 59, 59, 999);
    tasks = tasks.filter((task) => task.status === 'done' && !!task.completedDate && task.completedDate >= start.getTime() && task.completedDate <= end.getTime());
  } else if (!scope.views?.length && plan.dateScope === 'today') {
    const ids = new Set(taskStore.tasks.getTodayTasks().map((task) => task.id));
    tasks = tasks.filter((task) => ids.has(task.id));
  }
  if (!scope.views?.length && plan.dateScope === 'tomorrow') {
    const start = new Date(); start.setDate(start.getDate() + 1); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setHours(23, 59, 59, 999);
    tasks = tasks.filter((task) => !!task.startDate && task.startDate >= start.getTime() && task.startDate <= end.getTime());
  }
  if (!scope.views?.length && plan.dateScope === 'upcoming') tasks = tasks.filter((task) => taskStore!.tasks.getUpcomingTasks().some((item) => item.id === task.id));
  if (!scope.views?.length && plan.dateScope === 'someday') tasks = tasks.filter((task) => task.someday === true);
  if (plan.recurring) tasks = tasks.filter((task) => !!task.repeatRule);
  if (plan.project) tasks = tasks.filter((task) => task.projectId && taskStore!.projects.get(task.projectId)?.name.toLowerCase().includes(String(plan.project).toLowerCase()));
  if (plan.area) tasks = tasks.filter((task) => task.areaId && taskStore!.areas.get(task.areaId)?.name.toLowerCase().includes(String(plan.area).toLowerCase()));
  // 关键词只作为第二阶段 AI 的语义线索，不在本地做字面过滤，避免漏掉同义表达。
  return tasks.slice(0, 100);
}

async function executePendingOperation(): Promise<string> {
  if (!taskStore || !pendingOperation || pendingOperation.status !== 'pending') return '当前没有等待确认的操作';
  if (executedOperationIds.has(pendingOperation.operationId)) return '该操作已经执行过了';
  const op = pendingOperation;
  if (op.type === 'delete') {
    for (const id of op.targetIds) {
      const current = taskStore.tasks.get(id);
      if (!current) throw new Error('待删除任务已不存在，请重新查询');
      if (op.baseUpdated[id] !== current.updated) throw new Error(`任务“${current.title}”已发生变化，请重新查询后再删除`);
    }
    const count = await taskStore.tasks.trashTasks(op.targetIds);
    executedOperationIds.add(op.operationId);
    op.status = 'executed';
    pendingOperation = null;
    return `已删除 ${count} 个任务（已保留可恢复记录）`;
  }
  for (const id of op.targetIds) {
    const current = taskStore.tasks.get(id);
    if (!current) continue;
    if (op.baseUpdated[id] !== current.updated) throw new Error(`任务“${current.title}”已在其他位置发生变化，请重新查询后再修改`);
    const raw = op.changes;
    const changes: any = {};
    for (const field of ['title', 'notes', 'someday']) {
      if (field in raw) changes[field] = raw[field];
    }
    if (typeof raw.startDate === 'string') {
      changes.startDate = parseDate(raw.startDate);
      if (changes.startDate && typeof raw.startTime === 'string') {
        const [hours, minutes] = raw.startTime.split(':').map(Number);
        const value = new Date(changes.startDate); value.setHours(hours || 0, minutes || 0, 0, 0); changes.startDate = value.getTime();
      }
    }
    else if (raw.startDate === null) changes.startDate = undefined;
    if (typeof raw.deadline === 'string') {
      changes.deadline = parseDate(raw.deadline);
      if (changes.deadline && typeof raw.deadlineTime === 'string') {
        const [hours, minutes] = raw.deadlineTime.split(':').map(Number);
        const value = new Date(changes.deadline); value.setHours(hours || 0, minutes || 0, 0, 0); changes.deadline = value.getTime();
      }
    }
    else if (raw.deadline === null) changes.deadline = undefined;
    if (raw.status && ['todo', 'done', 'canceled'].includes(raw.status)) changes.status = raw.status;
    if ('repeatRule' in raw) changes.repeatRule = raw.repeatRule === null ? undefined : normalizeRepeatRule(raw.repeatRule);
    if (typeof raw.project === 'string') changes.projectId = taskStore.projects.getAll().find((p) => p.name.toLowerCase() === raw.project.toLowerCase())?.id;
    if (typeof raw.area === 'string') changes.areaId = taskStore.areas.getAll().find((a) => a.name.toLowerCase() === raw.area.toLowerCase())?.id;
    if (Array.isArray(raw.tags)) changes.tags = raw.tags.map((name: string) => taskStore!.tags.getAll().find((tag) => tag.name.toLowerCase() === String(name).toLowerCase())?.id).filter(Boolean);
    await taskStore.tasks.updateTask(id, changes);
    if (Array.isArray(raw.checklist)) {
      const existing = taskStore.tasks.getSubTasks(id);
      const retained = new Set<string>();
      for (let index = 0; index < raw.checklist.length; index++) {
        const title = String(raw.checklist[index]).trim();
        if (!title) continue;
        const match = existing.find((child) => !retained.has(child.id) && child.title === title);
        if (match) { retained.add(match.id); await taskStore.tasks.updateTask(match.id, { order: index }); }
        else await taskStore.tasks.createTask({ title, parentId: id, status: 'todo', order: index });
      }
      for (const child of existing) if (!retained.has(child.id)) await taskStore.tasks.delete(child.id);
    }
  }
  executedOperationIds.add(op.operationId);
  op.status = 'executed';
  pendingOperation = null;
  return `已完成 ${op.targetIds.length} 个任务的修改`;
}

export async function confirmAiOperation(round: ChatRound) {
  try {
    round.assistantMessage = await executePendingOperation();
    round.pendingOperation = undefined;
  } catch (error: any) {
    round.assistantMessage = error?.message || '修改失败，请重新查询后再试';
  }
  bump(round);
}

export function cancelAiOperation(round: ChatRound) {
  if (pendingOperation) pendingOperation.status = 'canceled';
  pendingOperation = null;
  round.pendingOperation = undefined;
  round.assistantMessage = '已取消待执行的修改';
  bump(round);
}

/** 旧流程保留为暂时的兼容实现，不再由界面调用。 */
async function legacySendAiMessage(text: string, config: AIConfig) {
  if (!taskStore) {
    console.error('[aiChat] taskStore is null');
    return;
  }

  if (isTaskSearchRequest(text)) {
    const round: ChatRound = {
      id: `round-${Date.now()}-${roundSeq++}`,
      userText: text,
      reasoning: "",
      content: "",
      phase: 'thinking',
      parsedTasks: [],
      adopted: new Set(),
      createdTaskIds: {},
      errorMsg: "",
      mode: 'search',
      searchResults: [],
      assistantMessage: '',
    };
    aiInputText.set("");
    aiIsSending.set(true);
    aiRounds.update((items) => [...items, round]);
    try {
      const allTasks = taskStore.tasks.getAll().filter((task) => !task.parentId);
      const summaries = allTasks.map((task) => ({
        id: task.id,
        title: task.title,
        notes: task.notes,
        status: task.status,
        created: task.created,
        updated: task.updated,
        startDate: task.startDate,
        deadline: task.deadline,
        completedDate: task.completedDate,
        someday: task.someday === true,
        repeatRule: task.repeatRule,
        project: task.projectId ? taskStore!.projects.get(task.projectId)?.name : undefined,
        area: task.areaId ? taskStore!.areas.get(task.areaId)?.name : undefined,
        tags: (task.tags || []).map((id) => taskStore!.tags.get(id)?.name).filter(Boolean),
      }));
      const result = await queryTasksWithAI(
        text,
        summaries,
        { ...config, model: get(aiSelectedModel) || config.model },
        get(aiThinkingLevel),
        {
          onReasoning: (value) => { round.reasoning = value; bump(round); },
          onContent: (value) => { round.content = value; round.phase = 'organizing'; bump(round); },
        },
      );
      const byId = new Map(allTasks.map((task) => [task.id, task]));
      round.searchResults = result.taskIds.map((id) => byId.get(id)).filter((task): task is Task => !!task);
      round.assistantMessage = result.message || (round.searchResults.length ? `找到 ${round.searchResults.length} 个匹配任务` : '没有找到匹配的任务');
      round.phase = 'done';
    } catch (error: any) {
      round.phase = 'error';
      round.errorMsg = error?.message || 'AI 查询失败，请重试';
    } finally {
      aiIsSending.set(false);
      bump(round);
    }
    return;
  }

  // 同一会话中的后续指令基于最近一次任务集继续修订，而不是脱离上下文
  // 把“改成明天”之类的话误识别为一项新任务。
  const previousResult = [...get(aiRounds)]
    .reverse()
    .find((item) => item.phase === 'done' && item.parsedTasks.length > 0);
  const catalogText = taskStore
    ? `\n\n当前可用分类（只能从中选择，未提及时返回 null）：\n项目：${taskStore.projects.getAll().map(p => `${p.name}${p.headings.length ? `（标题分组：${p.headings.map(h => h.title).join('、')}）` : ''}`).join('、') || '无'}\n区域：${taskStore.areas.getAll().map(a => a.name).join('、') || '无'}\n标签：${taskStore.tags.getAll().map(t => t.name).join('、') || '无'}`
    : '';
  const requestText = (previousResult
    ? `下面是当前已经整理出的任务列表：\n${JSON.stringify(previousResult.parsedTasks, null, 2)}\n\n用户的后续要求：${text}\n\n请根据后续要求修改当前任务列表，并返回修改后的完整 JSON 任务数组。不要把“修改日期、标题、标签、检查项”等修改指令创建成新任务；只有用户明确要求新增任务时才增加数组项。`
    : text) + catalogText;

  const round: ChatRound = {
    id: `round-${Date.now()}-${roundSeq++}`,
    userText: text,
    reasoning: "",
    content: "",
    phase: 'thinking',
    parsedTasks: [],
    adopted: new Set(),
    createdTaskIds: {},
    errorMsg: "",
    mode: 'organize',
  };

  // 先更新输入框和按钮状态，再追加消息卡片。分开到两个渲染帧，避免多个
  // 共享 store 在同一轮 Svelte flush 中互相放大响应式更新。
  aiInputText.set("");
  aiIsSending.set(true);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  aiRounds.update((r) => [...r, round]);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const configWithModel = { ...config, model: get(aiSelectedModel) || config.model };
  const level = get(aiThinkingLevel);

  // 节流：流式回调每 100ms 最多触发一次 store 更新，避免频繁重渲染卡死 UI
  let lastBumpTime = 0;
  function throttledBump() {
    const now = Date.now();
    if (now - lastBumpTime > 100) {
      lastBumpTime = now;
      bump(round);
    }
  }

  try {
    const { content } = await parseTasksWithAIStream(requestText, configWithModel, level, {
      onReasoning: (fullText) => {
        round.reasoning = fullText;
        if (round.phase === 'thinking') throttledBump();
      },
      onContent: (fullText) => {
        round.content = fullText;
        if (round.phase === 'thinking') round.phase = 'organizing';
        throttledBump();
      },
    });

    // 流结束后强制更新一次，确保最终状态写入
    bump(round);

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

    // 最近结果已经落库时，后续指令直接更新原任务，避免再次生成可重复添加的卡片。
    if (previousResult && taskStore) {
      for (const [indexText, taskId] of Object.entries(previousResult.createdTaskIds || {})) {
        const index = Number(indexText);
        const parsed = parsedTasks[index];
        if (!parsed || !taskStore.tasks.get(taskId)) continue;
        const draft = parsedToPrefill(parsed);
        await taskStore.tasks.updateTask(taskId, {
          title: draft.title,
          notes: draft.notes,
          startDate: draft.startDate,
          deadline: draft.deadline,
          someday: draft.someday,
          tags: draft.tags,
          projectId: draft.projectId,
          areaId: draft.areaId,
          headingId: draft.headingId,
          repeatRule: draft.repeatRule,
        });

        const oldChildren = taskStore.tasks.getSubTasks(taskId);
        for (const child of oldChildren) await taskStore.tasks.delete(child.id);
        for (let childIndex = 0; childIndex < draft.checklist.length; childIndex++) {
          await taskStore.tasks.createTask({
            title: draft.checklist[childIndex],
            parentId: taskId,
            status: 'todo',
            order: childIndex,
          });
        }
        round.adopted.add(index);
        round.createdTaskIds[index] = taskId;
      }
    }
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

function isTaskSearchRequest(text: string): boolean {
  return /(在哪里|在哪儿|查找|搜索|找一下|找出|找到|查询|有哪些任务|哪些任务|有几个任务|所有任务|全部任务|已完成的?任务|已添加的?任务|完成了什么)/.test(text);
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

  let deadline = parseDate(parsed.deadline || '');
  if (deadline && parsed.deadlineTime) {
    const [h, m] = parsed.deadlineTime.split(':').map(Number);
    const d = new Date(deadline);
    d.setHours(h, m, 0, 0);
    deadline = d.getTime();
  }

  const tagIds: string[] = [];
  const unresolved: string[] = [];
  let projectId: string | undefined;
  let areaId: string | undefined;
  let headingId: string | undefined;
  if (taskStore && parsed.tags && parsed.tags.length > 0) {
    const allTags = taskStore.tags.getAll();
    for (const tagName of parsed.tags) {
      const canonicalName = findExistingTagName(tagName, allTags.map((tag) => tag.name));
      const matched = canonicalName ? allTags.find((tag) => tag.name === canonicalName) : undefined;
      if (matched) tagIds.push(matched.id);
      else unresolved.push(`标签“${tagName}”`);
    }
  }
  if (taskStore && parsed.project) {
    projectId = taskStore.projects.getAll().find(p => p.name.toLowerCase() === parsed.project!.toLowerCase())?.id;
    if (!projectId) unresolved.push(`项目“${parsed.project}”`);
  }
  if (taskStore && parsed.area) {
    areaId = taskStore.areas.getAll().find(a => a.name.toLowerCase() === parsed.area!.toLowerCase())?.id;
    if (!areaId) unresolved.push(`区域“${parsed.area}”`);
  }
  if (taskStore && projectId && parsed.heading) {
    headingId = taskStore.projects.get(projectId)?.headings.find(
      h => h.title.toLowerCase() === parsed.heading!.toLowerCase()
    )?.id;
    if (!headingId) unresolved.push(`标题分组“${parsed.heading}”`);
  } else if (parsed.heading) {
    unresolved.push(`标题分组“${parsed.heading}”（需同时指定项目）`);
  }

  return {
    title: parsed.title || '',
    notes: parsed.notes || '',
    checklist: parsed.checklist || [],
    startDate: startDate || undefined,
    deadline: deadline || undefined,
    someday: parsed.someday === true,
    tags: tagIds,
    projectId,
    areaId,
    headingId,
    status: parsed.status,
    repeatRule: normalizeRepeatRule(parsed.repeatRule),
    unresolved,
  };
}
