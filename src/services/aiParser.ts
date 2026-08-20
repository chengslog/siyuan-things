/**
 * AI 任务解析服务
 * 流式调用 AI API（SSE），解析推理过程（reasoning_content）与任务结果
 */

import type { ParsedTask } from '@/types';

export interface AIConfig {
  mode: 'siyuan' | 'custom';
  endpoint: string;
  apiKey: string;
  model: string;
}

// 思考强度档位：temperature + max_tokens + 提示词指令的组合
export interface ThinkingLevel {
  value: number;
  label: string;
  desc: string;
  temperature: number;
  maxTokens: number;
  instruction: string;
}

export const THINKING_LEVELS: ThinkingLevel[] = [
  {
    value: 0.3,
    label: '简洁',
    desc: '快速响应，适合简单任务',
    temperature: 0.3,
    maxTokens: 1024,
    instruction: '简要分析，快速给出结果',
  },
  {
    value: 0.7,
    label: '平衡',
    desc: '默认强度，兼顾速度和质量',
    temperature: 0.7,
    maxTokens: 2048,
    instruction: '',
  },
  {
    value: 1.0,
    label: '深入',
    desc: '详细分析，适合复杂任务',
    temperature: 1.0,
    maxTokens: 4096,
    instruction: '深入思考，充分考虑任务细节与关联',
  },
];

// 流式回调
export interface StreamCallbacks {
  onReasoning: (text: string) => void;  // 推理内容增量（全文累计）
  onContent: (text: string) => void;    // 回答内容增量（全文累计）
}

export interface AITaskQueryResult {
  message: string;
  taskIds: string[];
}

export interface AIQueryPlan {
  view?: 'all' | 'inbox' | 'today' | 'upcoming' | 'anytime' | 'someday' | 'log' | 'projects' | 'areas' | 'tags' | 'project' | 'area' | 'tag';
  viewId?: string;
  heading?: string;
  headingId?: string;
  status?: 'todo' | 'done' | 'canceled' | 'any';
  dateScope?: 'today' | 'tomorrow' | 'upcoming' | 'someday' | 'any';
  keywords?: string[];
  project?: string;
  area?: string;
  tag?: string;
  duplicate?: boolean;
  recurring?: boolean;
}

export interface AIRouteResult {
  intent: 'create' | 'search' | 'update' | 'delete' | 'confirm' | 'cancel' | 'clarify' | 'answer';
  structure?: 'single_task' | 'single_with_checklist' | 'multiple_tasks';
  message?: string;
  tasks?: any[];
  query?: AIQueryPlan;
  targetIds?: string[];
  changes?: Record<string, any>;
}

/**
 * 从思源全局配置获取 AI 配置
 */
function getSiYuanAIConfig(): { endpoint: string; apiKey: string; model: string } | null {
  try {
    const siyuanConfig = (window as any).siyuan?.config;
    if (!siyuanConfig?.ai) {
      return null;
    }

    const aiConfig = siyuanConfig.ai;
    const provider = aiConfig.providers?.[0];

    if (!provider || !provider.apiKey || !provider.baseURL) {
      return null;
    }

    // baseURL 可能是 https://api.openai.com/v1，需要拼接 /chat/completions
    let endpoint = provider.baseURL;
    if (!endpoint.endsWith('/chat/completions') && !endpoint.endsWith('/completions')) {
      endpoint = endpoint.replace(/\/$/, '') + '/chat/completions';
    }

    const model = provider.models?.find((m: any) => m.enabled)?.name || 'gpt-4o-mini';

    return {
      endpoint: endpoint,
      apiKey: provider.apiKey,
      model: model
    };
  } catch (error) {
    console.error('[AI Parser] Failed to get SiYuan AI config:', error);
    return null;
  }
}

/**
 * 构建系统提示词（动态注入当天日期）
 */
