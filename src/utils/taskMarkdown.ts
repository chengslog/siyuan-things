import type { Priority, RepeatRule, TaskStatus } from '@/types';

export interface TaskMarkdownChecklistItem {
  title: string;
  completed: boolean;
}

export interface TaskMarkdownData {
  id: string;
  title: string;
  notes?: string;
  status: TaskStatus;
  priority: Priority;
  project?: string;
  area?: string;
  heading?: string;
  parentTask?: string;
  tags?: string[];
  checklist?: TaskMarkdownChecklistItem[];
  startDate?: number;
  deadline?: number;
  someday?: boolean;
  completedDate?: number;
  repeatRule?: RepeatRule;
  created?: number;
  updated?: number;
  blockId?: string;
  recurrenceSourceId?: string;
  recurrenceGeneratedAt?: number;
  order?: number;
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: '待办',
  done: '已完成',
  canceled: '已取消',
};

const PRIORITY_LABELS: Record<Priority, string> = {
  none: '无',
  low: '低',
  medium: '中',
  high: '高',
};

const REPEAT_LABELS: Record<RepeatRule, string> = {
  daily: '每天',
  weekdays: '每个工作日',
  weekly: '每周',
  monthly: '每月',
  yearly: '每年',
};

function inlineText(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function inlineCode(value: string): string {
  return `\`${value.replace(/`/g, '\\`')}\``;
}

function formatDateTime(timestamp: number, includeSeconds = false): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const hasTime = date.getHours() !== 0 || date.getMinutes() !== 0 || date.getSeconds() !== 0;
  if (!hasTime) return datePart;
  const timePart = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return includeSeconds ? `${datePart} ${timePart}:${pad(date.getSeconds())}` : `${datePart} ${timePart}`;
}

/**
 * 将一条任务导出成兼容思源、GitHub 与常见 Markdown 编辑器的可读文本。
 * 属性区突出日常使用的信息，备注保留原始 Markdown，技术字段集中放在末尾。
 */
export function formatTaskAsMarkdown(task: TaskMarkdownData): string {
  const title = inlineText(task.title) || '未命名任务';
  const properties = [
    `- **状态**：${STATUS_LABELS[task.status]}`,
    `- **优先级**：${PRIORITY_LABELS[task.priority]}`,
    task.project && `- **项目**：${inlineText(task.project)}`,
    task.area && `- **区域**：${inlineText(task.area)}`,
    task.heading && `- **分组**：${inlineText(task.heading)}`,
    task.parentTask && `- **父任务**：${inlineText(task.parentTask)}`,
    task.someday && `- **计划时间**：某天`,
    task.startDate && `- **开始时间**：${formatDateTime(task.startDate)}`,
    task.deadline && `- **截止时间**：${formatDateTime(task.deadline)}`,
    task.repeatRule && `- **重复**：${REPEAT_LABELS[task.repeatRule]}`,
    task.tags?.length && `- **标签**：${task.tags.map(inlineText).join('、')}`,
  ].filter(Boolean) as string[];

  const sections = [`# ${title}`, properties.join('\n')];
  const notes = task.notes?.trim();
  if (notes) sections.push(`## 备注\n\n${notes}`);

  const checklist = (task.checklist || []).filter((item) => item.title.trim());
  if (checklist.length) {
    const completed = checklist.filter((item) => item.completed).length;
    sections.push([
      `## 检查清单（${completed}/${checklist.length}）`,
      '',
      ...checklist.map((item) => `- [${item.completed ? 'x' : ' '}] ${inlineText(item.title)}`),
    ].join('\n'));
  }

  const metadata = [
    `- **任务 ID**：${inlineCode(task.id)}`,
    task.created && `- **创建时间**：${formatDateTime(task.created, true)}`,
    task.updated && `- **更新时间**：${formatDateTime(task.updated, true)}`,
    task.completedDate && `- **完成时间**：${formatDateTime(task.completedDate, true)}`,
    task.blockId && `- **思源块 ID**：${inlineCode(task.blockId)}`,
    task.recurrenceSourceId && `- **重复来源任务 ID**：${inlineCode(task.recurrenceSourceId)}`,
    task.recurrenceGeneratedAt && `- **重复任务生成时间**：${formatDateTime(task.recurrenceGeneratedAt, true)}`,
    task.order != null && `- **排序值**：${task.order}`,
  ].filter(Boolean) as string[];
  sections.push(`## 元数据\n\n${metadata.join('\n')}`);

  return `${sections.join('\n\n')}\n`;
}
