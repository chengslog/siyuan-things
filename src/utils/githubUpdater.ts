export const GITHUB_RELEASE_API = "https://api.github.com/repos/chengslog/siyuan-things/releases/latest";
export const GITHUB_UPDATE_MANIFEST = "https://github.com/chengslog/siyuan-things/releases/latest/download/update.json";
export const MAX_GITHUB_PACKAGE_SIZE = 20 * 1024 * 1024;

/** Release-owned metadata lets updates proceed without the anonymous REST API quota. */
export function releaseFromUpdateManifest(value: unknown): GitHubRelease {
  const manifest = value as Record<string, unknown> | null;
  if (!manifest || manifest.schemaVersion !== 1 || manifest.plugin !== 'siyuan-things'
    || typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)
    || !Number.isSafeInteger(manifest.size) || Number(manifest.size) <= 0 || Number(manifest.size) > MAX_GITHUB_PACKAGE_SIZE
    || typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(manifest.sha256)) {
    throw new Error('GitHub 更新清单格式异常，已停止更新');
  }
  // Derive both destinations from the validated version, never trust URLs in downloaded JSON.
  const base = 'https://github.com/chengslog/siyuan-things/releases';
  const tag = `v${manifest.version}`;
  return {
    tag_name: tag, draft: false, prerelease: false, html_url: `${base}/tag/${tag}`,
    assets: [{ name: 'package.zip', size: Number(manifest.size), digest: `sha256:${manifest.sha256.toLowerCase()}`,
      browser_download_url: `${base}/download/${tag}/package.zip` }],
  };
}

async function isPrimaryRateLimit(response: Response): Promise<boolean> {
  if (response.status !== 403 && response.status !== 429) return false;
  let message = '';
  try { message = String((await response.clone().json()).message || ''); } catch { /* Gateway response. */ }
  // Secondary abuse limits must be respected rather than retried through another endpoint.
  return !/secondary rate limit|abuse detection/i.test(message)
    && (response.headers.get('x-ratelimit-remaining') === '0' || /API rate limit exceeded/i.test(message));
}

export async function loadGitHubRelease(options: {
  signal?: AbortSignal;
  request?: typeof fetch;
  inspect?: (response: Response, stage: string, url: string) => Promise<void>;
  onFallback?: () => void;
} = {}): Promise<GitHubRelease> {
  const request = options.request || fetch;
  let apiError: unknown;
  let response: Response | undefined;
  try {
    response = await request(GITHUB_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store', signal: options.signal,
    });
    await options.inspect?.(response, '版本检查', GITHUB_RELEASE_API);
    if (!response.ok) throw new Error(`GitHub API HTTP ${response.status}`);
    return await response.json() as GitHubRelease;
  } catch (error) {
    if (options.signal?.aborted || (response && !(await isPrimaryRateLimit(response)))) throw error;
    apiError = error;
  }
  options.onFallback?.();
  try {
    const fallback = await request(GITHUB_UPDATE_MANIFEST, { cache: 'no-store', signal: options.signal });
    await options.inspect?.(fallback, '官方更新清单', GITHUB_UPDATE_MANIFEST);
    if (!fallback.ok) throw new Error(`官方更新清单 HTTP ${fallback.status}`);
    // A manifest is a few hundred bytes. Bound reads even if Content-Length is absent or forged.
    const json = await readGitHubPackage(fallback, 4096);
    if (json.size > 4096) throw new Error('GitHub 更新清单过大');
    return releaseFromUpdateManifest(JSON.parse(await json.text()));
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error(`${apiError instanceof Error ? apiError.message : 'GitHub API 不可用'}；官方备用通道失败：${error instanceof Error ? error.message : '网络异常'}。旧版 Release 可能尚未提供 update.json。`);
  }
}

export interface GitHubRequestDiagnostic {
  stage: string;
  url: string;
  status: number;
  reason: string;
  remaining: string | null;
  reset: string | null;
  retryAfter: string | null;
  requestId: string | null;
}

export async function diagnoseGitHubResponse(response: Response, stage: string, url: string): Promise<GitHubRequestDiagnostic> {
  let message = '';
  if (!response.ok && response.headers.get('content-type')?.includes('json')) {
    try { message = String((await response.clone().json()).message || ''); } catch { /* Non-JSON gateway responses are not copied. */ }
  }
  const remaining = response.headers.get('x-ratelimit-remaining');
  const secondary = /secondary rate limit|abuse detection/i.test(message);
  const limited = response.status === 429 || ((response.status === 403) &&
    (remaining === '0' || /rate limit/i.test(message) || secondary));
  // Export only a classified reason: raw bodies can contain IPs, signed URLs,
  // proxy credentials or other private information.
  const reason = response.ok ? '请求成功' : limited
    ? (secondary ? 'GitHub 临时限制了请求频率，请稍后重试。' : 'GitHub API 请求额度已用尽，请等待额度恢复或更换网络出口。')
    : response.status === 403 ? '访问被拒绝；尚不能确定是 GitHub 限制还是代理、网关拦截。'
    : `请求失败（HTTP ${response.status}）。`;
  const target = new URL(url);
  const safeUrl = ['api.github.com', 'github.com'].includes(target.hostname)
    && target.pathname.startsWith('/' + (target.hostname === 'api.github.com' ? 'repos/' : '') + 'chengslog/siyuan-things/')
    ? target.origin + target.pathname : '非预期地址（已隐藏）';
  const safeNumber = (name: string) => {
    const value = response.headers.get(name);
    return value && /^\d{1,16}$/.test(value) ? value : null;
  };
  const requestId = response.headers.get('x-github-request-id');
  return {
    stage, url: safeUrl, status: response.status, reason,
    remaining: safeNumber('x-ratelimit-remaining'), reset: safeNumber('x-ratelimit-reset'),
    retryAfter: safeNumber('retry-after'),
    requestId: requestId && /^[a-zA-Z0-9:-]{1,100}$/.test(requestId) ? requestId : null,
  };
}

export function formatGitHubDiagnostics(version: string, siyuanVersion: string, frontend: string, attempts: GitHubRequestDiagnostic[]): string {
  return [
    'Things GitHub 更新排查信息', `Things: ${version}`, `SiYuan: ${siyuanVersion}`,
    `前端: ${frontend}`, `时间: ${new Date().toISOString()}`,
    ...attempts.map(item => [
      `阶段: ${item.stage}`, `地址: ${item.url}`, `HTTP: ${item.status}`, `判断: ${item.reason}`,
      `剩余额度: ${item.remaining ?? '未提供'}`, `额度恢复时间（Unix 秒）: ${item.reset ?? '未提供'}`,
      `重试等待（秒）: ${item.retryAfter ?? '未提供'}`, `GitHub 请求编号: ${item.requestId ?? '未提供'}`,
    ].join('\n')),
    ...(!attempts.length ? ['未收到可读取的 HTTP 响应，请提供报错截图及代理使用情况。'] : []),
  ].join('\n\n');
}

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
