import { spawn, execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const anchor = fileURLToPath(new URL('./native-harness-command.py', import.meta.url));
const shutdownGraceMs = 5000;
const terminalObservationMs = 1000;

async function groupEmpty(groupId, remainingMs, env) {
  // Signal zero probes the anchored process group without delivering a signal.
  // ESRCH proves absence. A present group still needs the zombie-aware census.
  try {
    process.kill(-groupId, 0);
  } catch (error) {
    if (error.code === 'ESRCH') return true;
    throw error;
  }
  const { stdout } = await execute('python3', [anchor, '--inspect-group', String(groupId)],
    { timeout: Math.max(1, Math.floor(remainingMs)), maxBuffer: 8 * 1024 * 1024, env });
  const members = JSON.parse(stdout);
  if (!Array.isArray(members) || members.some((pid) => !Number.isSafeInteger(pid) || pid <= 1)) throw new Error('Invalid group census');
  return members.length === 0;
}

export async function runNativeCommand({ command, args = [], cwd, env = process.env,
  logPath, receiptPath, timeoutMs = 600_000, signal, onLine }) {
  if (process.platform === 'win32' || typeof command !== 'string' || !command
      || !Array.isArray(args) || args.some((value) => typeof value !== 'string')
      || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('A finite POSIX native command is required');
  }
  const receiptFile = await open(receiptPath, 'wx', 0o600);
  const started = performance.now();
  const receipt = { command: [command, ...args], startedAt: new Date().toISOString(),
    timeoutMs, timedOut: false, cancelled: false, exitCode: null,
    outputComplete: false, cleanupComplete: false, owner: null };
  let child;
  let log;
  let lines;
  let timer;
  let hardTimer;
  let reason;
  let outputError;
  let logWriteFailed = false;
  const request = (value) => {
    if (reason) return;
    reason = value;
    if (child?.stdin.writable) child.stdin.write(JSON.stringify({ reason }) + '\n', () => undefined);
  };
  const abort = () => request('cancelled');
  try {
    log = createWriteStream(logPath, { flags: 'wx', mode: 0o600 });
    log.on('error', (error) => { logWriteFailed = true; outputError = error; request('output-error'); });
    await once(log, 'open');
    if (signal?.aborted) {
      reason = 'cancelled';
      receipt.cleanupComplete = true;
      receipt.outputComplete = true;
    } else {
      child = spawn('python3', [anchor, '--receipt', receiptPath + '.owner.json',
        '--timeout-seconds', String(timeoutMs / 1000), '--', command, ...args],
      { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
      child.stdin.on('error', () => undefined);
      child.stdout.pipe(log, { end: false });
      child.stderr.pipe(log, { end: false });
      if (onLine) {
        lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
        lines.on('line', (line) => {
          try { onLine(line); } catch (error) { outputError = error; request('output-error'); }
        });
      }
      const closed = new Promise((resolve) => {
        child.once('close', (code, signalName) => resolve({ code, signalName }));
        child.once('error', (error) => resolve({ error }));
      });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      timer = setTimeout(() => request('timeout'), Math.max(0, started + timeoutMs - performance.now()));
      const hard = new Promise((resolve) => {
        hardTimer = setTimeout(() => resolve({ incomplete: true }),
          Math.max(0, started + timeoutMs + shutdownGraceMs + terminalObservationMs - performance.now()));
      });
      const terminal = await Promise.race([closed, hard]);
      clearTimeout(timer); clearTimeout(hardTimer);
      receipt.anchorExitCode = terminal.code ?? null;
      receipt.anchorSignal = terminal.signalName ?? null;
      receipt.outputComplete = !terminal.incomplete && !terminal.error;
      if (terminal.error) receipt.error = terminal.error.message;
      try { receipt.owner = JSON.parse(await readFile(receiptPath + '.owner.json', 'utf8')); }
      catch (error) { receipt.ownerReadError = error.code ?? error.message; }
      const owner = receipt.owner;
      const admitted = owner?.anchorPid === child.pid && owner.groupId === child.pid && owner.sessionId === child.pid;
      if (admitted && receipt.outputComplete) {
        const checkDeadline = Math.min(
          performance.now() + terminalObservationMs,
          started + timeoutMs + shutdownGraceMs + terminalObservationMs,
        );
        do {
          try { receipt.cleanupComplete = await groupEmpty(child.pid, checkDeadline - performance.now(), env); }
          catch (error) { receipt.cleanupReadError = error.code ?? error.message; }
          if (receipt.cleanupComplete) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        } while (performance.now() < checkDeadline);
      }
      receipt.ownerAcknowledged = admitted && (owner.phase === 'finished' || owner.phase === 'kill-issued');
      reason ??= owner?.reason ?? (terminal.incomplete ? 'timeout' : undefined);
      if (terminal.incomplete) {
        // This is incomplete failure, never a successful output truncation.
        request('timeout');
        child.stdin.end(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
      }
      receipt.exitCode = terminal.code;
    }
  } catch (error) {
    receipt.error = error.message;
    request('output-error');
  } finally {
    clearTimeout(timer); clearTimeout(hardTimer);
    signal?.removeEventListener('abort', abort);
    lines?.close();
    if (log && !log.closed) await new Promise((resolve) => log.end(resolve));
    if (outputError) receipt.error = outputError.message;
    if (logWriteFailed) receipt.outputComplete = false;
    receipt.timedOut = reason === 'timeout';
    receipt.cancelled = reason === 'cancelled';
    if (receipt.timedOut) receipt.exitCode = 124;
    else if (receipt.cancelled) receipt.exitCode = 130;
    else if (reason || receipt.error || !receipt.ownerAcknowledged) receipt.exitCode = 125;
    if (!receipt.cleanupComplete || !receipt.outputComplete) receipt.exitCode = 125;
    receipt.finishedAt = new Date().toISOString();
    receipt.elapsedMs = performance.now() - started;
    try { await receiptFile.writeFile(JSON.stringify(receipt, null, 2) + '\n'); }
    finally { await receiptFile.close(); }
  }
  if (receipt.exitCode !== 0) {
    const error = new Error(receipt.timedOut ? 'Native command timed out' : receipt.cancelled ? 'Native command cancelled' : `Native command failed (${receipt.exitCode}); see retained receipt`);
    error.receipt = receipt;
    throw error;
  }
  return receipt;
}
