import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { writeUpdateManifest } from '../scripts/create_update_manifest.mjs';

import {
  compareStableVersions,
  GITHUB_RELEASE_API,
  GITHUB_UPDATE_MANIFEST,
  loadGitHubRelease,
  releaseFromUpdateManifest,
  diagnoseGitHubResponse,
  formatGitHubDiagnostics,
  expectedSha256,
  readGitHubPackage,
  resolveGitHubUpdate,
  type GitHubRelease,
} from "../src/utils/githubUpdater.ts";

test('403 diagnostics distinguish rate limits and never export raw IPs or credentials', async () => {
  const response = Response.json({ message: 'API rate limit exceeded for 192.0.2.1 token=private-secret' }, {
    status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1794070000', 'x-github-request-id': 'ABCD:1234' },
  });
  const diagnosis = await diagnoseGitHubResponse(response, '版本检查', 'https://api.github.com/repos/chengslog/siyuan-things/releases/latest?token=private-secret');
  assert.match(diagnosis.reason, /额度已用尽/);
  assert.equal(diagnosis.remaining, '0');
  assert.equal(diagnosis.requestId, 'ABCD:1234');
  const report = formatGitHubDiagnostics('0.8.0', '3.8.8', 'desktop', [diagnosis]);
  assert.doesNotMatch(report, /192\.0\.2\.1|private-secret|\?token/);
  const secondary = await diagnoseGitHubResponse(Response.json({ message: 'secondary rate limit' }, { status: 403 }), '下载', diagnosis.url);
  assert.match(secondary.reason, /频率/);
});

test('HTML gateway responses remain unclassified and private response bodies stay hidden', async () => {
  const diagnosis = await diagnoseGitHubResponse(new Response('<html>private-proxy-information</html>', {
    status: 403, headers: { 'content-type': 'text/html' },
  }), '版本检查', 'https://api.github.com/repos/chengslog/siyuan-things/releases/latest');
  assert.match(diagnosis.reason, /尚不能确定/);
  assert.equal(diagnosis.remaining, null);
  assert.doesNotMatch(JSON.stringify(diagnosis), /private-proxy-information/);
});

const release = (overrides: Partial<GitHubRelease> = {}): GitHubRelease => ({
  tag_name: "v0.6.0",
  draft: false,
  prerelease: false,
  html_url: "https://github.com/chengslog/siyuan-things/releases/tag/v0.6.0",
  assets: [{
    name: "package.zip",
    url: "https://api.github.com/repos/chengslog/siyuan-things/releases/assets/1",
    browser_download_url: "https://github.com/chengslog/siyuan-things/releases/download/v0.6.0/package.zip",
    size: 600_000,
    digest: `sha256:${"a".repeat(64)}`,
  }],
  ...overrides,
});

const manifest = { schemaVersion: 1, plugin: 'siyuan-things', version: '0.12.0', size: 600_000, sha256: 'b'.repeat(64) };

test('a primary API quota error uses official metadata and pins download to its version', async () => {
  const requests: string[] = [], stages: string[] = [];
  const result = await loadGitHubRelease({
    request: (async (url) => {
      requests.push(String(url));
      return requests.length === 1
        ? Response.json({ message: 'API rate limit exceeded' }, { status: 403, headers: { 'x-ratelimit-remaining': '0' } })
        : Response.json(manifest);
    }) as typeof fetch,
    inspect: async (response, stage) => { stages.push(stage); if (!response.ok) throw new Error('rate limited'); },
  });
  assert.deepEqual(requests, [GITHUB_RELEASE_API, GITHUB_UPDATE_MANIFEST]);
  assert.equal(stages.length, 2);
  const update = resolveGitHubUpdate(result, '0.11.1')!;
  assert.equal(update.asset.browser_download_url, 'https://github.com/chengslog/siyuan-things/releases/download/v0.12.0/package.zip');
  assert.equal(update.asset.url, undefined);
  assert.equal(expectedSha256(update.asset), manifest.sha256);
});

