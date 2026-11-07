import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { localCodexBridge } from '../src/services/vendor/accountBridge.ts';

test('local Codex receives the task conversation over stdin with tools disabled and a read-only workspace', async () => {
  const calls: Array<{ args: string[]; options: any; input?: string }> = [];
  const fs = {
    readdirSync: () => [{ name: 'version', isDirectory: () => true }],
    existsSync: () => true,
    statSync: () => ({ mtimeMs: 1, size: 2 }),
    mkdtempSync: () => path.join('test-temp', 'isolated'),
    readFileSync: () => '{"intent":"answer","message":"OK"}',
    unlinkSync() {}, rmdirSync() {},
  };
  const client = localCodexBridge.createClient({ fs, path, os: { homedir: () => 'home', tmpdir: () => 'test-temp' }, env: {},
    spawn: (_exe: string, args: string[], options: any) => {
      const record = { args, options, input: '' }; calls.push(record);
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
      child.stdout.setEncoding = child.stderr.setEncoding = () => {};
      child.kill = () => {};
      child.stdin.end = (input: string) => {
        record.input = input;
        queueMicrotask(() => {
          if (args[0] === 'login') child.stdout.emit('data', 'Logged in using ChatGPT');
          child.emit('close', 0);
        });
      };
      return child;
    },
  });
  const messages = [{ role: 'system', content: 'You manage Things tasks. Return JSON only.' }, { role: 'user', content: 'Create a task called hello.' }];
  const content = await client.chat({ messages, webSearch: 'off' });
  assert.match(content, /"message":"OK"/);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.shell, false);
  assert.equal(calls[1].options.windowsHide, true);
  const args = calls[1].args;
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.includes('--ephemeral'));
  assert.ok(args.includes('project_doc_max_bytes=0'));
  for (const tool of ['shell_tool', 'apps', 'plugins', 'computer_use', 'multi_agent', 'hooks']) {
    const index = args.indexOf(tool); assert.equal(args[index - 1], '--disable');
  }
  assert.ok(calls[1].input?.includes(JSON.stringify(messages)));
  assert.ok(!args.some(value => value.includes('Create a task')));
});
