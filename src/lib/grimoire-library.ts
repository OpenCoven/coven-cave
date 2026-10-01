/**
 * Memories Library presentation helpers — pure, dependency-free derivations
 * the navigator, tab strip, launcher, and reader share so a stitch reads the
 * same everywhere it appears.
 *
 *   - `cleanDocTitle` turns a flattened markdown first line ("# Title ### Sub")
 *     into a readable title. Research missions write their prompt verbatim
 *     into the vault title, so heading markers and emphasis leak into rows.
 *   - `stitchTagView` separates human tags from machine bookkeeping
 *     (`mission:<uuid>`, id fragments) that only made the rail noisy.
 *   - `groupMissionStitches` folds the four artifacts a research mission
 *     publishes (report, findings, research log, source ledger) into one
 *     expandable navigator group.
 *   - `readingMeta` is the reader's "~11 min read · 2,350 words" line.
 */

import { computeMdDocStats } from "./md-doc-stats.ts";

// ── Titles ───────────────────────────────────────────────────────────────────

/** Strip markdown syntax from a one-line title. Leading heading markers go;
 *  heading markers in the middle of the line (a flattened `# A\n### B`) become
 *  an em-dash separator; emphasis, code, and link syntax keep only their text. */
export function cleanDocTitle(raw: string | null | undefined): string {
  if (!raw) return "";
  const text = raw
    .replace(/\s+/g, " ")
    .trim()
    // Leading ATX marker: "## Title" → "Title".
    .replace(/^#{1,6}\s+/, "")
    // A heading marker right after a label colon is not a section break:
    // "Research and compare: # Topic" → "Research and compare: Topic".
    .replace(/:\s+#{1,6}\s+/g, ": ")
    // Any other inline heading run separates two flattened headings.
    .replace(/\s+#{1,6}\s+/g, " — ")
    // [[target|alias]] → alias, [[target]] → target.
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) => alias ?? target)
    // [text](url) → text.
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    // Balanced emphasis first, then any stray markers a truncation left open.
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/\*\*|__/g, "")
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=$|[\s).,:;!?—])/g, "$1$2")
    .replace(/\s+/g, " ")
    .replace(/^[\s—:–-]+|[\s—:–-]+$/g, "")
    .trim();
  return text;
}

/** A doc's first level-one heading, comments and fenced code skipped. */
export function firstH1(markdown: string | undefined): string | null {
  if (!markdown) return null;
  const head = markdown.slice(0, 8000).replace(/<!--[\s\S]*?(-->|$)/g, "");
  let inFence = false;
  for (const line of head.split("\n")) {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = line.match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/);
    if (match) return cleanDocTitle(match[1]) || null;
  }
  return null;
}

// ── Tags ─────────────────────────────────────────────────────────────────────

const MACHINE_TAG_PREFIX = /^(mission|flow|flow-run|run|session|automation|iteration|artifact|source):/i;
const UUIDISH = /[0-9a-f]{8}-[0-9a-f]{4}/i;
const LONG_HEX = /^[0-9a-f-]{12,}$/i;

/** Bookkeeping tags written by automation — ids, not words a person files by. */
export function isMachineTag(tag: string): boolean {
  const t = tag.trim();
  if (!t) return true;
  return MACHINE_TAG_PREFIX.test(t) || UUIDISH.test(t) || LONG_HEX.test(t);
}

/** The research mission id a stitch was published from, if any. */
export function missionIdOf(tags: readonly string[]): string | null {
  for (const tag of tags) {
    const match = tag.match(/^mission:(.+)$/i);
    if (match && match[1].trim()) return match[1].trim();
  }
  return null;
}

export type StitchTagView = {
  /** Up to `max` human tags, in their written order. */
  tags: string[];
  /** Human tags beyond `max` (count only — the row has no room). */
  overflow: number;
  /** True when the stitch came from a research mission. */
  research: boolean;
};

/** Tags every research-mission artifact carries (the generic marker, the
 *  mission mode, and the artifact kind) — the "Research" hint and the row's own
 *  label already say all of this. */
const RESEARCH_BOOKKEEPING_TAGS = new Set([
  "research",
  "autoresearch",
  "sweep",
  "brief",
  "findings",
  "report",
  "research-log",
  "source-ledger",
]);

