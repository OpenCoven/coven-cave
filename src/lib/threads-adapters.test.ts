// Adapter tests: the ten fixture states (spec §1) and the fail-closed rules
// R3/R4/R5/R6/R7 at the adapter boundary. The daemon adapter is exercised
// with an injected daemon call and temp coven homes — the real socket and a
// live daemon belong to the Phase 4 E2E lane (threads-986.17.6).
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import {
  DaemonThreadsAdapter,
  FixturesThreadsAdapter,
  httpStatusForEnvelope,
  activeThreadsAdapter,
} from "./threads-adapters.ts";
import type { ThreadsEnvelope } from "./threads-read.ts";

const WEAVE_HOLDS = "11111111-1111-4111-8111-111111111111";
const WEAVE_FRAYED = "22222222-2222-4222-8222-222222222222";
const WEAVE_SNAPPED = "33333333-3333-4333-8333-333333333333";
const WEAVE_UNKNOWN = "44444444-4444-4444-8444-444444444444";
const THREAD_HOLDS_SOUL = "aaaaaaa1-0001-4001-8001-000000000001";
const THREAD_FRAYED = "aaaaaaa2-0002-4002-8002-000000000001";
const FRAYED_STRAND = "bbbbbbb2-0002-4002-8002-000000000001";
const PROPOSAL_OK = "cccccccc-0001-4001-8001-000000000001";

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function assertMeta(envelope: ThreadsEnvelope<unknown>, adapter: "fixtures" | "daemon") {
  assert.equal(envelope.meta.adapter, adapter);
  assert.ok(Number.isFinite(Date.parse(envelope.meta.observedAt)), "observedAt must be a timestamp");
  assert.ok(Number.isFinite(Date.parse(envelope.meta.staleAfter)), "staleAfter must be a timestamp");
  assert.ok(envelope.meta.sourceCursor.length > 0, "sourceCursor must be present");
}

describe("fixtures adapter — weave states", () => {
  const adapter = new FixturesThreadsAdapter();

  it("weave-holds: rail row rolls up holds and is verified", async () => {
    const res = await adapter.listWeaves("sage");
    assertMeta(res, "fixtures");
    assert.equal(res.blocked, false);
    assert.equal(res.data?.length, 1);
    assert.equal(res.data?.[0]?.id, WEAVE_HOLDS);
    assert.deepEqual(res.data?.[0]?.tensionRollup, { state: "holds" });
    assert.equal(res.data?.[0]?.coherence, "coherent");
    assert.equal(res.meta.verified, true);
  });

  it("weave-frayed: rollup frays, coherence degraded with the named surface", async () => {
    const res = await adapter.weave(WEAVE_FRAYED);
    assert.equal(res.data?.tensionRollup.state, "frayed");
    assert.equal(res.data?.coherence, "degraded");
    assert.deepEqual(res.data?.degradedSurfaces, ["MEMORY.md"]);
  });

  it("weave-snapped: rollup snapped, coherence broken", async () => {
    const res = await adapter.weave(WEAVE_SNAPPED);
    assert.equal(res.data?.tensionRollup.state, "snapped");
    assert.equal(res.data?.coherence, "broken");
  });

  it("weave-unknown: unrecognized tension and coherence fail closed (R1)", async () => {
    const res = await adapter.weave(WEAVE_UNKNOWN);
    assert.equal(res.data?.tensionRollup.state, "unknown");
    assert.equal(res.data?.coherence, "unknown");
  });

  it("unknown weave id answers not-found blocked, never empty-healthy (R11)", async () => {
    const res = await adapter.weave("99999999-9999-4999-8999-999999999999");
    assert.equal(res.blocked, true);
    assert.equal(res.why, "not-found");
    assert.equal(httpStatusForEnvelope(res, "GET"), 404);
  });

  it("daemon-timeout scenario blocks every read (R3)", async () => {
    const timedOut = new FixturesThreadsAdapter({ scenario: "daemon-timeout" });
    for (const envelope of [
      await timedOut.listWeaves(),
      await timedOut.weave(WEAVE_HOLDS),
      await timedOut.thread(THREAD_FRAYED),
      await timedOut.strands(THREAD_FRAYED),
      await timedOut.audit(THREAD_FRAYED),
      await timedOut.proposals(),
    ]) {
      assert.equal(envelope.blocked, true);
      assert.equal(envelope.why, "daemon-timeout");
      assert.equal(envelope.meta.verified, false);
    }
  });

  it("missing fixtures block with no-fixture (R4) — nothing is fabricated", async () => {
    const empty = new FixturesThreadsAdapter({ root: tempDir("phase4-empty-") });
    const res = await empty.listWeaves();
    assert.equal(res.blocked, true);
    assert.equal(res.why, "no-fixture");
  });
});

