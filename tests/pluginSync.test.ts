import assert from 'node:assert/strict';
import test from 'node:test';
import { hasThingsSyncIgnore, readSyncIgnore, removeThingsSyncIgnore, setThingsSyncIgnored } from '../src/utils/pluginSync.ts';

test('removing Things package exclusions preserves all other rules, negations and line endings', () => {
  const content = '# plugins/siyuan-things/**/*\r\nassets/*.pdf\r\n/plugins/siyuan-things/\r\nplugins/siyuan-things/**/*\r\n!plugins/siyuan-things/icon.png\r\nplugins/other/**/*\r\nplugins/siyuan-things/draft.js';
  assert.equal(hasThingsSyncIgnore(content), true);
  const updated = removeThingsSyncIgnore(content);
  assert.equal(updated, '# plugins/siyuan-things/**/*\r\nassets/*.pdf\r\n!plugins/siyuan-things/icon.png\r\nplugins/other/**/*\r\nplugins/siyuan-things/draft.js');
  assert.equal(hasThingsSyncIgnore(updated), false);
});

test('API errors and unreadable rules never result in a write', async () => {
  for (const response of [new Response('{"code":403}', { status: 202 }), new Response('{"code":-1}'), new Response('', { status: 500 })]) {
    let calls = 0;
    const request = (async () => { calls++; return response; }) as typeof fetch;
    await assert.rejects(setThingsSyncIgnored(false, request), /读取|读取失败/);
    assert.equal(calls, 1);
  }
  assert.equal(await readSyncIgnore((async () => new Response('{"code":404}', { status: 202 })) as typeof fetch), '');
});

test('a concurrent change to shared sync rules prevents overwriting them', async () => {
  let reads = 0;
  const request = (async (url) => {
    assert.equal(url, '/api/file/getFile');
    return new Response(++reads === 1 ? 'plugins/siyuan-things/**/*\n' : 'assets/*.pdf\n');
  }) as typeof fetch;
  await assert.rejects(setThingsSyncIgnored(false, request), /其他操作修改/);
});

test('writes only syncignore and verifies the saved content before success', async () => {
  let content = 'assets/*.pdf\nplugins/siyuan-things/**/*\n';
  let writes = 0;
  const request = (async (url, init) => {
    if (url === '/api/file/getFile') return new Response(content);
    assert.equal(url, '/api/file/putFile');
    const form = init!.body as FormData;
    assert.equal(form.get('path'), '/data/.siyuan/syncignore');
    content = await (form.get('file') as Blob).text();
    writes++;
    return Response.json({ code: 0 });
  }) as typeof fetch;
  await setThingsSyncIgnored(false, request);
  assert.equal(content, 'assets/*.pdf\n');
  await setThingsSyncIgnored(true, request);
  assert.equal(content, 'assets/*.pdf\nplugins/siyuan-things/**/*\n');
  assert.equal(writes, 2);
});