function buildSystemPrompt(level: ThinkingLevel): string {
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const base = `你是一个任务解析助手。用户会输入一段文本，你需要：
1. 判断是否需要拆分为多个独立任务
2. 对每个任务提取以下信息并以 JSON 数组返回：

[
  {
    "title": "任务标题",
    "notes": "任务备注或空字符串",
    "checklist": ["检查项1", "检查项2"],
    "startDate": "YYYY-MM-DD 或 null",
    "startTime": "HH:mm 或 null",
    "deadline": "YYYY-MM-DD 或 null",
    "deadlineTime": "HH:mm 或 null",
    "someday": false,
    "repeatRule": "daily | weekdays | weekly | monthly | yearly 或 null",
    "project": "已有项目名称或 null",
    "area": "已有区域名称或 null",
    "heading": "已有项目内标题分组名称或 null",
    "tags": ["标签1", "标签2"]
  }
]

规则：
- 标题：提取核心任务，简洁明了（≤20字）
- 检查项：识别步骤、待办事项，每条≤30字
- 日期：识别时间表达，转换为 YYYY-MM-DD 格式（今天是 ${dateStr}）
- 提醒时间：识别具体时刻，转换为 HH:mm 格式
- “今晚”必须同时返回今天的 startDate 和 startTime；未给出具体钟点时，startTime 使用 18:00
- 备注：不适合作为标题或检查项、但对执行有帮助的补充信息
- 某天：用户明确表示“以后、将来、某天、暂不安排”且没有具体日期时设为 true
- 重复：识别每天、工作日、每周、每月、每年，分别返回 daily、weekdays、weekly、monthly、yearly；未提及返回 null
- 项目/区域/标题分组：仅在用户明确提及名称时填写，不要凭空编造
- 截止时间：用户给出截止日期的具体时刻时写入 deadlineTime
- 标签：识别 #标签 或推断分类
- 如果某字段无法识别，返回 null 或空数组
- 当用户消息中包含“当前已经整理出的任务列表”时，这是同一会话的后续修订：必须在现有任务上修改并返回修改后的完整任务数组；不要把修改指令本身创建成任务
- 只有用户明确要求新增任务时，才在现有任务数组中增加新任务
- 只返回 JSON，不要其他文字`;

  return level.instruction ? `${base}\n\n附加要求：${level.instruction}。` : base;
}

/**
 * 调用 AI 解析任务（流式）
 * @returns 推理内容 + 回答内容
 */
export async function parseTasksWithAIStream(
  text: string,
  config: AIConfig,
  thinkingLevel: ThinkingLevel,
  callbacks: StreamCallbacks
): Promise<{ reasoning: string; content: string }> {
  // 根据模式选择配置源
  let actualConfig: { endpoint: string; apiKey: string; model: string };

  if (config.mode === 'siyuan') {
    const siyuanConfig = getSiYuanAIConfig();
    if (!siyuanConfig) {
      throw new Error('未找到思源 AI 配置，请在思源设置中配置 AI 服务');
    }
    actualConfig = siyuanConfig;
  } else {
    actualConfig = {
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      model: config.model
    };
  }

  if (!actualConfig.apiKey) {
    throw new Error('未配置 AI API Key');
  }
  if (!actualConfig.endpoint) {
    throw new Error('未配置 AI API 端点');
  }

  const payload: any = {
    model: actualConfig.model || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: buildSystemPrompt(thinkingLevel) },
      { role: 'user', content: text }
    ],
    temperature: thinkingLevel.temperature,
    max_tokens: thinkingLevel.maxTokens,
    stream: true,
  };

  // DeepSeek reasoning 系列支持 reasoning_effort 参数
  const modelName = (actualConfig.model || '').toLowerCase();
  if (modelName.includes('reasoner') || modelName.includes('deepseek-r') || modelName.includes('v4')) {
    const effort = thinkingLevel.value <= 0.3 ? 'low' : thinkingLevel.value >= 1.0 ? 'high' : 'medium';
    payload.reasoning_effort = effort;
  }

  console.log('[AI Parser] Streaming request to:', actualConfig.endpoint, 'model:', actualConfig.model);

  return streamChat(actualConfig, payload, callbacks);
}

/** 让 AI 根据本地任务摘要理解查询语义，只返回匹配 ID，不允许改写任务。 */
export async function queryTasksWithAI(
  question: string,
  taskSummaries: unknown[],
  config: AIConfig,
  thinkingLevel: ThinkingLevel,
  callbacks: StreamCallbacks,
): Promise<AITaskQueryResult> {
  const actualConfig = config.mode === 'siyuan' ? getSiYuanAIConfig() : {
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    model: config.model,
  };
  if (!actualConfig?.apiKey) throw new Error('未配置 AI API Key');
  if (!actualConfig.endpoint) throw new Error('未配置 AI API 端点');

  const now = new Date();
  const nowText = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const system = `你是任务查询助手。当前时间是 ${nowText}。
根据用户问题，从提供的任务摘要中进行语义搜索、日期判断、状态筛选和归纳。
只能引用列表中真实存在的任务 ID，不得虚构任务，不得修改任务。
返回严格 JSON：{"message":"给用户的简洁回答","taskIds":["匹配任务ID"]}。
“今天的任务”包括开始日期不晚于今天且仍未完成的任务，以及截止日期为今天的未完成任务。
“已完成”按 status=done 判断。结果按相关性排序，最多返回 20 个。`;
  const payload: any = {
    model: actualConfig.model || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'system', content: '如果用户查询重复任务，请根据标题语义、备注、日期、项目、区域和检查项识别真正重复的组。message 应按组说明重复原因、差异和建议保留项；taskIds 只返回重复组中的任务。' },
      { role: 'user', content: `用户问题：${question}\n\n任务摘要：\n${JSON.stringify(taskSummaries)}` },
    ],
    temperature: Math.min(thinkingLevel.temperature, 0.4),
    max_tokens: Math.min(thinkingLevel.maxTokens, 2048),
    stream: true,
  };
  const { content } = await streamChat(actualConfig, payload, callbacks);
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const parsed = JSON.parse((fenced ? fenced[1] : content).trim());
  return {
    message: String(parsed?.message || '').trim(),
    taskIds: Array.isArray(parsed?.taskIds) ? parsed.taskIds.map(String) : [],
  };
}

