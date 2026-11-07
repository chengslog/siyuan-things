import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Exercise the plugin's real lifecycle handlers with an isolated host. Svelte,
// SiYuan and the DOM are mocked so these tests cannot access user databases.
const compiled = ts.transpileModule(readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture() {
  const windowListeners = new Map<string, Set<() => Promise<void>>>();
  const documentListeners = new Map<string, Set<() => Promise<void>>>();
  const intervals: Array<() => void> = [];
  const messages: string[] = [];
  const navigation: Array<{ type: string; id?: string }> = [];
  const add = (listeners: typeof windowListeners) => (type: string, listener: () => Promise<void>) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(listener);
  };
  const module = { exports: {} as any };
  const window = { addEventListener: add(windowListeners), dispatchEvent() {},
    setInterval(callback: () => void) { intervals.push(callback); return intervals.length; } };
  const document = { addEventListener: add(documentListeners), visibilityState: 'visible',
    activeElement: null as null | { matches: () => boolean }, querySelector: () => null };
  runInNewContext(compiled, {
    module, exports: module.exports,
    require: (name: string) => name === 'siyuan'
      ? { Plugin: class {}, showMessage: (message: string) => messages.push(message),
        openMobileFileById: (_app: unknown, id: string) => navigation.push({ type: 'mobile', id }),
        openTab: (options: { doc: { id: string } }) => navigation.push({ type: 'desktop', id: options.doc.id }),
      } : {},
    window, document, Event: class {}, console: { log() {} },
    __PLUGIN_VERSION__: 'test', __PLUGIN_CHANGELOG__: '',
  });
  const plugin = new module.exports.default();
  const calls = { loads: 0, settings: 0, reminders: 0, refreshes: 0 };
  let failure: Error | undefined;
  plugin.isMobileFrontend = true;
  plugin.store = { storage: { mode: 'starting' }, tasks: { count: 0 }, async loadAll() {
    calls.loads++;
    if (failure) throw failure;
    plugin.store.storage.mode = 'database';
  } };
  plugin.settingUtils = { async load() { calls.settings++; }, get: () => 'none' };
  plugin.reminderService = { async start() { calls.reminders++; }, stop() {} };
  plugin.mobileApp = { refresh() { calls.refreshes++; } };
  return { plugin, calls, windowListeners, documentListeners, document, intervals, messages, navigation,
    fail(error?: Error) { failure = error; } };
}

test('failed mobile cold start retains one recovery listener and timer and recovers on focus', async () => {
  const f = fixture();
  f.fail(new Error('kernel not ready'));
  f.plugin.onLayoutReady();
  await f.plugin.startupTask;
  f.plugin.onLayoutReady();
  await f.plugin.startupTask;
  assert.equal(f.windowListeners.get('focus')?.size, 1);
  assert.equal(f.documentListeners.get('visibilitychange')?.size, 1);
  assert.equal(f.intervals.length, 1);
  assert.equal(f.calls.reminders, 0);
  assert.equal(f.plugin.dataServicesReady, false);
  f.fail();
  await [...f.windowListeners.get('focus')!][0]();
  assert.equal(f.plugin.dataServicesReady, true);
  assert.equal(f.calls.settings, 1);
  assert.equal(f.calls.reminders, 1);
  assert.ok(f.calls.refreshes > 0);
  await [...f.documentListeners.get('visibilitychange')!][0]();
  assert.equal(f.calls.reminders, 1, 'refreshing must not start duplicate reminder services');
});

test('layout returns before slow storage so the host can mount the dock', async () => {
  const f = fixture();
  let release!: () => void;
  f.plugin.store.loadAll = () => new Promise<void>(resolve => { release = resolve; });
  assert.equal(f.plugin.onLayoutReady(), undefined, 'host must not await network reads');
  const pending = f.plugin.startupTask;
  assert.equal(f.plugin.dataServicesReady, false);
  f.plugin.onLayoutReady();
  assert.equal(f.plugin.startupTask, pending, 'duplicate layout callbacks share startup');
  release();
  await pending;
  assert.equal(f.plugin.dataServicesReady, true);
  assert.equal(f.calls.settings, 1);
  assert.equal(f.calls.reminders, 1);
});

test('unloading during background startup does not start services or report a stale error', async () => {
  const f = fixture();
  let reject!: (error: Error) => void;
  f.plugin.store.loadAll = () => new Promise<void>((_resolve, fail) => { reject = fail; });
  f.plugin.onLayoutReady();
  const pending = f.plugin.startupTask;
  f.plugin.unloaded = true;
  reject(new Error('connection lost'));
  await pending;
  assert.equal(f.calls.settings, 0);
  assert.equal(f.calls.reminders, 0);
  assert.equal(f.messages.length, 0);
});

test('concurrent manual and foreground recovery share startup initialization', async () => {
  const f = fixture();
  await Promise.all([f.plugin.refreshStorage(), f.plugin.handleStorageFocus(), f.plugin.refreshStorage()]);
  assert.equal(f.calls.loads, 1);
  assert.equal(f.calls.settings, 1);
  assert.equal(f.calls.reminders, 1);
});