describe("fixtures adapter — thread and strands", () => {
  const adapter = new FixturesThreadsAdapter();

  it("thread view carries channels and per-channel required strands", async () => {
    const res = await adapter.thread(THREAD_HOLDS_SOUL);
    assert.equal(res.data?.surface, "SOUL.md");
    assert.deepEqual(res.data?.holdsUnder, ["mutation", "forced"]);
    assert.deepEqual(res.data?.requiredStrands.forced, ["ContentHash", "ManifestEntry"]);
  });

  it("frayed strand carries the current-vs-expected diff from observations", async () => {
    const res = await adapter.strands(THREAD_FRAYED);
    const blamed = res.data?.find((s) => s.id === FRAYED_STRAND);
    assert.ok(blamed, "blamed strand present");
    assert.deepEqual(blamed?.fray, {
      expected: "bebebebebebebebe",
      observed: "cacacacacacacaca",
      observedAt: "2026-07-15T09:00:00.000Z",
    });
  });
});

describe("fixtures adapter — audit lineage", () => {
  const adapter = new FixturesThreadsAdapter();

  it("audit-with-lineage: frayed thread walks verdict -> proposal rows, newest first", async () => {
    const res = await adapter.audit(THREAD_FRAYED);
    assert.equal(res.blocked, false);
    const ids = res.data?.map((r) => r.id);
    assert.deepEqual(ids, [4, 2, 1]);
    assert.equal(res.data?.[2]?.decision, "degrade_to_proposal");
    assert.equal(res.data?.[1]?.proposalId, PROPOSAL_OK);
    assert.equal(res.meta.sourceCursor, "ward_audit:4");
  });

  it("R7: an entry with an unresolvable proposal ref is still listed", async () => {
    const res = await adapter.audit(THREAD_FRAYED);
    const orphan = res.data?.find((r) => r.id === 4);
    assert.ok(orphan, "orphan-ref row present, never silently dropped");
    assert.equal(orphan?.proposalId, "ffffffff-9999-4999-8999-999999999999");
  });

  it("audit-empty: a thread with no rows is a verified empty list, not blocked", async () => {
    const res = await adapter.audit(THREAD_HOLDS_SOUL);
    assert.equal(res.blocked, false);
    assert.deepEqual(res.data, []);
    assert.equal(res.meta.verified, true);
  });

  it("pagination honors before=<rowid>", async () => {
    const res = await adapter.audit(THREAD_FRAYED, 2);
    assert.deepEqual(
      res.data?.map((r) => r.id),
      [1],
    );
  });
});

