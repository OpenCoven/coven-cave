// Relevance scan for the upstream API registry (#6359).
//
// The registry is only useful while it matches the code. This scan reads the
// server source and fails in both directions: a file that fetches an external
// host the registry does not credit to it, and a registry caller that no
// longer fetches. Either way the fix is a one-line registry edit, and the
// anomaly suite stays pointed at every live upstream dependency.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { networkCalls } from "../testing/upstream-network-scan.ts";

import { DEFAULT_FEEDS } from "./rss-feeds.ts";
import {
  LINK_ONLY_HOSTS,
  UPSTREAM_API_IDS,
  UPSTREAM_APIS,
  upstreamApiById,
  upstreamApiForHost,
} from "./upstream-api-registry.ts";

const root = process.cwd();
const SCAN_ROOTS = ["src/app/api", "src/lib", "src/proxy.ts", "server.ts"];
const SKIP_DIRS = new Set(["node_modules", ".next", "fixtures", "openclaw-fixtures", "testing"]);
const SKIP_FILE = /\.test\.(ts|tsx)$|\.gen\.ts$|\.d\.ts$/;
const SOURCE_FILE = /\.(ts|tsx)$/;
/** A fetch-shaped call: the shared primitive, the global, an injected implementation, or Node's https client. */
const FETCHES = { test: (source: string) => networkCalls(source).length > 0 };
/** A raw fetch that bypasses the live primitive. */

/** Callers allowed to keep a raw fetch, each with the reason. Keep this short. */
const RAW_FETCH_EXEMPT: Readonly<Record<string, string>> = {
  "src/lib/server/pin-sources.ts": "the user-URL path goes through https.request behind the public-only resolver; the fixed GitHub hosts use the primitive",
  "src/app/api/salem/route.ts": "the enhance call goes to Cave's own /api/chat/generate/enhance on the request origin, not to an upstream",
};
/** Callers that may not import the server-only primitive at all, each with the reason. */
const PRIMITIVE_EXEMPT: Readonly<Record<string, string>> = {
  "src/lib/voice/openai-realtime.ts": "ships to the browser through src/lib/voice/registry.ts, so the server ledger stays out of the client bundle",
  "src/lib/voice/elevenlabs.ts": "ships to the browser through src/lib/voice/registry.ts, so the server ledger stays out of the client bundle",
};
const HOST_RE = /https?:\/\/([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d+)?)/gi;
/** Hosts that are documentation, fixtures, loopback or reserved names, never an upstream. */
const NOT_UPSTREAM = /example|\.(invalid|test|lan|local)(:\d+)?$|^localhost(:|$)|^127\.|^0\.0\.0\.0|^\[|w3\.org$|schema\.org$|tailnet|placeholder|attacker|evil/i;

function walk(target: string, acc: string[]): string[] {
  if (!existsSync(target)) return acc;
  const stat = statSync(target);
  if (stat.isFile()) {
    if (SOURCE_FILE.test(target) && !SKIP_FILE.test(target)) acc.push(target);
    return acc;
  }
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    walk(path.join(target, entry.name), acc);
  }
  return acc;
}

const files = SCAN_ROOTS.flatMap((scanRoot) => walk(path.join(root, scanRoot), []))
  .map((file) => path.relative(root, file).split(path.sep).join("/"))
  .sort();
const sources = new Map(files.map((file) => [file, readFileSync(path.join(root, file), "utf8")]));