test('a mobile sync failure reports the error, releases sync state and remains retryable', async () => {
  const f = fixture();
  f.plugin.handleSyncStart();
  f.fail(new Error('source unavailable'));
  await f.plugin.handleSyncEnd();
  assert.equal(f.plugin.syncInProgress, false);
  assert.ok(f.messages.some(message => message.includes('source unavailable')));
  f.fail();
  await f.plugin.refreshStorage();
  assert.equal(f.plugin.dataServicesReady, true);
});

test('a closed kernel during shutdown does not show background error dialogs or retry reads', async () => {
  const f = fixture();
  f.fail(new Error('思源数据库请求失败：sql: database is closed'));
  f.plugin.handleSyncStart();
  await f.plugin.handleSyncEnd();
  assert.equal(f.plugin.syncInProgress, false);
  assert.equal(f.calls.loads, 1);
  assert.equal(f.messages.length, 0);
  await f.plugin.handleStorageFocus();
  assert.equal(f.calls.loads, 2);
  assert.equal(f.plugin.storageRefreshBusy, false);
  assert.equal(f.messages.length, 0);
  f.fail();
  await f.plugin.handleStorageFocus();
  assert.equal(f.plugin.dataServicesReady, true, 'a live window can recover on the next normal refresh');
});

test('a hidden or actively edited mobile view is not refreshed in the background', async () => {
  const f = fixture();
  f.document.visibilityState = 'hidden';
  await f.plugin.handleStorageFocus();
  assert.equal(f.calls.loads, 0);
  f.document.visibilityState = 'visible';
  f.document.activeElement = { matches: () => true };
  await f.plugin.handleStorageFocus();
  assert.equal(f.calls.loads, 0);
  f.document.activeElement = null;
  f.plugin.syncInProgress = true;
  await f.plugin.handleStorageFocus();
  assert.equal(f.calls.loads, 0);
  f.plugin.syncInProgress = false;
  f.plugin.unloaded = true;
  await f.plugin.handleStorageFocus();
  await f.plugin.refreshStorage();
  assert.equal(f.calls.loads, 0);
});

test('opening the mobile data center dismisses overlays before native navigation', () => {
  const f = fixture();
  f.plugin.store.storage.docId = 'data-center';
  f.plugin.closeMobileTaskPage = () => f.navigation.push({ type: 'close-task-page' });
  const dialog = { destroy: () => f.navigation.push({ type: 'close-settings' }) };
  f.plugin.openDataCenter(dialog);
  assert.deepEqual(f.navigation, [
    { type: 'close-settings' }, { type: 'close-task-page' }, { type: 'mobile', id: 'data-center' },
  ]);
  f.plugin.isMobileFrontend = false;
  f.plugin.openDataCenter(dialog);
  assert.deepEqual(f.navigation.at(-1), { type: 'desktop', id: 'data-center' });
});

test('narrow Things panes keep pinned navigation, but respect manual hiding and tiny windows', () => {
  const f = fixture();
  f.plugin.isMobileFrontend = false;
  let override = false;
  let floating = true;
  let active = true;
  const dock = {
    pin: true,
    getResponsivePreferredSize: () => 232,
    hasResponsiveManualOverride: () => override,
    prepareForManualResize: () => { override = true; },
    clearResponsiveManualOverride: () => { override = false; },
    isResponsiveFloating: () => floating,
    setResponsiveFloating: (value: boolean) => { floating = value; },
  };
  const outer = { element: { clientWidth: 650 } };
  const layout = { leftDock: dock, centerLayout: { children: [{}], parent: outer } };
  const root = { isConnected: true, getClientRects: () => [{}], closest: () => null };
  f.plugin.getRuntimeLayout = () => layout;
  f.plugin.findDockModel = () => ({ dock, type: 'things_nav' });
  f.plugin.getThingsDockButton = () => ({ classList: { contains: () => active } });
  f.plugin.preserveThingsNavigation(root, 320);
  assert.equal(floating, false, 'AI can collapse without making the navigation float');
  assert.equal(override, true);
  active = false;
  f.plugin.preserveThingsNavigation(root, 320);
  assert.equal(override, false, 'manual close releases the temporary priority');
  active = true;
  outer.element.clientWidth = 500;
  floating = true;
  f.plugin.preserveThingsNavigation(root, 320);
  assert.equal(floating, true, 'extremely narrow windows retain native fallback');
  outer.element.clientWidth = 650;
  dock.pin = false;
  f.plugin.preserveThingsNavigation(root, 320);
  assert.equal(floating, true, 'unpinned navigation stays floating');
  dock.pin = true;
  override = true;
  f.plugin.preserveThingsNavigation(root, 320);
  f.plugin.releaseThingsNavigation(root);
  assert.equal(override, true, 'never clear a manual override owned by the user');
});