describe("fixtures adapter — proposals", () => {
  const adapter = new FixturesThreadsAdapter();

  it("pending-with-proposals + pending-corrupt: ok and corrupt entries listed together (R6)", async () => {
    const res = await adapter.proposals();
    assert.equal(res.blocked, false);
    assert.equal(res.data?.length, 3);
    const okEntries = res.data?.filter((p) => p.parse === "ok") ?? [];
    const corrupt = res.data?.filter((p) => p.parse === "corrupt") ?? [];
    assert.equal(okEntries.length, 2);
    assert.equal(corrupt.length, 1);
    assert.equal(corrupt[0]?.payload, null);
    const utf8 = okEntries.find((p) => p.payload?.id === PROPOSAL_OK);
    assert.equal(utf8?.payload?.edits[0]?.contents.encoding, "utf8");
  });

  it("pending-empty: an empty pending dir is a verified empty list", async () => {
    const emptyPending = new FixturesThreadsAdapter({ pendingDir: tempDir("phase4-pending-empty-") });
    const res = await emptyPending.proposals();
    assert.equal(res.blocked, false);
    assert.deepEqual(res.data, []);
    assert.equal(res.meta.verified, true);
  });

  it("an unreadable pending listing fails closed, never throws", async () => {
    // A regular file where the dir should be: existsSync passes, readdir throws.
    const notADir = path.join(tempDir("phase4-pending-unreadable-"), "pending");
    writeFileSync(notADir, "not a directory");
    const broken = new FixturesThreadsAdapter({ pendingDir: notADir });
    const res = await broken.proposals();
    assert.equal(res.blocked, true);
    assert.equal(res.why, "no-fixture");
    assert.equal(res.meta.verified, false);
    assert.equal(res.data, null);
  });

  it("R5: approve and reject refuse in fixtures mode — no daemon, no decision", async () => {
    for (const envelope of [await adapter.approve(), await adapter.reject()]) {
      assert.equal(envelope.blocked, true);
      assert.equal(envelope.why, "daemon-unavailable");
      assert.equal(httpStatusForEnvelope(envelope, "POST"), 503);
    }
  });
});

describe("daemon adapter — weave reads fail closed without a daemon", () => {
  it("unreachable daemon (status 0) blocks with daemon-unreachable (R3/R4)", async () => {
    const adapter = new DaemonThreadsAdapter({
      call: async () => ({ ok: false, status: 0, data: null, error: "connect ENOENT" }),
      covenHomeDir: tempDir("phase4-home-"),
    });
    const res = await adapter.listWeaves();
    assert.equal(res.blocked, true);
    assert.equal(res.why, "daemon-unreachable");
    assert.equal(res.meta.verified, false);
  });

  it("a daemon without the read endpoint (pre-.19) blocks with daemon-endpoint-missing", async () => {
    const adapter = new DaemonThreadsAdapter({
      call: async () => ({ ok: false, status: 404, data: null, error: "not found" }),
      covenHomeDir: tempDir("phase4-home-"),
    });
    const res = await adapter.weave(WEAVE_HOLDS);
    assert.equal(res.blocked, true);
    assert.equal(res.why, "daemon-endpoint-missing");
  });

  it("a daemon that answers the contract serves normalized summaries", async () => {
    const adapter = new DaemonThreadsAdapter({
      call: async <T>() =>
        ({
          ok: true,
          status: 200,
          data: [
            {
              weave: {
                id: WEAVE_HOLDS,
                familiar_id: "sage",
                threads: [],
                weave_hash: [1, 2],
                coven_ref: null,
                pattern_descriptor: {
                  name: "identity-surface",
                  protected_surfaces: [],
                  channels_required: [],
                  strand_requirements: [],
                },
              },
              coherence: "Coherent",
            },
          ] as unknown as T,
        }) as { ok: true; status: number; data: T },
      covenHomeDir: tempDir("phase4-home-"),
    });
    const res = await adapter.listWeaves();
    assert.equal(res.blocked, false);
    assert.equal(res.data?.[0]?.familiarId, "sage");
    // An empty weave still rolls up unknown, not healthy.
    assert.equal(res.data?.[0]?.tensionRollup.state, "unknown");
  });
});

