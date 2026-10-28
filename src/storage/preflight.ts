/** Raw legacy reads and migration checks. This module never writes or initializes a Store. */
export const LEGACY_FILES = {
  tasks: 'tasks.json',
  archived: 'tasks-archive.json',
  trash: 'tasks-trash.json',
  projects: 'projects.json',
  areas: 'areas.json',
  tags: 'tags.json',
} as const;

export interface LegacySnapshot {
  tasks: any[];
  archived: any[];
  trash: any[];
  projects: any[];
  areas: any[];
  tags: any[];
}

export interface AuditIssue {
  code: string;
  path: string;
  /** Describes the problem without copying private task content. */
  message: string;
}

export interface AuditResult {
  errors: AuditIssue[];
  warnings: AuditIssue[];
  counts: {
    tasks: number;
    archived: number;
    trashBatches: number;
    trashItems: number;
    projects: number;
    areas: number;
    tags: number;
    headings: number;
  };
  hasLegacyData: boolean;
}

export interface LegacyReader {
  loadData(name: string): Promise<any>;
}

/** Missing files are empty; corrupt files and failed reads must never look like a fresh install. */
export async function readLegacy(storage: LegacyReader): Promise<LegacySnapshot> {
  const entries = await Promise.all(Object.entries(LEGACY_FILES).map(async ([key, filename]) => {
    let value: unknown;
    try {
      value = await storage.loadData(filename);
    } catch {
      throw new Error(`Unable to read legacy file: ${filename}`);
    }
    if (value === null || value === undefined || value === '') return [key, []] as const;
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        throw new Error(`Invalid JSON in legacy file: ${filename}`);
      }
    }
    if (!Array.isArray(value)) throw new Error(`Expected an array in legacy file: ${filename}`);
    return [key, value] as const;
  }));
  return Object.fromEntries(entries) as unknown as LegacySnapshot;
}