// Existing non-provider call signatures, not blanket file exemptions. Counts and
// arguments ratchet: a new unknown call or a stale entry fails the inventory.
const CALL_BOUNDARIES: Record<string, { args: string[]; reason: string }> = {
  "src/lib/shared-json-fetch.ts": { args: ["url"], reason: "browser-shared Cave JSON resources; not a server provider transport" },
  "src/lib/daemon-fault-harness.ts": { args: ["`${harness.url}/health`"], reason: "synthetic loopback daemon fixture health check" },
  "src/app/api/mobile-handoff/route.ts": { args: ['new URL("/api/familiars", backend)', 'new URL("/api/familiars", target)'], reason: "Cave-to-Cave mobile handoff peer probes" },
  "src/app/api/chat/broadcast/route.ts": { args: ['new URL("/api/chat/send", req.url)'], reason: "same-origin Cave route forwarding" },
  "src/lib/omnigent/client.ts": { args: ["url"], reason: "Coven hub protocol client; separate internal peer contract" },
  "src/lib/familiar-stream.ts": { args: ["bridgeUrl"], reason: "browser sends to Cave chat/send or chat/generate" },
  "src/lib/workflows.ts": { args: ["url"], reason: "browser workflow CRUD helper against Cave routes" },
  "src/lib/use-runtime-model-options.ts": { args: ["url"], reason: "browser runtime model discovery through Cave API" },
  "src/lib/openclaw-compatibility.ts": { args: ["url"], reason: "injected schema-bundle transport; production server wrapper is runtime-compatibility-registry" },
  "src/lib/passkey-client.ts": { args: ["url"], reason: "browser passkey challenge/credential requests to Cave" },
  "src/lib/tool-output-fetch.ts": { args: ["url"], reason: "same-origin-only Cave conversation tool-output route" },
  "src/lib/github-tasks-cache.ts": { args: ["input", "endpoint"], reason: "browser cache for Cave GitHub task routes, not GitHub's API" },
  "src/lib/use-milestone-watch.ts": { args: ["url"], reason: "browser milestone reads from Cave" },
  "src/app/api/chat/send/route.ts": { args: ["hermesResponsesUrl(hermesApi)"], reason: "separate Hermes runtime stream contract, outside the original scoped provider matrix; no shared-ledger acceptance claimed" },
  "src/lib/surface-warmup-registry.ts": { args: ["url"], reason: "browser warmup of Cave API resources" },
  "src/lib/use-familiar-contracts.ts": { args: ["url"], reason: "browser familiar contract/retro/self-report reads from Cave" },
  "src/lib/authed-image.ts": { args: ["src"], reason: "browser sidecar-authenticated Cave image reads" },
  "src/lib/use-projects-cache.ts": { args: ["url"], reason: "browser projects reads from Cave" },
  "src/lib/mobile-mode-reconcile.ts": { args: ["input"], reason: "browser shared-mode preference reconciliation with Cave" },
  "src/lib/github-item-fetch.ts": { args: ["url"], reason: "browser reads Cave GitHub item proxy" },
  "src/lib/use-github-pr.ts": { args: ["url"], reason: "browser reads Cave PR proxy" },
  "src/lib/use-local-daemon-readiness.ts": { args: ["...args"], reason: "browser Cave daemon/status readiness helper" },
  "src/lib/session-changes-api.ts": { args: ['changesUrl(projectRoot, { checkpoints: "1" })', 'changesUrl(projectRoot, { branches: "1" })', 'changesUrl(projectRoot, { path: filePath })'], reason: "browser Cave project session-change routes" },
  "src/lib/composer-add-menu-data.ts": { args: ["url"], reason: "browser composer menu resources from Cave" },
  "src/lib/executor-status.ts": { args: ["url"], reason: "Coven executor peer health protocol, separate from third-party providers" },
  "src/lib/grok-compatibility.ts": { args: ["url"], reason: "injected signed-schema transport; production wrapper is runtime-compatibility-registry" },
  "src/lib/opencode-compatibility.ts": { args: ["url"], reason: "injected signed-schema transport; production wrapper is runtime-compatibility-registry" },
  "src/lib/cave-backdrop.ts": { args: ["familiarBackdropUrl(familiarId)", "familiarBackdropUrl(familiarId)"], reason: "browser familiar backdrop reads/writes through Cave" },
  "src/lib/voice/local-loop.ts": { args: ["`${base}/v1/models`"], reason: "browser-delivered local voice provider readiness probe; keeps its own deadline" },
  "src/lib/automations/revision-rebase.ts": { args: ["`${path}/definition`", "path"], reason: "browser automation revision reads/writes through Cave API" },
  "src/lib/server/marketplace-payload.ts": { args: ["url"], reason: "separate size/hash-pinned marketplace artifact downloader; no provider-matrix acceptance claimed" },
  "src/lib/server/upstream-fetch.ts": { args: ["input"], reason: "the registry's transport primitive itself" },
  "src/lib/server/local-codex-backends.ts": { args: ["url"], reason: "separate local-model backend eligibility probes; no shared-ledger acceptance claimed" },
};

