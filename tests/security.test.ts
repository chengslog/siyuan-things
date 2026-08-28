import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readProjectFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('sidebar renderers never interpolate persisted entity fields into HTML', () => {
  const source = readProjectFile('src/index.ts');
  const sidebarStart = source.indexOf('private renderProjects');
  const sidebarEnd = source.indexOf('private closeCreateCard');
  assert.ok(sidebarStart >= 0 && sidebarEnd > sidebarStart);

  const sidebarRenderers = source.slice(sidebarStart, sidebarEnd);
  assert.doesNotMatch(sidebarRenderers, /\$\{(?:p|a|t)\.(?:id|name|color)\}/);
  assert.match(sidebarRenderers, /\.textContent\s*=/);
  assert.match(sidebarRenderers, /\.dataset\.id\s*=/);
  assert.match(sidebarRenderers, /TAG_PALETTE\.includes/);
  assert.match(sidebarRenderers, /replaceChildren\(fragment\)/);
});

test('AI credentials are not written to configuration logs', () => {
  const settingsSource = readProjectFile('src/libs/setting-utils.ts');
  const pluginSource = readProjectFile('src/index.ts');

  assert.doesNotMatch(settingsSource, /console\.(?:debug|log)\(['"](?:Load|Save) config:/);
  assert.doesNotMatch(pluginSource, /Setting \$\{key\} saved:/);
  assert.match(pluginSource, /key === "aiApiKey"[\s\S]{0,160}el\.type = "password"/);
});

test('release workflow uses a committed lockfile and immutable official actions', () => {
  const workflow = readProjectFile('.github/workflows/release.yml');
  const gitignore = readProjectFile('.gitignore');

  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /ncipollo\/release-action/);
  assert.doesNotMatch(gitignore, /^pnpm-lock\.yaml$/m);
});
