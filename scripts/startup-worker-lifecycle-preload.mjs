// Measurement-only preload. Records aggregate resources, never file contents.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
const output = process.env.CAVE_WORKER_PROBE_OUTPUT;
if (!output || !process.env.CAVE_WORKER_PROBE_HOME) throw new Error('probe requires an isolated output and home');
const home = process.env.CAVE_WORKER_PROBE_HOME;
if (process.env.HOME !== home || process.env.COVEN_HOME !== path.join(home, 'coven')
  || process.env.COVEN_CAVE_HOME !== path.join(home, 'coven', 'cave')) throw new Error('probe home mismatch');
const started = performance.now();
const nativeInterval = globalThis.setInterval;
const nativeClearInterval = globalThis.clearInterval;
const nativeTimeout = globalThis.setTimeout;
const timers = new Map();
let backupReads = 0;
let fetchCalls = 0;
let held = false;
let priorCpu = process.cpuUsage();
let priorAt = started;
const emit = value => fs.appendFileSync(output, JSON.stringify({ elapsedMs: performance.now() - started, ...value }) + '\n');
globalThis.setInterval = (callback, delay, ...args) => {
  const timer = nativeInterval(callback, delay, ...args);
  timers.set(timer, delay);
  return timer;
};
globalThis.clearInterval = timer => { timers.delete(timer); return nativeClearInterval(timer); };
const originalRead = fsp.readFile;
fsp.readFile = function (...args) {
  if (String(args[0]) === path.join(home, 'coven', 'cave', 'backup-sync.json')) backupReads += 1;
  return Reflect.apply(originalRead, this, args);
};
const originalOpen = fsp.open;
fsp.open = async function (...args) {
  const handle = await Reflect.apply(originalOpen, this, args);
  if (String(args[0]) !== path.join(home, 'coven', 'cave', 'config.json')) return handle;
  const original = handle.readFile;
  handle.readFile = async function (...readArgs) {
    const delay = Number(process.env.CAVE_WORKER_PROBE_DELAY_MS ?? 0);
    if (delay > 0 && globalThis.__backupSyncInFlight && !held) {
      held = true;
      emit({ event: 'archive-source-held', delayMs: delay });
      await new Promise(resolve => nativeTimeout(resolve, delay));
    }
    return Reflect.apply(original, this, readArgs);
  };
  return handle;
};
syncBuiltinESMExports();
const originalFetch = globalThis.fetch;
globalThis.fetch = function (...args) { fetchCalls += 1; return Reflect.apply(originalFetch, this, args); };
function sample(event) {
  const now = performance.now();
  const cpu = process.cpuUsage();
  const elapsed = now - priorAt;
  const cpuMs = (cpu.user - priorCpu.user + cpu.system - priorCpu.system) / 1000;
  const owner = globalThis.__backupSyncScheduler;
  emit({ event, memory: process.memoryUsage(), cpuMs, intervalMs: elapsed,
    cpuPercentOfOneCore: elapsed ? cpuMs / elapsed * 100 : 0,
    intervalDelaysMs: [...timers.values()].sort((a, b) => a - b), backupReads, fetchCalls,
    scheduled: { wanted: globalThis.__caveScheduledChatScheduler?.wanted ?? null,
      pending: Boolean(globalThis.__caveScheduledChatScheduler?.pending) },
    backup: { wanted: owner?.wanted ?? null, pending: Boolean(owner?.pending),
      inFlight: Boolean(globalThis.__backupSyncInFlight), timer: Boolean(owner?.timer),
      legacyStarted: globalThis.__backupSyncSchedulerStarted ?? null },
  });
  priorCpu = cpu; priorAt = now;
}
// Exclude the observer's own timer from the application's interval inventory.
nativeInterval(() => sample('sample'), 1_000).unref();
process.on('exit', code => { sample('exit'); emit({ event: 'exit-code', code }); });
emit({ event: 'preload', node: process.version, pid: process.pid });
