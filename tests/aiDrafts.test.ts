import test from 'node:test';
import assert from 'node:assert/strict';
import { omitEchoedDraftsForCreate } from '../src/utils/aiDrafts.ts';

test('removes old drafts echoed into an independent create round', () => {
  const previous = [
    { clientId: 'draft-round-1-0', title: '任务 A' },
    { clientId: 'draft-round-1-1', title: '任务 B' },
  ];
  const current = [
    { clientId: 'draft-round-1-0', title: '任务 A' },
    { clientId: 'draft-round-2-0', title: '任务 C' },
  ];

  assert.deepEqual(omitEchoedDraftsForCreate(current, previous), [current[1]]);
});

test('keeps genuinely new drafts and drafts without inherited identity', () => {
  const current = [
    { title: '允许创建一个同名的新任务' },
    { clientId: 'draft-round-2-0', title: '新任务' },
  ];

  assert.deepEqual(
    omitEchoedDraftsForCreate(current, [{ clientId: 'draft-round-1-0', title: '旧任务' }]),
    current,
  );
});