const callsByFile = new Map([...sources].map(([file, source]) => [file, networkCalls(source, file)]));
const registeredCallers = new Set(UPSTREAM_APIS.flatMap(entry => [...entry.callers]));
function unknownCalls(file: string, source: string): string[] {
  if (registeredCallers.has(file)) return [];
  const actual = networkCalls(source, file).filter(call => !call.internal).map(call => call.argument).sort();
  const allowed = [...(CALL_BOUNDARIES[file]?.args ?? [])].sort();
  return JSON.stringify(actual) === JSON.stringify(allowed) ? [] : [`${file}: network call inventory changed; register the caller or review a specific internal/separate-contract boundary (${actual.join(", ")})`];
}

function hostsIn(source: string): Set<string> {
  const hosts = new Set<string>();
  for (const match of source.matchAll(HOST_RE)) hosts.add(match[1].toLowerCase());
  return hosts;
}

test("registry ids are unique, declared, and resolvable", () => {
  assert.deepEqual([...new Set(UPSTREAM_API_IDS)], [...UPSTREAM_API_IDS]);
  assert.deepEqual(UPSTREAM_APIS.map((entry) => entry.id).sort(), [...UPSTREAM_API_IDS].sort());
  for (const entry of UPSTREAM_APIS) {
    assert.equal(upstreamApiById(entry.id), entry);
    assert.ok(entry.hosts.length > 0 || entry.userSupplied, `${entry.id}: an entry with no fixed host must be userSupplied`);
    assert.ok(entry.callers.length > 0, `${entry.id}: declare at least one caller`);
    for (const host of entry.hosts) {
      assert.ok(upstreamApiForHost(host), `${entry.id}: ${host} does not resolve`);
      assert.equal(host, host.toLowerCase(), `${entry.id}: hosts are lower-case (${host})`);
    }
  }
  assert.equal(upstreamApiForHost("api.unlisted.example"), null);
});

test("every server file that fetches an external host is credited to a registry entry", () => {
  const problems: string[] = [];
  for (const [file, source] of sources) {
    if (!FETCHES.test(source)) continue;
    for (const host of hostsIn(source)) {
      if (NOT_UPSTREAM.test(host) || host in LINK_ONLY_HOSTS) continue;
      const credited = UPSTREAM_APIS.some((entry) => entry.hosts.includes(host) && entry.callers.includes(file));
      if (!credited) problems.push(`${file} fetches and names ${host}: add the file to that host's entry in src/lib/server/upstream-api-registry.ts (or the host to LINK_ONLY_HOSTS if it is never fetched)`);
    }
  }
  assert.deepEqual(problems, []);
});

test("every registry caller still exists and still fetches", () => {
  const problems: string[] = [];
  for (const entry of UPSTREAM_APIS) {
    for (const file of entry.callers) {
      const source = sources.get(file);
      if (source === undefined) {
        problems.push(`${entry.id}: caller ${file} is not a scanned server source file`);
        continue;
      }
      if (!FETCHES.test(source)) problems.push(`${entry.id}: caller ${file} no longer fetches anything`);
    }
    for (const file of entry.hostSources ?? []) {
      if (!existsSync(path.join(root, file))) problems.push(`${entry.id}: hostSource ${file} is missing`);
    }
  }
  assert.deepEqual(problems, []);
});