/** Split a stitch's tags into what a navigator row should show. A mission tag
 *  becomes a single "Research" provenance hint, and the bookkeeping tags every
 *  mission artifact carries drop with it; tags a person added stay. */
export function stitchTagView(tags: readonly string[], max = 3): StitchTagView {
  const research = missionIdOf(tags) !== null;
  const human: string[] = [];
  for (const tag of tags) {
    if (isMachineTag(tag)) continue;
    if (research && RESEARCH_BOOKKEEPING_TAGS.has(tag.toLowerCase())) continue;
    if (!human.includes(tag)) human.push(tag);
  }
  return { tags: human.slice(0, max), overflow: Math.max(0, human.length - max), research };
}

// ── Research mission groups ──────────────────────────────────────────────────

export type MissionStitchInput = {
  id: string;
  title: string;
  tags: string[];
  body?: string;
  modified?: string;
};

/** The artifact role inside a mission, for labels and ordering. */
export type MissionArtifactRole = "report" | "brief" | "findings" | "research-log" | "source-ledger" | "other";

const ROLE_ORDER: Record<MissionArtifactRole, number> = {
  report: 0,
  brief: 0,
  findings: 1,
  "research-log": 2,
  "source-ledger": 3,
  other: 4,
};

const ROLE_LABEL: Record<Exclude<MissionArtifactRole, "other">, string> = {
  report: "Report",
  brief: "Brief",
  findings: "Findings",
  "research-log": "Research log",
  "source-ledger": "Source ledger",
};

export function missionArtifactRole(entry: Pick<MissionStitchInput, "id" | "title" | "tags">): MissionArtifactRole {
  const title = cleanDocTitle(entry.title).toLowerCase();
  if (/-primary$/.test(entry.id)) return entry.tags.includes("brief") ? "brief" : "report";
  if (title === "findings") return "findings";
  if (title === "research log") return "research-log";
  if (title === "source ledger") return "source-ledger";
  return "other";
}

/** A short label for an artifact shown under its mission. */
export function missionArtifactLabel(entry: Pick<MissionStitchInput, "id" | "title" | "tags">): string {
  const role = missionArtifactRole(entry);
  return role === "other" ? cleanDocTitle(entry.title) || entry.id : ROLE_LABEL[role];
}

const PROMPT_PREFIX =
  /^(research and compare|deep research prompt|research prompt|research topic|report topic|improved prompt)\s*:?\s+/i;

function stripPromptPrefixes(title: string): string {
  let out = title;
  for (let i = 0; i < 4 && PROMPT_PREFIX.test(out); i += 1) out = out.replace(PROMPT_PREFIX, "");
  return out.trim();
}

/** The human title for a mission: the findings heading ("Findings — X" → X),
 *  else the report's own H1, else the report's vault title without its prompt
 *  boilerplate. */
export function missionTitle(entries: readonly MissionStitchInput[]): string {
  const findings = entries.find((e) => missionArtifactRole(e) === "findings");
  const findingsH1 = firstH1(findings?.body)?.replace(/^findings\b\s*(?:[—–:-]\s*)?/i, "").trim();
  if (findingsH1) return findingsH1;
  const primary = entries.find((e) => {
    const role = missionArtifactRole(e);
    return role === "report" || role === "brief";
  });
  const primaryH1 = firstH1(primary?.body);
  if (primaryH1) return primaryH1;
  const fromTitle = primary ? stripPromptPrefixes(cleanDocTitle(primary.title)) : "";
  if (fromTitle) return fromTitle;
  const other = entries.find((e) => missionArtifactRole(e) === "other");
  return (other && stripPromptPrefixes(cleanDocTitle(other.title))) || "Research mission";
}

/** missionId → human title over a whole corpus (members need not be adjacent). */
export function missionTitleIndex(entries: readonly MissionStitchInput[]): Map<string, string> {
  const byMission = new Map<string, MissionStitchInput[]>();
  for (const entry of entries) {
    const missionId = missionIdOf(entry.tags);
    if (!missionId) continue;
    const list = byMission.get(missionId) ?? [];
    list.push(entry);
    byMission.set(missionId, list);
  }
  const titles = new Map<string, string>();
  for (const [missionId, list] of byMission) titles.set(missionId, missionTitle(list));
  return titles;
}