type Row = Record<string, any>;
type Entry = { row: Row; path: string };
type Kind = 'id' | 'string' | 'number' | 'date' | 'boolean' | 'ids' | 'flags' | 'headings';
type Field = { kind: Kind; optional?: boolean; choices?: readonly string[] };
type Shape = Record<string, Field>;
const optional = (kind: Kind): Field => ({ kind, optional: true });
const TASK: Shape = {
  id: { kind: 'id' }, title: { kind: 'string' }, notes: { kind: 'string' },
  status: { kind: 'string', choices: ['todo', 'done', 'canceled'] },
  priority: { kind: 'string', choices: ['none', 'low', 'medium', 'high'] },
  created: { kind: 'date' }, updated: { kind: 'date' }, startDate: optional('date'),
  deadline: optional('date'), someday: optional('boolean'), completedDate: optional('date'),
  repeatRule: { kind: 'string', optional: true, choices: ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'] },
  recurrenceSourceId: optional('id'), recurrenceGeneratedAt: optional('date'),
  projectId: optional('id'), areaId: optional('id'), parentId: optional('id'), headingId: optional('id'),
  tags: { kind: 'ids' }, order: { kind: 'number' }, blockId: optional('id'),
};
const PROJECT: Shape = {
  id: { kind: 'id' }, name: { kind: 'string' }, notes: { kind: 'string' }, areaId: optional('id'),
  status: { kind: 'string', choices: ['active', 'onhold', 'completed', 'canceled'] },
  deadline: optional('date'), created: { kind: 'date' }, updated: { kind: 'date' },
  order: { kind: 'number' }, headings: { kind: 'headings' },
  groupOrder: optional('ids'), collapsedGroups: optional('flags'),
};
const AREA: Shape = {
  id: { kind: 'id' }, name: { kind: 'string' }, notes: { kind: 'string' }, order: { kind: 'number' },
  created: { kind: 'date' }, updated: { kind: 'date' }, collapsedGroups: optional('flags'),
};
const TAG: Shape = {
  id: { kind: 'id' }, name: { kind: 'string' }, color: optional('string'), parentId: optional('id'),
  order: { kind: 'number' }, collapsedGroups: optional('flags'),
};
const HEADING: Shape = {
  id: { kind: 'id' }, title: { kind: 'string' }, order: { kind: 'number' }, collapsed: optional('boolean'),
};
const TRASH: Shape = {
  id: { kind: 'id' }, deletedAt: { kind: 'date' }, tasks: { kind: 'headings' },
};

function isRecord(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.prototype.toString.call(value) === '[object Object]';
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Audits the complete source without normalizing it. Missing targets are warnings so a
 * migration can preserve the legacy ID. Ambiguous identities and invalid scalar data
 * are errors; callers must resolve them before activating the new data source.
 */
export function auditLegacy(snapshot: LegacySnapshot): AuditResult {
  const result: AuditResult = {
    errors: [], warnings: [], hasLegacyData: false,
    counts: { tasks: 0, archived: 0, trashBatches: 0, trashItems: 0, projects: 0, areas: 0, tags: 0, headings: 0 },
  };
  const issue = (level: 'errors' | 'warnings', code: string, path: string, message: string) => {
    result[level].push({ code, path, message });
  };

  function validateRecord(value: unknown, shape: Shape, path: string): value is Row {
    if (!isRecord(value)) {
      issue('errors', 'INVALID_RECORD', path, 'Expected an object; the original record must be preserved for recovery.');
      return false;
    }
    for (const [field, spec] of Object.entries(shape)) {
      const current = value[field];
      const fieldPath = `${path}.${field}`;
      if (current === undefined) {
        if (!spec.optional) issue('errors', 'MISSING_FIELD', fieldPath, 'A required legacy field is missing.');
        continue;
      }
      if (current === null && spec.optional) {
        issue('warnings', 'EXPLICIT_NULL', fieldPath, 'Preserve the explicit null in source metadata; do not silently substitute a default.');
        continue;
      }
      let valid = false;
      switch (spec.kind) {
        case 'id': valid = isId(current); break;
        case 'string': valid = typeof current === 'string'; break;
        case 'number': valid = typeof current === 'number' && Number.isFinite(current); break;
        case 'date':
          valid = typeof current === 'number' && Number.isSafeInteger(current) && Math.abs(current) <= 8_640_000_000_000_000;
          break;
        case 'boolean': valid = typeof current === 'boolean'; break;
        case 'ids': valid = Array.isArray(current) && current.every(isId); break;
        case 'flags': valid = isRecord(current) && Object.values(current).every(flag => typeof flag === 'boolean'); break;
        case 'headings': valid = Array.isArray(current); break;
      }
      if (!valid) {
        issue('errors', 'INVALID_FIELD', fieldPath, `Expected ${spec.kind}; no automatic coercion was performed.`);
      } else if (spec.choices && !spec.choices.includes(current)) {
        issue('errors', 'UNKNOWN_ENUM', fieldPath, 'The stored enum is not supported; preserve it and resolve the mapping explicitly.');
      } else if ((field === 'title' || field === 'name') && !current.trim()) {
        issue('warnings', 'EMPTY_TITLE', fieldPath, 'The original blank title must not be discarded or used to merge records.');
      } else if (spec.kind === 'ids' && new Set(current).size !== current.length) {
        issue('warnings', 'DUPLICATE_ARRAY_MEMBER', fieldPath, 'Duplicate members and original sequence must be retained in migration metadata.');
      }
    }
    for (const field of Object.keys(value)) {
      if (!Object.prototype.hasOwnProperty.call(shape, field)) {
        issue('warnings', 'EXTRA_FIELD', `${path}.${field}`, 'Preserve this unknown field in the extension payload and original snapshot.');
      }
    }
    return true;
  }

  function collect(key: keyof LegacySnapshot, shape: Shape): Entry[] {
    const value = snapshot?.[key];
    if (!Array.isArray(value)) {
      result.hasLegacyData = true;
      issue('errors', 'INVALID_COLLECTION', key, 'Expected a source array; an invalid collection cannot be treated as an empty installation.');
      return [];
    }
    if (value.length > 0) result.hasLegacyData = true;
    const count = key === 'trash' ? 'trashBatches' : key;
    result.counts[count] = value.length;
    const entries: Entry[] = [];
    value.forEach((row, index) => {
      const path = `${key}[${index}]`;
      if (validateRecord(row, shape, path)) entries.push({ row, path });
    });
    return entries;
  }

  function unique(entries: Entry[], duplicateCode = 'DUPLICATE_ID', level: 'errors' | 'warnings' = 'errors'): Map<string, Entry> {
    const map = new Map<string, Entry>();
    for (const entry of entries) {
      if (!isId(entry.row.id)) continue;
      const previous = map.get(entry.row.id);
      if (previous) {
        issue(level, duplicateCode, `${entry.path}.id`, `The identity also occurs at ${previous.path}.id; source records must not overwrite one another.`);
      } else {
        map.set(entry.row.id, entry);
      }
    }
    return map;
  }

  function reference(entry: Entry, field: string, targets: Map<string, Entry>, code = 'MISSING_REFERENCE'): void {
    const value = entry.row[field];
    if (isId(value) && !targets.has(value)) {
      issue('warnings', code, `${entry.path}.${field}`, 'The referenced object is absent; preserve the original ID as a legacy reference.');
    }
  }

  /** Iterative graph traversal avoids stack overflow on large/deep imported trees. */
  function cycles(entries: Map<string, Entry>, field: string, code: string, level: 'errors' | 'warnings' = 'errors'): void {
    const finished = new Set<string>();
    for (const start of entries.keys()) {
      if (finished.has(start)) continue;
      const chain: string[] = [];
      const positions = new Map<string, number>();
      let cursor: unknown = start;
      while (isId(cursor) && entries.has(cursor) && !finished.has(cursor)) {
        if (positions.has(cursor)) {
          const entry = entries.get(cursor)!;
          issue(level, code, `${entry.path}.${field}`, `A cycle of ${chain.length - positions.get(cursor)!} record(s) requires explicit repair; no records were changed.`);
          break;
        }
        positions.set(cursor, chain.length);
        chain.push(cursor);
        cursor = entries.get(cursor)!.row[field];
      }
      for (const id of chain) finished.add(id);
    }
  }

  const tasks = collect('tasks', TASK);
  const archived = collect('archived', TASK);
  const projects = collect('projects', PROJECT);
  const areas = collect('areas', AREA);
  const tags = collect('tags', TAG);
  const batches = collect('trash', TRASH);
  const taskIndex = unique([...tasks, ...archived]);
  const projectIndex = unique(projects);
  const areaIndex = unique(areas);
  const tagIndex = unique(tags);
  unique(batches, 'DUPLICATE_BATCH_ID', 'warnings');

  const headings = new Map<string, Map<string, Entry>>();
  const allHeadingIds = new Set<string>();
  for (const project of projects) {
    reference(project, 'areaId', areaIndex);
    if (!Array.isArray(project.row.headings)) continue;
    result.counts.headings += project.row.headings.length;
    const entries: Entry[] = [];
    project.row.headings.forEach((row: unknown, index: number) => {
      const path = `${project.path}.headings[${index}]`;
      if (validateRecord(row, HEADING, path)) entries.push({ row, path });
    });
    const headingIndex = unique(entries, 'DUPLICATE_HEADING_ID');
    if (isId(project.row.id) && !headings.has(project.row.id)) headings.set(project.row.id, headingIndex);
    for (const id of headingIndex.keys()) allHeadingIds.add(id);
    if (Array.isArray(project.row.groupOrder)) {
      project.row.groupOrder.forEach((id: unknown, index: number) => {
        if (isId(id) && id !== 'none' && !headingIndex.has(id)) {
          issue('warnings', 'MISSING_GROUP', `${project.path}.groupOrder[${index}]`, 'Preserve this unresolved group-order entry; do not silently normalize the source sequence.');
        }
      });
    }
  }

  function taskReferences(entry: Entry, parentTargets = taskIndex, history = false): void {
    reference(entry, 'parentId', parentTargets);
    reference(entry, 'projectId', projectIndex);
    reference(entry, 'areaId', areaIndex);
    reference(entry, 'recurrenceSourceId', taskIndex);
    if (isId(entry.row.projectId) && isId(entry.row.areaId)) {
      issue('warnings', 'PROJECT_AND_AREA', entry.path, 'Both project and direct area are populated; preserve both and derive effective area separately.');
    }
    if (Array.isArray(entry.row.tags)) {
      entry.row.tags.forEach((id: unknown, index: number) => {
        if (isId(id) && !tagIndex.has(id)) {
          issue('warnings', 'MISSING_TAG', `${entry.path}.tags[${index}]`, 'Keep this unresolved tag ID and its original position.');
        }
      });
    }
    if (isId(entry.row.headingId) && !headings.get(entry.row.projectId)?.has(entry.row.headingId)) {
      issue('warnings', allHeadingIds.has(entry.row.headingId) ? 'CROSS_PROJECT_HEADING' : 'MISSING_HEADING', `${entry.path}.headingId`,
        'The heading is not available in this task’s project; preserve the original project and heading IDs.');
    }
    if (!history && entry.row.repeatRule && !entry.row.parentId && !entry.row.startDate && !entry.row.deadline) {
      issue('warnings', 'UNDATED_RECURRENCE', entry.path, 'Import without calling lifecycle methods that would add today’s date or generate an occurrence.');
    }
    if (entry.row.status !== 'done' && typeof entry.row.completedDate === 'number') {
      issue('warnings', 'STALE_COMPLETED_DATE', `${entry.path}.completedDate`, 'Retain the historical completion timestamp; do not rewrite the task status during migration.');
    }
  }

  for (const entry of [...tasks, ...archived]) taskReferences(entry);
  cycles(taskIndex, 'parentId', 'TASK_PARENT_CYCLE');
  cycles(taskIndex, 'recurrenceSourceId', 'RECURRENCE_CYCLE');
  for (const entry of tags) reference(entry, 'parentId', tagIndex);
  cycles(tagIndex, 'parentId', 'TAG_PARENT_CYCLE');

  // Snapshots are immutable historical versions, not current tasks indexed globally by id.
  for (const batch of batches) {
    if (!Array.isArray(batch.row.tasks)) continue;
    result.counts.trashItems += batch.row.tasks.length;
    const snapshots: Entry[] = [];
    batch.row.tasks.forEach((row: unknown, index: number) => {
      const path = `${batch.path}.tasks[${index}]`;
      if (validateRecord(row, TASK, path)) snapshots.push({ row, path });
    });
    const batchIndex = unique(snapshots, 'DUPLICATE_SNAPSHOT_ID', 'warnings');
    const parentTargets = new Map(taskIndex);
    for (const [id, entry] of batchIndex) parentTargets.set(id, entry);
    for (const entry of snapshots) taskReferences(entry, parentTargets, true);
    cycles(batchIndex, 'parentId', 'HISTORICAL_PARENT_CYCLE', 'warnings');
  }
  return result;
}
