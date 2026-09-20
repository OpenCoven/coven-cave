import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { normalizeProposalTerminal } from "./proposal-terminal.ts";
import { DaemonThreadsAdapter } from "./threads-adapters.ts";

const proposalId = "cccccccc-0001-4001-8001-000000000001";
function row(event = "proposal_approved", reason = "applied") {
  const close = { reason, replay_hash_matched: reason === "applied" ? true : reason === "vetoed" ? null : false, rationale: "PRIVATE RATIONALE" };
  return { id: 1, proposal_id: proposalId, event_type: event, decided_at: "2099-01-01T02:00:01Z",
    detail: JSON.stringify(event === "proposal_approved" ? { approval_path_label: "familiar_review", rationale: null, window_close: close } : close) };
}
test("terminal receipts use the producer's event-specific close shape and redact private data", () => {
  for (const [event, reason, terminal] of [["proposal_approved", "applied", "applied"], ["proposal_vetoed", "vetoed", "vetoed"], ["proposal_rejected", "evidence_diverged", "rejected"]]) {
    const result = normalizeProposalTerminal(row(event, reason));
    assert.equal(result?.terminal, terminal);
    assert.equal(result?.reason, reason);
    assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  }
});
test("unknown, malformed and contradictory close evidence stays blocked", () => {
  for (const invalid of [{ ...row(), detail: "{" }, { ...row(), detail: "null" }, { ...row(), proposal_id: "bad" },
    { ...row(), decided_at: "not a date" }, row("proposal_approved", "vetoed"), row("proposal_vetoed", "applied"),
    row("proposal_rejected", "future_reason"), row("unknown", "applied"),
    { ...row(), detail: JSON.stringify({ window_close: { reason: "applied", replay_hash_matched: false } }) }]) {
    assert.equal(normalizeProposalTerminal(invalid), null);
  }
});

test("terminal timestamps reject impossible calendar dates and normalized overflow", () => {
  for (const decided_at of ["2099-02-30T02:00:01Z", "2100-02-29T02:00:01Z", "2099-01-01T24:00:00Z"]) {
    assert.equal(normalizeProposalTerminal({ ...row(), decided_at }), null);
  }
  assert.equal(normalizeProposalTerminal({ ...row(), decided_at: "2000-02-29T02:00:01+01:30" })?.terminal, "applied");
});

test("evidence divergence requires the producer's failed replay comparison", () => {
  for (const replay_hash_matched of [true, null]) {
    assert.equal(normalizeProposalTerminal({ ...row("proposal_rejected", "evidence_diverged"),
      detail: JSON.stringify({ reason: "evidence_diverged", replay_hash_matched, rationale: null }) }), null);
  }
});
test("persisted outcomes require a live daemon and exactly one terminal audit row", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "cave-terminal-test-"));
  const db = new DatabaseSync(path.join(home, "coven.sqlite3"));
  try {
    db.exec("CREATE TABLE ward_audit (id INTEGER PRIMARY KEY, proposal_id TEXT, event_type TEXT, detail TEXT, decided_at TEXT)");
    const value = row();
    const insert = db.prepare("INSERT INTO ward_audit(proposal_id,event_type,detail,decided_at) VALUES (?,?,?,?)");
    insert.run(value.proposal_id, value.event_type, value.detail, value.decided_at);
    let available = true;
    const adapter = new DaemonThreadsAdapter({ covenHomeDir: home, call: async <T>() => available
      ? { ok: true, status: 200, data: { proposals: [] } as T }
      : { ok: false, status: 503, data: null, error: "synthetic offline" } });
    const confirmed = await adapter.proposalOutcomes();
    assert.equal(confirmed.blocked, false);
    assert.equal(confirmed.data?.[0].terminal, "applied");
    available = false;
    assert.equal((await adapter.proposalOutcomes()).blocked, true);
    available = true;
    insert.run(value.proposal_id, value.event_type, value.detail, value.decided_at);
    assert.equal((await adapter.proposalOutcomes()).why, "unparseable");
  } finally { db.close(); rmSync(home, { recursive: true, force: true }); }
});

test("all accepted paths retain terminal receipts without fabricated window evidence", () => {
  for (const label of ["human_review", "human_required", "auto", "familiar_review"]) {
    const value = { ...row(), detail: JSON.stringify({ approval_path_label: label, rationale: "Private approval", window_close: null }) };
    assert.equal(normalizeProposalTerminal(value)?.terminal, "applied");
  }
  assert.equal(normalizeProposalTerminal({ ...row("proposal_rejected"), detail: null })?.terminal, "rejected");
  assert.equal(normalizeProposalTerminal({ ...row(), detail: JSON.stringify({ approval_path_label: "human_required", rationale: null, window_close: null }) }), null);
  assert.equal(normalizeProposalTerminal({ ...row(), detail: JSON.stringify({ approval_path_label: "future", rationale: null, window_close: null }) }), null);
});

test("terminal audit rows with null proposal IDs fail closed rather than disappearing", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "cave-terminal-null-id-"));
  const db = new DatabaseSync(path.join(home, "coven.sqlite3"));
  try {
    db.exec("CREATE TABLE ward_audit (id INTEGER PRIMARY KEY, proposal_id TEXT, event_type TEXT, detail TEXT, decided_at TEXT)");
    const value = row();
    const insert = db.prepare("INSERT INTO ward_audit(proposal_id,event_type,detail,decided_at) VALUES (?,?,?,?)");
    insert.run(value.proposal_id, value.event_type, value.detail, value.decided_at);
    insert.run(null, value.event_type, value.detail, value.decided_at);
    const adapter = new DaemonThreadsAdapter({ covenHomeDir: home,
      call: async <T>() => ({ ok: true, status: 200, data: { proposals: [] } as T }) });
    const result = await adapter.proposalOutcomes();
    assert.equal(result.blocked, true);
    assert.equal(result.why, "unparseable");
    assert.equal(result.meta.verified, false);
    assert.equal(result.data, null);
  } finally { db.close(); rmSync(home, { recursive: true, force: true }); }
});

test("an empty local queue cannot establish a live daemon connection", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "cave-empty-offline-"));
  try {
    const adapter = new DaemonThreadsAdapter({ covenHomeDir: home,
      call: async () => ({ ok: false, status: 503, data: null, error: "synthetic offline" }) });
    assert.equal((await adapter.proposals()).blocked, true);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("empty and absent pending directories require matching live empty summaries", async () => {
  for (const directory of [false, true]) {
    const home = mkdtempSync(path.join(os.tmpdir(), "cave-empty-summary-"));
    try {
      if (directory) mkdirSync(path.join(home, "pending"));
      for (const [data, blocked] of [[{ proposals: [] }, false], [{ proposals: [{ proposalId }] }, true],
        [{ proposals: [{ degraded: { file: "unparseable.json" } }] }, true], [{ unexpected: [] }, true]] as const) {
        const adapter = new DaemonThreadsAdapter({ covenHomeDir: home,
          call: async <T>() => ({ ok: true, status: 200, data: data as T }) });
        const result = await adapter.proposals();
        assert.equal(result.blocked, blocked);
        assert.equal(result.meta.verified, !blocked);
        if (blocked) assert.equal(result.why, "unparseable");
      }
    } finally { rmSync(home, { recursive: true, force: true }); }
  }
});
