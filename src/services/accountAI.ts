import { accountBridge, localCodexBridge } from './vendor/accountBridge.ts';

export type AccountMode = 'chatgpt' | 'codex';
export interface AccountModel { id: string; label: string; efforts: string[]; defaultEffort?: string; isDefault?: boolean; }
export interface AccountStatus { loggedIn: boolean; loginFailed?: boolean; plan?: string; }
export interface DeviceLogin { verificationUrl: string; userCode: string; }
export interface AccountChatOptions {
  mode: AccountMode; model?: string; reasoningEffort?: string;
  messages: Array<{ role: string; content: string }>; signal?: AbortSignal;
  onContent?: (content: string) => void;
}

let frontend = '';
const activeChats = new Set<AbortController>();
export function configureAccountAI(value: string) { frontend = value; accountBridge.configure(value); }
export function closeAccountAI() {
  for (const controller of activeChats) controller.abort();
  activeChats.clear();
  accountBridge.close();
}
export function desktopAccountsAvailable() { return ['desktop', 'desktop-window'].includes(frontend); }

export function validDeviceLogin(value: unknown): value is DeviceLogin {
  const data = value as DeviceLogin;
  return data?.verificationUrl === 'https://auth.openai.com/codex/device'
    && typeof data.userCode === 'string' && /^[A-Za-z0-9-]{4,32}$/.test(data.userCode);
}

export async function accountStatus(mode: AccountMode, signal?: AbortSignal): Promise<AccountStatus> {
  if (mode === 'codex') {
    if (!desktopAccountsAvailable()) throw new Error('Codex 本机登录需要 Windows 思源桌面客户端。');
    await localCodexBridge.checkAvailability({ signal });
    return { loggedIn: true };
  }
  return accountBridge.call({}, 'status', {}, { signal });
}

export async function loginAccount(signal?: AbortSignal): Promise<DeviceLogin> {
  const data = await accountBridge.call({}, 'login', {}, { signal });
  if (!validDeviceLogin(data)) throw new Error('授权服务未返回有效的官方设备授权链接。');
  return data;
}

export async function logoutAccount(signal?: AbortSignal): Promise<void> {
  await accountBridge.call({}, 'logout', {}, { signal });
}

export async function accountModels(signal?: AbortSignal): Promise<AccountModel[]> {
  const result = await accountBridge.call({}, 'models', {}, { signal });
  if (!Array.isArray(result.models)) throw new Error('授权服务返回的模型列表无效。');
  const ids = new Set<string>();
  return result.models.flatMap((row: any) => {
    if (typeof row?.id !== 'string' || !row.id || row.id.length > 200 || /[\x00-\x20\x7f]/.test(row.id) || ids.has(row.id)) return [];
    ids.add(row.id);
    return [{ id: row.id, label: String(row.label || row.id).slice(0, 200),
      efforts: Array.isArray(row.efforts) ? row.efforts.filter((effort: unknown) => typeof effort === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(effort)) : [],
      defaultEffort: typeof row.defaultEffort === 'string' ? row.defaultEffort : '', isDefault: row.isDefault === true }];
  });
}

export async function completeAccountChat(options: AccountChatOptions): Promise<string> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  activeChats.add(controller);
  try {
    if (options.mode === 'codex') {
      if (!desktopAccountsAvailable()) throw new Error('Codex 本机登录需要 Windows 思源桌面客户端。');
      return await localCodexBridge.chat({ messages: options.messages, webSearch: 'off', signal: controller.signal, onDelta: options.onContent });
    }
    return await accountBridge.chat({
      config: { model: options.model || '', reasoningEffort: options.reasoningEffort || '', webSearch: 'off' },
      messages: options.messages, signal: controller.signal, onDelta: options.onContent,
    });
  } finally {
    activeChats.delete(controller);
    options.signal?.removeEventListener('abort', abort);
  }
}
