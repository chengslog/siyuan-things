import test from 'node:test';
import assert from 'node:assert/strict';
import { auditLegacy, LEGACY_FILES, readLegacy, type LegacySnapshot } from '../src/storage/preflight.ts';

const task = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: 'Task', notes: '', status: 'todo', priority: 'none',
  created: 1720000000123, updated: 1720000000123, tags: [], order: 0, ...extra,
});
const project = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: 'Same project name', notes: '', status: 'active',
  created: 1720000000123, updated: 1720000000123, order: 0, headings: [], ...extra,
});
const empty = (): LegacySnapshot => ({ tasks: [], archived: [], trash: [], projects: [], areas: [], tags: [] });
const codes = (issues: Array<{ code: string }>) => issues.map(issue => issue.code);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

test('reads all six raw files without any writes and treats only missing sentinel values as empty', async () => {
  const calls: string[] = [];
  const values: Record<string, unknown> = {
    'tasks.json': '[{"id":"raw"}]', 'tasks-archive.json': null,
    'tasks-trash.json': '', 'projects.json': [], 'areas.json': undefined, 'tags.json': '[]',
  };
  const result = await readLegacy({ async loadData(filename) { calls.push(filename); return values[filename]; } });
  assert.deepEqual(calls.sort(), Object.values(LEGACY_FILES).sort());
  assert.deepEqual(result, { ...empty(), tasks: [{ id: 'raw' }] });
});

test('read failures, corrupt JSON, parsed null and object payloads cannot be mistaken for fresh installations', async () => {
  for (const value of ['broken private task text', 'null', '{}', {}, 0, false, '   ']) {
    await assert.rejects(readLegacy({ async loadData() { return value; } }), /legacy file/);
  }
  await assert.rejects(readLegacy({ async loadData() { throw new Error('network failed'); } }), /Unable to read legacy file/);
});

test('empty source is fresh, but archive-only and trash-only sources are existing installations', () => {
  assert.deepEqual(auditLegacy(empty()), {
    errors: [], warnings: [], hasLegacyData: false,
    counts: { tasks: 0, archived: 0, trashBatches: 0, trashItems: 0, projects: 0, areas: 0, tags: 0, headings: 0 },
  });
  assert.equal(auditLegacy({ ...empty(), archived: [task('archived')] }).hasLegacyData, true);
  assert.equal(auditLegacy({ ...empty(), trash: [{ id: 'batch', deletedAt: 1, tasks: [] }] }).hasLegacyData, true);
  const malformed = auditLegacy({ ...empty(), tasks: null } as unknown as LegacySnapshot);
  assert.equal(malformed.hasLegacyData, true);
  assert.ok(codes(malformed.errors).includes('INVALID_COLLECTION'));
});

test('complete source keeps hierarchy across active/archive and same-named classifications', () => {
  const snapshot = empty();
  snapshot.areas = [{ id: 'area', name: 'Area', notes: '', order: -0.5, created: 0, updated: 1, collapsedGroups: { active: true } }];
  snapshot.projects = [project('p1', { areaId: 'area', headings: [{ id: 'h', title: 'Group', order: 0, collapsed: false }], groupOrder: ['none', 'h'] }), project('p2')];
  snapshot.tags = [{ id: 'tag1', name: 'Same', color: '#abc', order: 0 }, { id: 'tag2', name: 'Same', parentId: 'tag1', order: 0.25 }];
  snapshot.archived = [task('parent', { status: 'done', completedDate: 123 })];
  snapshot.tasks = [task('child', { parentId: 'parent', projectId: 'p1', headingId: 'h', tags: ['tag2', 'tag1'], order: -3, someday: false })];
  const before = JSON.stringify(snapshot);
  const result = auditLegacy(deepFreeze(snapshot));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.counts.headings, 1);
  assert.equal(JSON.stringify(snapshot), before);
});

test('active/archive identity collisions block migration while historical versions do not', () => {
  const snapshot = { ...empty(), tasks: [task('same')], archived: [task('same')] };
  assert.ok(codes(auditLegacy(snapshot).errors).includes('DUPLICATE_ID'));
  snapshot.archived = [];
  snapshot.trash = [
    { id: 'batch', deletedAt: 200, tasks: [task('same', { notes: 'first version' }), task('same', { notes: 'second version' })] },
    { id: 'batch', deletedAt: 100, tasks: [task('same', { notes: 'third version' })] },
  ];
  const before = JSON.stringify(snapshot);
  const result = auditLegacy(deepFreeze(snapshot));
  assert.deepEqual(result.errors, []);
  assert.ok(codes(result.warnings).includes('DUPLICATE_BATCH_ID'));
  assert.ok(codes(result.warnings).includes('DUPLICATE_SNAPSHOT_ID'));
  assert.equal(result.counts.trashItems, 3);
  assert.equal(JSON.stringify(snapshot), before);
});

