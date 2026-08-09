export const PLATFORM_SURFACE_LABELS = ["surface:ios", "surface:desktop", "surface:shared"] as const;

export type PlatformSurface = (typeof PLATFORM_SURFACE_LABELS)[number] extends `surface:${infer Surface}`
  ? Surface
  : never;

export type PlatformClassification = PlatformSurface | "missing" | "conflicting";

export type BeadStatus = "open" | "in_progress" | "blocked" | "deferred" | "closed";

export type BeadStaleState = "none" | "older_than_24h" | "older_than_7d";

export type BeadDeliveryRow = {
  id: string;
  title: string;
  status: BeadStatus;
  priority: number;
  updated_at: string | null;
  labels?: readonly string[] | null;
};

export type BeadDeliveryItem = {
  id: string;
  title: string;
  status: BeadStatus;
  priority: number;
  updatedAt: string;
  stale: BeadStaleState;
};

export type BeadsDeliveryOverview = {
  generatedAt: string;
  totals: {
    remaining: number;
    ready: number;
    open: number;
    inProgress: number;
    blocked: number;
    deferred: number;
  };
  stale: {
    olderThan24h: number;
    olderThan7d: number;
    oldest: BeadDeliveryItem[];
  };
  surfaceHygiene: Record<PlatformClassification, number>;
};

export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
export const SEVERELY_STALE_AFTER_MS = 7 * STALE_AFTER_MS;
export const MAX_STALE_ITEMS = 20;

const PLATFORM_LABEL_TO_CLASSIFICATION: Record<(typeof PLATFORM_SURFACE_LABELS)[number], PlatformSurface> = {
  "surface:ios": "ios",
  "surface:desktop": "desktop",
  "surface:shared": "shared",
};

function normalizeLabels(labels: readonly string[] | null | undefined): string[] {
  return (labels ?? []).map((label) => label.trim()).filter(Boolean);
}

function parseUpdatedAt(updatedAt: string | null | undefined): number | null {
  if (!updatedAt) return null;
  const parsed = Date.parse(updatedAt);
  return Number.isNaN(parsed) ? null : parsed;
}

function isClosedRow(row: Pick<BeadDeliveryRow, "status">): boolean {
  return row.status === "closed";
}

function classifyStaleState(row: BeadDeliveryRow, nowMs: number): BeadStaleState {
  if (row.status !== "in_progress") return "none";

  const updatedAtMs = parseUpdatedAt(row.updated_at);
  if (updatedAtMs === null) return "none";

  const ageMs = nowMs - updatedAtMs;
  if (ageMs <= STALE_AFTER_MS) return "none";
  if (ageMs > SEVERELY_STALE_AFTER_MS) return "older_than_7d";
  return "older_than_24h";
}

export function classifyPlatform(labels: readonly string[] | null | undefined): PlatformClassification {
  const uniquePlatformLabels = new Set<PlatformSurface>();

  for (const label of normalizeLabels(labels)) {
    const classification = PLATFORM_LABEL_TO_CLASSIFICATION[label as keyof typeof PLATFORM_LABEL_TO_CLASSIFICATION];
    if (classification) uniquePlatformLabels.add(classification);
  }

  if (uniquePlatformLabels.size === 0) return "missing";
  if (uniquePlatformLabels.size > 1) return "conflicting";
  return uniquePlatformLabels.values().next().value ?? "missing";
}

export function classifyStale(row: BeadDeliveryRow, nowMs: number): BeadStaleState {
  return classifyStaleState(row, nowMs);
}

function toStaleItem(row: BeadDeliveryRow, stale: BeadStaleState): BeadDeliveryItem {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    updatedAt: row.updated_at ?? "",
    stale,
  };
}

export function buildBeadsDeliveryOverview(
  allRows: ReadonlyArray<BeadDeliveryRow>,
  readyRows: ReadonlyArray<BeadDeliveryRow>,
  nowMs: number,
): BeadsDeliveryOverview {
  const remainingRows = allRows.filter((row) => !isClosedRow(row));

  const totals = {
    remaining: remainingRows.length,
    ready: readyRows.length,
    open: 0,
    inProgress: 0,
    blocked: 0,
    deferred: 0,
  };

  const surfaceHygiene: BeadsDeliveryOverview["surfaceHygiene"] = {
    ios: 0,
    desktop: 0,
    shared: 0,
    missing: 0,
    conflicting: 0,
  };

  const staleRows = remainingRows
    .map((row) => {
      const stale = classifyStaleState(row, nowMs);
      const updatedAtMs = parseUpdatedAt(row.updated_at);
      return { row, stale, updatedAtMs };
    })
    .filter(({ stale, updatedAtMs }) => stale !== "none" && updatedAtMs !== null)
    .sort((left, right) => {
      const leftMs = left.updatedAtMs ?? Number.POSITIVE_INFINITY;
      const rightMs = right.updatedAtMs ?? Number.POSITIVE_INFINITY;
      if (leftMs !== rightMs) return leftMs - rightMs;
      return left.row.id.localeCompare(right.row.id);
    });

  let olderThan24h = 0;
  let olderThan7d = 0;

  for (const row of remainingRows) {
    switch (row.status) {
      case "open":
        totals.open += 1;
        break;
      case "in_progress": {
        totals.inProgress += 1;
        const stale = classifyStaleState(row, nowMs);
        if (stale === "older_than_24h") olderThan24h += 1;
        if (stale === "older_than_7d") {
          olderThan24h += 1;
          olderThan7d += 1;
        }
        break;
      }
      case "blocked":
        totals.blocked += 1;
        break;
      case "deferred":
        totals.deferred += 1;
        break;
      case "closed":
        break;
    }

    const classification = classifyPlatform(row.labels);
    surfaceHygiene[classification] += 1;
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    totals,
    stale: {
      olderThan24h,
      olderThan7d,
      oldest: staleRows.slice(0, MAX_STALE_ITEMS).map(({ row, stale }) => toStaleItem(row, stale)),
    },
    surfaceHygiene,
  };
}
