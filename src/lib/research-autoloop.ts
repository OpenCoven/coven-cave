/**
 * Typed, read-only projection of Sage's autoresearch receipts.
 *
 * `~/.coven/research/autoresearch/results.tsv` is the authority. Completion
 * events may add document paths to an existing receipt, but they never mint
 * rows on their own and this module never writes either source.
 */

export const AUTORESEARCH_VERDICTS = [
  "PROMOTE",
  "ACCEPT",
  "REJECT",
  // Historical ledgers used REVISE before the v0.1 three-verdict contract.
  "REVISE",
] as const;

export type AutoresearchVerdict = (typeof AUTORESEARCH_VERDICTS)[number];

export type AutoresearchLedgerRow = {
  timestamp: string;
  kind: string;
  iter: number;
  slug: string;
  score: number | null;
  verdict: AutoresearchVerdict;
  branch: string;
  summary: string;
};

export type AutoresearchEvent = {
  ts: string;
  iter: number;
  slug: string;
  score: number;
  verdict: AutoresearchVerdict;
  synthesisPath: string;
  stagedSkillPath: string | null;
};

export type AutoresearchRow = AutoresearchLedgerRow & {
  synthesisPath: string | null;
  stagedSkillPath: string | null;
};

export type AutoresearchSnapshot = {
  type: "snapshot";
  rows: AutoresearchRow[];
  available: boolean;
  updatedAt: string;
};

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function isAutoresearchSnapshot(value: unknown): value is AutoresearchSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  if (
    snapshot.type !== "snapshot" ||
    typeof snapshot.available !== "boolean" ||
    !parseTimestamp(snapshot.updatedAt) ||
    !Array.isArray(snapshot.rows)
  ) {
    return false;
  }
  return snapshot.rows.every((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const row = candidate as Record<string, unknown>;
    const score = row.score;
    return (
      parseTimestamp(row.timestamp) !== null &&
      typeof row.kind === "string" &&
      parseIter(row.iter) !== null &&
      typeof row.slug === "string" &&
      row.slug.trim().length > 0 &&
      (
        score === null ||
        (typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 30)
      ) &&
      parseVerdict(row.verdict) !== null &&
      typeof row.branch === "string" &&
      typeof row.summary === "string" &&
      isNullableString(row.synthesisPath) &&
      isNullableString(row.stagedSkillPath)
    );
  });
}

function parseTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return Number.isFinite(Date.parse(trimmed)) ? trimmed : null;
}

function parseIter(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseVerdict(value: unknown): AutoresearchVerdict | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return (AUTORESEARCH_VERDICTS as readonly string[]).includes(normalized)
    ? normalized as AutoresearchVerdict
    : null;
}

/**
 * Scores in the ledger span three eras:
 * - `27` / `27/30` — current quality score;
 * - `c:7/a:8/v:9` — legacy component score (sum = 24);
 * - large integers such as `2484` — a historical word-count field.
 *
 * Only values that are truthfully on the 0–30 quality scale are projected.
 */
function parseScore(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  const components = /^c:(\d+)\/a:(\d+)\/v:(\d+)$/i.exec(raw);
  if (components) {
    const total = Number(components[1]) + Number(components[2]) + Number(components[3]);
    return total >= 0 && total <= 30 ? total : null;
  }
  const scalar = /^(\d+(?:\.\d+)?)(?:\/30)?$/.exec(raw);
  if (!scalar) return null;
  const score = Number(scalar[1]);
  return Number.isFinite(score) && score >= 0 && score <= 30 ? score : null;
}

export function parseAutoresearchLedger(raw: string): AutoresearchLedgerRow[] {
  const rows: AutoresearchLedgerRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = line.split("\t");
    if (fields.length < 10) continue;
    const timestamp = parseTimestamp(fields[0]);
    const iter = parseIter(fields[2]);
    // Early ledger writers appended an inline abstract after `<slug>:`.
    // Keep the stable slug as the join/link key; field 10 remains the
    // authoritative human-readable summary.
    const slug = fields[3]?.split(":", 1)[0]?.trim();
    const verdict = parseVerdict(fields[7]);
    if (!timestamp || iter === null || !slug || !verdict) continue;
    rows.push({
      timestamp,
      kind: fields[1]?.trim() || "research",
      iter,
      slug,
      score: parseScore(fields[5]),
      verdict,
      branch: fields[8]?.trim() || "",
      summary: fields.slice(9).join("\t").trim(),
    });
  }
  return rows.sort((left, right) => {
    const byTime = Date.parse(right.timestamp) - Date.parse(left.timestamp);
    return byTime || right.iter - left.iter;
  });
}

export function parseAutoresearchEvents(raw: string): AutoresearchEvent[] {
  const events: AutoresearchEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const record = parsed as Record<string, unknown>;
    const ts = parseTimestamp(record.ts);
    const iter = parseIter(record.iter);
    const slug = typeof record.slug === "string" ? record.slug.trim() : "";
    const score = parseScore(record.score);
    const verdict = parseVerdict(record.verdict);
    const synthesisPath =
      typeof record.synthesis === "string" ? record.synthesis.trim() : "";
    const stagedSkillPath =
      record.staged_skill === null || record.staged_skill === undefined
        ? null
        : typeof record.staged_skill === "string" && record.staged_skill.trim()
          ? record.staged_skill.trim()
          : null;
    if (
      !ts ||
      iter === null ||
      !slug ||
      score === null ||
      !verdict ||
      !synthesisPath
    ) {
      continue;
    }
    events.push({
      ts,
      iter,
      slug,
      score,
      verdict,
      synthesisPath,
      stagedSkillPath,
    });
  }
  return events.sort((left, right) => Date.parse(right.ts) - Date.parse(left.ts));
}

function eventKey(iter: number, slug: string): string {
  return `${iter}\u0000${slug}`;
}

export function mergeAutoresearchRows(
  ledger: readonly AutoresearchLedgerRow[],
  events: readonly AutoresearchEvent[],
): AutoresearchRow[] {
  const eventByReceipt = new Map<string, AutoresearchEvent>();
  // Events arrive newest-first. Keep the first event for a receipt so a stale
  // duplicate line cannot overwrite the most recent document paths.
  for (const event of events) {
    const key = eventKey(event.iter, event.slug);
    if (!eventByReceipt.has(key)) eventByReceipt.set(key, event);
  }
  return ledger.map((row) => {
    const event = eventByReceipt.get(eventKey(row.iter, row.slug));
    return {
      ...row,
      synthesisPath: event?.synthesisPath ?? null,
      stagedSkillPath: event?.stagedSkillPath ?? null,
    };
  });
}
