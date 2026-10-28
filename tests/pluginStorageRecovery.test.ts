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
  await f.plugin.onLayoutReady();
  await f.plugin.onLayoutReady();
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
