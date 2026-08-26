import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTaskAsMarkdown } from '../src/utils/taskMarkdown.ts';

test('formats a complete task as readable portable Markdown', () => {
  const markdown = formatTaskAsMarkdown({
    id: 'task-1',
    title: '发布新版本',
    notes: '先完成 **回归测试**。',
    status: 'todo',
    priority: 'high',
    project: '产品',
    area: '工作',
    heading: '本周发布',
    tags: ['重要', '版本'],
    checklist: [
      { title: '更新变更日志', completed: true },
      { title: '打包插件', completed: false },
    ],
    someday: false,
    repeatRule: 'weekly',
    created: new Date(2026, 7, 26, 9, 30, 5).getTime(),
    updated: new Date(2026, 7, 26, 10, 0, 0).getTime(),
    blockId: 'block-1',
    order: 42,
  });

  assert.match(markdown, /^# 发布新版本/m);
  assert.match(markdown, /- \*\*状态\*\*：待办/);
  assert.match(markdown, /- \*\*项目\*\*：产品/);
  assert.match(markdown, /先完成 \*\*回归测试\*\*。/);
  assert.match(markdown, /## 检查清单（1\/2）/);
  assert.match(markdown, /- \[x\] 更新变更日志/);
  assert.match(markdown, /- \[ \] 打包插件/);
  assert.match(markdown, /## 元数据/);
  assert.match(markdown, /`task-1`/);
  assert.match(markdown, /`block-1`/);
});

test('omits empty optional sections and normalizes multiline inline values', () => {
  const markdown = formatTaskAsMarkdown({
    id: 'task-2',
    title: '第一行\n第二行',
    status: 'done',
    priority: 'none',
    tags: [],
    checklist: [],
    order: 0,
  });

  assert.match(markdown, /^# 第一行 第二行/m);
  assert.match(markdown, /- \*\*状态\*\*：已完成/);
  assert.doesNotMatch(markdown, /## 备注/);
  assert.doesNotMatch(markdown, /## 检查清单/);
  assert.match(markdown, /- \*\*排序值\*\*：0/);
});
