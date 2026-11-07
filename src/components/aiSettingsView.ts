import {
  accountModels, accountStatus, desktopAccountsAvailable, loginAccount, logoutAccount,
  type AccountMode, type AccountModel, type DeviceLogin,
} from '../services/accountAI';
import { getSiYuanAIConfig } from '../services/aiParser';
import { API_PRESETS, normalizeAIEndpoint, saveAISettings, type AISettingsStore, type APIProvider } from '../utils/aiSettings';
import { setRefreshButton } from '../utils/settingsRefreshButton';

const effortLabels: Record<string, string> = { none: '关闭', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高', ultra: '超高' };

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}
function section(title: string) {
  const panel = element('section', 'things-settings__section things-settings__connection-panel');
  panel.appendChild(element('div', 'things-settings__category-title', title));
  return panel;
}
function selectField(title: string, options: Array<[string, string]>, value: string) {
  const label = element('label', 'things-settings__connection-field', title);
  const input = element('select', 'b3-select');
  for (const [key, text] of options) input.add(new Option(text, key));
  input.value = value;
  label.appendChild(input);
  return { label, input };
}
function inputField(title: string, value: string, type = 'text') {
  const label = element('label', 'things-settings__connection-field', title);
  const input = element('input', 'b3-text-field');
  input.type = type;
  input.value = value;
  input.autocomplete = 'off';
  input.spellcheck = false;
  label.appendChild(input);
  return { label, input };
}
function button(title: string, action: () => Promise<void> | void, primary = false) {
  const node = element('button', 'things-settings__action-button' + (primary ? ' things-settings__action-button--primary' : ''), title);
  node.type = 'button';
  node.addEventListener('click', () => void action());
  return node;
}

