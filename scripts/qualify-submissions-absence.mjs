#!/usr/bin/env node
// Qualifies the optional Submissions boundary against built artifacts (#6402).
//
//   node scripts/qualify-submissions-absence.mjs \
//     --absent <standalone> --included <standalone> [--baseline <standalone>]
//     [--chromium <executable>] [--out receipt.json]
//
// Build the two standalone directories from one commit, with and without
// COVEN_CAVE_INCLUDE_SUBMISSIONS=1. Copy the built server.mjs, `.next/static`,
// `public` and the packages server.mjs imports (ws, node-pty) into each.
// `--baseline` is a build from before the boundary, for the rollback row. Servers
// start the way the packaged sidecar does: server.mjs, COVEN_CAVE_BUNDLE=1 and a
// per-run token, because the proxy refuses a bare server.js. Every row uses a
// synthetic temporary home and a PATH without user tools, and a failed or skipped
// row stays in the receipt. Exits non-zero on any failure.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((part) => {
  const [key, value] = part.trim().split(/\s+/);
  return [key, value];
}));
if (!args.absent || !args.included) {
  console.error('usage: --absent <dir> --included <dir> [--baseline <dir>] [--out <file>]');
  process.exit(2);
}

const STORE = 'opencoven-submissions.json';
const SUBMISSIONS = '/api/opencoven/submissions';
const EXECUTIONS = '/api/opencoven/executions';
const RETAINED = `${SUBMISSIONS}/retained`;
const TOKEN = randomBytes(24).toString('hex');
const fetch = (url, init = {}) => globalThis.fetch(url, {
  ...init,
  headers: { ...init.headers, 'x-coven-cave-token': TOKEN },
});
const rows = [];
let currentRow = null;

function check(name, ok, detail) {
  currentRow.checks.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) });
  if (!ok) console.error(`  ✗ ${name}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`);
}

async function row(name, body) {
  currentRow = { name, checks: [] };
  rows.push(currentRow);
  console.log(`▸ ${name}`);
  try {
    await body();
  } catch (error) {
    check('row completed', false, String(error?.stack ?? error));
  }
  currentRow.ok = currentRow.checks.every((item) => item.ok);
}

const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

async function start(dir, home, env = {}) {
  const port = await freePort();
  const started = performance.now();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: dir,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      PATH: '/usr/bin:/bin',
      NODE_ENV: 'production',
      COVEN_CAVE_BUNDLE: '1',
      COVEN_CAVE_AUTH_TOKEN: TOKEN,
      HOME: home,
      COVEN_HOME: home,
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
      ...env,
    },
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-8000); });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`server did not answer: ${stderr}`);
    try {
      const response = await fetch(`${base}${RETAINED}`);
      if (response.status > 0) break;
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const readyMs = Math.round(performance.now() - started);
  return {
    base,
    pid: child.pid,
    readyMs,
    exited,
    stderr: () => stderr,
    stop: async (signal = 'SIGTERM') => {
      child.kill(signal);
      const exit = await exited;
      // Every graceful stop is graded, and an unclean one keeps its own reason.
      // server.close waits on open keep-alive sockets, so exit 1 with only
      // `http: pending` also happens before the boundary (9 of 10 burst stops on
      // the baseline). It is counted separately, and a worker that failed to
      // drain still fails the row.
      if (signal === 'SIGTERM') {
        const httpOnly = exit.code === 1
          && /http: \{ status: 'pending' \}/.test(stderr)
          && !/status: '(?!drained|pending)\w+'/.test(stderr);
        if (httpOnly) currentRow.httpPendingStops = (currentRow.httpPendingStops ?? 0) + 1;
        check(`SIGTERM stop of ${path.basename(dir)} exits cleanly`, stoppedCleanly(exit) || httpOnly, { exit, stderr: stderr.slice(-1500) });
      }
      return exit;
    },
  };
}