/** 第一阶段：只判断意图并生成执行计划；查询阶段不接触完整任务库。 */
export async function routeAiMessage(
  text: string,
  sessionContext: unknown,
  config: AIConfig,
  thinkingLevel: ThinkingLevel,
  callbacks: StreamCallbacks,
): Promise<AIRouteResult> {
  const actualConfig = config.mode === 'siyuan' ? getSiYuanAIConfig() : {
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    model: config.model,
  };
  if (!actualConfig?.apiKey) throw new Error('未配置 AI API Key');
  if (!actualConfig.endpoint) throw new Error('未配置 AI API 端点');
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const system = `你是 Things 任务助手的意图路由器。今天是 ${date}。
根据用户消息和会话上下文，只返回严格 JSON，不要附加文字。
intent 只能是 create/search/update/confirm/cancel/clarify/answer。
- create：用户要新建任务；同时返回完整 tasks 数组，字段与任务解析格式一致。
- search：用户要查询、回顾、寻找或总结已有任务；返回 query：status(todo/done/canceled/any)、dateScope(today/tomorrow/upcoming/someday/any)、keywords、project、area。
- update：用户要修改已有草稿或真实任务；targetIds 必须取自上下文给出的稳定 ID，changes 只包含明确要求修改的字段。若修改当前草稿，也可以在 tasks 返回修改后的完整草稿列表，并保留 clientId。
- 用户要修改的真实任务尚未出现在上下文时，先返回 search 查询计划定位任务，不得猜测 ID。
- confirm/cancel：仅用于确认或取消上下文中的 pendingOperation。
- clarify：目标或要求不明确，需要追问；message 给出问题。
- answer：无需操作即可根据上下文回答。
不得把查询当创建，不得虚构上下文中不存在的任务 ID。“它、这个、第二个”等必须结合 focusedTasks、lastSearchResults、drafts 解析；不唯一时返回 clarify。
任务字段：clientId,title,notes,checklist,startDate,startTime,deadline,deadlineTime,someday,repeatRule,project,area,heading,tags。repeatRule 只能是 daily/weekdays/weekly/monthly/yearly/null。`;
  const payload = {
    model: actualConfig.model || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'system', content: 'Intent 还支持 delete。用户明确要删除真实任务时返回 {"intent":"delete","targetIds":["ID"],"message":"删除预览说明"}。targetIds 只能取自 lastSearchResults 或 focusedTasks；目标不明确时先 search 或 clarify，不得猜 ID。删除只生成待确认计划，不得声称已执行。查询重复内容的任务组时设置 query.duplicate=true；查询设置了重复规则的任务时设置 query.recurring=true。创建或修改重复规则使用 repeatRule=daily/weekdays/weekly/monthly/yearly/null。confirm/cancel 同时适用于修改和删除操作。' },
      { role: 'system', content: '视图名是精确产品术语：“计划”或“计划列表”必须映射为 search query.dateScope="upcoming"，不是所有待办；“今天”映射 today；“某天”映射 someday。对“全部”、“都有哪些”等追问，必须从 recentConversation 继承上一轮已明确的视图和筛选范围，不得重置为 any。' },
      { role: 'system', content: '查询计划必须优先返回结构化 query.view：all/inbox/today/upcoming/anytime/someday/log/projects/areas/tags/project/area/tag。产品术语映射：收件箱=inbox，今天=today，计划=upcoming，随时=anytime，某天=someday，日志或已完成=log。指定项目/区域/标签时返回 view=project/area/tag 并在 project/area/keywords 中给出名称；项目标题分组另返回 heading。用户说“当前、这里、这个列表”时使用 currentViewContext；说“全部”时继承 lastQueryScope，只移除关键词等内容限制，不得移除视图作用域。dateScope 只表示额外日期条件，不再用它表示侧边栏视图。' },
      { role: 'system', content: '创建任务时必须根据用户完整语义判断任务结构，并返回 structure：single_task（一个独立任务）、single_with_checklist（一个目标及其步骤/准备事项）、multiple_tasks（多个可独立完成和分别管理的结果）。不要仅凭“拆分、步骤、清单”等关键词决定数量：一个目标的准备事项或执行步骤应放入同一 task.checklist；多个独立目标应生成多个 tasks；多个目标分别要求步骤时，应生成多个 tasks，并在各自 checklist 中写步骤。用户明确指定任务数量、说“分别/各自/每个任务”时必须遵守。例如“明天上午 9 点开产品评审会，帮我拆分准备事项”是 single_with_checklist；“创建产品发布和季度复盘两个任务，分别拆分步骤”是 multiple_tasks。若无法判断事项是独立任务还是检查项，返回 clarify 追问，不得猜测。不得凭空增加日期、责任人、项目归属或用户未表达的具体要求。' },
      { role: 'user', content: `会话上下文：${JSON.stringify(sessionContext)}\n\n用户消息：${text}` },
    ],
    temperature: Math.min(thinkingLevel.temperature, 0.4),
    max_tokens: thinkingLevel.maxTokens,
    stream: true,
  };
  const { content } = await streamChat(actualConfig, payload, callbacks);
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const parsed = JSON.parse((fenced ? fenced[1] : content).trim());
  return {
    intent: parsed.intent,
    structure: ['single_task', 'single_with_checklist', 'multiple_tasks'].includes(parsed.structure)
      ? parsed.structure
      : undefined,
    message: parsed.message,
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks : undefined,
    query: parsed.query,
    targetIds: Array.isArray(parsed.targetIds) ? parsed.targetIds.map(String) : undefined,
    changes: parsed.changes,
  };
}

