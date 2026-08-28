import assert from "node:assert/strict";
import test from "node:test";

import {
  compareStableVersions,
  expectedSha256,
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