export function createAISettingsView(options: {
  settings: AISettingsStore; changed: () => void; close: () => void; openURL: (url: string) => void;
}) {
  const { settings } = options;
  let disposed = false, generation = 0, polling: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const authPanel = section('账号授权'), apiPanel = section('API 设置');
  const authActions = element('div', 'things-settings__footer-actions');
  const apiActions = element('div', 'things-settings__footer-actions');
  const accountOperations = element('div', 'things-settings__inline-actions');
  const apiOperations = element('div', 'things-settings__inline-actions');
  const method = selectField('授权方式', [['chatgpt', 'ChatGPT 账号授权'], ['codex', 'Codex 本机登录']],
    settings.get('aiMode') === 'codex' ? 'codex' : settings.get('aiAccountProvider') || 'chatgpt');
  const card = element('div', 'things-settings__account-card');
  const accountCopy = element('div');
  const accountName = element('strong');
  const accountDescription = element('p');
  const accountBadge = element('span', 'things-settings__account-badge', '尚未检查');
  const accountHeading = element('div', 'things-settings__account-heading');
  accountHeading.append(accountName, accountBadge);
  accountCopy.append(accountHeading, accountDescription);
  card.append(accountCopy, accountOperations);
  const deviceFields = element('div', 'things-settings__device-fields');
  deviceFields.hidden = true;
  const model = selectField('模型', [['', '登录后选择模型']], settings.get('aiAccountModel') || '');
  const effort = selectField('思考强度', [['', '模型默认']], '');
  const modelRow = element('div', 'things-settings__connection-row');
  modelRow.append(model.label, effort.label);
  const authHint = element('p', 'things-settings__section-desc');
  const authNotice = element('p', 'things-settings__connection-notice');
  authNotice.setAttribute('role', 'status');
  authPanel.append(method.label, card, deviceFields, modelRow, authHint, authNotice);
  let models: AccountModel[] = [], loggedIn = false, login: DeviceLogin | undefined;
  let selectedModel = settings.get('aiAccountModel') || '';
  let selectedEffort = settings.get('aiReasoningEffort') || '';

  function stop() {
    generation++;
    clearTimeout(polling);
    controller?.abort();
    controller = undefined;
  }
  function updateEfforts() {
    const selected = models.find(item => item.id === model.input.value);
    effort.input.replaceChildren(new Option('模型默认', ''));
    for (const item of selected?.efforts || []) effort.input.add(new Option(effortLabels[item] || item, item));
    effort.input.value = selected?.efforts.includes(selectedEffort) ? selectedEffort : '';
    effort.input.disabled = !selected;
  }
  function updateModels() {
    model.input.replaceChildren(new Option(loggedIn ? '沿用账号默认模型' : '登录后选择模型', ''));
    for (const item of models) model.input.add(new Option(item.label + (item.isDefault ? ' · 推荐' : ''), item.id));
    if (selectedModel && !models.some(item => item.id === selectedModel)) {
      model.input.add(new Option(selectedModel + ' · 待验证', selectedModel));
    }
    model.input.value = selectedModel;
    model.input.disabled = !loggedIn;
    updateEfforts();
  }
  model.input.addEventListener('change', () => {
    selectedModel = model.input.value; selectedEffort = ''; updateEfforts();
    authNotice.textContent = '修改尚未保存，点击底部“保存”后生效。';
  });
  effort.input.addEventListener('change', () => {
    selectedEffort = effort.input.value;
    authNotice.textContent = '修改尚未保存，点击底部“保存”后生效。';
  });

  const authButtons: HTMLButtonElement[] = [];
  function authBusy(busy: boolean) {
    method.input.disabled = busy;
    authButtons.forEach(item => { item.disabled = busy; });
    setRefreshButton(checkButton, method.input.value === 'codex' ? '检查连接' : '刷新状态', busy);
  }
  async function runAuth(work: (signal: AbortSignal, current: () => boolean) => Promise<void>) {
    stop();
    const revision = generation;
    controller = new AbortController();
    const current = () => !disposed && generation === revision;
    authBusy(true);
    authNotice.textContent = '正在连接…';
    try { await work(controller.signal, current); }
    catch (error) { if (current()) authNotice.textContent = (error as Error).message; }
    finally { if (current()) authBusy(false); }
  }
  async function refresh(signal: AbortSignal, current: () => boolean) {
    const mode = method.input.value as AccountMode;
    const status = await accountStatus(mode, signal);
    if (!current()) return;
    loggedIn = status.loggedIn;
    accountBadge.textContent = loggedIn ? '已登录' : status.loginFailed ? '授权未完成' : '未登录';
    if (loggedIn) {
      login = undefined;
      deviceFields.hidden = true;
      if (mode === 'chatgpt') {
        const receivedModels = await accountModels(signal);
        if (!current()) return;
        models = receivedModels;
      }
      authNotice.textContent = '连接正常。点击“保存”后，Things 将使用此账号。';
    } else authNotice.textContent = mode === 'chatgpt' ? '请登录 ChatGPT，或刷新已有授权。' : '请先在官方 Codex 中使用 ChatGPT 登录。';
    updateModels();
    updateLoginButton();
  }
  function showDevice(data: DeviceLogin) {
    deviceFields.replaceChildren(element('p', 'things-settings__section-desc', '在官方页面输入设备码完成授权，然后回到这里。'));
    for (const [title, value] of [['设备码', data.userCode], ['授权链接', data.verificationUrl]]) {
      const field = inputField(title, value);
      field.input.readOnly = true;
      const copy = button('复制', async () => {
        try {
          field.input.focus(); field.input.select();
          if (!document.execCommand('copy')) await navigator.clipboard.writeText(value);
          authNotice.textContent = title + '已复制。';
        } catch { authNotice.textContent = '请手动复制已选中的' + title + '。'; }
      });
      const row = element('div', 'things-settings__device-copy');
      field.input.remove(); row.append(field.input, copy); field.label.append(row);
      deviceFields.appendChild(field.label);
    }
    deviceFields.hidden = false;
  }
  function pollLogin(signal: AbortSignal, current: () => boolean, expires = Date.now() + 10 * 60_000) {
    polling = setTimeout(async () => {
      if (!current()) return;
      if (Date.now() > expires) { authNotice.textContent = '本次授权等待已结束，请重新登录。'; login = undefined; updateLoginButton(); return; }
      try {
        const status = await accountStatus('chatgpt', signal);
        if (!current()) return;
        if (status.loggedIn) { await refresh(signal, current); return; }
        if (status.loginFailed) { authNotice.textContent = '授权未完成，请重新登录。'; login = undefined; updateLoginButton(); return; }
        pollLogin(signal, current, expires);
      } catch (error) { if (current()) authNotice.textContent = (error as Error).message; }
    }, 2500);
  }
  function updateLoginButton() {
    loginButton.hidden = method.input.value !== 'chatgpt';
    loginButton.textContent = login ? '打开授权页面' : loggedIn ? '退出登录' : '登录 ChatGPT';
  }
  const loginButton = button('登录 ChatGPT', async () => {
    if (login) { options.openURL(login.verificationUrl); return; }
    await runAuth(async (signal, current) => {
      if (loggedIn) {
        await logoutAccount(signal);
        if (!current()) return;
        loggedIn = false; models = []; accountBadge.textContent = '未登录';
        updateModels(); updateLoginButton(); authNotice.textContent = '已退出当前授权服务的 ChatGPT 登录。';
      } else {
        const data = await loginAccount(signal);
        if (!current()) return;
        login = data; showDevice(data); updateLoginButton(); accountBadge.textContent = '等待授权';
        authNotice.textContent = '正在等待授权完成…';
        options.openURL(data.verificationUrl);
        pollLogin(signal, current);
      }
    });
  });
  const checkButton = button('刷新状态', () => runAuth(refresh));
  setRefreshButton(checkButton, '刷新状态');
  const authSave = button('保存', () => runAuth(async (signal, current) => {
    await refresh(signal, current);
    if (!current()) return;
    if (!loggedIn) throw new Error('请先完成登录并确认连接正常。');
    const mode = method.input.value as AccountMode;
    if (mode === 'chatgpt' && selectedModel && !models.some(item => item.id === selectedModel)) throw new Error('请选择当前账号可用的模型。');
    await saveAISettings(settings, { aiMode: mode, aiAccountProvider: mode,
      ...(mode === 'chatgpt' ? { aiAccountModel: selectedModel, aiReasoningEffort: effort.input.value } : {}) });
    options.changed();
    if (current()) authNotice.textContent = '已保存并启用' + (mode === 'codex' ? ' Codex 本机登录。' : ' ChatGPT 账号授权。');
  }), true);
  const authCancel = button('取消', options.close);
  authButtons.push(loginButton, checkButton, authSave);
  accountOperations.append(checkButton, loginButton);
  authActions.append(authCancel, authSave);
  function changeMethod() {
    stop(); loggedIn = false; login = undefined; models = []; deviceFields.hidden = true;
    const codex = method.input.value === 'codex';
    accountName.textContent = codex ? '本机 Codex' : 'ChatGPT';
    accountDescription.textContent = codex ? '复用已有的 ChatGPT 登录，无需 API Key' : '使用账号授权，无需 API Key';
    accountBadge.textContent = '尚未检查';
    modelRow.hidden = codex;
    authHint.textContent = codex
      ? (desktopAccountsAvailable() ? '沿用本机 Codex 的模型配置。点击“检查连接”确认登录状态。' : '请在 Windows 思源桌面客户端使用本机 Codex。')
      : (desktopAccountsAvailable() ? '使用官方 Codex 登录组件完成设备授权。授权凭据保留在本机。' : '使用当前思源同域的账号授权服务，无需重复填写地址。');
    authNotice.textContent = '';
    setRefreshButton(checkButton, codex ? '检查连接' : '刷新状态');
    updateModels(); updateLoginButton(); authBusy(false);
    if (codex && !desktopAccountsAvailable()) { checkButton.disabled = true; authSave.disabled = true; }
  }
  method.input.addEventListener('change', changeMethod);
  changeMethod();

  const storedMode = settings.get('aiMode');
  const previousProvider = settings.get('aiProvider');
  const storedProvider = storedMode === 'siyuan' ? 'siyuan' : Object.prototype.hasOwnProperty.call(API_PRESETS, previousProvider) ? previousProvider : 'custom';
  const provider = selectField('服务商', Object.entries(API_PRESETS).map(([key, item]) => [key, item.label]), storedProvider);
  const endpoint = inputField('API 地址', settings.get('aiApiEndpoint') || 'https://api.openai.com/v1/chat/completions', 'url');
  const apiModel = inputField('模型名称', settings.get('aiModel') || '');
  const key = inputField('API Key', settings.get('aiApiKey') || '', 'password');
  endpoint.input.placeholder = 'https://…/v1'; apiModel.input.placeholder = '服务商提供的模型名称'; key.input.placeholder = '粘贴 API Key';
  const apiFields = element('div', 'things-settings__connection-fields');
  apiFields.append(endpoint.label, apiModel.label, key.label);
  const apiHint = element('p', 'things-settings__section-desc');
  const apiNotice = element('p', 'things-settings__connection-notice');
  apiNotice.setAttribute('role', 'status');
  apiFields.addEventListener('input', () => { apiNotice.textContent = '修改尚未保存，点击底部“保存”后生效。'; });
  const providerRow = element('div', 'things-settings__field-action-row');
  providerRow.append(provider.label, apiOperations);
  apiPanel.append(providerRow, apiFields, apiHint, apiNotice);
  const drafts = new Map<string, { endpoint: string; model: string; key: string }>();
  let currentProvider = provider.input.value;
  function changeAPIProvider() {
    const current = provider.input.value as APIProvider;
    const preset = API_PRESETS[current];
    if (!preset) return;
    apiFields.hidden = current === 'siyuan';
    apiHint.textContent = current === 'siyuan' ? '使用思源已配置并启用的 AI 服务和模型，无需在这里重复填写。'
      : '兼容 OpenAI 的 API。地址可填写 /v1，也可填写完整的 /chat/completions 地址。';
    apiNotice.textContent = '';
  }
  provider.input.addEventListener('change', () => {
    drafts.set(currentProvider, { endpoint: endpoint.input.value, model: apiModel.input.value, key: key.input.value });
    currentProvider = provider.input.value;
    const saved = drafts.get(currentProvider);
    const preset = API_PRESETS[currentProvider as APIProvider];
    endpoint.input.value = saved?.endpoint ?? preset.endpoint;
    apiModel.input.value = saved?.model ?? preset.model;
    key.input.value = saved?.key ?? '';
    changeAPIProvider();
  });
  changeAPIProvider();
  function apiValues() {
    if (provider.input.value === 'siyuan') return { aiMode: 'siyuan', aiProvider: 'siyuan' };
    if (!apiModel.input.value.trim()) throw new Error('请填写模型名称。');
    if (!key.input.value.trim()) throw new Error('请填写 API Key。');
    return { aiMode: 'custom', aiProvider: provider.input.value,
      aiApiEndpoint: normalizeAIEndpoint(endpoint.input.value), aiModel: apiModel.input.value.trim(), aiApiKey: key.input.value.trim() };
  }
  let apiBusy = false;
  let apiController: AbortController | undefined;
  const apiTest = button('测试连接', async () => {
    if (apiBusy) return;
    apiBusy = true; apiTest.disabled = true; apiSave.disabled = true; provider.input.disabled = true;
    apiNotice.textContent = '正在测试连接…';
    apiController = new AbortController();
    const timer = setTimeout(() => apiController?.abort(), 30_000);
    try {
      const config = apiValues();
      const resolved = config.aiMode === 'siyuan' ? await getSiYuanAIConfig() : { endpoint: config.aiApiEndpoint, model: config.aiModel, apiKey: config.aiApiKey };
      if (!resolved?.endpoint || !resolved.apiKey || !resolved.model) throw new Error('请先在思源中配置并启用 AI 服务和模型。');
      const response = await fetch(resolved.endpoint, { method: 'POST', signal: apiController.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resolved.apiKey}` },
        body: JSON.stringify({ model: resolved.model, messages: [{ role: 'user', content: '仅回复 OK。' }], stream: false }) });
      if (!response.ok) throw new Error(`连接失败（HTTP ${response.status}），请检查地址、模型和密钥。`);
      const data = await response.json();
      if (!data.choices?.[0]?.message) throw new Error('服务没有返回兼容的对话响应，请检查 API 地址。');
      if (!disposed) apiNotice.textContent = '连接正常。';
    } catch (error) { if (!disposed) apiNotice.textContent = (error as Error).name === 'AbortError' ? '测试已停止或连接超时。' : (error as Error).message; }
    finally {
      clearTimeout(timer); apiBusy = false;
      if (!disposed) { apiTest.disabled = false; apiSave.disabled = false; provider.input.disabled = false; }
    }
  });
  const apiSave = button('保存', async () => {
    if (apiBusy) return;
    apiBusy = true; apiSave.disabled = true; apiTest.disabled = true; provider.input.disabled = true;
    try {
      await saveAISettings(settings, apiValues());
      options.changed();
      if (!disposed) apiNotice.textContent = '已保存并启用当前 API 设置。';
    } catch (error) { if (!disposed) apiNotice.textContent = (error as Error).message; }
    finally { apiBusy = false; if (!disposed) { apiSave.disabled = false; apiTest.disabled = false; provider.input.disabled = false; } }
  }, true);
  apiOperations.append(apiTest);
  apiActions.append(button('取消', options.close), apiSave);

  return {
    authPanel, apiPanel, authActions, apiActions,
    dispose() { disposed = true; stop(); apiController?.abort(); key.input.value = ''; drafts.clear(); },
  };
}
