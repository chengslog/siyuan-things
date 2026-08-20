// ===== 任务状态 =====
export type TaskStatus = 'todo' | 'done' | 'canceled';

// ===== 优先级 =====
export type Priority = 'none' | 'low' | 'medium' | 'high';

// ===== 任务 =====
export interface Task {
  id: string;
  title: string;
  notes: string;
  status: TaskStatus;
  priority: Priority;

  // 时间
  created: number;
  updated: number;
  startDate?: number;    // 开始日期（计划日期）- 出现在"今天"的日期
  deadline?: number;     // 截止日期
  someday?: boolean;     // 是否是"某天"任务
  completedDate?: number;

  // 组织
  projectId?: string;
  areaId?: string;
  parentId?: string;     // 父任务 ID（子任务）
  headingId?: string;    // 项目内标题分组
  tags: string[];        // 标签 ID 列表

  // 排序
  order: number;

  // 思源关联
  blockId?: string;      // 关联的思源笔记块 ID
}

// ===== 项目 =====
export type ProjectStatus = 'active' | 'onhold' | 'completed' | 'canceled';

export interface ProjectHeading {
  id: string;
  title: string;
  order: number;
}

export interface Project {
  id: string;
  name: string;
  notes: string;
  areaId?: string;
  status: ProjectStatus;
  deadline?: number;
  created: number;
  updated: number;
  order: number;
  headings: ProjectHeading[];
}

// ===== 区域 =====
export interface Area {
  id: string;
  name: string;
  notes: string;
  order: number;
  created: number;
  updated: number;
}

// ===== 标签 =====
export interface Tag {
  id: string;
  name: string;
  color?: string;
  parentId?: string;
  order: number;
}

// ===== 视图类型 =====
export type ViewType =
  | 'inbox'
  | 'today'
  | 'upcoming'
  | 'anytime'
  | 'someday'
  | 'log'
  | 'projects'
  | 'areas'
  | 'tags'
  | 'project'
  | 'area'
  | 'tag'
  | 'search';

// ===== 插件配置 =====
export interface PluginConfig {
  // 显示
  showCompletedTasks: boolean;
  showCanceledTasks: boolean;

  // 行为
  inboxDefault: boolean;     // 新任务默认进入收件箱
  autoArchive: boolean;      // 自动归档已完成任务
  archiveDays: number;       // 多少天后归档

  // 思源集成
  defaultNotebook?: string;  // 默认笔记本
  syncToBlock: boolean;      // 是否同步任务到笔记块
}

export const DEFAULT_CONFIG: PluginConfig = {
  showCompletedTasks: false,
  showCanceledTasks: false,
  inboxDefault: true,
  autoArchive: false,
  archiveDays: 30,
  syncToBlock: false,
};

// ===== Store 事件 =====
export type StoreEventType = 'change' | 'add' | 'update' | 'delete';

export interface StoreEvent {
  type: StoreEventType;
  ids: string[];
}

// ===== AI 解析结果 =====
export interface ParsedTask {
  clientId?: string;      // AI 会话内稳定草稿 ID
  title: string;
  notes?: string;
  checklist?: string[];
  startDate?: string;    // YYYY-MM-DD
  startTime?: string;    // HH:mm
  deadline?: string;     // YYYY-MM-DD
  deadlineTime?: string; // HH:mm
  someday?: boolean;
  project?: string;      // 项目名称
  area?: string;         // 区域名称
  heading?: string;      // 项目内标题分组名称
  tags?: string[];
}