/**
 * SSE 流式调用。原生 fetch 是异步网络 API，不经过思源 forwardProxy。
 */
async function streamChat(
  config: { endpoint: string; apiKey: string; model: string },
  payload: any,
  callbacks: StreamCallbacks
): Promise<{ reasoning: string; content: string }> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 60000);
  let response: Response;
  try {
    response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('AI 请求超时（60秒），请检查网络连接或 API 配置');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI 服务调用失败: ${response.status} ${errorText.slice(0, 200)}`);
  }
  if (!response.body) {
    throw new Error('响应无 body，无法流式读取');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let reasoning = '';
  let content = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;
        if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
          reasoning += delta.reasoning_content;
          callbacks.onReasoning(reasoning);
        }
        if (typeof delta.content === 'string' && delta.content) {
          content += delta.content;
          callbacks.onContent(content);
        }
      } catch {
        // 忽略单行格式错误，继续读取后续 SSE 数据。
      }
    }
  }

  return { reasoning, content };
}

/**
 * 解析 AI 响应为 ParsedTask 数组
 */
export function parseTasksFromContent(content: string): ParsedTask[] {
  // 尝试提取 JSON（AI 可能返回 markdown 代码块）
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) ||
    content.match(/(\[[\s\S]*\])/);

  const jsonStr = jsonMatch ? jsonMatch[1] : content;

  try {
    const parsed = JSON.parse(jsonStr);

    if (Array.isArray(parsed)) {
      return parsed.map(normalizeParsedTask);
    }

    if (parsed && typeof parsed === 'object') {
      return [normalizeParsedTask(parsed)];
    }

    throw new Error('Invalid AI response format');
  } catch (error) {
    console.error('[AI Parser] Failed to parse JSON:', error, content.slice(0, 500));
    throw new Error('AI 返回格式错误');
  }
}

/**
 * 规范化 ParsedTask 对象
 */
function normalizeParsedTask(task: any): ParsedTask {
  return {
    clientId: String(task.clientId || '').trim() || undefined,
    title: String(task.title || '').trim(),
    notes: String(task.notes || '').trim() || undefined,
    checklist: Array.isArray(task.checklist)
      ? task.checklist.map((item: any) => String(item || '').trim()).filter(Boolean)
      : [],
    startDate: task.startDate || undefined,
    startTime: task.startTime || undefined,
    deadline: task.deadline || undefined,
    deadlineTime: task.deadlineTime || undefined,
    someday: task.someday === true,
    project: String(task.project || '').trim() || undefined,
    area: String(task.area || '').trim() || undefined,
    heading: String(task.heading || '').trim() || undefined,
    tags: Array.isArray(task.tags)
      ? task.tags.map((tag: any) => String(tag || '').trim()).filter(Boolean)
      : []
  };
}
