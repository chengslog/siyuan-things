// Only for explicit local-kernel integration tests. Production uses SiYuan's already-loaded Lute.
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';

export async function setupLute(kernelBase = 'http://127.0.0.1:6806') {
  if (globalThis.Lute?.New) return globalThis.Lute;
  let source;
  if (process.env.THINGS_LUTE_PATH) source = await fs.readFile(process.env.THINGS_LUTE_PATH, 'utf8');
  else {
    const url = new URL('/stage/protyle/js/lute/lute.min.js', kernelBase);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Set THINGS_LUTE_PATH for a remote kernel; only local kernel JavaScript is loaded automatically.');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Cannot load the local SiYuan Markdown engine: ${response.status}`);
    source = await response.text();
  }
  vm.runInThisContext(`(function(require) {\n${source}\n})`, { filename: 'siyuan-test-lute.js' })(createRequire(import.meta.url));
  if (typeof globalThis.Lute?.New !== 'function') throw new Error('The supplied runtime is not SiYuan Lute.');
  return globalThis.Lute;
}
