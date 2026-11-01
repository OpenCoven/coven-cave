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
/** A fetch-shaped call: the global, an injected implementation, or Node's https client. */
const FETCHES = /\b(fetch|fetchImpl|fetchFn|fetcher)\s*\(|\bhttps?\.(get|request)\s*\(/;
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
