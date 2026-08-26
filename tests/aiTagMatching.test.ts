import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findExistingTagName,
  inferExistingTaskTags,
} from '../src/utils/aiTagMatching.ts';

test('adds an existing issue tag to explicit bug reports without creating a new name', () => {
  assert.deepEqual(
    inferExistingTaskTags('反馈一个问题：拖动卡片后界面报错，请记录成任务', ['工作', 'Bug', '优化建议']),
    ['Bug'],
  );
});

test('matches cross-language issue wording and prefers a feedback-specific existing tag', () => {
  assert.deepEqual(
    inferExistingTaskTags('反馈 bug：同步完成后标签消失', ['问题', '问题反馈', '建议']),
    ['问题反馈'],
  );
});

test('keeps model-selected tags and does not infer issue tags for ordinary tasks', () => {
  assert.deepEqual(
    inferExistingTaskTags('整理下周发布计划', ['Bug', '产品'], ['产品']),
    ['产品'],
  );
});

test('normalizes hash prefixes, spacing, case and hierarchical paths to existing names', () => {
  assert.equal(findExistingTagName(' # BUG ', ['Bug', '产品']), 'Bug');
  assert.equal(findExistingTagName('工作 / 缺陷', ['工作', '缺陷']), '缺陷');
});
