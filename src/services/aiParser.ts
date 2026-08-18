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

    const model = provider.models?.find((m: any) => m.enabled)?.name || 'gpt-4o-mini';

    return {
      endpoint: provider.baseURL,
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
    "checklist": ["检查项1", "检查项2"],
    "startDate": "YYYY-MM-DD 或 null",
    "startTime": "HH:mm 或 null",
    "deadline": "YYYY-MM-DD 或 null",
    "tags": ["标签1", "标签2"],
    "priority": "none|low|medium|high"
  }
]

规则：
- 标题：提取核心任务，简洁明了（≤20字）
- 检查项：识别步骤、待办事项，每条≤30字
- 日期：识别时间表达，转换为 YYYY-MM-DD 格式（今天是 ${dateStr}）
- 提醒时间：识别具体时刻，转换为 HH:mm 格式
- 标签：识别 #标签 或推断分类
- 优先级：识别紧急程度词汇（紧急/重要=high，一般=medium，不急=low）
- 如果某字段无法识别，返回 null 或空数组
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

  try {
    return await streamChat(actualConfig, payload, callbacks);
  } catch (streamError) {
    console.warn('[AI Parser] Stream failed, falling back to non-stream:', streamError);
    return await nonStreamChat(actualConfig, payload, callbacks);
  }
}

/**
 * SSE 流式调用
 */
async function streamChat(
  config: { endpoint: string; apiKey: string; model: string },
  payload: any,
  callbacks: StreamCallbacks
): Promise<{ reasoning: string; content: string }> {
  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

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

        // DeepSeek 推理模型的思考内容
        if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
          reasoning += delta.reasoning_content;
          callbacks.onReasoning(reasoning);
        }
        // 正常回答内容
        if (typeof delta.content === 'string' && delta.content) {
          content += delta.content;
          callbacks.onContent(content);
        }
      } catch (e) {
        // 忽略无法解析的行
      }
    }
  }

  return { reasoning, content };
}

/**
 * 非流式 fallback
 */
async function nonStreamChat(
  config: { endpoint: string; apiKey: string; model: string },
  payload: any,
  callbacks: StreamCallbacks
): Promise<{ reasoning: string; content: string }> {
  const nonStreamPayload = { ...payload, stream: false };

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(nonStreamPayload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI 服务调用失败: ${response.status} ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  const message = data?.choices?.[0]?.message;
  const reasoning = message?.reasoning_content || message?.reasoning || '';
  const content = message?.content || '';

  if (reasoning) callbacks.onReasoning(reasoning);
  if (content) callbacks.onContent(content);

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
    title: String(task.title || '').trim(),
    checklist: Array.isArray(task.checklist)
      ? task.checklist.map((item: any) => String(item || '').trim()).filter(Boolean)
      : [],
    startDate: task.startDate || undefined,
    startTime: task.startTime || undefined,
    deadline: task.deadline || undefined,
    tags: Array.isArray(task.tags)
      ? task.tags.map((tag: any) => String(tag || '').trim()).filter(Boolean)
      : [],
    priority: validatePriority(task.priority)
  };
}

/**
 * 验证优先级值
 */
function validatePriority(priority: any): 'none' | 'low' | 'medium' | 'high' {
  const valid = ['none', 'low', 'medium', 'high'];
  return valid.includes(priority) ? priority : 'none';
}