const stoppedCleanly = (exit) => exit.code === 0 || exit.code === 143 || exit.signal === 'SIGTERM';
const json = async (response) => ({ status: response.status, body: await response.json().catch(() => null) });
const post = (base, route, body) => fetch(`${base}${route}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const sha = (text) => createHash('sha256').update(text).digest('hex');
const tempHome = () => mkdtemp(path.join(os.tmpdir(), 'cave-submissions-qualify-'));
const read = (home) => readFile(path.join(home, STORE), 'utf8');

function rssKb(pid) {
  return Number(spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim()) || null;
}
function descriptors(pid) {
  const result = spawnSync('/usr/sbin/lsof', ['-p', String(pid)], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim().split('\n').length - 1 : null;
}
function childCount(pid) {
  return spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean).length;
}

const packageFor = (version) => ({
  manifest: {
    name: 'Synthetic Runtime',
    version,
    description: 'A synthetic runtime for the qualification matrix.',
    type: 'runtime',
    capabilities: ['shell.exec'],
    requiredServices: [],
    permissions: { env: [], config: [], filesystem: ['read'] },
    entrypoints: { invoke: 'bin/run', health: 'bin/run health' },
    runtime: {
      id: 'synthetic-runtime',
      invocation: 'stdio',
      protocols: ['opencoven.runtime.v1'],
      capabilities: ['shell.exec'],
      config: { env: [] },
      healthCheck: { command: 'bin/run health' },
      sandbox: { network: 'restricted', filesystem: 'workspace' },
    },
    artifacts: ['bin/run'],
    examples: [{ name: 'smoke', path: 'examples/smoke.json' }],
    docs: ['docs/runtime.md'],
  },
  artifacts: ['manifest.json', 'bin/run', 'examples/smoke.json'],
  files: {
    'bin/run': { size: 8, sha256: 'a'.repeat(64) },
    'examples/smoke.json': '{}',
  },
});

async function publish(base, version) {
  return json(await post(base, SUBMISSIONS, { package: packageFor(version), publish: true }));
}

async function assertRefused(base, code, label) {
  const responses = await Promise.all([
    fetch(`${base}${SUBMISSIONS}`).then(json),
    post(base, SUBMISSIONS, { package: packageFor('9.9.9'), publish: true }).then(json),
    post(base, EXECUTIONS, { harnessId: 'x' }).then(json),
  ]);
  for (const [index, response] of responses.entries()) {
    check(`${label} direct request ${index} refuses with ${code}`, response.status === 503 && response.body?.code === code, response);
  }
}

await row('fresh and physically absent', async () => {
  const home = await tempHome();
  const server = await start(args.absent, home);
  await assertRefused(server.base, 'submissions-not-installed', 'absent');
  const retained = await fetch(`${server.base}${RETAINED}`).then(json);
  check('retained path answers with nothing saved', retained.body?.exists === false, retained);
  const shell = await fetch(`${server.base}/`);
  check('the shell still serves', shell.status === 200, shell.status);
  await server.stop();
  await rm(home, { recursive: true, force: true });
});

await row('existing data with the implementation absent, then reinstalled', async () => {
  const home = await tempHome();
  const included = await start(args.included, home);
  const first = await publish(included.base, '1.0.0');
  check('included build publishes', first.body?.published === true, first);
  await included.stop();
  const before = await read(home);

  const absent = await start(args.absent, home);
  await assertRefused(absent.base, 'submissions-not-installed', 'absent with data');
  const summary = await fetch(`${absent.base}${RETAINED}`).then(json);
  check('the saved entry is discoverable', summary.body?.count === 1, summary);
  const download = await fetch(`${absent.base}${RETAINED}?download=1`);
  check('export is byte for byte', (await download.text()) === before);
  check('export is an attachment', /attachment/.test(download.headers.get('content-disposition') ?? ''));
  const unconfirmed = await fetch(`${absent.base}${RETAINED}`, { method: 'DELETE' });
  check('delete needs confirmation', unconfirmed.status === 400, unconfirmed.status);
  check('nothing was rewritten', (await read(home)) === before);
  await absent.stop();

  const reinstalled = await start(args.included, home);
  const catalog = await fetch(`${reinstalled.base}${SUBMISSIONS}`).then(json);
  check(
    'reinstall reopens the entry with its original identity',
    JSON.stringify(catalog.body?.catalog ?? []).includes('synthetic-runtime') && JSON.stringify(catalog.body?.catalog ?? []).includes('1.0.0'),
    catalog.body?.catalog,
  );
  await reinstalled.stop();

  const again = await start(args.absent, home);
  const removed = await fetch(`${again.base}${RETAINED}?confirm=delete`, { method: 'DELETE' }).then(json);
  check('confirmed delete works with the implementation absent', removed.body?.deleted === true, removed);
  await again.stop();
  await rm(home, { recursive: true, force: true });
});

await row('malformed stored bytes export exactly from both artifacts', async () => {
  const home = await tempHome();
  // {"x":"<FF>"}: valid JSON punctuation around one invalid UTF-8 byte.
  const stored = Buffer.from('7b2278223a22ff227d', 'hex');
  await writeFile(path.join(home, STORE), stored);
  for (const [label, dir] of [['absent', args.absent], ['included', args.included]]) {
    const server = await start(dir, home);
    const summary = await fetch(`${server.base}${RETAINED}`).then(json);
    check(`${label}: the summary reports uncountable data`, summary.body?.exists === true && summary.body?.count === null, summary);
    const download = await fetch(`${server.base}${RETAINED}?download=1`);
    const bytes = Buffer.from(await download.arrayBuffer());
    check(`${label}: the download is the stored bytes`, download.status === 200 && bytes.equals(stored), { status: download.status, hex: bytes.toString('hex') });
    check(`${label}: the download digest matches the file`, sha(bytes) === sha(stored));
    await server.stop();
  }
  check('the stored file is unchanged', (await readFile(path.join(home, STORE))).equals(stored));
  await rm(home, { recursive: true, force: true });
});

await row('installed but disabled', async () => {
  const home = await tempHome();
  const seed = await start(args.included, home);
  await publish(seed.base, '1.0.0');
  await seed.stop();
  const before = await read(home);
  const server = await start(args.included, home, { COVEN_CAVE_SUBMISSIONS_DISABLED: '1' });
  await assertRefused(server.base, 'submissions-disabled', 'disabled');
  check('refused publish wrote nothing', (await read(home)) === before);
  const retained = await fetch(`${server.base}${RETAINED}`).then(json);
  check('retained data stays reachable while disabled', retained.body?.count === 1, retained);
  await server.stop();
  await rm(home, { recursive: true, force: true });
});

await row('absent and disabled together: physical absence is reported', async () => {
  const home = await tempHome();
  const server = await start(args.absent, home, { COVEN_CAVE_SUBMISSIONS_DISABLED: '1' });
  await assertRefused(server.base, 'submissions-not-installed', 'absent and disabled');
  const retained = await fetch(`${server.base}${RETAINED}`).then(json);
  check('retained path still answers', retained.status === 200 && retained.body?.exists === false, retained);
  await server.stop();
  await rm(home, { recursive: true, force: true });
});

await row('failed load, by removing the implementation chunk from a real build', async () => {
  const copy = await mkdtemp(path.join(os.tmpdir(), 'cave-submissions-broken-'));
  await cp(args.included, copy, { recursive: true, verbatimSymlinks: true });
  const chunks = path.join(copy, '.next', 'server', 'chunks');
  const removed = [];
  for (const file of await readdir(chunks, { recursive: true })) {
    if (!file.endsWith('.js')) continue;
    const target = path.join(chunks, file);
    if ((await stat(target)).isFile() && (await readFile(target, 'utf8')).includes('opencoven.execution.v1')) {
      await rename(target, `${target}.removed`);
      removed.push(file);
    }
  }
  check('found the implementation chunk to remove', removed.length > 0, removed);
  const home = await tempHome();
  await writeFile(path.join(home, STORE), '{"version":1,"submissions":[{"name":"kept"}]}');
  const server = await start(copy, home);
  const before = rssKb(server.pid);
  const refused = await Promise.all(Array.from({ length: 50 }, () => fetch(`${server.base}${SUBMISSIONS}`).then(json)));
  check(
    'every request refuses with a bounded named error',
    refused.every((response) => response.status === 503 && response.body?.code === 'submissions-load-failed'),
    refused.slice(0, 2),
  );
  check('the error discloses no path', !JSON.stringify(refused[0].body).includes(copy));
  check('core still serves', (await fetch(`${server.base}/`)).status === 200);
  const retained = await fetch(`${server.base}${RETAINED}`).then(json);
  check('retained data survives the failed load', retained.body?.count === 1, retained);
  currentRow.rssKb = { before, after: rssKb(server.pid) };
  await server.stop();
  await rm(home, { recursive: true, force: true });
  await rm(copy, { recursive: true, force: true });
});

await row('in-flight publishes: SIGTERM, then SIGKILL mid-burst', async () => {
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    const home = await tempHome();
    let acknowledgedTotal = 0;
    const attempts = [];
    // Later attempts wait longer, so a kill lands among acknowledged writes. A
    // row with none would prove nothing, and it fails below.
    for (const [attempt, delayMs] of [15, 40, 80, 160, 320, 640].entries()) {
      const server = await start(args.included, home);
      const versions = Array.from({ length: 40 }, (_, index) => `${attempt + 1}.${index}.0`);
      const burst = versions.map((version) => publish(server.base, version).catch(() => null));
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      await server.stop(signal);
      const results = await Promise.all(burst);
      const raw = await read(home).catch(() => null);
      let parsed = null;
      try { parsed = raw === null ? { submissions: [] } : JSON.parse(raw); } catch { /* reported below */ }
      check(`${signal} after ${delayMs}ms: the store is valid JSON, never partial`, parsed !== null);
      const stored = new Set((parsed?.submissions ?? []).map((item) => item.version));
      const acknowledged = versions.filter((_, index) => results[index]?.body?.published === true);
      const lost = acknowledged.filter((version) => !stored.has(version));
      check(`${signal} after ${delayMs}ms: every acknowledged publish survived`, lost.length === 0, { acknowledged: acknowledged.length, lost });
      acknowledgedTotal += acknowledged.length;
      attempts.push({ delayMs, acknowledged: acknowledged.length, stored: stored.size });
    }
    currentRow[signal] = attempts;
    check(`${signal}: at least one kill landed after an acknowledged publish`, acknowledgedTotal > 0, attempts);

    const after = await start(args.included, home);
    const replay = await publish(after.base, '1.0.0');
    check(`${signal}: replaying a publish after restart succeeds`, replay.body?.published === true, replay.status);
    const replayed = JSON.parse(await read(home)).submissions.filter((item) => item.version === '1.0.0');
    check(`${signal}: replay holds one entry`, replayed.length === 1, replayed.length);
    await after.stop();
    await rm(home, { recursive: true, force: true });
  }
});

await row('unauthorized callers are refused before the boundary', async () => {
  const home = await tempHome();
  const seed = await start(args.included, home);
  await publish(seed.base, '1.0.0');
  await seed.stop();
  const before = await read(home);
  const routes = [['GET', SUBMISSIONS], ['POST', SUBMISSIONS], ['POST', EXECUTIONS], ['GET', RETAINED], ['GET', `${RETAINED}?download=1`], ['DELETE', `${RETAINED}?confirm=delete`]];
  for (const [label, dir] of [['absent', args.absent], ['included', args.included]]) {
    const server = await start(dir, home);
    for (const [method, route] of routes) {
      const response = await globalThis.fetch(`${server.base}${route}`, {
        method,
        headers: { origin: 'https://attacker.example', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      const text = await response.text();
      check(`${label}: cross-origin ${method} ${route} is refused`, response.status === 403, response.status);
      check(`${label}: cross-origin ${method} ${route} discloses no saved data`, !text.includes('synthetic-runtime'));
    }
    // Every route needs the packaged credential even from loopback: the shared
    // local guard runs first in the Submissions host as well as on saved data.
    for (const [method, route] of routes) {
      const response = await globalThis.fetch(`${server.base}${route}`, { method });
      check(`${label}: tokenless loopback ${method} ${route} is refused`, response.status === 403, response.status);
    }
    await server.stop();
  }
  check('no unauthorized request changed the data', (await read(home)) === before);
  await rm(home, { recursive: true, force: true });
});

await row('authenticated phone ingress is refused before the boundary', async () => {
  // A device-access bearer is what the real proxy admits as remote ingress and
  // marks with x-coven-cave-mobile-access. The packaged sidecar token is absent,
  // as it is on a phone.
  const phone = randomBytes(24).toString('hex');
  const pairs = [['GET', SUBMISSIONS], ['POST', SUBMISSIONS], ['POST', EXECUTIONS]];
  const ingress = (base, method, route) => globalThis.fetch(`${base}${route}`, {
    method,
    headers: { authorization: `Bearer ${phone}`, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify(route === SUBMISSIONS ? { package: packageFor('9.9.9'), publish: true } : { harnessId: 'x' }) } : {}),
  });
  const home = await tempHome();
  const seed = await start(args.included, home);
  await publish(seed.base, '1.0.0');
  await seed.stop();
  const before = await read(home);
  for (const [label, dir] of [['absent', args.absent], ['included', args.included]]) {
    const server = await start(dir, home, { COVEN_CAVE_ACCESS_TOKEN: phone });
    for (const [method, route] of pairs) {
      const response = await ingress(server.base, method, route);
      const text = await response.text();
      let body = null;
      try { body = JSON.parse(text); } catch { /* not JSON */ }
      check(`${label}: phone ${method} ${route} is refused by the local guard`, response.status === 403 && body?.code === 'local_request_required', { status: response.status, body: text.slice(0, 200) });
      check(`${label}: phone ${method} ${route} discloses no saved data`, !text.includes('synthetic-runtime'));
    }
    await server.stop();
  }
  check('no phone request changed the data', (await read(home)) === before);
  // Control: the pre-boundary build admits the same bearer to its unguarded
  // route, so the refusals above come from the new guard, not the proxy.
  if (!args.baseline) {
    currentRow.controlSkipped = 'no --baseline artifact supplied';
    check('baseline control ran', false, currentRow.controlSkipped);
  } else {
    const baseline = await start(args.baseline, home, { COVEN_CAVE_ACCESS_TOKEN: phone });
    const admitted = await ingress(baseline.base, 'GET', SUBMISSIONS);
    const text = await admitted.text();
    check('control: the baseline proxy admits the phone bearer', admitted.status === 200, { status: admitted.status, body: text.slice(0, 200) });
    await baseline.stop();
  }
  await rm(home, { recursive: true, force: true });
});

await row('repeated absent and included cycles on one home', async () => {
  const home = await tempHome();
  const seed = await start(args.included, home);
  await publish(seed.base, '1.0.0');
  await seed.stop();
  const digest = sha(await read(home));
  const samples = [];
  for (let cycle = 0; cycle < 6; cycle += 1) {
    const dir = cycle % 2 === 0 ? args.absent : args.included;
    const server = await start(dir, home);
    await Promise.all(Array.from({ length: 30 }, () => fetch(`${server.base}${SUBMISSIONS}`).then((response) => response.arrayBuffer())));
    await new Promise((resolve) => setTimeout(resolve, 8000));
    samples.push({
      artifact: cycle % 2 === 0 ? 'absent' : 'included',
      readyMs: server.readyMs,
      rssKb: rssKb(server.pid),
      descriptors: descriptors(server.pid),
      children: childCount(server.pid),
    });
    await server.stop();
  }
  check('data is unchanged across cycles', sha(await read(home)) === digest);
  check('no artifact leaves a child process', samples.every((sample) => sample.children === 0), samples);
  currentRow.samples = samples;
  await rm(home, { recursive: true, force: true });
});

await row('sustained refusals in one absent process', async () => {
  const home = await tempHome();
  const server = await start(args.absent, home);
  // The first block opens this script's own keep-alive pool, which the server
  // counts as sockets, so growth is graded between later blocks.
  const samples = [];
  for (let block = 0; block < 3; block += 1) {
    for (let round = 0; round < 40; round += 1) {
      await Promise.all(Array.from({ length: 50 }, () => fetch(`${server.base}${SUBMISSIONS}`).then((response) => response.arrayBuffer())));
    }
    await new Promise((resolve) => setTimeout(resolve, 8000));
    samples.push({ requests: (block + 1) * 2000, rssKb: rssKb(server.pid), descriptors: descriptors(server.pid) });
  }
  currentRow.samples = samples;
  check('descriptors plateau after the first block', samples[2].descriptors <= samples[0].descriptors + 8, samples);
  check('no child process appeared', childCount(server.pid) === 0);
  await server.stop();
  await rm(home, { recursive: true, force: true });
});

await row('the built absent page in a browser, through the packaged credential', async () => {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch(args.chromium ? { executablePath: args.chromium } : {});
  const home = await tempHome();
  const seed = await start(args.included, home);
  await publish(seed.base, '1.0.0');
  await seed.stop();
  const before = await read(home);
  const server = await start(args.absent, home);
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    await page.addInitScript(() => window.localStorage.setItem('cave:onboarding:dismissed', '1'));
    await page.goto(`${server.base}/?mode=submissions#covenCaveToken=${TOKEN}`);
    await page.getByText("Submissions isn't included in this build").waitFor({ timeout: 60_000 });
    await page.getByText(/^1 saved submission is kept/).waitFor({ timeout: 30_000 });
    check('a saved link opens the page with the saved count', true);

    const downloading = page.waitForEvent('download', { timeout: 30_000 });
    await page.getByRole('button', { name: /^Export/ }).click();
    const download = await downloading;
    check('Export reaches the credentialed route and saves the exact bytes', (await readFile(await download.path(), 'utf8')) === before);
    check('reading and exporting left the file unchanged', (await read(home)) === before);

    await page.getByRole('button', { name: 'Delete…' }).click();
    check('the first delete step removes nothing', (await read(home)) === before);
    await page.getByRole('button', { name: 'Cancel' }).click();
    check('cancel removes nothing', (await read(home)) === before);
    await page.getByRole('button', { name: 'Delete…' }).click();
    await page.getByRole('button', { name: /^Delete saved submi/ }).click();
    await page.getByText('You have no saved submissions.').waitFor({ timeout: 30_000 });
    check('the confirmed delete removes the file', (await read(home).catch(() => null)) === null);
    await context.close();
  } finally {
    await server.stop();
    await browser.close();
    await rm(home, { recursive: true, force: true });
  }
});

