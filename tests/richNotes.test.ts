import test from 'node:test';
import assert from 'node:assert/strict';
import { RichNotes, RichNotesUnsupportedError } from '../src/storage/richNotes.ts';
import { memoryCodec } from './helpers/nativeNotesMemory.ts';

const rich = new RichNotes(() => memoryCodec);
const image = '![diagram](assets/one.png "title")';
const clone = (value: any) => JSON.parse(JSON.stringify(value));

test('rich notes retain exact original Markdown and represent pictures as rich marked links plus assets', () => {
  const source = `**Bold**  \n\n${image}\n\n\`![literal](assets/code.png)\`\n\n\`\`\`md\n![example](assets/fence.png)\n\`\`\`\n`;
  const plan = rich.prepare(source);
  assert.deepEqual(plan.assets.mAsset, [{ type: 'image', content: 'assets/one.png', name: 'diagram' }]);
  assert.match(plan.cell.text.rich.content, /things-image:/);
  assert.equal(rich.read(plan.cell, plan.assets, plan.state), source);
});

test('native image removal invalidates exact alias without reviving removed media or converting ordinary links', () => {
  const source = `${image}\n\n[ordinary](assets/one.png)`;
  const plan = rich.prepare(source), result = rich.read(plan.cell, { mAsset: [] }, plan.state);
  assert.doesNotMatch(result, /!\[/);
  assert.match(result, /\[ordinary\]\(assets\/one.png\)/);
  assert.doesNotMatch(result, /things-image/);
});

test('native image additions and replacement are visible and native label edits invalidate original image syntax', () => {
  const plan = rich.prepare(image);
  const added = { mAsset: [...plan.assets.mAsset, { type: 'image', content: 'assets/two.png', name: 'added' }] };
  assert.match(rich.read(plan.cell, added, plan.state), /!\[added\]\(<assets\/two.png>\)/);
  const replaced = { mAsset: [{ type: 'image', content: 'assets/replacement.png', name: 'replacement' }] };
  const replacement = rich.read(plan.cell, replaced, plan.state);
  assert.doesNotMatch(replacement, /assets\/one.png/);
  assert.match(replacement, /assets\/replacement.png/);
  const edited = clone(plan.cell); edited.text.rich.content = edited.text.rich.content.replace('🖼 diagram', '🖼 new caption');
  assert.match(rich.read(edited, plan.assets, plan.state), /!\[new caption\]/);
});

test('native rich text edits return new content and clearing writes explicit rich:null', () => {
  const plan = rich.prepare('**original**\n'), edited = clone(plan.cell);
  edited.text.rich.content = '**native**';
  assert.equal(rich.read(edited, plan.assets, plan.state), '**native**');
  const clear = rich.prepare('', plan.cell, plan.assets, plan.state);
  assert.equal(clear.cell.text.rich, null);
  assert.deepEqual(clear.assets.mAsset, []);
  assert.equal(rich.read(clear.cell, clear.assets, clear.state), '');
});

test('durable reservation recognizes either interrupted column, while concurrent native edits stop recovery', () => {
  const before = rich.prepare(image), after = rich.prepare('new ![two](assets/two.png)', before.cell, before.assets, before.state);
  const reserved = rich.reservation(after, before.cell, before.assets, before.state);
  assert.throws(() => rich.read(after.cell, before.assets, reserved), /尚未完成/);
  assert.equal(rich.read(after.cell, before.assets, reserved, true), image);
  assert.equal(rich.read(before.cell, after.assets, reserved, true), image);
  assert.equal(rich.read(after.cell, after.assets, reserved), 'new ![two](assets/two.png)');
  const native = rich.prepare('native edit');
  assert.throws(() => rich.read(native.cell, before.assets, reserved, true), /原生编辑/);
});

test('unsupported executable diagrams are rejected before any write plan exists', () => {
  assert.throws(() => rich.validate('```mermaid\ngraph TD;A-->B\n```'), RichNotesUnsupportedError);
});

test('editing a note retains native file attachments while their ordinary links remain', () => {
  const original = rich.prepare('Note'), assets = { mAsset: [{ type: 'file', content: 'assets/report.pdf', name: 'report' }] };
  const source = rich.read(original.cell, assets, original.state);
  const edited = rich.prepare(`Edited\n\n${source}`, original.cell, assets, original.state);
  assert.deepEqual(edited.assets.mAsset, assets.mAsset);
  assert.equal(rich.read(edited.cell, edited.assets, edited.state), `Edited\n\n${source}`);
  const removed = rich.prepare('Edited', edited.cell, edited.assets, edited.state);
  assert.deepEqual(removed.assets.mAsset, []);
});
