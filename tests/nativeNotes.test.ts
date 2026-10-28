import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeNotes, NativeNotesUnsupportedError, NotesConflictError } from '../src/storage/nativeNotes.ts';
import { memoryCodec, memoryNativeDocuments, nextId, nodeId, splitRoots } from './helpers/nativeNotesMemory.ts';

const owner = 'test-owner', record = 'tasks:test';
async function setup(source = 'First\n\nSecond') {
  const memory = memoryNativeDocuments(), id = nextId();
  memory.documents.set(id, source);
  memory.attrs.set(id, { 'custom-things-owner': owner, 'custom-things-record': record });
  const notes = new NativeNotes(memory.request, () => memoryCodec);
  await notes.initialize(id, source, owner, record);
  return { ...memory, notes, id, source };
}
const ids = (dom: string) => [...dom.matchAll(/data-node-id="([^"]+)"/g)].map(match => match[1]);

test('original Markdown is an exact formatting alias while its native baseline is unchanged', async () => {
  const source = '中文 &quot;  \r\n\r\n- alpha\r\n- beta\r\n\r\n```js\r\nx()\r\n```\r\n\r\n![image](assets/demo.png) [link](https://example.com?a=1&b=2)\r\n  ';
  const env = await setup(source);
  assert.equal((await env.notes.read(env.id)).text, source);
  assert.equal((await new NativeNotes(env.request, () => memoryCodec).read(env.id)).text, source);
  assert.ok(env.attrs.get(env.id)!['custom-things-notes-v1'].startsWith('b64:'));
  await env.request('/api/attr/setBlockAttrs', { id: env.id, attrs: { 'custom-unrelated': 'native attribute' } });
  assert.equal((await env.notes.read(env.id)).text, source);
});

test('native content changes invalidate the original alias and return real Markdown', async () => {
  const env = await setup('Original  \n');
  env.documents.set(env.id, 'Native changed\n\n- native item');
  assert.equal((await env.notes.read(env.id)).text, 'Native changed\n\n- native item');
  await assert.rejects(env.notes.write(env.id, 'Stale rewrite', env.source, owner, record), NotesConflictError);
  assert.equal(env.documents.get(env.id), 'Native changed\n\n- native item');
});

test('editing paragraphs, list insertion, code and asset links preserves all previous block IDs', async () => {
  const source = 'First\n\n- alpha\n- beta\n\n```js\nx()\n```\n\n![image](assets/demo.png) [link](https://example.com)';
  const env = await setup(source), previous = ids(env.sync(env.id));
  const desired = source.replace('First', 'First changed').replace('- beta', '- inserted\n- beta').replace('x()', 'y()') + '\n\nNew paragraph  \n';
  await env.notes.write(env.id, desired, source, owner, record);
  assert.equal((await env.notes.read(env.id)).text, desired);
  const current = ids(env.sync(env.id));
  assert.ok(previous.every(id => current.includes(id)));
  assert.equal(new Set(current).size, current.length);
});

test('moving unchanged blocks retains their identities and their custom native attributes', async () => {
  const env = await setup('First\n\nSecond\n\nThird');
  const before = splitRoots(env.sync(env.id));
  env.doms.set(env.id, before.map((dom, index) => index === 1 ? dom.replace('data-type=', 'custom-native="kept" data-type=') : dom).join(''));
  await env.notes.write(env.id, 'Third\n\nSecond changed\n\nFirst', env.source, owner, record);
  const after = splitRoots(env.sync(env.id));
  assert.deepEqual(after.map(nodeId), [nodeId(before[2]), nodeId(before[1]), nodeId(before[0])]);
  assert.ok(after[1].includes('custom-native="kept"'));
});

test('a one-for-one paragraph to heading conversion preserves the original block reference', async () => {
  const env = await setup('First\n\nSecond');
  const before = splitRoots(env.sync(env.id)).map(nodeId);
  await env.notes.write(env.id, '# First\n\nSecond', env.source, owner, record);
  const after = splitRoots(env.sync(env.id));
  assert.deepEqual(after.map(nodeId), before);
  assert.ok(after[0].includes('NodeHeading'));
  await env.notes.verifyCanonical(env.id, '# First\n\nSecond');
  await assert.rejects(env.notes.verifyCanonical(env.id, 'First\n\nSecond'), NotesConflictError);
});

test('unknown native containers and inline styles are rejected before modifying content', async () => {
  for (const unknown of ['container', 'inline-style']) {
    const env = await setup();
    const dom = env.sync(env.id);
    env.doms.set(env.id, unknown === 'container' ? dom.replace('NodeParagraph', 'NodeTabs') : dom.replace('contenteditable="true"', 'contenteditable="true" style="color:red"'));
    const before = env.doms.get(env.id), attrs = env.attrs.get(env.id);
    const actual = (await env.notes.read(env.id)).text;
    await assert.rejects(env.notes.write(env.id, 'Changed\n\nSecond', actual, owner, record), NativeNotesUnsupportedError);
    assert.equal(env.doms.get(env.id), before);
    assert.deepEqual(env.attrs.get(env.id), attrs);
  }
});