await row('browser launch to a usable composer (5 cold samples each, reported, not graded)', async () => {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch(args.chromium ? { executablePath: args.chromium } : {});
  const measure = async (dir) => {
    const samples = [];
    for (let index = 0; index < 5; index += 1) {
      const home = await tempHome();
      const server = await start(dir, home);
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.addInitScript(() => window.localStorage.setItem('cave:onboarding:dismissed', '1'));
      const started = performance.now();
      await page.goto(`${server.base}/#covenCaveToken=${TOKEN}`);
      await page.locator('textarea, [contenteditable="true"]').first().waitFor({ state: 'visible', timeout: 60_000 });
      samples.push(Math.round(performance.now() - started));
      await context.close();
      await server.stop('SIGKILL');
      await rm(home, { recursive: true, force: true });
    }
    return samples;
  };
  currentRow.absentMs = await measure(args.absent);
  currentRow.includedMs = await measure(args.included);
  await browser.close();
  check('all samples collected', currentRow.absentMs.length === 5 && currentRow.includedMs.length === 5);
});

await row('matched idle cost after readiness (5 samples each, reported, not graded)', async () => {
  const measure = async (dir) => {
    const samples = [];
    for (let index = 0; index < 5; index += 1) {
      const home = await tempHome();
      const server = await start(dir, home);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      samples.push({ readyMs: server.readyMs, rssKb: rssKb(server.pid), descriptors: descriptors(server.pid) });
      await server.stop();
      await rm(home, { recursive: true, force: true });
    }
    return samples;
  };
  currentRow.absent = await measure(args.absent);
  currentRow.included = await measure(args.included);
  check('all samples collected', currentRow.absent.length === 5 && currentRow.included.length === 5);
});

