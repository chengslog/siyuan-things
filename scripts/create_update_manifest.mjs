import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function writeUpdateManifest(root = process.cwd()) {
  const plugin = JSON.parse(readFileSync(resolve(root, 'plugin.json'), 'utf8'));
  if (plugin.name !== 'siyuan-things' || !/^\d+\.\d+\.\d+$/.test(plugin.version)) {
    throw new Error('Expected a stable siyuan-things plugin version');
  }
  const bytes = readFileSync(resolve(root, 'package.zip'));
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('Invalid package.zip size');
  const manifest = { schemaVersion: 1, plugin: plugin.name, version: plugin.version,
    size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  writeFileSync(resolve(root, 'update.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) writeUpdateManifest();
