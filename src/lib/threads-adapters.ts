// Phase 4 read adapters: two paths behind one interface (spec §1).
//
// - `fixtures` (daemon-absent): reads fixtures/phase-4/ — the DEFAULT until
//   threads-986.19 merges PR OpenCoven/coven#382.
// - `daemon` (daemon-present): coven socket for weave state and decision
//   forwarding, ~/.coven/coven.sqlite3 for ward_audit, ~/.coven/pending/ for
//   staged proposals.
//
// Both are read-only over protected memory. The approve/reject methods are
// thin daemon-forwarders (§3.7): they carry the principal's decision to the
// daemon and return its outcome; they never apply edits, never touch
// pending/, never write sqlite. In fixtures mode they refuse (fail-closed).

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

import { callDaemon, type DaemonResponse } from "./coven-daemon.ts";
import { covenHome } from "./coven-paths.ts";
import {
  blockedEnvelope,
  isSafeThreadsId,
  makeThreadsMeta,
  normalizeAuditRow,
  normalizeDegradedFamiliar,
  normalizeStrandsOfThread,
  normalizeThread,
  normalizeWeaveDetail,
  normalizeWeaveSummary,
  okEnvelope,
  type AuditEntryView,
  type ProposalView,
  type RawWeaveEntry,
  type StrandView,
  type ThreadsAdapterKind,
  type ThreadsEnvelope,
  type ThreadView,
  type WeaveListEntry,
  type WeaveDetail,
  type WeaveSummary,
} from "./threads-read.ts";
import { normalizeProposal } from "./proposal-normalize.ts";

export interface ThreadsReadAdapter {
  kind: ThreadsAdapterKind;
  listWeaves(familiar?: string): Promise<ThreadsEnvelope<WeaveListEntry[]>>;
  weave(id: string): Promise<ThreadsEnvelope<WeaveDetail>>;
  thread(id: string): Promise<ThreadsEnvelope<ThreadView>>;
  strands(threadId: string): Promise<ThreadsEnvelope<StrandView[]>>;
  audit(threadId: string, before?: number): Promise<ThreadsEnvelope<AuditEntryView[]>>;
  proposals(): Promise<ThreadsEnvelope<ProposalView[]>>;
  approve(proposalId: string, note?: string): Promise<ThreadsEnvelope<unknown>>;
  reject(proposalId: string, note?: string): Promise<ThreadsEnvelope<unknown>>;
}

const AUDIT_PAGE_SIZE = 200;

function normalizeWeaveList(entries: RawWeaveEntry[], familiar?: string): WeaveListEntry[] {
  const normalized: WeaveListEntry[] = [];
  for (const entry of entries) {
    const weave = normalizeWeaveSummary(entry);
    if (weave) {
      if (!familiar || weave.familiarId === familiar) normalized.push(weave);
      continue;
    }
    const degradedFamiliar = normalizeDegradedFamiliar(entry);
    if (degradedFamiliar && (!familiar || degradedFamiliar.familiarId === familiar)) {
      normalized.push(degradedFamiliar);
    }
  }
  return normalized;
}

function pendingDirCursor(dir: string): string {
  let listing: string[] = [];
  try {
    listing = readdirSync(/* turbopackIgnore: true */ dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => {
        const stat = statSync(path.join(/* turbopackIgnore: true */ dir, f));
        return `${f}:${stat.size}:${stat.mtimeMs}`;
      });
  } catch {
    listing = [];
  }
  return `pending:${createHash("sha256").update(listing.join("\n")).digest("hex").slice(0, 16)}`;
}

type StagedProposal = {
  file: string;
  raw: unknown;
};

type ProposalSummarySource =
  | { state: "available"; byId: Map<string, unknown> }
  | { state: "unavailable" }
  | { state: "unparseable" };

