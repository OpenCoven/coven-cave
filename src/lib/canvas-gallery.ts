// Pure helpers for the Chat → Canvas tab gallery (framework-free, unit-testable).

import type { CanvasArtifact } from "@/lib/canvas-artifacts";

/** Sort a canvas file's artifacts newest-first for the gallery; artifacts
 *  without a usable timestamp sink to the end. */
export function sortArtifactsForGallery(artifacts: CanvasArtifact[]): CanvasArtifact[] {
  return [...artifacts].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

/** Short "Jul 12"-style date for a card's meta line; "" when unparseable. */
export function formatArtifactWhen(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  try {
    return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export function isCanvasGalleryLoadCurrent(
  startedArtifactVersion: number,
  requestToken: number,
  currentArtifactVersion: number,
  latestRequestToken: number,
): boolean {
  return (
    startedArtifactVersion === currentArtifactVersion &&
    requestToken === latestRequestToken
  );
}

export type CanvasKindFilter = "all" | "react" | "html";

/** Kind with the store's back-compat default: legacy artifacts (pre-React)
 *  have no `kind` and are treated as "html", same as everywhere else. */
export function galleryArtifactKind(artifact: CanvasArtifact): "react" | "html" {
  return artifact.kind === "react" ? "react" : "html";
}

/** Toolbar search + segmented kind filter for the gallery grid.
 *  Case-insensitive substring match on the title; preserves input order. */
export function filterCanvasArtifacts(
  artifacts: CanvasArtifact[],
  query: string,
  kindFilter: CanvasKindFilter,
): CanvasArtifact[] {
  const q = query.trim().toLowerCase();
  return artifacts.filter((artifact) => {
    if (kindFilter !== "all" && galleryArtifactKind(artifact) !== kindFilter) return false;
    return !q || artifact.title.toLowerCase().includes(q);
  });
}

export type CanvasArtifactSnapshotMutation =
  | { kind: "upsert"; changedId: string; deletedIds?: ReadonlySet<string> }
  | { kind: "delete"; deletedId: string };

function revisionTime(artifact: CanvasArtifact): number {
  const parsed = Date.parse(artifact.updatedAt);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/**
 * Merge full mutation responses without allowing an older response to erase a
 * newer revision or an artifact introduced by another in-flight mutation.
 */
export function mergeCanvasArtifactSnapshot(
  current: CanvasArtifact[],
  incoming: CanvasArtifact[],
  mutation: CanvasArtifactSnapshotMutation,
): CanvasArtifact[] {
  const deletedId = mutation.kind === "delete" ? mutation.deletedId : null;
  const deletedIds = mutation.kind === "upsert" ? mutation.deletedIds : undefined;
  const merged = new Map(
    current
      .filter((artifact) => artifact.id !== deletedId && !deletedIds?.has(artifact.id))
      .map((artifact) => [artifact.id, artifact]),
  );

  for (const artifact of incoming) {
    if (artifact.id === deletedId || deletedIds?.has(artifact.id)) continue;
    const existing = merged.get(artifact.id);
    const incomingRevision = revisionTime(artifact);
    const existingRevision = existing ? revisionTime(existing) : Number.NEGATIVE_INFINITY;
    const changedId = mutation.kind === "upsert" ? mutation.changedId : null;
    if (
      !existing
      || incomingRevision > existingRevision
      || (incomingRevision === existingRevision && artifact.id === changedId)
    ) {
      merged.set(artifact.id, artifact);
    }
  }
  return [...merged.values()];
}
