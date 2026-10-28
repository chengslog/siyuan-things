/** IDs bind each schema version; human-readable names are never identities. */
export const TABLE_NAMES = ['tasks', 'projects', 'areas', 'tags', 'headings', 'trashBatches', 'trashItems'] as const;
export type TableName = typeof TABLE_NAMES[number];
export type ColumnType = 'text' | 'number' | 'date' | 'select' | 'url' | 'checkbox' | 'relation' | 'mAsset';
export interface ColumnSpec {
  field: string;
  name: string;
  type: ColumnType;
  relation?: TableName;
  multiple?: boolean;
  options?: readonly string[];
}
export interface TableSpec { name: string; titleField: string; columns: ColumnSpec[] }

const text = (field: string, name: string): ColumnSpec => ({ field, name, type: 'text' });
const number = (field: string, name: string): ColumnSpec => ({ field, name, type: 'number' });
const date = (field: string, name: string): ColumnSpec => ({ field, name, type: 'date' });
const select = (field: string, name: string, options: string[]): ColumnSpec => ({ field, name, type: 'select', options });
const relation = (field: string, name: string, target: TableName, multiple = false): ColumnSpec =>
  ({ field, name, type: 'relation', relation: target, multiple });
const common = (): ColumnSpec[] => [text('id', 'Things ID'), text('extra', '扩展数据'), text('presence', '原字段记录'), number('sourceIndex', '源序号')];
const notes = (): ColumnSpec[] => [text('notesDocId', '备注文档 ID'), { field: 'notesLink', name: '打开备注', type: 'url' }];

export const V1_TABLES: Record<TableName, TableSpec> = {
  tasks: { name: '任务', titleField: 'title', columns: [
    ...common(), select('status', '状态', ['todo', 'done', 'canceled']),
    select('priority', '优先级', ['none', 'low', 'medium', 'high']),
    date('created', '原创建时间'), date('updated', '业务更新时间'), date('startDate', '开始日期'), date('deadline', '截止日期'),
    { field: 'someday', name: '某天', type: 'checkbox' }, date('completedDate', '完成时间'),
    select('repeatRule', '重复规则', ['daily', 'weekdays', 'weekly', 'monthly', 'yearly']),
    relation('recurrenceSourceId', '上一次重复实例', 'tasks'), date('recurrenceGeneratedAt', '下一实例生成时间'),
    relation('projectId', '项目', 'projects'), relation('areaId', '直属区域', 'areas'),
    relation('parentId', '父任务', 'tasks'), relation('headingId', '项目分组', 'headings'), relation('tags', '标签', 'tags', true),
    number('order', '排序'), text('blockId', '原笔记块 ID'), ...notes(),
    select('storageState', '存储状态', ['active', 'archived']), text('tagOrder', '标签顺序'),
  ] },
  projects: { name: '项目', titleField: 'name', columns: [
    ...common(), ...notes(), relation('areaId', '区域', 'areas'),
    select('status', '状态', ['active', 'onhold', 'completed', 'canceled']), date('deadline', '截止日期'),
    date('created', '原创建时间'), date('updated', '业务更新时间'), number('order', '排序'),
    text('groupOrder', '分组顺序'), text('collapsedGroups', '分组折叠状态'),
  ] },
  areas: { name: '区域', titleField: 'name', columns: [
    ...common(), ...notes(), number('order', '排序'), date('created', '原创建时间'), date('updated', '业务更新时间'), text('collapsedGroups', '分组折叠状态'),
  ] },
  tags: { name: '标签', titleField: 'name', columns: [
    ...common(), text('color', '颜色'), relation('parentId', '父标签', 'tags'), number('order', '排序'), text('collapsedGroups', '分组折叠状态'),
  ] },
  headings: { name: '项目分组', titleField: 'title', columns: [
    ...common(), relation('projectId', '所属项目', 'projects'), number('order', '排序'), { field: 'collapsed', name: '折叠', type: 'checkbox' },
  ] },
  trashBatches: { name: '回收批次', titleField: 'name', columns: [
    ...common(), date('deletedAt', '删除时间'), number('order', '批次顺序'), select('state', '恢复状态', ['pending', 'restored']),
  ] },
  trashItems: { name: '回收明细', titleField: 'title', columns: [
    ...common(), relation('batchId', '删除批次', 'trashBatches'), text('taskId', '原任务 ID'), text('payload', '完整任务快照'), ...notes(),
  ] },
};

/** V2 stores note bodies directly in rich text cells. Legacy links remain as hidden migration backups. */
export const TABLES: Record<TableName, TableSpec> = Object.fromEntries(TABLE_NAMES.map(name => [name, {
  ...V1_TABLES[name],
  columns: V1_TABLES[name].columns.flatMap(column => column.field === 'notesDocId'
    ? [text('notes', '备注'), { field: 'notesAssets', name: '备注图片', type: 'mAsset' } as ColumnSpec, column] : [column]),
}])) as Record<TableName, TableSpec>;

export function getTableSpecs(version: 1 | 2): Record<TableName, TableSpec> {
  return version === 1 ? V1_TABLES : TABLES;
}
