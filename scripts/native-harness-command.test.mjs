import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runNativeCommand } from './native-harness-command.mjs';

const anchor = fileURLToPath(new URL('./native-harness-command.py', import.meta.url));
const test = (name, run) => nodeTest(name, { skip: process.platform === 'win32' }, run);
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'native-command-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, command: process.execPath, args: [], cwd: root,
    logPath: path.join(root, 'command.log'), receiptPath: path.join(root, 'command.json'), timeoutMs: 2000 };
}
async function until(check, milliseconds = 2000) {
  const deadline = performance.now() + milliseconds;
  do { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 20)); } while (performance.now() < deadline);
  assert.fail('fixture condition did not complete');
}
function absent(pid) {
  try { process.kill(pid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; }
}
async function failedRun(options) {
  let result;
  await assert.rejects(runNativeCommand(options), (error) => { result = error.receipt; return Boolean(result); });
  assert.deepEqual(JSON.parse(await readFile(options.receiptPath, 'utf8')), result);
  return result;
}

test('successful native commands retain both output streams and acknowledge cleanup', async (t) => {
  const options = await fixture(t);
  const lines = [];
  options.args = ['-e', "console.log('stage-ready'); console.error('diagnostic-kept')"];
  options.onLine = (line) => lines.push(line);
  const receipt = await runNativeCommand(options);
  assert.equal(receipt.exitCode, 0);
  assert.equal(receipt.timedOut, false);
  assert.equal(receipt.cleanupComplete, true);
  assert.equal(receipt.outputComplete, true);
  assert.equal(receipt.ownerAcknowledged, true);
  assert.deepEqual(lines, ['stage-ready']);
  const log = await readFile(options.logPath, 'utf8');
  assert.match(log, /stage-ready/); assert.match(log, /diagnostic-kept/);
  assert.equal(absent(receipt.owner.anchorPid), true);
});

test('genuine command failure retains its exit status and diagnostic output', async (t) => {
  const options = await fixture(t);
  options.args = ['-e', "console.error('deliberate-command-failure');process.exit(17)"];
  const receipt = await failedRun(options);
  assert.equal(receipt.exitCode, 17);
  assert.equal(receipt.owner.rootExitCode, 17);
  assert.equal(receipt.cleanupComplete, true);
  assert.match(await readFile(options.logPath, 'utf8'), /deliberate-command-failure/);
});

test('a root exit cannot turn a deadline with inherited open output into success', async (t) => {
  const options = await fixture(t);
  const pidFile = path.join(options.root, 'child.pid');
  const child = path.join(options.root, 'child.cjs');
  const parent = path.join(options.root, 'parent.cjs');
  await writeFile(child, "require('node:fs').writeFileSync(process.argv[2],String(process.pid));console.log('descendant-ready');setTimeout(()=>process.exit(0),7000);");
  await writeFile(parent, "require('node:child_process').spawn(process.execPath,process.argv.slice(2),{stdio:['ignore',process.stdout,process.stderr]}).unref();process.exit(0);");
  options.args = [parent, child, pidFile]; options.timeoutMs = 2000;
  const receipt = await failedRun(options);
  assert.equal(receipt.exitCode, 124);
  assert.equal(receipt.timedOut, true);
  assert.equal(receipt.owner.rootExitCode, 0);
  assert.equal(receipt.cleanupComplete, true);
  assert.equal(receipt.outputComplete, true);
  assert.ok(receipt.elapsedMs < 7000);
  const pid = Number(await readFile(pidFile, 'utf8'));
  await until(() => absent(pid));
  assert.match(await readFile(options.logPath, 'utf8'), /descendant-ready/);
});

test('a command ignoring graceful shutdown is killed only within its anchored group', async (t) => {
  const options = await fixture(t);
  options.args = ['-e', "process.on('SIGTERM',()=>{});console.log('ignore-ready');setTimeout(()=>process.exit(0),9000)"];
  options.timeoutMs = 2000;
  const receipt = await failedRun(options);
  assert.equal(receipt.exitCode, 124);
  assert.equal(receipt.timedOut, true);
  assert.equal(receipt.owner.killIssued, true);
  assert.equal(receipt.cleanupComplete, true);
  assert.equal(receipt.outputComplete, true);
  assert.ok(receipt.elapsedMs >= 6900 && receipt.elapsedMs < 8000);
  assert.ok(receipt.owner.shutdownElapsedSeconds >= 5);
  assert.equal(absent(receipt.owner.anchorPid), true);
  await until(() => absent(receipt.owner.commandPid));
});

test('cancellation is a failure and leaves a distinct unrelated leased process alive', async (t) => {
  const options = await fixture(t);
  const stop = path.join(options.root, 'stop-control');
  const control = spawn(process.execPath, ['-e', "const fs=require('node:fs');const end=Date.now()+9000;setInterval(()=>{if(fs.existsSync(process.argv[1])||Date.now()>end)process.exit(0)},20)", stop], { stdio: 'ignore' });
  const controlClosed = once(control, 'close');
  const controller = new AbortController();
  options.signal = controller.signal;
  options.args = ['-e', "console.log('cancel-ready');setTimeout(()=>process.exit(0),7000)"];
  options.onLine = (line) => { if (line === 'cancel-ready') controller.abort(); };
  try {
    const receipt = await failedRun(options);
    assert.equal(receipt.exitCode, 130);
    assert.equal(receipt.cancelled, true);
    assert.equal(receipt.cleanupComplete, true);
    assert.equal(control.exitCode, null);
    assert.equal(absent(control.pid), false);
    await until(() => absent(receipt.owner.commandPid));
  } finally {
    await writeFile(stop, 'stop'); await controlClosed;
  }
});

test('an already cancelled command does not launch a process', async (t) => {
  const options = await fixture(t);
  const controller = new AbortController(); controller.abort();
  options.signal = controller.signal;
  options.args = ['-e', "throw Error('must not execute')"];
  const receipt = await failedRun(options);
  assert.equal(receipt.exitCode, 130);
  assert.equal(receipt.owner, null);
  assert.equal(receipt.cleanupComplete, true);
});

test('unexpected anchor loss cannot report a successful command from a stale owner record', async (t) => {
  const options = await fixture(t);
  options.command = 'python3';
  options.args = ['-c', "import os,signal; parent=os.getppid(); assert parent==os.getpgrp()==os.getsid(0); os.kill(parent,signal.SIGKILL); print('root-after-anchor-loss',flush=True)"];
  const receipt = await failedRun(options);
  assert.equal(receipt.exitCode, 125);
  assert.equal(receipt.ownerAcknowledged, false);
  assert.match(await readFile(options.logPath, 'utf8'), /root-after-anchor-loss/);
});

test('the anchor refuses an inherited foreign session before launching its command', async (t) => {
  const options = await fixture(t);
  const forbidden = path.join(options.root, 'must-not-exist');
  const child = spawn('python3', [anchor, '--receipt', options.receiptPath + '.owner.json', '--timeout-seconds', '1', '--', process.execPath, '-e', "require('node:fs').writeFileSync(process.argv[1],'bad')", forbidden], { detached: false, stdio: 'ignore' });
  const [code] = await once(child, 'close');
  assert.equal(code, 125);
  await assert.rejects(readFile(forbidden), { code: 'ENOENT' });
});

test('a command exiting zero after deadline termination still fails as timed out', async (t) => {
  const options = await fixture(t);
  options.args = ['-e', "process.on('SIGTERM',()=>{console.log('late-zero-exit');process.exit(0)});console.log('ready');setTimeout(()=>process.exit(0),7000)"];
  options.timeoutMs = 1000;
  const receipt = await failedRun(options);
  assert.equal(receipt.exitCode, 124);
  assert.equal(receipt.owner.rootExitCode, 0);
  assert.equal(receipt.cleanupComplete, true);
  assert.match(await readFile(options.logPath, 'utf8'), /late-zero-exit/);
});

test('a line-consumer failure stops owned work and preserves output as failure', async (t) => {
  const options = await fixture(t);
  options.args = ['-e', "console.log('trigger-consumer');setTimeout(()=>process.exit(0),7000)"];
  options.onLine = () => { throw new Error('consumer failed'); };
  const receipt = await failedRun(options);
  assert.equal(receipt.exitCode, 125);
  assert.match(receipt.error, /consumer failed/);
  assert.equal(receipt.cleanupComplete, true);
  assert.match(await readFile(options.logPath, 'utf8'), /trigger-consumer/);
});

test('output escaping the admitted session is incomplete failure, not a truncated success', async (t) => {
  const options = await fixture(t);
  const pidFile = path.join(options.root, 'escaped.pid');
  const stop = path.join(options.root, 'stop-escaped');
  const leaf = path.join(options.root, 'escaped.cjs');
  await writeFile(leaf, "const fs=require('node:fs');fs.writeFileSync(process.argv[2],String(process.pid));console.log('escaped-output');const end=Date.now()+9000;setInterval(()=>{if(fs.existsSync(process.argv[3])||Date.now()>end)process.exit(0)},20);");
  options.args = ['-e', "require('node:child_process').spawn(process.execPath,process.argv.slice(1),{detached:true,stdio:['ignore',process.stdout,process.stderr]}).unref();process.exit(0)", leaf, pidFile, stop];
  options.timeoutMs = 1000;
  try {
    const receipt = await failedRun(options);
    assert.equal(receipt.exitCode, 125);
    assert.equal(receipt.outputComplete, false);
    assert.equal(receipt.cleanupComplete, false);
    assert.match(await readFile(options.logPath, 'utf8'), /escaped-output/);
    const pid = Number(await readFile(pidFile, 'utf8'));
    assert.equal(absent(pid), false);
  } finally {
    await writeFile(stop, 'stop');
    try {
      const pid = Number(await readFile(pidFile, 'utf8'));
      await until(() => absent(pid), 3000);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
});

test('the full five-second graceful shutdown window retains a late final diagnostic', async (t) => {
  const options = await fixture(t);
  options.timeoutMs = 1000;
  options.args = ['-e', "process.on('SIGTERM',()=>{console.log('begin-graceful');setTimeout(()=>{console.log('finished-graceful');process.exit(0)},4500)});console.log('ready');setInterval(()=>{},1000)"];
  const receipt = await failedRun(options);
  assert.equal(receipt.exitCode, 124);
  assert.equal(receipt.owner.rootExitCode, 0);
  assert.equal(receipt.owner.killIssued, false);
  assert.equal(receipt.outputComplete, true);
  assert.match(await readFile(options.logPath, 'utf8'), /finished-graceful/);
});

test('a failed log write cannot claim complete retained output', async (t) => {
  const options = await fixture(t);
  options.timeoutMs = 1000;
  options.args = ['-e', "console.log('x'.repeat(20000));setTimeout(()=>process.exit(0),7000)"];
  const wrapper = path.join(options.root, 'limited.mjs');
  const moduleURL = new URL('./native-harness-command.mjs', import.meta.url).href;
  await writeFile(wrapper, "const {runNativeCommand}=await import(process.argv[2]);setTimeout(()=>process.exit(90),10000).unref();try{await runNativeCommand(JSON.parse(process.argv[3]));process.exitCode=91}catch(error){console.log(JSON.stringify(error.receipt))}");
  const child = spawn('python3', ['-c', 'import os,resource,sys;resource.setrlimit(resource.RLIMIT_FSIZE,(8192,8192));os.execv(sys.argv[1],sys.argv[1:])', process.execPath, wrapper, moduleURL, JSON.stringify(options)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  const [code] = await once(child, 'close');
  assert.equal(code, 0);
  const receipt = JSON.parse(output);
  assert.equal(receipt.exitCode, 125);
  assert.equal(receipt.cleanupComplete, true);
  assert.equal(receipt.outputComplete, false);
  assert.match(receipt.error, /EFBIG/);
  assert.equal(absent(receipt.owner.anchorPid), true);
  await until(() => absent(receipt.owner.commandPid));
});

nodeTest('Darwin process inventory errors cannot certify an empty owned group', { skip: process.platform !== 'darwin' }, async () => {
  // libproc returns zero, rather than -1, for a failed kernel query. The
  // dependency double injects that documented failure; production decides it.
  const program = `import importlib.util,ctypes,errno,sys
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('owner',sys.argv[1])
owner=importlib.util.module_from_spec(spec);spec.loader.exec_module(owner)
class Library: pass
library=Library()
def denied(*args):
 ctypes.set_errno(errno.EPERM)
 return 0
library.proc_listpids=denied
library.proc_pidinfo=lambda *args:0
owner.ctypes.CDLL=lambda *args,**kwargs:library
try:
 owner.group_members(12345)
except OSError as error:
 assert error.errno==errno.EPERM
else:
 raise AssertionError('permission uncertainty certified empty membership')
`;
  const child = spawn('python3', ['-B', '-c', program, anchor], { stdio: ['ignore', 'pipe', 'pipe'] });
  let error = '';
  child.stderr.on('data', (chunk) => { error += chunk; });
  const [code] = await once(child, 'close');
  assert.equal(code, 0, error);
});

test('terminal inspection failure does not consume unused command time', async (t) => {
  const options = await fixture(t);
  const python = path.join(options.root, 'python3');
  await writeFile(python, [
    '#!/bin/sh',
    'if [ "$2" = "--inspect-group" ]; then exit 1; fi',
    'PATH="$ORIGINAL_PATH" exec python3 "$@"',
    '',
  ].join('\n'), { mode: 0o700 });
  options.env = { ...process.env, ORIGINAL_PATH: process.env.PATH, PATH: options.root + path.delimiter + process.env.PATH };
  options.timeoutMs = 3000;
  options.args = ['-e', 'process.exit(0)'];
  const receipt = await failedRun(options);
  assert.equal(receipt.owner.phase, 'finished');
  assert.equal(receipt.owner.rootExitCode, 0);
  assert.equal(receipt.exitCode, 125);
  assert.equal(receipt.cleanupComplete, false);
  assert.equal(receipt.outputComplete, true);
  assert.ok(receipt.elapsedMs < options.timeoutMs + 1000, 'terminal inspection exceeded its observation budget');
});
