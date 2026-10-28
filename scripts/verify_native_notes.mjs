// Explicit synthetic-only check against a running local kernel; no production AV binding is used.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { setupLute } from './native_test_runtime.mjs';
import { NativeNotes, NotesConflictError } from '../src/storage/nativeNotes.ts';
import { newSiyuanId } from '../src/storage/avClient.ts';

if (process.env.THINGS_NOTES_LIVE_TEST !== '1') throw new Error('Set THINGS_NOTES_LIVE_TEST=1 to create a labelled synthetic note.');
const base = process.env.THINGS_SIYUAN_URL || 'http://127.0.0.1:6806';
const notebook = process.env.THINGS_NOTES_TEST_NOTEBOOK;
if (!notebook) throw new Error('Set THINGS_NOTES_TEST_NOTEBOOK to an isolated test notebook.');
await setupLute(base);
const request = async (endpoint, body) => {
  const response = await fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok || result.code !== 0) throw new Error(`${endpoint}: ${result.msg || response.status}`);
  return result.data;
};
const sourceId = newSiyuanId();
const source = `First  \r\n{: id="${sourceId}"}\r\n\r\n- alpha\r\n- beta\r\n\r\n\`\`\`js\r\nconsole.log("x")\r\n\`\`\`\r\n\r\n$$\r\nx+1\r\n$$\r\n\r\n![picture](assets/synthetic-not-present.png) [link](https://example.com)\r\n  `;
const notes = new NativeNotes(request);
const docId = await request('/api/filetree/createDocWithMd', { notebook, path: `/Things 复杂备注验证（测试） ${Date.now()}`, markdown: await notes.prepareCreateMarkdown(source) });
await fs.mkdir('tmp', { recursive: true });
await fs.writeFile('tmp/native-notes-live.json', JSON.stringify({ docId, notebook }, null, 2));
const owner = 'things-native-notes-live-test', record = 'synthetic-note';
await request('/api/attr/setBlockAttrs', { id: docId, attrs: { 'custom-things-owner': owner, 'custom-things-record': record } });
await notes.initialize(docId, source, owner, record);
assert.equal((await notes.read(docId)).text, source);
const beforeDOM = (await request('/api/block/getBlockDOM', { id: docId })).dom;
const beforeIds = [...beforeDOM.matchAll(/data-node-id="([^"]+)"/g)].map(match => match[1]);
assert.ok(!beforeIds.includes(sourceId), 'Source IAL identities must not be imported into a different document.');
const desired = source.replace('First  ', 'First edited').replace('- beta', '- inserted\r\n- beta').replace('console.log("x")', 'console.log("y")').replace('x+1', 'x+2') + '\r\n\r\nLast paragraph\n';
await notes.write(docId, desired, source, owner, record);
assert.equal((await notes.read(docId)).text, desired);
const afterDOM = (await request('/api/block/getBlockDOM', { id: docId })).dom;
const afterIds = [...afterDOM.matchAll(/data-node-id="([^"]+)"/g)].map(match => match[1]);
assert.ok(beforeIds.every(id => afterIds.includes(id)), 'Every existing block and list-item ID must survive these edits.');

const final = desired.replace('First edited', 'First final').replace('console.log("y")', 'console.log("z")') + '\nAnother paragraph  \n';
let transactions = 0;
const interrupted = new NativeNotes(async (endpoint, body) => {
  const result = await request(endpoint, body);
  if (endpoint === '/api/transactions' && ++transactions === 2) throw new Error('Simulated lost response');
  return result;
});
await assert.rejects(interrupted.write(docId, final, desired, owner, record), /Simulated lost response/);
await new NativeNotes(request).write(docId, final, desired, owner, record);
assert.equal((await notes.read(docId)).text, final);
const children = await request('/api/block/getChildBlocks', { id: docId });
await request('/api/block/updateBlock', { id: children[0].id, dataType: 'markdown', data: 'Externally edited synthetic paragraph', lockType: true });
const external = (await notes.read(docId)).text;
assert.ok(external.includes('Externally edited synthetic paragraph'));
assert.ok(!external.includes('{: id='), 'Internal block attributes must not leak into Things notes.');
await assert.rejects(notes.write(docId, source, final, owner, record), NotesConflictError);
console.log(JSON.stringify({ result: 'passed', docId, exactWhitespace: true, sourceIALRemapped: true, oldIdsPreserved: beforeIds.length, lostResponseRecovery: true, nativeEditConflict: true }));
