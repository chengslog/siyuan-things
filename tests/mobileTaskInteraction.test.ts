import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the real component handlers with synthetic events/storage; no SiYuan data or browser is needed.
const card = readFileSync(new URL('../src/components/TaskCard.svelte', import.meta.url), 'utf8');
const checklist = readFileSync(new URL('../src/components/Checklist.svelte', import.meta.url), 'utf8');
function execute(source: string, values: Record<string, any>) {
  const context = vm.createContext(values);
  vm.runInContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, context);
  return context;
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const click = { stopPropagation() {} };

test('IME confirmation does not add a checklist row or steal its focus', () => {
  const handler = checklist.slice(checklist.indexOf('  function handleKeydown('), checklist.indexOf('  // 拖动功能'));
  for (const event of [{ isComposing: true, keyCode: 13 }, { isComposing: false, keyCode: 229 }]) {
    let prevented = false;
    const context = execute(handler, { items: [{ id: 'one', title: '中文', completed: false }], genId: () => 'two',
      dispatch() {}, pendingFocusId: null, itemElements: new Map() });
    context.handleKeydown({ key: 'Enter', ...event, preventDefault() { prevented = true; } }, 'one');
    assert.equal(context.items.length, 1);
    assert.equal(context.pendingFocusId, null);
    assert.equal(prevented, false);
    context.handleKeydown({ key: 'Enter', isComposing: false, keyCode: 13, preventDefault() {} }, 'one');
    assert.equal(context.items.length, 2);
    assert.equal(context.pendingFocusId, 'two');
  }
});

function completionFixture(write: (id: string, changes: any) => Promise<any>) {
  const source = card.slice(card.indexOf('  let moveTimeout: any = null;'), card.indexOf('  // 删除任务'));
  const cleanup = card.match(/onDestroy\(\(\) => \{([\s\S]*?)\n  \}\);/)![1];
  let timer: (() => void) | undefined;
  const messages: string[] = [];
  const context = execute(source + `\nfunction destroyComponent(){${cleanup}}\nfunction state(){return {pendingDone,completionApplied,completionInFlight,isMoving};}`, {
    task: { id: 'one', status: 'todo' }, currentView: 'today', expanded: false, mode: 'create', destroyed: false,
    store: { tasks: { updateTask: write } }, showMessage: (message: string) => messages.push(message),
    setTimeout(callback: () => void) { timer = callback; return 1; }, clearTimeout() { timer = undefined; },
    console: { error() {} }, document: { removeEventListener() {} }, window: { removeEventListener() {} },
    handleOutsideClick() {}, handleCardExpanded() {}, handleDropdownOutside() {}, copyFeedbackTimer: null, touchDragTimer: null,
  });
  return { context, messages, fire: () => { const next = timer; timer = undefined; next?.(); }, hasTimer: () => !!timer };
}

test('failed completion releases all local pending state and displays an error', async () => {
  const f = completionFixture(async () => { throw new Error('offline'); });
  await f.context.handleToggle(click);
  f.fire();
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(f.context.state())), {
    pendingDone: false, completionApplied: false, completionInFlight: false, isMoving: false,
  });
  assert.equal(f.messages.length, 1);
});

test('repeated clicks and destruction during a completion write never apply it twice', async () => {
  let resolve!: (value: any) => void;
  const writes: any[] = [];
  const f = completionFixture(async (id, changes) => {
    writes.push({ id, ...changes });
    return new Promise(done => { resolve = done; });
  });
  await f.context.handleToggle(click);
  f.fire();
  await f.context.handleToggle(click);
  f.context.destroyComponent();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].status, 'done');
  resolve({ id: 'one', status: 'done' });
  await flush();
  assert.equal(f.context.state().completionApplied, true);
  assert.equal(f.context.state().completionInFlight, false);
  assert.equal(writes.length, 1);
});

test('destruction within the undo window commits once and cancels the delayed callback', async () => {
  let writes = 0;
  const f = completionFixture(async () => { writes++; return { id: 'one', status: 'done' }; });
  await f.context.handleToggle(click);
  f.context.destroyComponent();
  f.fire();
  await flush();
  assert.equal(f.hasTimer(), false);
  assert.equal(writes, 1);
});

test('undo writes an explicit todo state once and absent tasks are not marked successful', async () => {
  const writes: any[] = [];
  const f = completionFixture(async (_id, changes) => { writes.push(changes); return undefined; });
  f.context.task.status = 'done';
  await f.context.handleToggle(click);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].status, 'todo');
  assert.equal(writes[0].completedDate, undefined);
  assert.equal(f.context.state().completionApplied, false);
  assert.equal(f.context.state().pendingDone, false);
  assert.match(f.messages[0], /移走或删除/);
});

test('create retries reuse one immutable submission and ignore repeated clicks while saving', async () => {
  const source = card.slice(card.indexOf('  let isCreating = false;'), card.indexOf('  // 键盘事件'));
  const groups: any[] = [];
  let prepared = 0;
  let resolve!: (value: any) => void;
  let reject!: (reason: Error) => void;
  let dispatched = 0;
  const context = execute(source, {
    title: 'Parent', notes: '', startDate: undefined, deadline: undefined, repeatRule: undefined, someday: false,
    selectedTags: [], projectId: undefined, areaId: undefined, headingId: undefined, priority: 'none',
    prefilledData: undefined, presetView: undefined, currentView: 'inbox', currentViewId: undefined, presetHeadingId: undefined,
    mobile: true, destroyed: false, titleInput: null, checklist: [{ id: 'row', title: 'Child', completed: false }],
    closeMobilePicker() {}, showMessage() {}, console: { error() {} }, dispatch() { dispatched++; },
    store: { tasks: {
      prepareTaskGroup(data: any, items: any[]) { prepared++; return [{ id: 'parent', ...data }, ...items.map(item => ({ ...item, id: 'child', parentId: 'parent' }))]; },
      createTaskGroup(group: any[]) { groups.push(group); return new Promise((yes, no) => { resolve = yes; reject = no; }); },
    } },
  });
  const first = context.handleCreate();
  await context.handleCreate();
  context.cancelCreate();
  assert.equal(groups.length, 1);
  assert.equal(dispatched, 0, 'cancel must not discard a live submission');
  reject(new Error('response lost'));
  await first;
  const retry = context.handleCreate();
  assert.equal(prepared, 1);
  assert.equal(groups[1], groups[0]);
  resolve(groups[0][0]);
  await retry;
  assert.equal(dispatched, 1);
  assert.equal(context.title, '');
});
