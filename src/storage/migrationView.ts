import type { AuditResult } from './preflight.ts';

export const MIGRATION_STAGES: Record<string, string> = {
  checking: '正在检查源数据和运行环境…', backup: '正在保存并核对原始备份…',
  creating: '正在创建数据中心和数据库…', importing: '正在导入记录和备注…',
  verifying: '正在逐项核对导入结果…', activating: '正在切换数据源…', done: '迁移完成',
};

export function migrationCounts(report: AuditResult): string {
  const c = report.counts;
  return `当前任务（含检查项）${c.tasks}，归档任务 ${c.archived}，项目 ${c.projects}，区域 ${c.areas}，标签 ${c.tags}，项目分组 ${c.headings}，回收批次 ${c.trashBatches}，回收快照 ${c.trashItems}`;
}

const issueLabels: Record<string, string> = {
  INVALID_RECORD: '记录格式损坏，需要先处理', INVALID_COLLECTION: '数据集合格式损坏，需要先处理',
  MISSING_FIELD: '缺少必要字段', INVALID_FIELD: '字段类型无效', UNKNOWN_ENUM: '字段值暂不受支持',
  DUPLICATE_ID: '记录身份重复，不能覆盖导入', DUPLICATE_HEADING_ID: '项目分组身份重复',
  TASK_PARENT_CYCLE: '父子任务形成循环', RECURRENCE_CYCLE: '重复实例来源形成循环', TAG_PARENT_CYCLE: '父子标签形成循环',
  MISSING_REFERENCE: '关联对象已缺失，将保留原关联信息', MISSING_TAG: '标签已缺失，将保留原标签信息',
  PROJECT_AND_AREA: '同时关联项目和区域，将保留两者', MISSING_GROUP: '分组排序中有缺失分组，将保留原顺序',
  MISSING_HEADING: '项目分组已缺失，将保留原关联', CROSS_PROJECT_HEADING: '分组属于其他项目，将保留原关联',
  EXPLICIT_NULL: '字段为空值，将按原样保留', EMPTY_TITLE: '标题为空，将保留该记录',
  DUPLICATE_ARRAY_MEMBER: '列表含重复项，将保留原顺序', EXTRA_FIELD: '扩展字段将完整保留',
  DUPLICATE_BATCH_ID: '回收批次身份重复，将分别保留', DUPLICATE_SNAPSHOT_ID: '回收批次含多个历史版本，将分别保留',
  UNDATED_RECURRENCE: '重复任务没有日期，导入时不补日期或生成实例', STALE_COMPLETED_DATE: '记录含历史完成时间，将按原样保留',
};

/** Paths locate a record without exposing private task titles or note content. */
export function migrationIssues(report: AuditResult): string {
  return [
    ...(report.errors.length ? ['需要先处理：', ...report.errors.map(item => `${item.path}：${issueLabels[item.code] || item.message}`)] : []),
    ...(report.warnings.length ? ['按原样保留的待核对项：', ...report.warnings.map(item => `${item.path}：${issueLabels[item.code] || item.message}`)] : []),
  ].join('\n');
}