test("every declared host is still named by one of its callers or host sources", () => {
  const problems: string[] = [];
  for (const entry of UPSTREAM_APIS) {
    const texts = [...entry.callers, ...(entry.hostSources ?? [])]
      .map((file) => sources.get(file) ?? (existsSync(path.join(root, file)) ? readFileSync(path.join(root, file), "utf8") : ""));
    for (const host of entry.hosts) {
      const named = texts.some((text) => hostsIn(text).has(host) || text.includes(host));
      if (!named) problems.push(`${entry.id}: ${host} is not named by any caller or hostSource — stale host?`);
    }
  }
  assert.deepEqual(problems, []);
});

test("every registry caller reaches its upstream through upstreamFetch, so detection is live in production", () => {
  const problems: string[] = [];
  for (const entry of UPSTREAM_APIS) {
    for (const file of entry.callers) {
      const source = sources.get(file);
      if (source === undefined || file in PRIMITIVE_EXEMPT) continue;
      if (!/\bupstreamFetch\s*\(/.test(source)) {
        problems.push(`${entry.id}: ${file} never calls upstreamFetch — route its ${entry.hosts.join("/") || "upstream"} call through src/lib/server/upstream-fetch.ts`);
        continue;
      }
      if (networkCalls(source, file).some(call => call.transport !== "upstream") && !(file in RAW_FETCH_EXEMPT)) {
        problems.push(`${entry.id}: ${file} still has a raw fetch beside upstreamFetch — route it through the primitive or add a RAW_FETCH_EXEMPT reason`);
      }
    }
  }
  for (const file of [...Object.keys(RAW_FETCH_EXEMPT), ...Object.keys(PRIMITIVE_EXEMPT)]) {
    assert.ok(sources.has(file), `${file} is exempted but is no longer a scanned file`);
  }
  for (const file of Object.keys(PRIMITIVE_EXEMPT)) {
    assert.doesNotMatch(sources.get(file) ?? "", /\bupstreamFetch\s*\(/, `${file} now uses the primitive: drop its PRIMITIVE_EXEMPT line`);
  }
  assert.deepEqual(problems, []);
});

test("link-only hosts are still referenced somewhere, so the allowlist cannot go stale", () => {
  for (const host of Object.keys(LINK_ONLY_HOSTS)) {
    const referenced = [...sources.values()].some((source) => hostsIn(source).has(host));
    assert.ok(referenced, `LINK_ONLY_HOSTS.${host} is no longer referenced by any scanned file`);
  }
});

test("the default RSS feed hosts are each owned by a registry entry", () => {
  for (const feed of DEFAULT_FEEDS) {
    const host = new URL(feed.url).host.toLowerCase();
    assert.ok(upstreamApiForHost(host), `feed ${feed.id} (${host}) has no registry entry`);
  }
});


test("new network callers fail independently of inline hosts or Node import spelling", () => {
  assert.deepEqual([...sources].flatMap(([file, source]) => unknownCalls(file, source)), []);
  for (const [file, boundary] of Object.entries(CALL_BOUNDARIES)) {
    assert.ok(sources.has(file), `${file}: remove stale boundary`);
    assert.ok(boundary.reason.trim(), `${file}: boundary needs provenance`);
    assert.ok(callsByFile.get(file)?.length, `${file}: boundary no longer calls a transport`);
  }
  for (const source of [
    'import { endpoint } from "./config"; export function GET() { return fetch(endpoint); }',
    'import { request } from "node:https"; export function GET() { return request("https://api.github.com/user"); }',
    'import { request as send } from "node:https"; export function GET() { return send(endpoint); }',
    'const send = globalThis.fetch; export function GET() { return send(endpoint); }',
  ]) {
    assert.equal(unknownCalls("src/app/api/new-provider/route.ts", source).length, 1, source);
  }
  assert.deepEqual(unknownCalls("src/lib/browser-helper.ts", 'fetch("/api/preferences")'), []);
  assert.equal(unknownCalls("src/lib/browser-helper.ts", 'fetch("//unregistered.invalid/path")').length, 1);
});
