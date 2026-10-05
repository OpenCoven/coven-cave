// Test-only external tool. Every invocation must leave its own durable record;
// it deliberately does not deduplicate, so a repeated dispatch is observable.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const [execute, project, name] = process.argv.slice(2);
assert.ok(execute === '--execute' && project && process.argv.length === 5);
assert.ok(['darwin', 'linux'].includes(process.platform), 'this counter requires POSIX fixture isolation');
assert.ok(['effect-invocations.jsonl', 'negative-control-invocations.jsonl'].includes(name));
const canonical = fs.realpathSync(project);
assert.equal(canonical, project, 'use a canonical fixture root');
const root = path.dirname(project);
assert.equal(path.dirname(root), fs.realpathSync(tmpdir()));
assert.ok(path.basename(root).startsWith('cave-activity-effects-'));
assert.equal(path.basename(project), 'project');
for (const directory of [root, project]) {
  const stat = fs.lstatSync(directory);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  assert.equal(stat.mode & 0o077, 0, 'fixture directories must be private');
  if (process.getuid) assert.equal(stat.uid, process.getuid());
}
const file = path.join(project, name);
const stat = fs.lstatSync(file);
assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'counter must be an existing regular fixture file');
assert.equal(stat.nlink, 1, 'counter must not alias another file');
assert.equal(stat.mode & 0o077, 0, 'counter must be private');
if (process.getuid) assert.equal(stat.uid, process.getuid());
const fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW);
try {
  const opened = fs.fstatSync(fd);
  assert.ok(opened.isFile() && opened.dev === stat.dev && opened.ino === stat.ino);
  assert.equal(opened.nlink, 1);
  assert.ok(opened.size < 32 * 1024, 'fixture counter exceeded its bound');
  fs.writeSync(fd, JSON.stringify({ invocationId: randomUUID() }) + '\n');
  fs.fsyncSync(fd);
  const bytes = Buffer.alloc(fs.fstatSync(fd).size);
  assert.equal(fs.readSync(fd, bytes, 0, bytes.length, 0), bytes.length);
  process.stdout.write(String(bytes.toString('utf8').split('\n').filter(Boolean).length));
} finally {
  fs.closeSync(fd);
}
