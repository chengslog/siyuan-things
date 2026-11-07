const SYNC_IGNORE_PATH = '/data/.siyuan/syncignore';
const OWN_RULE = 'plugins/siyuan-things/**/*';

// Only edit whole-package rules belonging to Things. Preserve comments, other
// packages, negations and more specific user exclusions byte for byte.
export function isThingsSyncIgnoreRule(line: string): boolean {
  return /^\/?plugins\/siyuan-things(?:\/?|\/\*|\/\*\*|\/\*\*\/\*)$/.test(line.trim());
}

export function removeThingsSyncIgnore(content: string): string {
  return content.replace(/[^\r\n]*(?:\r\n|\r|\n|$)/g, line =>
    isThingsSyncIgnoreRule(line) ? '' : line);
}

export function hasThingsSyncIgnore(content: string): boolean {
  return content.split(/\r\n|\r|\n/).some(isThingsSyncIgnoreRule);
}

export async function readSyncIgnore(request: typeof fetch = fetch): Promise<string> {
  const response = await request('/api/file/getFile', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: SYNC_IGNORE_PATH }),
  });
  // SiYuan can return HTTP 202 with an API error, so response.ok alone is unsafe.
  const content = await response.text();
  if (response.status === 404) return '';
  let apiError: { code?: number } | undefined;
  if (/^\s*\{/.test(content)) {
    try { apiError = JSON.parse(content); } catch { /* A rule can start with a brace. */ }
  }
  if (response.status === 202 && apiError?.code === 404) return '';
  if (response.status !== 200) {
    throw new Error(`无法读取同步忽略规则（HTTP ${response.status}），未修改任何规则。`);
  }
  if (typeof apiError?.code === 'number') throw new Error('同步规则读取失败，未修改任何规则。');
  return content;
}

export async function setThingsSyncIgnored(ignored: boolean, request: typeof fetch = fetch, expectedIgnored?: boolean): Promise<void> {
  const original = await readSyncIgnore(request);
  const actual = hasThingsSyncIgnore(original);
  if (expectedIgnored !== undefined && actual !== expectedIgnored && actual !== ignored) {
    throw new Error('Things 同步规则已在其他位置修改，请重新打开设置后保存。');
  }
  let updated = removeThingsSyncIgnore(original);
  if (ignored) {
    const newline = original.includes('\r\n') ? '\r\n' : '\n';
    updated += (updated && !/[\r\n]$/.test(updated) ? newline : '') + OWN_RULE + newline;
  }
  if (original === updated) return;
  // Do not overwrite another editor's changes observed before the write.
  if (await readSyncIgnore(request) !== original) throw new Error('同步规则刚被其他操作修改，请重试。');
  const form = new FormData();
  form.append('path', SYNC_IGNORE_PATH);
  form.append('isDir', 'false');
  form.append('file', new Blob([updated], { type: 'text/plain;charset=utf-8' }), 'syncignore');
  const response = await request('/api/file/putFile', { method: 'POST', body: form });
  if (!response.ok || (await response.json()).code !== 0) throw new Error('同步规则保存失败，请重新打开设置核对。');
  if (await readSyncIgnore(request) !== updated) throw new Error('同步规则保存后核对不一致，请重新打开设置核对。');
}