describe("daemon adapter — ward_audit over sqlite", () => {
  async function seededHome(): Promise<string> {
    const home = tempDir("phase4-coven-home-");
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(home, "coven.sqlite3"));
    db.exec(`
CREATE TABLE ward_audit (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type    TEXT    NOT NULL,
    proposal_id   TEXT,
    familiar_id   TEXT    NOT NULL,
    ward_version  TEXT,
    ward_hash     BLOB    NOT NULL,
    tier          TEXT,
    decision      TEXT    NOT NULL,
    approver      TEXT,
    diff_hash     BLOB,
    files_touched TEXT    NOT NULL,
    channel       TEXT,
    thread_id     TEXT,
    submitted_at  TEXT    NOT NULL,
    decided_at    TEXT    NOT NULL,
    recorded_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO ward_audit (event_type, proposal_id, familiar_id, ward_hash, decision, files_touched, channel, thread_id, submitted_at, decided_at)
VALUES
 ('validation_verdict', NULL, 'echo', X'22224444', 'degrade_to_proposal', '["MEMORY.md"]', 'mutation', '${THREAD_FRAYED}', '2026-07-15T09:00:00Z', '2026-07-15T09:00:01Z'),
 ('proposal_submitted', '${PROPOSAL_OK}', 'echo', X'22224444', 'degrade_to_proposal', '["MEMORY.md"]', 'mutation', '${THREAD_FRAYED}', '2026-07-15T09:00:00Z', '2026-07-15T09:00:01Z'),
 ('validation_verdict', NULL, 'sage', X'11112222', 'permit', '["SOUL.md"]', 'mutation', 'some-other-thread', '2026-07-15T08:00:00Z', '2026-07-15T08:00:01Z');
`);
    db.close();
    return home;
  }

  it("reads rows for a thread newest-first with the max-rowid cursor", async () => {
    const adapter = new DaemonThreadsAdapter({
      call: async () => ({ ok: false, status: 0, data: null }),
      covenHomeDir: await seededHome(),
    });
    const res = await adapter.audit(THREAD_FRAYED);
    assert.equal(res.blocked, false);
    assert.deepEqual(
      res.data?.map((r) => r.id),
      [2, 1],
    );
    assert.equal(res.data?.[0]?.proposalId, PROPOSAL_OK);
    assert.equal(res.data?.[1]?.wardHash, "22224444");
    assert.equal(res.meta.sourceCursor, "ward_audit:3");
    assert.equal(res.meta.verified, true);
  });

  it("blocks with no-audit-store when the store is missing (R4)", async () => {
    const adapter = new DaemonThreadsAdapter({
      call: async () => ({ ok: false, status: 0, data: null }),
      covenHomeDir: tempDir("phase4-no-store-"),
    });
    const res = await adapter.audit(THREAD_FRAYED);
    assert.equal(res.blocked, true);
    assert.equal(res.why, "no-audit-store");
  });
});

