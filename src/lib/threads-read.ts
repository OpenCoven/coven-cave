// Phase 4 read models for coven-threads state (weave rail / thread pane /
// strand inspection / proposal approval).
//
// Contract: coven-threads specs/PHASE-4-CAVE-SURFACES.md. Normative rules
// inherited from there:
// - Predicate authoritative, descriptor derived — descriptor content is always
//   labeled derived; displayed status traces to a predicate result.
// - Gate 4 fail-closed is a rendering rule: anything unknown, unverifiable, or
//   unrecognized normalizes to a blocked state, never healthy-by-default.
// - This module is pure (no I/O): raw source encodings in, view models out.
//   Adapters (threads-adapters.ts) own the I/O.

// ---------------------------------------------------------------------------
// Envelope (§3.8) — freshness on every response

export type ThreadsAdapterKind = "daemon" | "fixtures";

export type ThreadsMeta = {
  observedAt: string;
  staleAfter: string;
  sourceCursor: string;
  adapter: ThreadsAdapterKind;
  verified: boolean;
};

export type ThreadsEnvelope<T> = {
  data: T | null;
  meta: ThreadsMeta;
  blocked: boolean;
  why?: BlockedWhy;
};

export type BlockedWhy =
  | "daemon-unreachable"
  | "daemon-unavailable"
  | "daemon-endpoint-missing"
  | "daemon-timeout"
  | "no-fixture"
  | "no-audit-store"
  | "unparseable"
  | "meta-missing"
  | "not-found"
  | "proposal-corrupt"
  | "proposal-refused"
  | "invalid-id";

export const THREADS_STALE_TTL_MS = 30_000;

export function makeThreadsMeta(input: {
  adapter: ThreadsAdapterKind;
  sourceCursor: string;
  verified: boolean;
  observedAt?: Date;
  ttlMs?: number;
}): ThreadsMeta {
  const observed = input.observedAt ?? new Date();
  const ttl = input.ttlMs ?? THREADS_STALE_TTL_MS;
  return {
    observedAt: observed.toISOString(),
    staleAfter: new Date(observed.getTime() + ttl).toISOString(),
    sourceCursor: input.sourceCursor,
    adapter: input.adapter,
    verified: input.verified,
  };
}

export function okEnvelope<T>(data: T, meta: ThreadsMeta): ThreadsEnvelope<T> {
  return { data, meta, blocked: false };
}

export function blockedEnvelope<T>(why: BlockedWhy, meta: ThreadsMeta): ThreadsEnvelope<T> {
  return { data: null, meta: { ...meta, verified: false }, blocked: true, why };
}

/** §3.9 — a response held past `staleAfter` must render the stale state. */
export function isStale(meta: ThreadsMeta, now: Date = new Date()): boolean {
  const staleAfter = Date.parse(meta.staleAfter);
  return !Number.isFinite(staleAfter) || now.getTime() > staleAfter;
}

// ---------------------------------------------------------------------------
// Read models (§2)

export type ChannelView = "deliberate" | "forced" | "serialization" | "mutation";

export type FrayReasonView = {
  kind:
    | "content-hash-mismatch"
    | "signature-invalid"
    | "manifest-entry-mismatch"
    | "audit-trail-unverifiable"
    | "required-strand-missing"
    | "serialization-marker-mismatch"
    | "other";
  missingKind?: StrandKindView;
  detail?: string;
};

export type SnapReasonView = {
  kind: "revoked" | "multiple-strand-fray" | "pattern-broken" | "other";
  detail?: string;
};

/**
 * §2.1 — the crate's three tension states plus the two UI-only fail-closed
 * states. `unknown` and `stale` exist only at this layer and are never
 * persisted toward the source.
 */
export type TensionView =
  | { state: "holds" }
  | {
      state: "frayed";
      strand: string | null;
      channel: ChannelView | null;
      reason: FrayReasonView;
      detectedAt: string | null;
    }
  | { state: "snapped"; channel: ChannelView | null; reason: SnapReasonView; at: string | null }
  | { state: "unknown"; why: "daemon-unreachable" | "unparseable" | "no-fixture" | "meta-missing" }
  | { state: "stale"; lastKnown: TensionView | null; observedAt: string };

