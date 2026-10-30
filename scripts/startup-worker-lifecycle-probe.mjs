// Run against an already built checkout; retain each synthetic home and receipt.
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const [checkoutArg, outputArg, mode = 'disabled', delayArg = '0', automations = 'enabled'] = process.argv.slice(2);
if (!checkoutArg || !outputArg || !['missing', 'disabled', 'enabled-idle', 'enabled-due', 'reminders-due'].includes(mode)
  || !['enabled', 'disabled'].includes(automations)) {
  throw new Error('usage: node scripts/startup-worker-lifecycle-probe.mjs CHECKOUT OUTPUT_DIR [missing|disabled|enabled-idle|enabled-due|reminders-due] [HOLD_DELAY_MS] [enabled|disabled]');
}
const checkout = path.resolve(checkoutArg);
const output = path.resolve(outputArg);
await mkdir(output, { recursive: false });
const home = await mkdtemp(path.join(os.tmpdir(), 'c6-wp-'));
const coven = path.join(home, 'coven');
const cave = path.join(coven, 'cave');
const snapshots = path.join(home, 'snapshots');
await mkdir(cave, { recursive: true });
await mkdir(snapshots);
await writeFile(path.join(cave, 'config.json'), JSON.stringify({ multiHost: { mode: 'local' }, probeMarker: 'synthetic retained marker' }));
const enabled = mode.startsWith('enabled');
// reminders-due: backup disabled, one reminder already due, and (with a delay)
// the admitted delivery's store read is held while SIGTERM arrives, so the
// receipt shows whether quit truncated it (#6295). The automations switch
// measures the disabled-domain idle baseline: no reminder or scheduled timer.
if (mode === 'reminders-due') {
  const dueAt = new Date(Date.now() - 60_000).toISOString();
  await writeFile(path.join(cave, 'inbox.json'), JSON.stringify({ version: 1, items: [{
    id: 'probe-due-reminder', kind: 'reminder', title: 'synthetic due reminder', status: 'pending',
    fireAt: dueAt, firedAt: null, snoozeUntil: null, readAt: null, createdAt: dueAt, updatedAt: dueAt,
  }] }));
}
if (mode !== 'missing') await writeFile(path.join(cave, 'backup-sync.json'), JSON.stringify({
  version: 1, config: { enabled, directory: snapshots, retainCount: 2, intervalHours: 24, onQuitPush: true },
  status: { lastSuccessAt: mode === 'enabled-idle' ? new Date().toISOString() : null },
}));
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'xdg'),
  COVEN_HOME: coven, COVEN_CAVE_HOME: cave, COVEN_SOCKET: path.join(home, 'no-daemon.sock'),
  COVEN_WORKSPACES_ROOT: path.join(home, 'workspaces'), COVEN_WORKSPACE_ROOT: path.join(home, 'workspaces'),
  COVEN_CAVE_LOCAL_VAULT_KEY_FILE: path.join(cave, 'local-vault.key'),
  COVEN_CAVE_LOCAL_VAULT_FILE: path.join(cave, 'local-vault.enc.json'),
  NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', COVEN_CAVE_E2E: '1',
  COVEN_CAVE_EVENT_PLANE_ENABLED: '0', CAVE_WORKER_PROBE_HOME: home,
  CAVE_WORKER_PROBE_OUTPUT: path.join(output, 'samples.jsonl'), CAVE_WORKER_PROBE_DELAY_MS: delayArg,
  CAVE_WORKER_PROBE_REMINDER_DELAY_MS: mode === 'reminders-due' ? delayArg : '0',
  ...(automations === 'disabled' ? { COVEN_CAVE_AUTOMATIONS_ENABLED: '0' } : {}),
};
if (enabled) {
  const setup = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const m = await import(${JSON.stringify(pathToFileURL(path.join(checkout, 'src/lib/local-encrypted-vault.ts')).href)}); m.setLocalEncryptedSecret('BACKUP_SYNC_PASSPHRASE', 'synthetic lifecycle probe passphrase');`],
  { env, cwd: checkout, encoding: 'utf8' });
  await writeFile(path.join(output, 'vault-setup.log'), setup.stdout + setup.stderr);
  if (setup.status !== 0) throw new Error('synthetic vault setup failed; see receipt');
}
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
env.PORT = String(port); env.COVEN_CAVE_PORT = String(port); env.HOSTNAME = '127.0.0.1';
const git = args => {
  const result = spawnSync('git', args, { cwd: checkout, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('git provenance failed');
  return result.stdout.trim();
};
const preload = fileURLToPath(new URL('./startup-worker-lifecycle-preload.mjs', import.meta.url));
const manifest = {
  checkout, source: git(['rev-parse', 'HEAD']), dirty: git(['status', '--short']),
  buildId: (await readFile(path.join(checkout, '.next/BUILD_ID'), 'utf8')).trim(),
  customServerSha256: createHash('sha256').update(await readFile(path.join(checkout, 'server.mjs'))).digest('hex'),
  preloadSha256: createHash('sha256').update(await readFile(preload)).digest('hex'),
  mode, automations, archiveDelayMs: mode === 'reminders-due' ? 0 : Number(delayArg), reminderDelayMs: mode === 'reminders-due' ? Number(delayArg) : 0,
  home, port, env: { COVEN_CAVE_E2E: '1', NODE_ENV: 'production', COVEN_CAVE_EVENT_PLANE_ENABLED: '0', COVEN_CAVE_AUTOMATIONS_ENABLED: automations === 'disabled' ? '0' : undefined },
  environment: { platform: os.platform(), release: os.release(), arch: os.arch(), node: process.version,
    cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, totalMemoryBytes: os.totalmem(), loadAverage: os.loadavg() },
  sampleIntervalMs: 1_000, readySamples: 1, idleTargetMs: 10_000,
};
const start = performance.now();
const child = spawn(process.execPath, ['--import', preload, 'server.mjs'], { cwd: checkout, env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', bytes => { logs += bytes; }); child.stderr.on('data', bytes => { logs += bytes; });
const exited = once(child, 'exit');
let terminal = false; child.once('exit', () => { terminal = true; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  while (!logs.includes('> Ready on')) {
    if (terminal) throw new Error('server exited before readiness');
    if (performance.now() - start > 60_000) throw new Error('server readiness exceeded 60s');
    await pause(100);
  }
  manifest.logReadinessMs = performance.now() - start;
  const httpStart = performance.now();
  const response = await fetch(`http://127.0.0.1:${port}/api/backup/sync`, { signal: AbortSignal.timeout(30_000) });
  manifest.overview = { status: response.status, elapsedMs: performance.now() - httpStart, body: await response.json() };
  if (response.status !== 200) throw new Error('production backup overview failed');
  if (mode === 'enabled-due' && Number(delayArg) > 0) {
    while (!(await readFile(env.CAVE_WORKER_PROBE_OUTPUT, 'utf8')).includes('archive-source-held')) {
      if (terminal || performance.now() - start > 60_000) throw new Error('admitted archive hold not observed');
      await pause(20);
    }
  } else if (mode === 'reminders-due' && Number(delayArg) > 0) {
    while (!(await readFile(env.CAVE_WORKER_PROBE_OUTPUT, 'utf8')).includes('reminder-pass-held')) {
      if (terminal || performance.now() - start > 60_000) throw new Error('admitted reminder hold not observed');
      await pause(20);
    }
  } else {
    await pause(10_000);
  }
  const signalAt = performance.now();
  child.kill('SIGTERM');
  const [code, signal] = await Promise.race([exited, pause(7_000).then(() => { throw new Error('owned server exceeded 7s probe stop bound'); })]);
  manifest.shutdown = { code, signal, elapsedMs: performance.now() - signalAt };
  manifest.snapshotFiles = (await readdir(snapshots)).filter(file => file.endsWith('.ccbackup'));
  if (mode === 'reminders-due') {
    const inbox = JSON.parse(await readFile(path.join(cave, 'inbox.json'), 'utf8'));
    const item = inbox.items.find(entry => entry.id === 'probe-due-reminder');
    manifest.reminder = { status: item?.status ?? 'missing', firedAt: item?.firedAt ?? null, items: inbox.items.length };
  }
  const verify = createServer();
  await new Promise((resolve, reject) => { verify.once('error', reject); verify.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => verify.close(resolve));
  manifest.portReleased = true;
} catch (error) {
  manifest.failure = error instanceof Error ? error.message : String(error);
  if (!terminal) { child.kill('SIGTERM'); await Promise.race([exited, pause(7_000)]); }
  if (!terminal) throw new Error('owned process remains live; inspect receipt before any further probe');
  process.exitCode = 1;
} finally {
  await writeFile(path.join(output, 'server.log'), logs);
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}
console.log(JSON.stringify({ output, source: manifest.source, buildId: manifest.buildId, mode, shutdown: manifest.shutdown, failure: manifest.failure }));