describe("daemon adapter — proposals and decisions", () => {
  function homeWithPending(): { home: string; pending: string } {
    const home = tempDir("phase4-decide-home-");
    const pending = path.join(home, "pending");
    mkdirSync(pending);
    writeFileSync(
      path.join(pending, `eeeeeeee-0000-4000-8000-000000000001-${PROPOSAL_OK}.json`),
      JSON.stringify({
        id: PROPOSAL_OK,
        familiar_id: "eeeeeeee-0000-4000-8000-000000000001",
        writer: "familiar:echo",
        channel: "Mutation",
        thread_id: THREAD_FRAYED,
        fray: { Frayed: { strand: null, channel: "Mutation", reason: "ContentHashMismatch" } },
        edits: [{ surface: "MEMORY.md", contents: { encoding: "utf8", data: "proposed" } }],
        staged_at: [2026, 196, 9, 0, 2, 0, 0, 0, 0],
      }),
    );
    return { home, pending };
  }

  it("reads staged proposals from ~/.coven/pending", async () => {
    const { home } = homeWithPending();
    const adapter = new DaemonThreadsAdapter({
      call: async () => ({ ok: false, status: 0, data: null }),
      covenHomeDir: home,
    });
    const res = await adapter.proposals();
    assert.equal(res.data?.length, 1);
    assert.equal(res.data?.[0]?.payload?.id, PROPOSAL_OK);
  });

  it("a coven home with no pending dir is verified-empty; no home at all is blocked", async () => {
    const home = tempDir("phase4-bare-home-");
    const adapter = new DaemonThreadsAdapter({
      call: async () => ({ ok: false, status: 0, data: null }),
      covenHomeDir: home,
    });
    assert.deepEqual((await adapter.proposals()).data, []);

    const gone = new DaemonThreadsAdapter({
      call: async () => ({ ok: false, status: 0, data: null }),
      covenHomeDir: path.join(home, "does-not-exist"),
    });
    const blocked = await gone.proposals();
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.why, "daemon-unavailable");
  });

  it("an unreadable pending listing fails closed in daemon mode too, never throws", async () => {
    const home = tempDir("phase4-home-unreadable-");
    writeFileSync(path.join(home, "pending"), "not a directory");
    const adapter = new DaemonThreadsAdapter({
      call: async () => ({ ok: false, status: 0, data: null }),
      covenHomeDir: home,
    });
    const res = await adapter.proposals();
    assert.equal(res.blocked, true);
    assert.equal(res.why, "unparseable");
    assert.equal(res.meta.verified, false);
    assert.equal(res.data, null);
  });

  it("approve forwards to the daemon and never touches the pending file itself", async () => {
    const { home, pending } = homeWithPending();
    const calls: { method?: string; path: string; body?: unknown }[] = [];
    const adapter = new DaemonThreadsAdapter({
      call: async <T>(req: { method?: string; path: string; body?: unknown }) => {
        calls.push(req);
        return { ok: true, status: 200, data: { applied: true } as unknown as T };
      },
      covenHomeDir: home,
    });
    const res = await adapter.approve(PROPOSAL_OK, "looks right");
    assert.equal(res.blocked, false);
    assert.deepEqual(res.data, { applied: true });
    assert.deepEqual(calls, [
      {
        method: "POST",
        path: `/api/v1/threads/proposals/${PROPOSAL_OK}/approve`,
        body: { note: "looks right" },
        timeoutMs: 4000,
      },
    ]);
    // Forward-only: removing the staged file is the daemon's job.
    const still = await adapter.proposals();
    assert.equal(still.data?.length, 1, "pending file untouched by the forwarder");
    assert.ok(pending.length > 0);
  });

  it("R5: decision fails closed when the daemon is unreachable", async () => {
    const { home } = homeWithPending();
    const adapter = new DaemonThreadsAdapter({
      call: async () => ({ ok: false, status: 0, data: null, error: "timeout" }),
      covenHomeDir: home,
    });
    const res = await adapter.reject(PROPOSAL_OK);
    assert.equal(res.blocked, true);
    assert.equal(res.why, "daemon-unreachable");
    assert.equal(httpStatusForEnvelope(res, "POST"), 503);
  });

  it("R6: a corrupt staged proposal answers proposal-corrupt (409), decision never forwarded", async () => {
    const home = tempDir("phase4-corrupt-home-");
    mkdirSync(path.join(home, "pending"));
    const corruptId = "dddddddd-0001-4001-8001-000000000001";
    writeFileSync(
      path.join(home, "pending", `eeeeeeee-0000-4000-8000-000000000001-${corruptId}.json`),
      "{ not json",
    );
    let forwarded = false;
    const adapter = new DaemonThreadsAdapter({
      call: async <T>() => {
        forwarded = true;
        return { ok: true, status: 200, data: {} as unknown as T };
      },
      covenHomeDir: home,
    });
    const res = await adapter.approve(corruptId);
    assert.equal(res.blocked, true);
    assert.equal(res.why, "proposal-corrupt");
    assert.equal(httpStatusForEnvelope(res, "POST"), 409);
    assert.equal(forwarded, false, "corrupt proposals must never reach the daemon");
  });

  it("rejects non-UUID ids before any filesystem or daemon interaction", async () => {
    const adapter = new DaemonThreadsAdapter({
      call: async () => ({ ok: false, status: 0, data: null }),
      covenHomeDir: tempDir("phase4-ids-"),
    });
    const res = await adapter.approve("../../../etc/passwd");
    assert.equal(res.blocked, true);
    assert.equal(res.why, "invalid-id");
    assert.equal(httpStatusForEnvelope(res, "POST"), 400);
  });

  it("unknown proposal id answers not-found (404)", async () => {
    const { home } = homeWithPending();
    const adapter = new DaemonThreadsAdapter({
      call: async () => ({ ok: false, status: 0, data: null }),
      covenHomeDir: home,
    });
    const res = await adapter.approve("99999999-9999-4999-8999-999999999999");
    assert.equal(res.blocked, true);
    assert.equal(res.why, "not-found");
    assert.equal(httpStatusForEnvelope(res, "GET"), 404);
  });
});

