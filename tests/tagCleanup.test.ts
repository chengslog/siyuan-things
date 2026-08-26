import test from 'node:test';
import assert from 'node:assert/strict';
import { removeTagId } from '../src/utils/tagCleanup.ts';

test('removes every occurrence of a deleted tag from a task', () => {
  assert.deepEqual(removeTagId(['bug', 'work', 'bug'], 'bug'), ['work']);
});

test('leaves unrelated or missing task tags untouched', () => {
  assert.equal(removeTagId(['work'], 'bug'), undefined);
  assert.equal(removeTagId(undefined, 'bug'), undefined);
});