test('lost responses after any committed block operation resume without duplicate inserts', async () => {
  for (const failedAt of [1, 2, 3]) {
    const env = await setup(), desired = 'First changed\n\nSecond changed\n\nNew paragraph';
    let count = 0;
    const interrupted = new NativeNotes(async (path, body) => {
      const result = await env.request(path, body);
      if (path === '/api/transactions' && ++count === failedAt) throw new Error('Lost response');
      return result;
    }, () => memoryCodec);
    await assert.rejects(interrupted.write(env.id, desired, env.source, owner, record), /Lost response/);
    await assert.rejects(env.notes.read(env.id), /尚未完成/);
    assert.equal((await env.notes.read(env.id, true)).pending, true);
    await new NativeNotes(env.request, () => memoryCodec).write(env.id, desired, env.source, owner, record);
    assert.equal((await env.notes.read(env.id)).text, desired);
    assert.equal(splitRoots(env.sync(env.id)).length, 3);
  }
});

test('external changes after an interrupted prefix preserve content and the pending recovery record', async () => {
  const env = await setup(), desired = 'First changed\n\nSecond changed';
  let count = 0;
  const interrupted = new NativeNotes(async (path, body) => {
    if (path === '/api/transactions' && ++count === 2) throw new Error('Before write');
    return env.request(path, body);
  }, () => memoryCodec);
  await assert.rejects(interrupted.write(env.id, desired, env.source, owner, record), /Before write/);
  env.documents.set(env.id, 'External changed during recovery\n\nSecond');
  const pending = env.attrs.get(env.id)!['custom-things-notes-v1'];
  await assert.rejects(env.notes.write(env.id, desired, env.source, owner, record), NotesConflictError);
  assert.equal(env.documents.get(env.id), 'External changed during recovery\n\nSecond');
  assert.equal(env.attrs.get(env.id)!['custom-things-notes-v1'], pending);
});

test('native inline annotations added after interruption cannot be erased during recovery', async () => {
  const env = await setup(), desired = 'First changed\n\nSecond changed';
  const interrupted = new NativeNotes(async (path, body) => {
    const result = await env.request(path, body);
    if (path === '/api/transactions') throw new Error('Lost response');
    return result;
  }, () => memoryCodec);
  await assert.rejects(interrupted.write(env.id, desired, env.source, owner, record), /Lost response/);
  const roots = splitRoots(env.sync(env.id));
  roots[1] = roots[1].replace('contenteditable="true"', 'contenteditable="true" custom-review-note="native annotation"');
  env.doms.set(env.id, roots.join(''));
  const before = env.doms.get(env.id);
  await assert.rejects(env.notes.write(env.id, desired, env.source, owner, record), NotesConflictError);
  assert.equal(env.doms.get(env.id), before);
});

test('an unrelated wanted note cannot replace a persisted write intent', async () => {
  const env = await setup();
  const interrupted = new NativeNotes(async (path, body) => {
    if (path === '/api/transactions') throw new Error('Before write');
    return env.request(path, body);
  }, () => memoryCodec);
  await assert.rejects(interrupted.write(env.id, 'Wanted', env.source, owner, record), /Before write/);
  await assert.rejects(env.notes.write(env.id, 'Different wanted', env.source, owner, record), NotesConflictError);
  assert.equal(env.documents.get(env.id), env.source);
});

test('a lost final metadata response is recognized as already complete on retry', async () => {
  const env = await setup(); let writes = 0;
  const interrupted = new NativeNotes(async (path, body) => {
    const result = await env.request(path, body);
    if (path === '/api/attr/setBlockAttrs' && ++writes === 2) throw new Error('Lost final response');
    return result;
  }, () => memoryCodec);
  await assert.rejects(interrupted.write(env.id, 'Done  \n', env.source, owner, record), /Lost final/);
  await env.notes.write(env.id, 'Done  \n', env.source, owner, record);
  assert.equal((await env.notes.read(env.id)).text, 'Done  \n');
  assert.equal((await env.notes.read(env.id)).pending, false);
});

test('an external edit between intent persistence and the first operation is not overwritten', async () => {
  const env = await setup(); let transactions = 0;
  const concurrent = new NativeNotes(async (path, body) => {
    const result = await env.request(path, body);
    if (path === '/api/attr/setBlockAttrs') env.documents.set(env.id, 'Native changed before transaction');
    if (path === '/api/transactions') transactions++;
    return result;
  }, () => memoryCodec);
  await assert.rejects(concurrent.write(env.id, 'Wanted', env.source, owner, record), NotesConflictError);
  assert.equal(transactions, 0);
  assert.equal(env.documents.get(env.id), 'Native changed before transaction');
});

test('initialization cannot claim different existing content or the wrong document owner', async () => {
  const env = await setup();
  await assert.rejects(env.notes.initialize(env.id, 'Unrelated content', owner, record), NotesConflictError);
  await assert.rejects(env.notes.write(env.id, 'Wanted', env.source, 'other-owner', record), /不属于/);
  assert.equal(env.documents.get(env.id), env.source);
});