describe("adapter selection (fixtures-first until threads-986.19 merges)", () => {
  it("defaults to fixtures; env flips to daemon; timeout scenario honored", () => {
    const prevAdapter = process.env.COVEN_THREADS_ADAPTER;
    const prevScenario = process.env.COVEN_THREADS_FIXTURE_SCENARIO;
    try {
      delete process.env.COVEN_THREADS_ADAPTER;
      delete process.env.COVEN_THREADS_FIXTURE_SCENARIO;
      assert.equal(activeThreadsAdapter().kind, "fixtures");
      process.env.COVEN_THREADS_ADAPTER = "daemon";
      assert.equal(activeThreadsAdapter().kind, "daemon");
      delete process.env.COVEN_THREADS_ADAPTER;
      process.env.COVEN_THREADS_FIXTURE_SCENARIO = "daemon-timeout";
      assert.equal(activeThreadsAdapter().kind, "fixtures");
    } finally {
      if (prevAdapter === undefined) delete process.env.COVEN_THREADS_ADAPTER;
      else process.env.COVEN_THREADS_ADAPTER = prevAdapter;
      if (prevScenario === undefined) delete process.env.COVEN_THREADS_FIXTURE_SCENARIO;
      else process.env.COVEN_THREADS_FIXTURE_SCENARIO = prevScenario;
    }
  });
});

describe("fail-closed sweep: no adapter state renders healthy from unverifiable input", () => {
  it("every blocked envelope is unverified with null data", async () => {
    const cases: ThreadsEnvelope<unknown>[] = [
      await new FixturesThreadsAdapter({ scenario: "daemon-timeout" }).listWeaves(),
      await new FixturesThreadsAdapter({ root: tempDir("phase4-sweep-") }).listWeaves(),
      await new FixturesThreadsAdapter().weave("99999999-9999-4999-8999-999999999999"),
      await new FixturesThreadsAdapter().approve(),
      await new DaemonThreadsAdapter({
        call: async () => ({ ok: false, status: 0, data: null }),
        covenHomeDir: tempDir("phase4-sweep-home-"),
      }).listWeaves(),
    ];
    for (const envelope of cases) {
      assert.equal(envelope.blocked, true);
      assert.equal(envelope.data, null);
      assert.equal(envelope.meta.verified, false);
      assert.ok(envelope.why, "every blocked envelope names why");
    }
  });

  it("fixture weave-unknown rolls up unknown at the rail — R1 end to end", async () => {
    const res = await new FixturesThreadsAdapter().listWeaves("cody");
    assert.equal(res.data?.[0]?.tensionRollup.state, "unknown");
    assert.equal(res.data?.[0]?.coherence, "unknown");
  });
});
