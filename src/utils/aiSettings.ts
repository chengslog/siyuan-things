import type { AIConfig } from '../services/aiParser';

export interface AISettingsStore {
  get(key: string): any;
  set(key: string, value: any): void;
  save(): Promise<any>;
}

export const API_PRESETS = {
  siyuan: { label: '复用思源设置', endpoint: '', model: '' },
  deepseek: { label: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  openai: { label: 'OpenAI · GPT', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  qwen: { label: '通义千问', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  custom: { label: '自定义兼容 API', endpoint: '', model: '' },
};
export type APIProvider = keyof typeof API_PRESETS;

export function normalizeAIEndpoint(value: string): string {
  const input = value.trim();
  const url = new URL(input);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('请输入有效的 HTTP 或 HTTPS API 地址。');
  if (url.search) throw new Error('API 地址不能包含查询参数，请在 API Key 栏填写密钥。');
  return /\/chat\/completions\/?$/.test(input) ? input.replace(/\/$/, '') : input.replace(/\/$/, '') + '/chat/completions';
}

export function readAISettings(settings?: Pick<AISettingsStore, 'get'>): AIConfig {
  const mode = settings?.get('aiMode') || 'siyuan';
  if (mode === 'chatgpt' || mode === 'codex') return {
    mode, endpoint: '', apiKey: '', model: mode === 'chatgpt' ? settings?.get('aiAccountModel') || '' : '',
    reasoningEffort: mode === 'chatgpt' ? settings?.get('aiReasoningEffort') || '' : '',
  };
  return {
    mode: mode === 'custom' ? 'custom' : 'siyuan',
    endpoint: settings?.get('aiApiEndpoint') || 'https://api.openai.com/v1/chat/completions',
    apiKey: settings?.get('aiApiKey') || '', model: settings?.get('aiModel') || 'gpt-4o-mini',
  };
}

// One configuration write switches the active provider and its fields together.
const pendingSaves = new WeakMap<AISettingsStore, Promise<unknown>>();
export async function saveAISettings(settings: AISettingsStore, values: Record<string, unknown>) {
  const captured = { ...values };
  const operation = (pendingSaves.get(settings) || Promise.resolve()).catch(() => {}).then(async () => {
    const previous = Object.fromEntries(Object.keys(captured).map(key => [key, settings.get(key)]));
    try {
      for (const [key, value] of Object.entries(captured)) settings.set(key, value);
      await settings.save();
    } catch (error) {
      for (const [key, value] of Object.entries(previous)) settings.set(key, value);
      throw error;
    }
  });
  pendingSaves.set(settings, operation);
  try { await operation; }
  finally { if (pendingSaves.get(settings) === operation) pendingSaves.delete(settings); }
}
