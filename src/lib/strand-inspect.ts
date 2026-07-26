// View-model for the strand inspection surface (threads-986.17.5; spec §2.4,
// §3 routes 4-5). Pure: strands + audit entries in, render rows out.
//
// - Per-strand detail for all five kinds, committed material as hex.
// - On a Frayed thread: current-vs-expected diff for the blamed strand; a
//   null observation renders blocked ("could not observe"), never healthy.
// - Lineage walks strand → ward_audit entries → source; entries with
//   unresolvable refs are marked, never silently dropped (R7).

import type { AuditEntryView, StrandView, TensionView } from "./threads-read.ts";

export type StrandDetailRow = { label: string; value: string; mono?: boolean };

export function strandDetailRows(strand: StrandView): StrandDetailRow[] {
  switch (strand.kind) {
    case "ContentHash":
      return [
        { label: "kind", value: "ContentHash — hash commitment to the surface's content" },
        { label: "algorithm", value: strand.algorithm },
        { label: "committed hash", value: strand.value || "(empty)", mono: true },
      ];
    case "Signature":
      return [
        { label: "kind", value: "Signature — provenance by an authority key" },
        { label: "key", value: strand.keyId || "(unnamed)" },
        { label: "signature kind", value: strand.sigKind },
        { label: "signature", value: strand.value || "(empty)", mono: true },
      ];
    case "ManifestEntry":
      return [
        { label: "kind", value: "ManifestEntry — membership in an external hash manifest" },
        { label: "manifest", value: strand.manifestId || "(unnamed)", mono: true },
        { label: "entry hash", value: strand.entryHash || "(empty)", mono: true },
      ];
    case "AuditTrail":
      return [
        { label: "kind", value: "AuditTrail — anchor into the ward.audit event log" },
        { label: "first seen", value: strand.firstSeen ?? "(unknown)" },
        { label: "event ref", value: strand.eventLogRef || "(empty)", mono: true },
      ];
    case "SerializationMarker":
      return [
        { label: "kind", value: "SerializationMarker — the survives-serialization contract (C7)" },
        { label: "format version", value: strand.formatVersion || "(empty)" },
        { label: "contract hash", value: strand.contractHash || "(empty)", mono: true },
      ];
  }
}

// ---------------------------------------------------------------------------
// Current-vs-expected diff (Frayed state)

export type StrandDiff = {
  strandId: string;
  expected: string;
  /** null = the verifier could not observe — renders blocked, not healthy. */
  observed: string | null;
  observedAt: string | null;
  matches: boolean | null;
};

export function strandDiff(strand: StrandView): StrandDiff | null {
  if (!strand.fray) return null;
  return {
    strandId: strand.id,
    expected: strand.fray.expected,
    observed: strand.fray.observed,
    observedAt: strand.fray.observedAt,
    matches: strand.fray.observed === null ? null : strand.fray.observed === strand.fray.expected,
  };
}

/** The strand the thread's tension blames, if any (spec §2.1). */
export function blamedStrandId(tension: TensionView): string | null {
  return tension.state === "frayed" ? tension.strand : null;
}

// ---------------------------------------------------------------------------
// Lineage: strand → audit entries → source (R7: unresolved refs marked)

export type LineageEntry = {
  entry: AuditEntryView;
  /** True when the entry references a proposal that no longer resolves. */
  unresolvedProposalRef: boolean;
};

export function annotateLineage(
  entries: AuditEntryView[],
  knownProposalIds: ReadonlySet<string>,
): LineageEntry[] {
  return entries.map((entry) => ({
    entry,
    unresolvedProposalRef: entry.proposalId !== null && !knownProposalIds.has(entry.proposalId),
  }));
}

/** Human line for one audit entry, referent-bound and audit-legible. */
export function lineageLine(entry: AuditEntryView): string {
  const files = entry.filesTouched.length > 0 ? ` · ${entry.filesTouched.join(", ")}` : "";
  const channel = entry.channel ? ` on ${entry.channel}` : "";
  return `#${entry.id} ${entry.eventType} → ${entry.decision}${channel}${files}`;
}