test('unknown values are not coerced and every malformed known field is reported', () => {
  const invalid = task('t', {
    title: 4, notes: [], status: 'archived', priority: 'urgent', created: Infinity, updated: 'today',
    startDate: NaN, deadline: 1.5, someday: 'false', completedDate: 8_640_000_000_000_001,
    repeatRule: 'hourly', recurrenceSourceId: 5, recurrenceGeneratedAt: false,
    projectId: [], areaId: {}, parentId: false, headingId: 5, tags: [3], order: Infinity, blockId: true,
  });
  const result = auditLegacy({ ...empty(), tasks: [invalid] });
  assert.equal(result.errors.length, 20);
  assert.ok(codes(result.errors).includes('UNKNOWN_ENUM'));
  assert.ok(result.errors.some(issue => issue.path === 'tasks[0].deadline'));
});

test('missing references and conflicting scope survive as warnings rather than silent cleanup', () => {
  const snapshot = empty();
  snapshot.projects = [project('p1'), project('p2', { headings: [{ id: 'h2', title: 'Heading', order: 0 }] })];
  snapshot.tasks = [task('t', {
    parentId: 'lost', projectId: 'p1', areaId: 'lost-area', headingId: 'h2',
    tags: ['lost-tag', 'lost-tag'], recurrenceSourceId: 'old-instance', startDate: null,
    customProperty: { nested: ['retain'] },
  })];
  const before = JSON.stringify(snapshot);
  const result = auditLegacy(deepFreeze(snapshot));
  assert.deepEqual(result.errors, []);
  for (const code of ['MISSING_REFERENCE', 'MISSING_TAG', 'CROSS_PROJECT_HEADING', 'PROJECT_AND_AREA', 'DUPLICATE_ARRAY_MEMBER', 'EXPLICIT_NULL', 'EXTRA_FIELD']) {
    assert.ok(codes(result.warnings).includes(code), code);
  }
  assert.equal(JSON.stringify(snapshot), before);
});

test('task, recurrence and tag cycles block new relations, but historical cycles remain recoverable', () => {
  const snapshot = empty();
  snapshot.tasks = [task('a', { parentId: 'b', recurrenceSourceId: 'a' }), task('b', { parentId: 'a' })];
  snapshot.tags = [{ id: 'tag', name: 'Tag', order: 0, parentId: 'tag' }];
  snapshot.trash = [{ id: 'b', deletedAt: 0, tasks: [task('old', { parentId: 'old' })] }];
  const result = auditLegacy(snapshot);
  assert.deepEqual(new Set(codes(result.errors)), new Set(['TASK_PARENT_CYCLE', 'RECURRENCE_CYCLE', 'TAG_PARENT_CYCLE']));
  assert.ok(codes(result.warnings).includes('HISTORICAL_PARENT_CYCLE'));
});

test('deep task trees can be inspected without recursive call-stack overflow', () => {
  const snapshot = empty();
  for (let index = 0; index < 12_000; index++) {
    snapshot.tasks.push(task(String(index), index < 11_999 ? { parentId: String(index + 1) } : {}));
  }
  assert.deepEqual(auditLegacy(snapshot).errors, []);
});

test('heading identity is local to a project and original group order is preserved', () => {
  const snapshot = empty();
  snapshot.projects = [project('a', { headings: [{ id: 'shared', title: 'Group', order: 0 }], groupOrder: ['none', 'shared', 'lost'], collapsedGroups: { other: false } }),
    project('b', { headings: [{ id: 'shared', title: 'Group', order: -1 }] })];
  const result = auditLegacy(snapshot);
  assert.deepEqual(result.errors, []);
  assert.ok(codes(result.warnings).includes('MISSING_GROUP'));
  snapshot.projects[0].headings.push({ id: 'shared', title: 'Duplicate', order: 1 });
  assert.ok(codes(auditLegacy(snapshot).errors).includes('DUPLICATE_HEADING_ID'));
});

test('project/area/tag/heading and trash field types are checked independently', () => {
  const snapshot = empty();
  snapshot.projects = [project('p', { status: 'todo', areaId: 3, groupOrder: [false], collapsedGroups: { active: 'yes' },
    headings: [{ id: 'h', title: 'Group', order: '1', collapsed: 'false' }] })];
  snapshot.areas = [{ id: 'area', name: 'Area', notes: false, order: 0, created: 1, updated: 2 }];
  snapshot.tags = [{ id: 'tag', name: 'Tag', order: 0, parentId: 1, color: [] }];
  snapshot.trash = [{ id: 'batch', deletedAt: 'yesterday', tasks: null }];
  const errors = auditLegacy(snapshot).errors;
  for (const path of ['projects[0].status', 'projects[0].areaId', 'projects[0].groupOrder', 'projects[0].collapsedGroups',
    'projects[0].headings[0].order', 'projects[0].headings[0].collapsed', 'areas[0].notes', 'tags[0].parentId', 'tags[0].color',
    'trash[0].deletedAt', 'trash[0].tasks']) assert.ok(errors.some(issue => issue.path === path), path);
});
