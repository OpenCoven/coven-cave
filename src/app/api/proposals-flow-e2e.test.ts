// E2E for the proposal decision flow with REAL staged-write fixtures
// (threads-986.17.6, spec §3.7).
//
// `next/server` cannot be imported under the bare-node test runner, so this
// test drives the exact composition the route handlers execute —
// activeThreadsAdapter() (env-selected, no mocks) + httpStatusForEnvelope —
// over the checked-in fixtures/phase-4/pending/ staged writes and a real
// temp COVEN_HOME, then pins the route sources to that composition so the
// handlers cannot drift from what is tested here. Guard behavior
// (rejectNonLocalRequest, invalid-JSON 400) is enforced per-route by
// src/app/api/api-contracts.test.ts.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, describe, it } from "node:test";

import { activeThreadsAdapter, httpStatusForEnvelope } from "../../lib/threads-adapters.ts";

const PROPOSAL_OK = "cccccccc-0001-4001-8001-000000000001";
const CORRUPT_ID = "dddddddd-0001-4001-8001-000000000001";

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const ENV_KEYS = ["COVEN_THREADS_ADAPTER", "COVEN_THREADS_FIXTURE_SCENARIO", "COVEN_HOME"] as const;
const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("route-source pins: handlers are exactly the composition under test", () => {
  const routeFiles = [
    "proposals/route.ts",
    "proposals/[id]/approve/route.ts",
    "proposals/[id]/reject/route.ts",
  ];

  it("every proposals route answers via activeThreadsAdapter + httpStatusForEnvelope", () => {
    for (const file of routeFiles) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      assert.match(source, /activeThreadsAdapter\(\)/, `${file} uses the env-selected adapter`);
      assert.match(source, /httpStatusForEnvelope\(envelope, "(GET|POST)"\)/, `${file} maps status via the shared mapper`);
      assert.doesNotMatch(source, /node:fs|writeFile|unlink|node:sqlite/, `${file} performs no I/O of its own`);
    }
  });

  it("decision routes forward the parsed note and guard origin + JSON", () => {
    for (const file of ["proposals/[id]/approve/route.ts", "proposals/[id]/reject/route.ts"]) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      assert.match(source, /rejectNonLocalRequest\(req\)/, `${file} keeps the local-origin guard`);
      assert.match(source, /invalid json body/, `${file} answers 400 on malformed JSON`);
      assert.match(source, /\.(approve|reject)\(id, note\)/, `${file} forwards id + note to the adapter only`);
    }
  });
});

describe("GET flow — real checked-in staged writes through the env-selected adapter", () => {
  it("serves the pending fixtures with the freshness envelope (explicit fixtures mode)", async () => {
    process.env.COVEN_THREADS_ADAPTER = "fixtures";
    delete process.env.COVEN_THREADS_FIXTURE_SCENARIO;
    const envelope = await activeThreadsAdapter().proposals();
    assert.equal(httpStatusForEnvelope(envelope, "GET"), 200);
    assert.equal(envelope.blocked, false);
    assert.equal(envelope.meta.adapter, "fixtures");
    assert.ok(envelope.meta.observedAt && envelope.meta.staleAfter && envelope.meta.sourceCursor);
    assert.equal(envelope.data?.length, 3, "two ok + one corrupt staged fixture");
    const ok = envelope.data?.filter((p) => p.parse === "ok") ?? [];
    const corrupt = envelope.data?.filter((p) => p.parse === "corrupt") ?? [];
    assert.equal(ok.length, 2);
    assert.equal(corrupt.length, 1);
    const utf8 = ok.find((p) => p.payload?.id === PROPOSAL_OK);
    assert.ok(utf8, "the utf8 staged write is listed");
    assert.equal(utf8?.payload?.edits[0]?.contents.encoding, "utf8");
    assert.match(utf8?.payload?.edits[0]?.contents.data ?? "", /durable memory/);
  });

  it("daemon-timeout scenario blocks the list (R3), never an empty-healthy answer", async () => {
    process.env.COVEN_THREADS_ADAPTER = "fixtures";
    process.env.COVEN_THREADS_FIXTURE_SCENARIO = "daemon-timeout";
    const envelope = await activeThreadsAdapter().proposals();
    assert.equal(envelope.blocked, true);
    assert.equal(envelope.why, "daemon-timeout");
    assert.equal(envelope.data, null);
    assert.equal(httpStatusForEnvelope(envelope, "GET"), 200, "reads render a blocked page state");
  });
});