export type CoherenceView = "coherent" | "degraded" | "broken" | "unknown";

export type WeaveSummary = {
  id: string;
  familiarId: string;
  threadCount: number;
  tensionRollup: TensionView;
  coherence: CoherenceView;
  degradedSurfaces: string[];
  weaveHash: string;
};

export type DegradedFamiliarView = {
  kind: "degraded-familiar";
  familiarId: string;
  /**
   * Forward-compatible: the daemon owns this enum. Unknown reason strings still
   * render blocked rather than disappearing.
   */
  reason: string;
  /** Sanitized daemon parse error; full paths and raw config stay out of Cave. */
  error: string;
};

export type WeaveListView = {
  weaves: WeaveSummary[];
  degraded: DegradedFamiliarView[];
};

export type PatternDescriptorView = {
  derived: true;
  name: string;
  protectedSurfaces: string[];
  channelsRequired: ChannelView[];
  strandRequirements: { kind: StrandKindView; requiredOnChannels: ChannelView[] }[];
};

export type WeaveDetail = WeaveSummary & {
  threads: ThreadView[];
  patternDescriptor: PatternDescriptorView | null;
  covenRef: string | null;
};

export type ThreadView = {
  id: string;
  weaveId: string;
  surface: string;
  writer: string;
  tension: TensionView;
  holdsUnder: ChannelView[];
  requiredStrands: Partial<Record<ChannelView, StrandKindView[]>>;
  strandCount: number;
  createdAt: string | null;
};

export type StrandKindView =
  | "ContentHash"
  | "Signature"
  | "ManifestEntry"
  | "AuditTrail"
  | "SerializationMarker";

export type StrandFrayView = {
  expected: string;
  observed: string | null;
  observedAt: string | null;
};

export type StrandView = {
  id: string;
  kind: StrandKindView;
  fray?: StrandFrayView;
} & (
  | { kind: "ContentHash"; algorithm: "blake3" | "sha256" | "unknown"; value: string }
  | { kind: "Signature"; keyId: string; sigKind: "ed25519" | "principal-attestation" | "unknown"; value: string }
  | { kind: "ManifestEntry"; manifestId: string; entryHash: string }
  | { kind: "AuditTrail"; firstSeen: string | null; eventLogRef: string }
  | { kind: "SerializationMarker"; formatVersion: string; contractHash: string }
);

export type AuditEntryView = {
  id: number;
  eventType: string;
  proposalId: string | null;
  familiarId: string;
  wardVersion: string | null;
  wardHash: string;
  tier: string | null;
  decision: string;
  approver: string | null;
  diffHash: string | null;
  filesTouched: string[];
  channel: string | null;
  threadId: string | null;
  submittedAt: string;
  decidedAt: string;
  recordedAt: string;
};

export type ProposalView = {
  file: string;
  parse: "ok" | "corrupt";
  payload: {
    id: string;
    familiarId: string;
    writer: string;
    channel: ChannelView | null;
    threadId: string;
    fray: TensionView;
    edits: { surface: string; contents: { encoding: "utf8" | "base64"; data: string } }[];
    stagedAt: string | null;
  } | null;
};

// ---------------------------------------------------------------------------
// Normalizers: raw serde encodings -> view models
//
// Raw shapes come from coven-threads-core's serde output (externally tagged
// enums, capitalized variant names, `time` 9-element timestamp arrays,
// Vec<u8> as number arrays). Anything unrecognized fails closed.

type Raw = Record<string, unknown>;