function readPendingDir(dir: string, fileFilter: (file: string) => boolean = (file) => file.endsWith(".json")): StagedProposal[] | null {
  // null = the listing itself could not be verified (unreadable dir, not a
  // dir, permissions). Callers fail closed — a throw here would 500 the route
  // instead of rendering blocked.
  let files: string[];
  try {
    files = readdirSync(/* turbopackIgnore: true */ dir)
      .filter(fileFilter)
      .sort();
  } catch {
    return null;
  }
  return files.map((file) => {
    try {
      const raw: unknown = JSON.parse(readFileSync(path.join(/* turbopackIgnore: true */ dir, file), "utf8"));
      return { file, raw };
    } catch {
      // R6: corrupt pending file — listed, actions disabled, never dropped.
      return { file, raw: null };
    }
  });
}

function stagedProposalId(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const candidate =
    typeof record.pending === "object" && record.pending !== null && !Array.isArray(record.pending)
      ? (record.pending as Record<string, unknown>)
      : record;
  return typeof candidate.id === "string" ? candidate.id : null;
}

function proposalSummarySource(raw: unknown): ProposalSummarySource {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { state: "unparseable" };
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !Object.hasOwn(record, "proposals")) return { state: "unparseable" };
  const proposals = record.proposals;
  if (!Array.isArray(proposals)) return { state: "unparseable" };
  const byId = new Map<string, unknown>();
  for (const proposal of proposals) {
    if (typeof proposal !== "object" || proposal === null || Array.isArray(proposal)) continue;
    const proposalId = (proposal as Record<string, unknown>).proposalId;
    if (typeof proposalId === "string") byId.set(proposalId, proposal);
  }
  return { state: "available", byId };
}

function proposalSummaryCursor(raw: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(raw) ?? String(raw);
  } catch {
    serialized = "unserializable";
  }
  return createHash("sha256").update(serialized).digest("hex").slice(0, 16);
}

function joinProposalSummaries(staged: StagedProposal[], summaries: ProposalSummarySource): ProposalView[] {
  return staged.map(({ file, raw }) => {
    const id = stagedProposalId(raw);
    const summary =
      summaries.state === "unavailable"
        ? null
        : summaries.state === "unparseable"
          ? true
          : id === null
            ? undefined
            : summaries.byId.get(id);
    return normalizeProposal(file, raw, summary);
  });
}