test('missing host Markdown runtime and malformed native responses fail explicitly', async () => {
  const env = await setup();
  const old = (globalThis as any).Lute;
  delete (globalThis as any).Lute;
  await assert.rejects(new NativeNotes(env.request).read(env.id), /引擎尚未就绪/);
  (globalThis as any).Lute = old;
  await assert.rejects(new NativeNotes(async () => ({}), () => memoryCodec).read(env.id), /读取失败/);
});

test('semantic block attributes change with the draft rather than being hidden by its formatting alias', async () => {
  const id = nextId(), blockId = nextId();
  let dom = `<div data-node-id="${blockId}" data-type="NodeMathBlock" data-content="x+1"></div>`;
  const attrs: Record<string, string> = { 'custom-things-owner': owner, 'custom-things-record': record };
  let operations = 0;
  const codec = {
    Md2BlockDOM(markdown: string) { return `<div data-node-id="${nextId()}" data-type="NodeMathBlock" data-content="${markdown.slice(3, -3)}"></div>`; },
    BlockDOM2StdMd(value: string) { return `$$\n${value.match(/data-content="([^"]*)"/)?.[1] || ''}\n$$\n`; },
  };
  const notes = new NativeNotes(async (path, body: any) => {
    if (path === '/api/attr/getBlockAttrs') return { ...attrs };
    if (path === '/api/attr/setBlockAttrs') { Object.assign(attrs, body.attrs); return; }
    if (path === '/api/block/getBlockDOM') return { dom };
    if (path === '/api/transactions') { operations++; dom = body.transactions[0].doOperations[0].data; return; }
    if (path === '/api/sqlite/flushTransaction') return;
    throw new Error(path);
  }, () => codec);
  await notes.initialize(id, '$$\nx+1\n$$', owner, record);
  await notes.write(id, '$$\nx+2\n$$', '$$\nx+1\n$$', owner, record);
  assert.equal(operations, 1);
  assert.ok(dom.includes('data-content="x+2"'));
  assert.ok(dom.includes(blockId));
  assert.equal((await notes.read(id)).text, '$$\nx+2\n$$');
});

test('tampered recovery operations cannot delete or move outside the current document or steal an existing ID', async () => {
  for (const mutation of ['external-delete', 'external-parent', 'external-descendant']) {
    const env = await setup(), desired = 'First changed\n\nSecond changed';
    const interrupted = new NativeNotes(async (path, body) => {
      if (path === '/api/transactions') throw new Error('Before write');
      return env.request(path, body);
    }, () => memoryCodec);
    await assert.rejects(interrupted.write(env.id, desired, env.source, owner, record), /Before write/);
    const external = nextId(); env.documents.set(external, 'External document');
    const externalBlock = nodeId(splitRoots(env.sync(external))[0]);
    const encoded = env.attrs.get(env.id)!['custom-things-notes-v1'];
    const state = JSON.parse(Buffer.from(encoded.slice(4), 'base64').toString('utf8'));
    const originalOperation = state.intent.operations[0];
    if (mutation === 'external-delete') state.intent.operations[0] = { action: 'delete', id: externalBlock };
    if (mutation === 'external-parent') state.intent.operations[0] = { action: 'move', id: originalOperation.id, parentID: external };
    if (mutation === 'external-descendant') originalOperation.data = originalOperation.data.replace('</div>', `<div data-node-id="${externalBlock}" data-type="NodeParagraph"><span contenteditable="true">External document</span></div></div>`);
    env.attrs.get(env.id)!['custom-things-notes-v1'] = `b64:${Buffer.from(JSON.stringify(state)).toString('base64')}`;
    let transactions = 0;
    const resumed = new NativeNotes(async (path, body) => { if (path === '/api/transactions') transactions++; return env.request(path, body); }, () => memoryCodec);
    await assert.rejects(resumed.write(env.id, desired, env.source, owner, record), NotesConflictError);
    assert.equal(transactions, 0);
    assert.equal(env.documents.get(external), 'External document');
  }
});

test('new document import remaps explicit source IAL identities before any create request', async () => {
  const sourceId = nextId(); let prepared = '';
  const notes = new NativeNotes(async (path, body: any) => {
    assert.equal(path, '/api/block/checkBlocksExist');
    assert.ok(!body.ids.includes(sourceId));
    return Object.fromEntries(body.ids.map((id: string) => [id, false]));
  }, () => ({
    Md2BlockDOM() { return `<div data-node-id="${sourceId}" data-type="NodeParagraph"><span contenteditable="true">Copied text</span></div>`; },
    BlockDOM2StdMd() { return 'Copied text\n'; },
    BlockDOM2Md(dom: string) { prepared = dom; return `Copied text\n{: id="${nodeId(dom)}"}\n`; },
  }));
  const markdown = await notes.prepareCreateMarkdown(`Copied text\n{: id="${sourceId}"}`);
  assert.ok(!markdown.includes(sourceId));
  assert.ok(!prepared.includes(sourceId));
  assert.ok(markdown.includes('Copied text'));
});
