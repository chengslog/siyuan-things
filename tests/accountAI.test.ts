import test from 'node:test';
import assert from 'node:assert/strict';
import { accountModels, accountStatus, completeAccountChat, configureAccountAI, loginAccount, validDeviceLogin } from '../src/services/accountAI.ts';

test('only the official device authorization URL and a bounded code are accepted', () => {
  assert.equal(validDeviceLogin({ verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-1234' }), true);
  for (const verificationUrl of ['https://example.com', 'http://auth.openai.com/codex/device', 'https://auth.openai.com/codex/device?token=x']) {
    assert.equal(validDeviceLogin({ verificationUrl, userCode: 'ABCD-1234' }), false);
  }
  assert.equal(validDeviceLogin(null), false);
  assert.equal(validDeviceLogin({ verificationUrl: 'https://auth.openai.com/codex/device', userCode: '<script>' }), false);
});

test('browser account actions use the authenticated same-origin service without desktop access or API credentials', async t => {
  configureAccountAI('browser-desktop');
  const requests: Array<{ url: unknown; init: RequestInit }> = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
    requests.push({ url, init });
    return Response.json({ loggedIn: true });
  });
  assert.deepEqual(await accountStatus('chatgpt'), { loggedIn: true });
  assert.equal(requests[0].url, '/investment-ai/v1/status');
  assert.equal(requests[0].init.credentials, 'same-origin');
  assert.equal(requests[0].init.redirect, 'error');
  assert.equal((requests[0].init.headers as Record<string, string>).Authorization, undefined);
  await assert.rejects(accountStatus('codex'), /Windows/);
  assert.equal(requests.length, 1);
});

test('account models and reasoning efforts are validated before rendering', async t => {
  configureAccountAI('browser-desktop');
  t.mock.method(globalThis, 'fetch', async () => Response.json({ models: [
    { id: 'model-a', label: 'Model A', efforts: ['low', 'high', '<invalid>'] },
    { id: 'model-a', efforts: [] }, { id: 'bad id' }, null,
  ] }));
  assert.deepEqual(await accountModels(), [{ id: 'model-a', label: 'Model A', efforts: ['low', 'high'], defaultEffort: '', isDefault: false }]);
});

test('malformed login responses never expose an arbitrary authorization link', async t => {
  configureAccountAI('browser-desktop');
  t.mock.method(globalThis, 'fetch', async () => Response.json({ verificationUrl: 'https://example.com/private', userCode: 'ABCD-1234' }));
  await assert.rejects(loginAccount(), /有效|官方/);
});

test('task prompts, model and effort reach account chat without an API key', async t => {
  configureAccountAI('browser-desktop');
  const messages = [{ role: 'system', content: 'Return JSON only.' }, { role: 'user', content: 'Create a task.' }];
  let body: any, content = '';
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    body = JSON.parse(init.body as string);
    return Response.json({ content: '{"intent":"create","tasks":[]}' });
  });
  const result = await completeAccountChat({ mode: 'chatgpt', model: 'model-a', reasoningEffort: 'high', messages, onContent: text => { content = text; } });
  assert.deepEqual(body, { messages, model: 'model-a', reasoningEffort: 'high', webSearch: 'off' });
  assert.equal(content, result);
});

test('cancellation is propagated and proxy response bodies are not surfaced as errors', async t => {
  configureAccountAI('browser-desktop');
  const controller = new AbortController(); controller.abort();
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return new Response('private proxy token', { status: 403 });
  });
  await assert.rejects(accountStatus('chatgpt', controller.signal), { name: 'AbortError' });
  await assert.rejects(accountStatus('chatgpt'), error => !String(error).includes('private proxy token'));
});
