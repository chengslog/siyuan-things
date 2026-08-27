import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSiYuanAIConfig } from '../src/utils/aiConfig.ts';

const provider = (
  id: string,
  modelId: string,
  modelName: string,
  apiKey: string,
  enabled = true,
) => ({
  id,
  enabled,
  baseURL: `https://${id}.example.com/v1/`,
  apiKey,
  protocol: 'openai',
  models: [{ id: modelId, name: modelName, enabled: true }],
});

test('uses the enabled provider that owns the preferred model', () => {
  const config = resolveSiYuanAIConfig(
    {
      providers: [
        provider('first', 'model-a', 'model-a', ''),
        provider('second', 'model-b-id', 'model-b', 'second-key'),
      ],
      agent: { modelId: 'model-a' },
    },
    'model-b-id',
  );

  assert.deepEqual(config, {
    endpoint: 'https://second.example.com/v1/chat/completions',
    apiKey: 'second-key',
    model: 'model-b',
    providerId: 'second',
    protocol: 'openai',
  });
});

test('uses the SiYuan agent model instead of assuming providers[0]', () => {
  const config = resolveSiYuanAIConfig({
    providers: [
      provider('disabled', 'model-a', 'model-a', '', false),
      provider('active', 'model-b-id', 'model-b', 'active-key'),
    ],
    agent: { modelId: 'model-b-id' },
  });

  assert.equal(config?.providerId, 'active');
  assert.equal(config?.apiKey, 'active-key');
  assert.equal(config?.model, 'model-b');
});

test('returns the selected provider even when its key is empty for precise validation', () => {
  const config = resolveSiYuanAIConfig({
    providers: [provider('active', 'model-id', 'model-name', '')],
    agent: { modelId: 'model-id' },
  });

  assert.equal(config?.providerId, 'active');
  assert.equal(config?.apiKey, '');
});