test('API success needs no fallback, and secondary or unknown 403 limits are not retried', async () => {
  for (const response of [Response.json(release()),
    Response.json({ message: 'secondary rate limit' }, { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
    new Response('gateway denied', { status: 403 })]) {
    let calls = 0;
    const work = loadGitHubRelease({ request: (async () => { calls++; return response; }) as typeof fetch });
    if (response.ok) assert.equal((await work).tag_name, 'v0.6.0');
    else await assert.rejects(work);
    assert.equal(calls, 1);
  }
});

test('network failure can use metadata but cancellation never starts a fallback', async () => {
  let calls = 0;
  const result = await loadGitHubRelease({ request: (async () => {
    if (++calls === 1) throw new TypeError('network unavailable');
    return Response.json(manifest);
  }) as typeof fetch });
  assert.equal(result.tag_name, 'v0.12.0');
  const controller = new AbortController();
  calls = 0;
  await assert.rejects(loadGitHubRelease({ signal: controller.signal, request: (async () => {
    calls++; controller.abort(); throw new DOMException('Aborted', 'AbortError');
  }) as typeof fetch }));
  assert.equal(calls, 1);
});

test('fallback rejects malformed metadata, oversized content, and absent release metadata', async () => {
  for (const invalid of [{ ...manifest, plugin: 'other' }, { ...manifest, version: '../evil' },
    { ...manifest, version: '0.12.0-beta' }, { ...manifest, size: 21 * 1024 * 1024 },
    { ...manifest, size: 1.2 }, { ...manifest, sha256: 'bad' }, null]) {
    assert.throws(() => releaseFromUpdateManifest(invalid));
  }
  const pinned = releaseFromUpdateManifest({ ...manifest, url: 'https://untrusted.example/package.zip' });
  assert.match(pinned.assets[0].browser_download_url, /^https:\/\/github.com\//);
  for (const fallback of [new Response('x'.repeat(4097)), new Response('missing', { status: 404 })]) {
    let calls = 0;
    await assert.rejects(loadGitHubRelease({ request: (async () => ++calls === 1
      ? Response.json({ message: 'API rate limit exceeded' }, { status: 403 }) : fallback) as typeof fetch }), /update.json/);
  }
});

test('release metadata generator records the exact package size and SHA-256', () => {
  const root = mkdtempSync(join(tmpdir(), 'things-update-'));
  try {
    const bytes = Buffer.from('release package fixture');
    writeFileSync(join(root, 'plugin.json'), JSON.stringify({ name: 'siyuan-things', version: '0.12.0' }));
    writeFileSync(join(root, 'package.zip'), bytes);
    writeUpdateManifest(root);
    const generated = JSON.parse(readFileSync(join(root, 'update.json'), 'utf8'));
    assert.equal(generated.size, bytes.length);
    assert.equal(generated.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(releaseFromUpdateManifest(generated).tag_name, 'v0.12.0');
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    rmSync(root, { recursive: true });
  }
});

test("compares stable semantic versions without lexicographic mistakes", () => {
  assert.equal(compareStableVersions("v0.10.0", "0.9.9"), 1);
  assert.equal(compareStableVersions("0.5.1", "v0.5.1"), 0);
  assert.equal(compareStableVersions("0.5.0", "0.5.1"), -1);
  assert.equal(compareStableVersions("0.6.0-beta.1", "0.5.1"), null);
});

test("accepts only a newer stable release with a bounded package.zip", () => {
  assert.equal(resolveGitHubUpdate(release(), "0.5.1")?.version, "0.6.0");
  assert.equal(resolveGitHubUpdate(release({ tag_name: "v0.5.1" }), "0.5.1"), null);
  assert.equal(resolveGitHubUpdate(release({ prerelease: true }), "0.5.1"), null);
  assert.throws(
    () => resolveGitHubUpdate(release({ assets: [] }), "0.5.1"),
    /package\.zip/,
  );
});

test("reads GitHub's sha256 digest when available", () => {
  assert.equal(expectedSha256(release().assets[0]), "a".repeat(64));
  assert.equal(expectedSha256({ ...release().assets[0], digest: "sha512:abcd" }), null);
});

test("streams package data and reports monotonic download progress", async () => {
  const percentages: number[] = [];
  const response = new Response(new Uint8Array([1, 2, 3, 4]), {
    headers: { "content-type": "application/zip" },
  });
  const blob = await readGitHubPackage(response, 4, ({ percent }) => percentages.push(percent));
  assert.equal(blob.size, 4);
  assert.equal(percentages[0], 0);
  assert.equal(percentages.at(-1), 100);
});

test("rejects a download larger than the release asset declaration", async () => {
  const response = new Response(new Uint8Array([1, 2, 3]));
  await assert.rejects(() => readGitHubPackage(response, 2), /大小超过/);
});