function isRecord(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** `time::OffsetDateTime` serde array: [year, ordinalDay, h, m, s, ns, offH, offM, offS]. */
export function timeArrayToIso(v: unknown): string | null {
  if (typeof v === "string") {
    const parsed = Date.parse(v);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  if (!Array.isArray(v) || v.length < 6 || v.some((n) => typeof n !== "number")) return null;
  const [year, ordinal, hour, minute, second, nanosecond, offH = 0, offM = 0, offS = 0] =
    v as number[];
  const base = Date.UTC(year, 0, ordinal, hour, minute, second, Math.floor(nanosecond / 1e6));
  if (!Number.isFinite(base)) return null;
  const offsetMs = (offH * 3600 + offM * 60 + offS) * 1000;
  return new Date(base - offsetMs).toISOString();
}

export function bytesToHex(v: unknown): string | null {
  if (typeof v === "string") return /^[0-9a-f]*$/i.test(v) ? v.toLowerCase() : null;
  if (!Array.isArray(v) || v.some((n) => typeof n !== "number" || n < 0 || n > 255)) return null;
  return v.map((n) => (n as number).toString(16).padStart(2, "0")).join("");
}

export function normalizeChannel(v: unknown): ChannelView | null {
  if (typeof v !== "string") return null;
  const lower = v.toLowerCase();
  return lower === "deliberate" || lower === "forced" || lower === "serialization" || lower === "mutation"
    ? lower
    : null;
}

const STRAND_KINDS: StrandKindView[] = [
  "ContentHash",
  "Signature",
  "ManifestEntry",
  "AuditTrail",
  "SerializationMarker",
];

function normalizeStrandKind(v: unknown): StrandKindView | null {
  return typeof v === "string" && (STRAND_KINDS as string[]).includes(v)
    ? (v as StrandKindView)
    : null;
}

const FRAY_REASON_TAGS: Record<string, FrayReasonView["kind"]> = {
  ContentHashMismatch: "content-hash-mismatch",
  SignatureInvalid: "signature-invalid",
  ManifestEntryMismatch: "manifest-entry-mismatch",
  AuditTrailUnverifiable: "audit-trail-unverifiable",
  SerializationMarkerMismatch: "serialization-marker-mismatch",
};

export function normalizeFrayReason(v: unknown): FrayReasonView {
  if (typeof v === "string" && FRAY_REASON_TAGS[v]) return { kind: FRAY_REASON_TAGS[v] };
  if (isRecord(v)) {
    const missing = v.RequiredStrandMissing;
    if (isRecord(missing)) {
      const kind = normalizeStrandKind(missing.kind);
      if (kind) return { kind: "required-strand-missing", missingKind: kind };
    }
    if (typeof v.Other === "string") return { kind: "other", detail: v.Other };
  }
  // Unrecognized reason: preserve it verbatim rather than misrepresent it.
  return { kind: "other", detail: JSON.stringify(v) };
}

const SNAP_REASON_TAGS: Record<string, SnapReasonView["kind"]> = {
  Revoked: "revoked",
  MultipleStrandFray: "multiple-strand-fray",
  PatternBroken: "pattern-broken",
};

export function normalizeSnapReason(v: unknown): SnapReasonView {
  if (typeof v === "string" && SNAP_REASON_TAGS[v]) return { kind: SNAP_REASON_TAGS[v] };
  if (isRecord(v) && typeof v.Other === "string") return { kind: "other", detail: v.Other };
  return { kind: "other", detail: JSON.stringify(v) };
}

/**
 * Normalize a raw `TensionState` (or `FrayOrSnap`). Anything unrecognized —
 * including tension variants a future crate version might add — normalizes to
 * `unknown` (R1: fail-closed, never healthy-by-default).
 */
export function normalizeTension(v: unknown): TensionView {
  if (v === "Holds") return { state: "holds" };
  if (isRecord(v)) {
    if (isRecord(v.Frayed)) {
      const f = v.Frayed;
      return {
        state: "frayed",
        strand: typeof f.strand === "string" ? f.strand : null,
        channel: normalizeChannel(f.channel),
        reason: normalizeFrayReason(f.reason),
        detectedAt: timeArrayToIso(f.detected_at),
      };
    }
    if (isRecord(v.Snapped)) {
      const s = v.Snapped;
      return {
        state: "snapped",
        channel: normalizeChannel(s.channel),
        reason: normalizeSnapReason(s.reason),
        at: timeArrayToIso(s.at),
      };
    }
    // FrayOrSnap::NotCovered normalizes to unknown at the view layer: it is a
    // refusal, not a tension state, and must never render healthy.
  }
  return { state: "unknown", why: "unparseable" };
}

export function normalizeCoherence(v: unknown): {
  coherence: CoherenceView;
  degradedSurfaces: string[];
} {
  if (v === "Coherent") return { coherence: "coherent", degradedSurfaces: [] };
  if (isRecord(v)) {
    if (isRecord(v.Degraded)) {
      const surfaces = Array.isArray(v.Degraded.degraded_surfaces)
        ? v.Degraded.degraded_surfaces.filter((s): s is string => typeof s === "string")
        : [];
      return { coherence: "degraded", degradedSurfaces: surfaces };
    }
    if (isRecord(v.Broken)) return { coherence: "broken", degradedSurfaces: [] };
  }
  return { coherence: "unknown", degradedSurfaces: [] };
}

// R1 rollup arithmetic (normative): snapped > frayed > unknown > stale > holds.
const TENSION_SEVERITY: Record<TensionView["state"], number> = {
  snapped: 4,
  frayed: 3,
  unknown: 2,
  stale: 1,
  holds: 0,
};

export function tensionRollup(tensions: TensionView[]): TensionView {
  if (tensions.length === 0) return { state: "unknown", why: "unparseable" };
  let worst = tensions[0];
  for (const t of tensions.slice(1)) {
    if (TENSION_SEVERITY[t.state] > TENSION_SEVERITY[worst.state]) worst = t;
  }
  return worst;
}

const HASH_ALGOS: Record<string, "blake3" | "sha256"> = { Blake3: "blake3", Sha256: "sha256" };
const SIG_KINDS: Record<string, "ed25519" | "principal-attestation"> = {
  Ed25519: "ed25519",
  PrincipalAttestation: "principal-attestation",
};

/** Verifier-observed values for frayed strands, keyed by strand id (§2.4). */
export type ObservedMap = Record<string, { value?: unknown; at?: unknown }>;

export function normalizeStrand(v: unknown, observed?: ObservedMap): StrandView | null {
  if (!isRecord(v)) return null;
  const [tag] = Object.keys(v);
  const body = tag !== undefined ? v[tag] : undefined;
  if (!tag || !isRecord(body) || typeof body.id !== "string") return null;
  const id = body.id;

  let view: StrandView | null = null;
  if (tag === "ContentHash") {
    view = {
      id,
      kind: "ContentHash",
      algorithm: HASH_ALGOS[String(body.algorithm)] ?? "unknown",
      value: bytesToHex(body.value) ?? "",
    };
  } else if (tag === "Signature") {
    view = {
      id,
      kind: "Signature",
      keyId: typeof body.key_id === "string" ? body.key_id : "",
      sigKind: SIG_KINDS[String(body.kind)] ?? "unknown",
      value: bytesToHex(body.value) ?? "",
    };
  } else if (tag === "ManifestEntry") {
    view = {
      id,
      kind: "ManifestEntry",
      manifestId: typeof body.manifest_id === "string" ? body.manifest_id : "",
      entryHash: bytesToHex(body.entry_hash) ?? "",
    };
  } else if (tag === "AuditTrail") {
    view = {
      id,
      kind: "AuditTrail",
      firstSeen: timeArrayToIso(body.first_seen),
      eventLogRef: typeof body.event_log_ref === "string" ? body.event_log_ref : "",
    };
  } else if (tag === "SerializationMarker") {
    view = {
      id,
      kind: "SerializationMarker",
      formatVersion: typeof body.format_version === "string" ? body.format_version : "",
      contractHash: bytesToHex(body.contract_hash) ?? "",
    };
  }
  if (!view) return null;

  const seen = observed?.[id];
  if (seen) {
    const expected =
      view.kind === "ContentHash"
        ? view.value
        : view.kind === "Signature"
          ? view.value
          : view.kind === "ManifestEntry"
            ? view.entryHash
            : view.kind === "SerializationMarker"
              ? view.contractHash
              : view.eventLogRef;
    view.fray = {
      expected,
      // null observed = the verifier could not observe: renders blocked, not healthy.
      observed: seen.value == null ? null : (bytesToHex(seen.value) ?? String(seen.value)),
      observedAt: timeArrayToIso(seen.at),
    };
  }
  return view;
}

export function normalizeDescriptor(v: unknown): PatternDescriptorView | null {
  if (!isRecord(v)) return null;
  return {
    derived: true,
    name: typeof v.name === "string" ? v.name : "",
    protectedSurfaces: Array.isArray(v.protected_surfaces)
      ? v.protected_surfaces.filter((s): s is string => typeof s === "string")
      : [],
    channelsRequired: Array.isArray(v.channels_required)
      ? v.channels_required.map(normalizeChannel).filter((c): c is ChannelView => c !== null)
      : [],
    strandRequirements: Array.isArray(v.strand_requirements)
      ? v.strand_requirements.flatMap((r) => {
          if (!isRecord(r)) return [];
          const kind = normalizeStrandKind(r.kind);
          if (!kind) return [];
          const channels = Array.isArray(r.required_on_channels)
            ? r.required_on_channels.map(normalizeChannel).filter((c): c is ChannelView => c !== null)
            : [];
          return [{ kind, requiredOnChannels: channels }];
        })
      : [],
  };
}

// §2.3 requiredStrands — Channel::required_strand_kinds, mirrored (structural
// floor per channel; source: coven-threads-core channel.rs).
export const REQUIRED_STRAND_KINDS: Record<ChannelView, StrandKindView[]> = {
  deliberate: [],
  forced: ["ContentHash", "ManifestEntry"],
  serialization: ["SerializationMarker"],
  mutation: ["ContentHash"],
};

export function normalizeThread(v: unknown, weaveId: string): ThreadView | null {
  if (!isRecord(v) || typeof v.id !== "string") return null;
  const holdsUnder = Array.isArray(v.holds_under)
    ? v.holds_under.map(normalizeChannel).filter((c): c is ChannelView => c !== null)
    : [];
  const requiredStrands: Partial<Record<ChannelView, StrandKindView[]>> = {};
  for (const channel of holdsUnder) requiredStrands[channel] = REQUIRED_STRAND_KINDS[channel];
  return {
    id: v.id,
    weaveId,
    surface: typeof v.surface === "string" ? v.surface : "",
    writer: typeof v.writer === "string" ? v.writer : "",
    tension: normalizeTension(v.tension),
    holdsUnder,
    requiredStrands,
    strandCount: Array.isArray(v.strands) ? v.strands.length : 0,
    createdAt: timeArrayToIso(v.created_at),
  };
}

/**
 * One entry of the weave read payload: the raw `WeaveRecord` plus the
 * predicate's coherence result and optional verifier observations.
 */
export type RawWeaveEntry = {
  weave?: unknown;
  coherence?: unknown;
  observed?: ObservedMap;
  degraded?: unknown;
};

export function normalizeWeaveSummary(entry: RawWeaveEntry): WeaveSummary | null {
  if (!isRecord(entry.weave) || typeof entry.weave.id !== "string") return null;
  const w = entry.weave;
  const id = entry.weave.id;
  const threads = Array.isArray(w.threads) ? w.threads : [];
  const tensions = threads.map((t) => (isRecord(t) ? normalizeTension(t.tension) : normalizeTension(undefined)));
  const { coherence, degradedSurfaces } = normalizeCoherence(entry.coherence);
  return {
    id,
    familiarId: typeof w.familiar_id === "string" ? w.familiar_id : "",
    threadCount: threads.length,
    tensionRollup: tensionRollup(tensions),
    coherence,
    degradedSurfaces,
    weaveHash: bytesToHex(w.weave_hash) ?? "",
  };
}

export function normalizeDegradedFamiliar(entry: RawWeaveEntry): DegradedFamiliarView | null {
  // Daemon should never emit both shapes. If it does, preserve the older healthy
  // path when it normalizes: a valid predicate-bearing weave is authoritative.
  if (normalizeWeaveSummary(entry) !== null) return null;
  if (!isRecord(entry.degraded)) return null;
  const familiarId = entry.degraded.familiarId;
  if (typeof familiarId !== "string" || familiarId.length === 0) return null;
  return {
    kind: "degraded-familiar",
    familiarId,
    reason: typeof entry.degraded.reason === "string" ? entry.degraded.reason : "ward-config-unparseable",
    error: typeof entry.degraded.error === "string" ? entry.degraded.error : "",
  };
}

export function normalizeWeaveDetail(entry: RawWeaveEntry): WeaveDetail | null {
  const summary = normalizeWeaveSummary(entry);
  if (!summary || !isRecord(entry.weave)) return null;
  const w = entry.weave;
  const threads = (Array.isArray(w.threads) ? w.threads : [])
    .map((t) => normalizeThread(t, summary.id))
    .filter((t): t is ThreadView => t !== null);
  return {
    ...summary,
    threads,
    patternDescriptor: normalizeDescriptor(w.pattern_descriptor),
    covenRef: typeof w.coven_ref === "string" ? w.coven_ref : null,
  };
}

export function normalizeStrandsOfThread(v: unknown, observed?: ObservedMap): StrandView[] {
  if (!isRecord(v) || !Array.isArray(v.strands)) return [];
  return v.strands
    .map((s) => normalizeStrand(s, observed))
    .filter((s): s is StrandView => s !== null);
}

// ---------------------------------------------------------------------------
// PendingProposal (§2.6)

export function normalizeProposal(fileName: string, raw: unknown): ProposalView {
  if (!isRecord(raw) || typeof raw.id !== "string" || !Array.isArray(raw.edits)) {
    return { file: fileName, parse: "corrupt", payload: null };
  }
  const edits: NonNullable<ProposalView["payload"]>["edits"] = [];
  for (const e of raw.edits) {
    if (!isRecord(e) || typeof e.surface !== "string" || !isRecord(e.contents)) {
      return { file: fileName, parse: "corrupt", payload: null };
    }
    const encoding = e.contents.encoding;
    const data = e.contents.data;
    if ((encoding !== "utf8" && encoding !== "base64") || typeof data !== "string") {
      return { file: fileName, parse: "corrupt", payload: null };
    }
    edits.push({ surface: e.surface, contents: { encoding, data } });
  }
  return {
    file: fileName,
    parse: "ok",
    payload: {
      id: raw.id,
      familiarId: typeof raw.familiar_id === "string" ? raw.familiar_id : "",
      writer: typeof raw.writer === "string" ? raw.writer : "",
      channel: normalizeChannel(raw.channel),
      threadId: typeof raw.thread_id === "string" ? raw.thread_id : "",
      fray: normalizeTension(raw.fray),
      edits,
      stagedAt: timeArrayToIso(raw.staged_at),
    },
  };
}

// ---------------------------------------------------------------------------
// ward_audit rows (§2.5) — shared by the sqlite adapter and the JSONL fixtures

export function normalizeAuditRow(row: Raw): AuditEntryView | null {
  const id = typeof row.id === "number" ? row.id : Number(row.id);
  if (!Number.isFinite(id)) return null;
  let filesTouched: string[] = [];
  if (typeof row.files_touched === "string") {
    try {
      const parsed = JSON.parse(row.files_touched);
      if (Array.isArray(parsed)) filesTouched = parsed.filter((s): s is string => typeof s === "string");
    } catch {
      filesTouched = [];
    }
  } else if (Array.isArray(row.files_touched)) {
    filesTouched = row.files_touched.filter((s): s is string => typeof s === "string");
  }
  return {
    id,
    eventType: String(row.event_type ?? ""),
    proposalId: row.proposal_id == null ? null : String(row.proposal_id),
    familiarId: String(row.familiar_id ?? ""),
    wardVersion: row.ward_version == null ? null : String(row.ward_version),
    wardHash: bytesToHex(row.ward_hash instanceof Uint8Array ? Array.from(row.ward_hash) : row.ward_hash) ?? "",
    tier: row.tier == null ? null : String(row.tier),
    decision: String(row.decision ?? ""),
    approver: row.approver == null ? null : String(row.approver),
    diffHash:
      row.diff_hash == null
        ? null
        : bytesToHex(row.diff_hash instanceof Uint8Array ? Array.from(row.diff_hash) : row.diff_hash),
    filesTouched,
    channel: row.channel == null ? null : String(row.channel),
    threadId: row.thread_id == null ? null : String(row.thread_id),
    submittedAt: String(row.submitted_at ?? ""),
    decidedAt: String(row.decided_at ?? ""),
    recordedAt: String(row.recorded_at ?? ""),
  };
}

// ---------------------------------------------------------------------------
// Id hygiene: ids interpolate into pending-file lookups and daemon paths.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSafeThreadsId(id: string): boolean {
  return UUID_RE.test(id);
}