await row('rollback to the pre-boundary build on the same data', async () => {
  if (!args.baseline) {
    currentRow.skipped = 'no --baseline artifact supplied';
    check('baseline artifact supplied', false, currentRow.skipped);
    return;
  }
  const home = await tempHome();
  const included = await start(args.included, home);
  await publish(included.base, '1.0.0');
  await included.stop();
  const baseline = await start(args.baseline, home);
  const catalog = await fetch(`${baseline.base}${SUBMISSIONS}`).then(json);
  check('the old build reads data written by the new one', JSON.stringify(catalog.body?.catalog ?? []).includes('synthetic-runtime'), catalog.status);
  const published = await publish(baseline.base, '1.0.1');
  check('the old build can still write', published.body?.published === true, published.status);
  await baseline.stop();
  const absent = await start(args.absent, home);
  const summary = await fetch(`${absent.base}${RETAINED}`).then(json);
  check('rolling forward keeps both entries', summary.body?.count === 2, summary);
  await absent.stop();
  await rm(home, { recursive: true, force: true });
});

const receipt = { generatedAt: new Date().toISOString(), node: process.version, platform: `${os.platform()} ${os.release()} ${os.arch()}`, args, rows };
if (args.out) await writeFile(args.out, `${JSON.stringify(receipt, null, 2)}\n`);
const failed = rows.filter((item) => !item.ok);
console.log(`\n${rows.length - failed.length} of ${rows.length} rows passed`);
for (const item of failed) console.log(`  failed: ${item.name}`);
process.exit(failed.length === 0 ? 0 : 1);
