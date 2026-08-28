export const GITHUB_RELEASE_API = "https://api.github.com/repos/chengslog/siyuan-things/releases/latest";
export const MAX_GITHUB_PACKAGE_SIZE = 20 * 1024 * 1024;

export interface GitHubReleaseAsset {
  name: string;
  url?: string;
  browser_download_url: string;
  size: number;
  digest?: string | null;
}

export interface GitHubRelease {
  tag_name: string;
  name?: string;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
  assets: GitHubReleaseAsset[];
}

export interface GitHubUpdate {
  version: string;
  releaseUrl: string;
  asset: GitHubReleaseAsset;
}

export interface GitHubDownloadProgress {
  received: number;
  total: number;
  percent: number;
}

function parseStableVersion(value: string): number[] | null {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map(Number) : null;
}

export function compareStableVersions(left: string, right: string): number | null {
  const a = parseStableVersion(left);
  const b = parseStableVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function resolveGitHubUpdate(release: GitHubRelease, currentVersion: string): GitHubUpdate | null {
  if (release.draft || release.prerelease) return null;
  const comparison = compareStableVersions(release.tag_name, currentVersion);
  if (comparison === null || comparison <= 0) return null;
  const asset = release.assets.find((item) => item.name === "package.zip");
  if (!asset || !asset.browser_download_url || asset.size <= 0 || asset.size > MAX_GITHUB_PACKAGE_SIZE) {
    throw new Error("GitHub Release 中的 package.zip 缺失或大小异常");
  }
  return {
    version: release.tag_name.replace(/^v/, ""),
    releaseUrl: release.html_url,
    asset,
  };
}

export function expectedSha256(asset: GitHubReleaseAsset): string | null {
  const digest = asset.digest?.trim().toLowerCase();
  return digest?.startsWith("sha256:") ? digest.slice("sha256:".length) : null;
}

export async function readGitHubPackage(
  response: Response,
  expectedSize: number,
  onProgress?: (progress: GitHubDownloadProgress) => void,
): Promise<Blob> {
  if (expectedSize <= 0 || expectedSize > MAX_GITHUB_PACKAGE_SIZE) {
    throw new Error("GitHub Release 中的 package.zip 大小异常");
  }

  if (!response.body) {
    const blob = await response.blob();
    onProgress?.({ received: blob.size, total: expectedSize, percent: 100 });
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let received = 0;
  let lastPercent = -1;
  onProgress?.({ received: 0, total: expectedSize, percent: 0 });

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > expectedSize || received > MAX_GITHUB_PACKAGE_SIZE) {
      await reader.cancel();
      throw new Error("下载的 package.zip 大小超过 GitHub Release 声明值");
    }
    chunks.push(value.slice().buffer as ArrayBuffer);
    const percent = Math.min(100, Math.floor((received / expectedSize) * 100));
    if (percent !== lastPercent) {
      lastPercent = percent;
      onProgress?.({ received, total: expectedSize, percent });
    }
  }

  return new Blob(chunks, {
    type: response.headers.get("content-type") || "application/zip",
  });
}
