import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  loadList,
  parseConnectorsPayload,
  parseSkillsPayload,
  resetComposerAddMenuCache,
} from "./composer-add-menu-data.ts";

// ── parseSkillsPayload ───────────────────────────────────────────────────────

test("skills: dedupes by id (first scope wins) and sorts by display name", () => {
  const out = parseSkillsPayload({
    ok: true,
    skills: [
      { id: "zeta", name: "Zeta", familiar: "global" },
      { id: "alpha", name: "Alpha", familiar: "global" },
      { id: "zeta", name: "Zeta (dupe)", familiar: "user" },
      { id: "beta", name: "beta" },
    ],
  });
  assert.deepEqual(
    out.map((s) => s.id),
    ["alpha", "beta", "zeta"],
  );
  assert.equal(out.find((s) => s.id === "zeta")?.familiar, "global", "first scope wins");
});

test("skills: falls back to id for sorting when name is missing", () => {
  const out = parseSkillsPayload({ ok: true, skills: [{ id: "b" }, { id: "a" }] });
  assert.deepEqual(out.map((s) => s.id), ["a", "b"]);
});

test("skills: rejects malformed payloads and rows", () => {
  assert.deepEqual(parseSkillsPayload(null), []);
  assert.deepEqual(parseSkillsPayload({ ok: false, skills: [{ id: "x" }] }), []);
  assert.deepEqual(parseSkillsPayload({ ok: true, skills: "nope" }), []);
  assert.deepEqual(
    parseSkillsPayload({ ok: true, skills: [null, 4, { name: "no-id" }, { id: "ok" }] }).map((s) => s.id),
    ["ok"],
  );
});

// ── parseConnectorsPayload ───────────────────────────────────────────────────

test("connectors: maps id/transport/target, defaults transport, sorts by id", () => {
  const out = parseConnectorsPayload({
    ok: true,
    servers: [
      { id: "vercel", transport: "http", target: "https://mcp.vercel.dev" },
      { id: "chrome", target: "npx chrome-mcp" },
    ],
  });
  assert.deepEqual(out, [
    { id: "chrome", transport: "stdio", target: "npx chrome-mcp" },
    { id: "vercel", transport: "http", target: "https://mcp.vercel.dev" },
  ]);
});

test("connectors: rejects malformed payloads and rows", () => {
  assert.deepEqual(parseConnectorsPayload(undefined), []);
  assert.deepEqual(parseConnectorsPayload({ ok: true }), []);
  assert.deepEqual(
    parseConnectorsPayload({ ok: true, servers: [{}, { id: "a" }] }),
    [{ id: "a", transport: "stdio", target: undefined }],
  );
});

// ── loadList cache semantics ─────────────────────────────────────────────────

test("loadList: concurrent + later callers share one fetch (remount-proof)", async () => {
  resetComposerAddMenuCache();
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 10));
    return { json: async () => ({ ok: true, skills: [{ id: "a" }] }) };
  }) as unknown as typeof fetch;
  try {
    const [x, y] = await Promise.all([
      loadList("/api/skills/local", parseSkillsPayload),
      loadList("/api/skills/local", parseSkillsPayload),
    ]);
    const z = await loadList("/api/skills/local", parseSkillsPayload);
    assert.equal(calls, 1, "one network request across concurrent + later callers");
    assert.deepEqual(x.map((s) => s.id), ["a"]);
    assert.deepEqual(y, x);
    assert.deepEqual(z, x);
  } finally {
    globalThis.fetch = realFetch;
    resetComposerAddMenuCache();
  }
});

test("loadList: failure resolves empty and clears the cache so next open retries", async () => {
  resetComposerAddMenuCache();
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) throw new Error("offline");
    return { json: async () => ({ ok: true, skills: [{ id: "b" }] }) };
  }) as unknown as typeof fetch;
  try {
    const first = await loadList("/api/skills/local", parseSkillsPayload);
    assert.deepEqual(first, [], "failed load yields empty list");
    const second = await loadList("/api/skills/local", parseSkillsPayload);
    assert.deepEqual(second.map((s) => s.id), ["b"], "retry after failure");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = realFetch;
    resetComposerAddMenuCache();
  }
});

test("loadList: stale entries revalidate; offline revalidation keeps the old list", async (t) => {
  resetComposerAddMenuCache();
  let calls = 0;
  let fail = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    if (fail) throw new Error("offline");
    return { json: async () => ({ ok: true, skills: [{ id: `s${calls}` }] }) };
  }) as unknown as typeof fetch;
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  try {
    const first = await loadList("/api/skills/local", parseSkillsPayload);
    assert.deepEqual(first.map((s) => s.id), ["s1"]);
    // Fresh within the window → cached, no refetch.
    t.mock.timers.setTime(1_000_000 + 5_000);
    await loadList("/api/skills/local", parseSkillsPayload);
    assert.equal(calls, 1, "fresh entry served from cache");
    // Past the window → revalidates.
    t.mock.timers.setTime(1_000_000 + 60_000);
    const second = await loadList("/api/skills/local", parseSkillsPayload);
    assert.equal(calls, 2, "stale entry refetched");
    assert.deepEqual(second.map((s) => s.id), ["s2"]);
    // Past the window again but now offline → previous list survives.
    fail = true;
    t.mock.timers.setTime(1_000_000 + 120_000);
    const third = await loadList("/api/skills/local", parseSkillsPayload);
    assert.equal(calls, 3, "offline revalidation attempted");
    assert.deepEqual(third.map((s) => s.id), ["s2"], "stale beats empty when revalidation fails");
  } finally {
    t.mock.timers.reset();
    globalThis.fetch = realFetch;
    resetComposerAddMenuCache();
  }
});

// ── hook wiring pins ─────────────────────────────────────────────────────────

const src = readFileSync(new URL("./composer-add-menu-data.ts", import.meta.url), "utf8");

test("hooks share a module-level cache so remounts can't strand loading or refetch", () => {
  assert.match(src, /const listCache = new Map<string, CacheEntry>\(\);/, "module-level cache");
  assert.match(
    src,
    /if \(hit && !\(hit\.settled && Date\.now\(\) - hit\.at > STALE_AFTER_MS\)\) \{\s*return hit\.promise as Promise<T\[\]>;/,
    "fresh in-flight/settled promise is shared; stale entries fall through to revalidate",
  );
  assert.match(src, /fetch\(url, \{ cache: "no-store" \}\)/, "no-store fetch");
  assert.match(src, /listCache\.delete\(url\);/, "first-load failures clear the entry for retry");
  assert.match(src, /const cached = lastItems\.get\(url\) as T\[\] \| undefined;/, "remounts render synchronously from the last list");
  assert.match(src, /useLazyList\(active, "\/api\/skills\/local", parseSkillsPayload\)/, "skills hook hits /api/skills/local");
  assert.match(src, /useLazyList\(active, "\/api\/mcp", parseConnectorsPayload\)/, "connectors hook hits /api/mcp");
});
