import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, symlinkSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tool = fileURLToPath(new URL('./runtime-activity-effect-counter.mjs', import.meta.url));
if (!['darwin', 'linux'].includes(process.platform)) {
  const refused = spawnSync(process.execPath, [tool, '--execute', 'unused', 'effect-invocations.jsonl'], { encoding: 'utf8' });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /requires POSIX fixture isolation/);
  console.log('runtime-activity-effect-counter.test.mjs: unsupported platform refused; POSIX durability scenarios not run');
  process.exit(0);
}
const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'cave-activity-effects-')));
const project = path.join(root, 'project');
mkdirSync(project, { mode: 0o700 });
const counter = path.join(project, 'effect-invocations.jsonl');
const invoke = () => execFileSync(process.execPath, [tool, '--execute', project, path.basename(counter)], { encoding: 'utf8' });
try {
  writeFileSync(counter, '', { mode: 0o600 });
  assert.equal(invoke(), '1');
  assert.equal(invoke(), '2', 'a fresh tool process must expose a second real invocation');
  const entries = readFileSync(counter, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(entries.length, 2);
  assert.equal(new Set(entries.map(x => x.invocationId)).size, 2);

  // Reject a counter that redirects even into another file in this owned
  // fixture. The test never targets the operator's files.
  const outside = path.join(root, 'untouched.txt');
  writeFileSync(outside, 'untouched', { mode: 0o600 });
  rmSync(counter);
  symlinkSync(outside, counter);
  const refused = spawnSync(process.execPath, [tool, '--execute', project, path.basename(counter)], { encoding: 'utf8' });
  assert.notEqual(refused.status, 0);
  assert.equal(readFileSync(outside, 'utf8'), 'untouched');
  rmSync(counter);
  linkSync(outside, counter);
  const alias = spawnSync(process.execPath, [tool, '--execute', project, path.basename(counter)], { encoding: 'utf8' });
  assert.notEqual(alias.status, 0);
  assert.equal(readFileSync(outside, 'utf8'), 'untouched');
  console.log('runtime-activity-effect-counter.test.mjs: passed');
} finally {
  rmSync(root, { recursive: true });
}