describe("decision flow — forward-only, fail-closed, staged files untouched", () => {
  it("R5: fixtures mode (no daemon) answers 503 and the checked-in files never change", async () => {
    process.env.COVEN_THREADS_ADAPTER = "fixtures";
    delete process.env.COVEN_THREADS_FIXTURE_SCENARIO;
    const pendingDir = path.join(process.cwd(), "fixtures", "phase-4", "pending");
    const before = readdirSync(pendingDir).sort();
    const envelope = await activeThreadsAdapter().approve(PROPOSAL_OK, "ship it");
    assert.equal(envelope.blocked, true);
    assert.equal(envelope.why, "daemon-unavailable");
    assert.equal(httpStatusForEnvelope(envelope, "POST"), 503);
    assert.deepEqual(readdirSync(pendingDir).sort(), before, "refused decision touches nothing");
  });

  it("reject path fails closed identically without a daemon", async () => {
    process.env.COVEN_THREADS_ADAPTER = "fixtures";
    const envelope = await activeThreadsAdapter().reject(PROPOSAL_OK);
    assert.equal(envelope.why, "daemon-unavailable");
    assert.equal(httpStatusForEnvelope(envelope, "POST"), 503);
  });

  it("daemon adapter + real staged file + unreachable daemon: refused visibly, file stays", async () => {
    const home = tempDir("phase4-e2e-home-");
    mkdirSync(path.join(home, "pending"));
    const fileName = `eeeeeeee-0000-4000-8000-000000000001-${PROPOSAL_OK}.json`;
    writeFileSync(
      path.join(home, "pending", fileName),
      JSON.stringify({
        id: PROPOSAL_OK,
        familiar_id: "eeeeeeee-0000-4000-8000-000000000001",
        writer: "familiar:echo",
        channel: "Mutation",
        thread_id: "aaaaaaa2-0002-4002-8002-000000000001",
        fray: { Frayed: { strand: null, channel: "Mutation", reason: "ContentHashMismatch" } },
        edits: [{ surface: "MEMORY.md", contents: { encoding: "utf8", data: "proposed" } }],
        staged_at: [2026, 196, 9, 0, 2, 0, 0, 0, 0],
      }),
    );
    process.env.COVEN_THREADS_ADAPTER = "daemon";
    process.env.COVEN_HOME = home;
    const adapter = activeThreadsAdapter();
    assert.equal(adapter.kind, "daemon", "env selects the real daemon adapter");
    const envelope = await adapter.approve(PROPOSAL_OK, "yes");
    assert.equal(envelope.blocked, true, "no daemon socket answers in this environment");
    assert.match(String(envelope.why), /daemon-(unreachable|unavailable)/);
    assert.equal(httpStatusForEnvelope(envelope, "POST"), 503);
    assert.deepEqual(readdirSync(path.join(home, "pending")), [fileName], "staged write untouched");
  });

  it("R6: a corrupt staged file answers 409 and the daemon is never asked", async () => {
    const home = tempDir("phase4-e2e-corrupt-");
    mkdirSync(path.join(home, "pending"));
    writeFileSync(
      path.join(home, "pending", `eeeeeeee-0000-4000-8000-000000000001-${CORRUPT_ID}.json`),
      "{ not json",
    );
    process.env.COVEN_THREADS_ADAPTER = "daemon";
    process.env.COVEN_HOME = home;
    const envelope = await activeThreadsAdapter().approve(CORRUPT_ID);
    assert.equal(envelope.why, "proposal-corrupt");
    assert.equal(httpStatusForEnvelope(envelope, "POST"), 409);
  });

  it("traversal ids are refused before any filesystem interaction (400)", async () => {
    process.env.COVEN_THREADS_ADAPTER = "daemon";
    process.env.COVEN_HOME = tempDir("phase4-e2e-ids-");
    const envelope = await activeThreadsAdapter().reject("../../../etc/passwd");
    assert.equal(envelope.why, "invalid-id");
    assert.equal(httpStatusForEnvelope(envelope, "POST"), 400);
  });

  it("unknown proposal ids answer not-found (404)", async () => {
    const home = tempDir("phase4-e2e-missing-");
    mkdirSync(path.join(home, "pending"));
    process.env.COVEN_THREADS_ADAPTER = "daemon";
    process.env.COVEN_HOME = home;
    const envelope = await activeThreadsAdapter().approve("99999999-9999-4999-8999-999999999999");
    assert.equal(envelope.why, "not-found");
    assert.equal(httpStatusForEnvelope(envelope, "POST"), 404);
  });
});
