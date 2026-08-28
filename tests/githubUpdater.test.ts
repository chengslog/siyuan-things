import assert from "node:assert/strict";
import test from "node:test";

import {
  compareStableVersions,
  expectedSha256,
  readGitHubPackage,
  resolveGitHubUpdate,
  type GitHubRelease,
} from "../src/utils/githubUpdater.ts";

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
