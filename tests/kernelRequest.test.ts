import test from 'node:test';
import assert from 'node:assert/strict';
import { createKernelRequest } from '../src/storage/kernelRequest.ts';

test('closed database response reaches Things without a prior host toast', async () => {
  let toasts = 0;
  let calls = 0;
  const request = createKernelRequest(async (_path, _body, _headers, process = true) => {
    calls++;
    if (process) toasts++;
    return { code: 1, msg: 'sql: database is closed' };
  });
  await assert.rejects(request('/api/query/sql', { mode: 'readonly' }), /sql: database is closed/);
  assert.equal(toasts, 0);
  assert.equal(calls, 1, 'never replay a request during shutdown');
});

test('kernel wrapper preserves failures and successful data, including writes', async () => {
  const body = { avID: 'test', values: [] };
  const request = createKernelRequest(async (path, supplied, headers, process) => {
    assert.equal(path, '/api/av/batchSetAttributeViewBlockAttrs');
    assert.equal(supplied, body);
    assert.equal(headers, undefined);
    assert.equal(process, false);
    return { code: -1, msg: 'permission denied' };
  });
  await assert.rejects(request('/api/av/batchSetAttributeViewBlockAttrs', body), /permission denied/);
  await assert.rejects(createKernelRequest(async () => null)('/missing', {}), /请求失败/);
  await assert.rejects(createKernelRequest(async () => { throw new Error('offline'); })('/read', {}), /offline/);
  assert.deepEqual(await createKernelRequest(async () => ({ code: 0, data: { ok: true } }))('/read', {}), { ok: true });
});