/** The title a stitch shows outside its mission group (tabs, launcher):
 *  "Findings · Identity Preservation…" instead of a bare, ambiguous "Findings". */
export function stitchDisplayTitle(
  entry: Pick<MissionStitchInput, "id" | "title" | "tags">,
  missionTitles?: ReadonlyMap<string, string>,
): string {
  const missionId = missionIdOf(entry.tags);
  const mission = missionId ? missionTitles?.get(missionId) : undefined;
  if (mission) {
    const role = missionArtifactRole(entry);
    return role === "report" || role === "brief" ? mission : `${missionArtifactLabel(entry)} · ${mission}`;
  }
  return cleanDocTitle(entry.title) || entry.id;
}

export type StitchNavItem<T> =
  | { kind: "entry"; entry: T }
  | {
      kind: "mission";
      missionId: string;
      title: string;
      /** Children in artifact order (report first), each with its short label. */
      entries: Array<{ entry: T; label: string }>;
      /** Newest member mtime (ISO), when any member has one. */
      modified?: string;
    };

/** Fold consecutive stitches that share a `mission:<id>` tag into one group.
 *  A mission with a single visible artifact stays a plain row. */
export function groupMissionStitches<T extends MissionStitchInput>(
  entries: readonly T[],
  missionTitles?: ReadonlyMap<string, string>,
): StitchNavItem<T>[] {
  const out: StitchNavItem<T>[] = [];
  let index = 0;
  while (index < entries.length) {
    const entry = entries[index];
    const missionId = missionIdOf(entry.tags);
    if (!missionId) {
      out.push({ kind: "entry", entry });
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < entries.length && missionIdOf(entries[end].tags) === missionId) end += 1;
    const run = entries.slice(index, end);
    if (run.length < 2) {
      out.push({ kind: "entry", entry });
    } else {
      const ordered = run
        .map((member, order) => ({ member, order }))
        .sort((a, b) => ROLE_ORDER[missionArtifactRole(a.member)] - ROLE_ORDER[missionArtifactRole(b.member)] || a.order - b.order)
        .map(({ member }) => ({ entry: member, label: missionArtifactLabel(member) }));
      const modified = run
        .map((member) => member.modified)
        .filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)))
        .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
      out.push({
        kind: "mission",
        missionId,
        title: missionTitles?.get(missionId) ?? missionTitle(run),
        entries: ordered,
        ...(modified ? { modified } : {}),
      });
    }
    index = end;
  }
  return out;
}

// ── Journal entries ──────────────────────────────────────────────────────────

/** The `/api/journal` query for one entry: a familiar's own entry when
 *  `familiar` is set, else the legacy coven-wide day file. */
export function journalEntryQuery(date: string, familiar?: string | null): string {
  return `date=${encodeURIComponent(date)}${familiar ? `&familiar=${encodeURIComponent(familiar)}` : ""}`;
}

/** The owning familiar of a journal list row (`source: "familiar"`); legacy
 *  day files are attributed by `reflectedBy` but owned by no one. */
export function journalRowFamiliar(row: { reflectedBy?: string | null; source?: string }): string | undefined {
  return row.source === "familiar" && row.reflectedBy ? row.reflectedBy : undefined;
}

// ── Reading time ─────────────────────────────────────────────────────────────

/** Words per minute for the reader's estimate — a comfortable pace for the
 *  technical prose familiars write. */
export const READING_WPM = 220;

export type ReadingMeta = { words: number; minutes: number };

/** Word count (same counter as the editor footer) and whole-minute estimate,
 *  floored at 1 — "0 min read" tells nobody anything. */
export function readingMeta(body: string): ReadingMeta {
  const { words } = computeMdDocStats(body);
  return { words, minutes: Math.max(1, Math.round(words / READING_WPM)) };
}

/** "~11 min read · 2,350 words" */
export function formatReadingMeta(meta: ReadingMeta): string {
  const words = `${meta.words.toLocaleString()} word${meta.words === 1 ? "" : "s"}`;
  return `~${meta.minutes} min read · ${words}`;
}
