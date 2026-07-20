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