function findPendingFile(dir: string, proposalId: string): string | null {
  // Filename convention: <familiar-uuid>-<proposal-uuid>.json (staging.rs).
  // proposalId is regex-validated before this is called; never joined raw.
  try {
    const match = readdirSync(/* turbopackIgnore: true */ dir).find((f) => f.endsWith(`-${proposalId}.json`));
    return match ? path.join(/* turbopackIgnore: true */ dir, match) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fixtures adapter (daemon-absent)

export type FixturesScenario = "default" | "daemon-timeout";

export type FixturesAdapterOptions = {
  root?: string;
  pendingDir?: string;
  scenario?: FixturesScenario;
};

export class FixturesThreadsAdapter implements ThreadsReadAdapter {
  readonly kind = "fixtures" as const;
  private readonly root: string;
  private readonly pendingDir: string;
  private readonly phase5FixtureDir: string | null;
  private readonly scenario: FixturesScenario;

  constructor(options: FixturesAdapterOptions = {}) {
    // Both fixture overrides and daemon stores are selected at runtime. Ignore
    // them as trace roots while retaining the existing validation/read paths.
    this.root = options.root ?? path.join(/* turbopackIgnore: true */ process.cwd(), "fixtures", "phase-4");
    this.pendingDir = options.pendingDir ?? path.join(/* turbopackIgnore: true */ this.root, "pending");
    this.phase5FixtureDir =
      options.root === undefined && options.pendingDir === undefined
        ? path.join(/* turbopackIgnore: true */ process.cwd(), "fixtures", "phase-5")
        : null;
    this.scenario = options.scenario ?? "default";
  }

  private meta(sourceCursor: string, verified: boolean) {
    return makeThreadsMeta({ adapter: "fixtures", sourceCursor, verified });
  }

  private timedOut<T>(): ThreadsEnvelope<T> | null {
    if (this.scenario !== "daemon-timeout") return null;
    // R3: source did not answer — blocked, stale banner + last-known in the UI.
    return blockedEnvelope<T>("daemon-timeout", this.meta("none", false));
  }

  private loadWeaveEntries(): RawWeaveEntry[] | null {
    try {
      const raw: unknown = JSON.parse(readFileSync(path.join(/* turbopackIgnore: true */ this.root, "weaves.json"), "utf8"));
      return Array.isArray(raw) ? (raw as RawWeaveEntry[]) : null;
    } catch {
      return null;
    }
  }

  private weaveCursor(): string {
    try {
      const stat = statSync(path.join(/* turbopackIgnore: true */ this.root, "weaves.json"));
      return `weave:fixture:${stat.size}:${stat.mtimeMs}`;
    } catch {
      return "weave:fixture:absent";
    }
  }

  async listWeaves(familiar?: string): Promise<ThreadsEnvelope<WeaveListEntry[]>> {
    const timeout = this.timedOut<WeaveListEntry[]>();
    if (timeout) return timeout;
    const entries = this.loadWeaveEntries();
    if (!entries) return blockedEnvelope("no-fixture", this.meta(this.weaveCursor(), false));
    return okEnvelope(normalizeWeaveList(entries, familiar), this.meta(this.weaveCursor(), true));
  }

  async weave(id: string): Promise<ThreadsEnvelope<WeaveDetail>> {
    const timeout = this.timedOut<WeaveDetail>();
    if (timeout) return timeout;
    const entries = this.loadWeaveEntries();
    if (!entries) return blockedEnvelope("no-fixture", this.meta(this.weaveCursor(), false));
    for (const entry of entries) {
      const detail = normalizeWeaveDetail(entry);
      if (detail?.id === id) return okEnvelope(detail, this.meta(`weave:${detail.weaveHash}`, true));
    }
    return blockedEnvelope("not-found", this.meta(this.weaveCursor(), false));
  }

  private findRawThread(threadId: string): { entry: RawWeaveEntry; raw: unknown; view: ThreadView } | null {
    const entries = this.loadWeaveEntries();
    if (!entries) return null;
    for (const entry of entries) {
      const weave = entry.weave;
      if (typeof weave !== "object" || weave === null) continue;
      const w = weave as { id?: unknown; threads?: unknown };
      if (typeof w.id !== "string" || !Array.isArray(w.threads)) continue;
      for (const rawThread of w.threads) {
        const view = normalizeThread(rawThread, w.id);
        if (view?.id === threadId) return { entry, raw: rawThread, view };
      }
    }
    return null;
  }

  async thread(id: string): Promise<ThreadsEnvelope<ThreadView>> {
    const timeout = this.timedOut<ThreadView>();
    if (timeout) return timeout;
    if (!this.loadWeaveEntries()) return blockedEnvelope("no-fixture", this.meta(this.weaveCursor(), false));
    const found = this.findRawThread(id);
    if (!found) return blockedEnvelope("not-found", this.meta(this.weaveCursor(), false));
    return okEnvelope(found.view, this.meta(this.weaveCursor(), true));
  }

  async strands(threadId: string): Promise<ThreadsEnvelope<StrandView[]>> {
    const timeout = this.timedOut<StrandView[]>();
    if (timeout) return timeout;
    if (!this.loadWeaveEntries()) return blockedEnvelope("no-fixture", this.meta(this.weaveCursor(), false));
    const found = this.findRawThread(threadId);
    if (!found) return blockedEnvelope("not-found", this.meta(this.weaveCursor(), false));
    return okEnvelope(
      normalizeStrandsOfThread(found.raw, found.entry.observed),
      this.meta(this.weaveCursor(), true),
    );
  }

  async audit(threadId: string, before?: number): Promise<ThreadsEnvelope<AuditEntryView[]>> {
    const timeout = this.timedOut<AuditEntryView[]>();
    if (timeout) return timeout;
    let lines: string[];
    try {
      lines = readFileSync(path.join(/* turbopackIgnore: true */ this.root, "ward-audit.jsonl"), "utf8")
        .split("\n")
        .filter((l) => l.trim().length > 0);
    } catch {
      return blockedEnvelope("no-fixture", this.meta("ward_audit:absent", false));
    }
    const rows: AuditEntryView[] = [];
    for (const line of lines) {
      try {
        const row = normalizeAuditRow(JSON.parse(line));
        if (row) rows.push(row);
      } catch {
        // A corrupt audit line is a contract violation of the fixture itself;
        // skipping silently would hide it. Fail the whole read closed.
        return blockedEnvelope("unparseable", this.meta("ward_audit:corrupt", false));
      }
    }
    const cursor = `ward_audit:${rows.reduce((max, r) => Math.max(max, r.id), 0)}`;
    const page = rows
      .filter((r) => r.threadId === threadId)
      .filter((r) => (before === undefined ? true : r.id < before))
      .sort((a, b) => b.id - a.id)
      .slice(0, AUDIT_PAGE_SIZE);
    // audit-empty is a verified fact (an empty list), not a blocked state.
    return okEnvelope(page, this.meta(cursor, true));
  }

  async proposals(): Promise<ThreadsEnvelope<ProposalView[]>> {
    const timeout = this.timedOut<ProposalView[]>();
    if (timeout) return timeout;
    if (!existsSync(/* turbopackIgnore: true */ this.pendingDir)) {
      return blockedEnvelope("no-fixture", this.meta("pending:absent", false));
    }
    const staged = readPendingDir(this.pendingDir);
    if (staged === null) {
      return blockedEnvelope("no-fixture", this.meta("pending:unreadable", false));
    }
    if (this.phase5FixtureDir === null) {
      return okEnvelope(
        joinProposalSummaries(staged, { state: "available", byId: new Map() }),
        this.meta(pendingDirCursor(this.pendingDir), true),
      );
    }

    const scheduled = readPendingDir(this.phase5FixtureDir, (file) => file.endsWith(".staged-envelope.json"));
    if (scheduled === null) {
      return blockedEnvelope("no-fixture", this.meta("phase5-proposals:unreadable", false));
    }
    let summaries: ProposalSummarySource;
    let summariesCursor = "unreadable";
    try {
      const raw: unknown = JSON.parse(
        readFileSync(path.join(/* turbopackIgnore: true */ this.phase5FixtureDir, "proposals.json"), "utf8"),
      );
      summaries = proposalSummarySource(raw);
      summariesCursor = proposalSummaryCursor(raw);
    } catch {
      summaries = { state: "unparseable" };
    }
    const listed = [
      ...joinProposalSummaries(staged, summaries),
      ...joinProposalSummaries(scheduled, summaries),
    ];
    return okEnvelope(
      listed,
      this.meta(`${pendingDirCursor(this.pendingDir)}:phase5:${summaries.state}:${summariesCursor}`, true),
    );
  }

  // §3.7 / R5: in fixtures mode there is no daemon to forward to — the action
  // fails closed. No optimistic UI, no queued decisions.
  async approve(): Promise<ThreadsEnvelope<unknown>> {
    return blockedEnvelope("daemon-unavailable", this.meta("none", false));
  }

  async reject(): Promise<ThreadsEnvelope<unknown>> {
    return blockedEnvelope("daemon-unavailable", this.meta("none", false));
  }
}

// ---------------------------------------------------------------------------
// Daemon adapter (daemon-present)

/**
 * Daemon read endpoints for weave state, defined by spec §1 as the
 * daemon-present contract. The daemon grows these after threads-986.19
 * merges PR #382; until it answers, every weave read fails closed
 * (`daemon-unreachable` / `daemon-endpoint-missing`) — never fabricated.
 */
export const DAEMON_WEAVES_PATH = "/api/v1/threads/weaves";
export const DAEMON_PROPOSALS_PATH = "/api/v1/threads/proposals";
export const DAEMON_PROPOSAL_DECISION_PATH = (id: string, decision: "approve" | "reject") =>
  `/api/v1/threads/proposals/${id}/${decision}`;

type DaemonCall = <T>(req: {
  method?: string;
  path: string;
  body?: unknown;
  timeoutMs?: number;
}) => Promise<DaemonResponse<T>>;

export type DaemonAdapterOptions = {
  call?: DaemonCall;
  covenHomeDir?: string;
  timeoutMs?: number;
};

export class DaemonThreadsAdapter implements ThreadsReadAdapter {
  readonly kind = "daemon" as const;
  private readonly call: DaemonCall;
  private readonly home: string;
  private readonly timeoutMs: number;

  constructor(options: DaemonAdapterOptions = {}) {
    this.call = options.call ?? (callDaemon as DaemonCall);
    this.home = options.covenHomeDir ?? covenHome();
    this.timeoutMs = options.timeoutMs ?? 4000;
  }

  private meta(sourceCursor: string, verified: boolean) {
    return makeThreadsMeta({ adapter: "daemon", sourceCursor, verified });
  }

  private blockedFromDaemon<T>(res: DaemonResponse<unknown>): ThreadsEnvelope<T> {
    // status 0 = transport failure (unreachable/timeout); 404 = daemon alive
    // but the endpoint is not there yet (pre-.19). Both fail closed.
    const why = res.status === 0 ? "daemon-unreachable" : res.status === 404 ? "daemon-endpoint-missing" : "daemon-unavailable";
    return blockedEnvelope<T>(why, this.meta("none", false));
  }

  private async fetchWeaveEntries(): Promise<
    { entries: RawWeaveEntry[] } | { blocked: ThreadsEnvelope<never> }
  > {
    const res = await this.call<RawWeaveEntry[]>({ path: DAEMON_WEAVES_PATH, timeoutMs: this.timeoutMs });
    if (!res.ok || !Array.isArray(res.data)) return { blocked: this.blockedFromDaemon<never>(res) };
    return { entries: res.data };
  }

  async listWeaves(familiar?: string): Promise<ThreadsEnvelope<WeaveListEntry[]>> {
    const fetched = await this.fetchWeaveEntries();
    if ("blocked" in fetched) return fetched.blocked;
    const list = normalizeWeaveList(fetched.entries, familiar);
    const cursorBits = list.map((entry) =>
      "kind" in entry
        ? `degraded:${entry.familiarId}:${entry.reason}:${createHash("sha256").update(entry.error).digest("hex").slice(0, 12)}`
        : entry.weaveHash,
    );
    return okEnvelope(list, this.meta(`weave:${cursorBits.join(",").slice(0, 64)}`, true));
  }

  async weave(id: string): Promise<ThreadsEnvelope<WeaveDetail>> {
    const fetched = await this.fetchWeaveEntries();
    if ("blocked" in fetched) return fetched.blocked;
    for (const entry of fetched.entries) {
      const detail = normalizeWeaveDetail(entry);
      if (detail?.id === id) return okEnvelope(detail, this.meta(`weave:${detail.weaveHash}`, true));
    }
    return blockedEnvelope("not-found", this.meta("weave:listed", false));
  }

  async thread(id: string): Promise<ThreadsEnvelope<ThreadView>> {
    const fetched = await this.fetchWeaveEntries();
    if ("blocked" in fetched) return fetched.blocked;
    for (const entry of fetched.entries) {
      const detail = normalizeWeaveDetail(entry);
      const found = detail?.threads.find((t) => t.id === id);
      if (found && detail) return okEnvelope(found, this.meta(`weave:${detail.weaveHash}`, true));
    }
    return blockedEnvelope("not-found", this.meta("weave:listed", false));
  }

  async strands(threadId: string): Promise<ThreadsEnvelope<StrandView[]>> {
    const fetched = await this.fetchWeaveEntries();
    if ("blocked" in fetched) return fetched.blocked;
    for (const entry of fetched.entries) {
      const weave = entry.weave;
      if (typeof weave !== "object" || weave === null) continue;
      const w = weave as { threads?: unknown };
      if (!Array.isArray(w.threads)) continue;
      for (const rawThread of w.threads) {
        const view = normalizeThread(rawThread, "");
        if (view?.id === threadId) {
          return okEnvelope(
            normalizeStrandsOfThread(rawThread, entry.observed),
            this.meta("weave:listed", true),
          );
        }
      }
    }
    return blockedEnvelope("not-found", this.meta("weave:listed", false));
  }

  async audit(threadId: string, before?: number): Promise<ThreadsEnvelope<AuditEntryView[]>> {
    const dbPath = path.join(/* turbopackIgnore: true */ this.home, "coven.sqlite3");
    if (!existsSync(/* turbopackIgnore: true */ dbPath)) {
      return blockedEnvelope("no-audit-store", this.meta("ward_audit:absent", false));
    }
    try {
      // Lazy: node:sqlite is experimental; loading it only here keeps the
      // fixtures path (the default until .19) entirely free of it.
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const cursorRow = db.prepare("SELECT COALESCE(MAX(id), 0) AS max_id FROM ward_audit").get() as
          | { max_id: number | bigint }
          | undefined;
        const cursor = `ward_audit:${Number(cursorRow?.max_id ?? 0)}`;
        const stmt = before
          ? db.prepare(
              "SELECT * FROM ward_audit WHERE thread_id = ? AND id < ? ORDER BY id DESC LIMIT ?",
            )
          : db.prepare("SELECT * FROM ward_audit WHERE thread_id = ? ORDER BY id DESC LIMIT ?");
        const rawRows = (
          before ? stmt.all(threadId, before, AUDIT_PAGE_SIZE) : stmt.all(threadId, AUDIT_PAGE_SIZE)
        ) as Record<string, unknown>[];
        const rows: AuditEntryView[] = [];
        for (const raw of rawRows) {
          const row = normalizeAuditRow(raw);
          if (row) rows.push(row);
        }
        return okEnvelope(rows, this.meta(cursor, true));
      } finally {
        db.close();
      }
    } catch {
      // Missing table (pre-.19 store), locked db, or driver failure: blocked.
      return blockedEnvelope("no-audit-store", this.meta("ward_audit:unreadable", false));
    }
  }

  async proposals(): Promise<ThreadsEnvelope<ProposalView[]>> {
    const pendingDir = path.join(/* turbopackIgnore: true */ this.home, "pending");
    if (!existsSync(/* turbopackIgnore: true */ pendingDir)) {
      // No pending dir but a real coven home: nothing has ever been staged —
      // verified empty. No coven home at all: nothing to verify against.
      if (existsSync(/* turbopackIgnore: true */ this.home)) return okEnvelope([], this.meta("pending:empty", true));
      return blockedEnvelope("daemon-unavailable", this.meta("pending:absent", false));
    }
    const staged = readPendingDir(pendingDir);
    if (staged === null) {
      // The staging area exists but its listing cannot be verified: blocked,
      // never a throw and never an empty-healthy answer.
      return blockedEnvelope("unparseable", this.meta("pending:unreadable", false));
    }
    if (staged.length === 0) return okEnvelope([], this.meta(pendingDirCursor(pendingDir), true));

    const res = await this.call<unknown>({ path: DAEMON_PROPOSALS_PATH, timeoutMs: this.timeoutMs });
    const summaries = res.ok ? proposalSummarySource(res.data) : { state: "unavailable" as const };
    const summariesCursor = res.ok ? proposalSummaryCursor(res.data) : `unavailable:${res.status}`;
    return okEnvelope(
      joinProposalSummaries(staged, summaries),
      this.meta(`${pendingDirCursor(pendingDir)}:${summariesCursor}`, true),
    );
  }

  private async decide(
    proposalId: string,
    decision: "approve" | "reject",
    note?: string,
  ): Promise<ThreadsEnvelope<unknown>> {
    if (!isSafeThreadsId(proposalId)) {
      return blockedEnvelope("invalid-id", this.meta("none", false));
    }
    const pendingDir = path.join(/* turbopackIgnore: true */ this.home, "pending");
    const file = findPendingFile(pendingDir, proposalId);
    if (!file) return blockedEnvelope("not-found", this.meta(pendingDirCursor(pendingDir), false));
    try {
      const parsed = normalizeProposal(path.basename(file), JSON.parse(readFileSync(/* turbopackIgnore: true */ file, "utf8")));
      if (parsed.parse === "corrupt") {
        return blockedEnvelope("proposal-corrupt", this.meta(pendingDirCursor(pendingDir), false));
      }
    } catch {
      return blockedEnvelope("proposal-corrupt", this.meta(pendingDirCursor(pendingDir), false));
    }
    // Forward-only: the daemon re-validates, applies or refuses, audits, and
    // removes the pending file. This adapter never mutates anything itself.
    const res = await this.call<unknown>({
      method: "POST",
      path: DAEMON_PROPOSAL_DECISION_PATH(proposalId, decision),
      body: note === undefined ? {} : { note },
      timeoutMs: this.timeoutMs,
    });
    if (!res.ok) return this.blockedFromDecision(res);
    return okEnvelope(res.data, this.meta(pendingDirCursor(pendingDir), true));
  }

  /**
   * §3.7: the daemon "applies or refuses" and the route returns its outcome —
   * a semantic refusal (blocked body with a why) must surface as that refusal,
   * not be flattened into a transport-shaped `daemon-unavailable` (which the
   * UI copy reads as "the proposal stays pending" — false for a daemon-side
   * revalidation refusal, which consumes the staged file).
   */
  private blockedFromDecision(res: DaemonResponse<unknown>): ThreadsEnvelope<unknown> {
    const body = res.data;
    if (typeof body === "object" && body !== null && (body as { blocked?: unknown }).blocked === true) {
      const why = (body as { why?: unknown }).why;
      if (why === "proposal-not-found") return blockedEnvelope("not-found", this.meta("none", false));
      if (why === "proposal-corrupt") return blockedEnvelope("proposal-corrupt", this.meta("none", false));
      return blockedEnvelope("proposal-refused", this.meta("none", false));
    }
    return this.blockedFromDaemon(res);
  }

  async approve(proposalId: string, note?: string): Promise<ThreadsEnvelope<unknown>> {
    return this.decide(proposalId, "approve", note);
  }

  async reject(proposalId: string, note?: string): Promise<ThreadsEnvelope<unknown>> {
    return this.decide(proposalId, "reject", note);
  }
}

// ---------------------------------------------------------------------------
// Adapter selection: daemon-present is the default since threads-986.19
// merged PR #382 (2026-07-15) and the daemon grew the read/decision endpoints
// (coven#408, threads-v3g) — spec §1's fixtures-first condition has lapsed.
// COVEN_THREADS_ADAPTER=fixtures keeps the daemon-absent adapter for demos,
// tests, and the fixture scenarios.

export function activeThreadsAdapter(): ThreadsReadAdapter {
  if (process.env.COVEN_THREADS_ADAPTER === "fixtures") {
    const scenario = process.env.COVEN_THREADS_FIXTURE_SCENARIO === "daemon-timeout" ? "daemon-timeout" : "default";
    return new FixturesThreadsAdapter({ scenario });
  }
  return new DaemonThreadsAdapter();
}

/** Map a blocked envelope's `why` to the HTTP status the route answers (§3.7, §4). */
export function httpStatusForEnvelope(envelope: ThreadsEnvelope<unknown>, method: "GET" | "POST"): number {
  if (!envelope.blocked) return 200;
  switch (envelope.why) {
    case "not-found":
      return 404; // R11: not-found renders blocked, never empty-healthy
    case "invalid-id":
      return 400;
    case "proposal-corrupt":
      return 409; // R6
    case "proposal-refused":
      return 409; // §3.7: daemon re-validated and refused — semantic, not transport
    case "daemon-unavailable":
    case "daemon-unreachable":
    case "daemon-endpoint-missing":
    case "daemon-timeout":
      // Reads render a blocked page state (200 + blocked envelope); decision
      // POSTs must fail loudly (R5).
      return method === "POST" ? 503 : 200;
    default:
      return method === "POST" ? 503 : 200;
  }
}
