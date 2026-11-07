import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAIEndpoint, readAISettings, saveAISettings } from '../src/utils/aiSettings.ts';

test('legacy API and SiYuan configurations retain their provider, endpoint, key and model', () => {
  const values = { aiMode: 'custom', aiApiEndpoint: 'http://localhost:8080/v1/chat/completions', aiApiKey: 'old-key', aiModel: 'old-model' };
  assert.deepEqual(readAISettings({ get: key => values[key] }), {
    mode: 'custom', endpoint: values.aiApiEndpoint, apiKey: 'old-key', model: 'old-model',
  });
  assert.equal(readAISettings().mode, 'siyuan');
});

test('account providers cannot inherit an API key or the previous API model', () => {
  for (const mode of ['chatgpt', 'codex']) {
    const values = { aiMode: mode, aiApiKey: 'private-key', aiModel: 'wrong-api-model', aiAccountModel: 'account-model', aiReasoningEffort: 'high' };
    const actual = readAISettings({ get: key => values[key] });
    assert.equal(actual.apiKey, ''); assert.equal(actual.endpoint, '');
    assert.equal(actual.model, mode === 'chatgpt' ? 'account-model' : '');
    assert.equal(actual.reasoningEffort, mode === 'chatgpt' ? 'high' : '');
  }
});

test('API address normalization supports base URLs and rejects credentials and query strings', () => {
  assert.equal(normalizeAIEndpoint('https://example.com/v1/'), 'https://example.com/v1/chat/completions');
  assert.equal(normalizeAIEndpoint('http://localhost:8080/v1/chat/completions'), 'http://localhost:8080/v1/chat/completions');
  for (const endpoint of ['file:///private', 'https://user:secret@example.com/v1', 'https://example.com/v1?key=secret', 'https://example.com/#fragment']) assert.throws(() => normalizeAIEndpoint(endpoint));
});

test('switching providers saves the configuration together and restores memory on failure', async () => {
  const values = { aiMode: 'custom', aiAccountModel: 'old-model' };
  const store = { get: key => values[key], set: (key, value) => { values[key] = value; }, async save() { throw Error('storage unavailable'); } };
  await assert.rejects(saveAISettings(store, { aiMode: 'chatgpt', aiAccountModel: 'new-model' }), /storage unavailable/);
  assert.deepEqual(values, { aiMode: 'custom', aiAccountModel: 'old-model' });
});
