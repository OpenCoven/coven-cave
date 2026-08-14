/**
 * Stage derivation for the GitHub stream — the "what is this row actually
 * asking of me" layer the sectioned list and its facet bar both read from.
 *
 * The old surface sorted a flat table by column. That answers "what changed
 * most recently", never "what is blocked on me", so triage meant reading every
 * row. Here each item resolves to one **stage** (a lowercase badge: `checks
 * failing`, `review requested`, `untriaged`), stages roll up into **sections**
 * ordered most-blocking first, and the facet chips are those same sections with
 * their counts — picking one narrows the list to it, so a chip can never
 * disagree with the headings underneath it.
 *
 * Every stage is derived from data the activity payload actually carries
 * (`kind`, `state`, `draft`, `checkStatus`, `labels`) plus the caller's linked
 * Cave work. Signals GitHub only exposes per item — mergeability, review
 * verdicts, unresolved threads — belong to the detail panel's landing gates,
 * not here: guessing them per row would put a confident badge on a fetch that
 * never happened.
 */

import type { GitHubItem } from "@/lib/github-tasks";
import type { Filter } from "@/components/github-view-data";

/** The five-tone vocabulary the stream paints with. */
export type GhTone = "ok" | "bad" | "warn" | "acc" | "mute";

export type GhStageKey =
  | "review-requested"
  | "checks-failing"
  | "checks-running"
  | "ready"
  | "draft"
  | "in-progress"
  | "untriaged"
  | "mentioned"
  | "closed"
  | "open";

export type GhStage = {
  key: GhStageKey;
  /** Badge copy, rendered verbatim. */
  label: string;
  tone: GhTone;
};

const STAGE: Record<GhStageKey, GhStage> = {
  "review-requested": { key: "review-requested", label: "review requested", tone: "acc" },
  "checks-failing": { key: "checks-failing", label: "checks failing", tone: "bad" },
  "checks-running": { key: "checks-running", label: "checks running", tone: "mute" },
  ready: { key: "ready", label: "ready", tone: "ok" },
  draft: { key: "draft", label: "draft", tone: "mute" },
  "in-progress": { key: "in-progress", label: "in progress", tone: "acc" },
  untriaged: { key: "untriaged", label: "untriaged", tone: "warn" },
  mentioned: { key: "mentioned", label: "mentioned", tone: "warn" },
  closed: { key: "closed", label: "closed", tone: "mute" },
  open: { key: "open", label: "open", tone: "mute" },
};

/**
 * The one-line "so what do I do" the row's peek panel shows. Written as an
 * instruction, not a status restatement — the badge already said the status.
 */
export const GH_NEXT_STEP: Record<GhStageKey, string> = {
  "review-requested": "Review the diff and leave a verdict — nothing else blocks you.",
  "checks-failing": "Read the failing job, fix on the same branch, push again.",
  "checks-running": "Nothing to do yet — CI is still running.",
  ready: "Checks are green. Merge it, or send it for a last read.",
  draft: "Not asking for anything yet — the author still has it.",
  "in-progress": "A familiar has this open. Read its session before you touch the branch.",
  untriaged: "Triage it: label it, assign it, or hand it to a familiar.",
  mentioned: "Reply in the thread — no code change is being asked for.",
  closed: "Landed or abandoned. Retire the worktree when you're finished with it.",
  open: "No blocking signal on this one. Open it when you get to it.",
};

/** What the caller already knows about a row beyond the GitHub payload. */
export type GhRowLinkage = {
  /** Cave tasks linked to this item. */
  linkedCount: number;
  /** Session or branch a linked task names, when one does. */
  session: string | null;
};

/**
 * One row, resolved. `row` stays generic so the view can carry its own item
 * type through grouping without this module knowing about React or cards.
 */
export type GhStreamEntry<T = GitHubItem> = GhRowLinkage & {
  row: T;
  stage: GhStage;
};

function isOpen(item: GitHubItem): boolean {
  const state = (item.state ?? "open").toLowerCase();
  return state !== "closed" && state !== "merged";
}

/**
 * Resolve one item to its stage. `checkStatus` is only populated for pull
 * requests, and only when the checks rollup came back — a null rollup means
 * "not reported", which is `open`, never `ready`.
 */
export function deriveStage(item: GitHubItem, linkage: GhRowLinkage): GhStage {
  if (item.kind === "notification") return STAGE.mentioned;
  if (item.kind === "review_request") return STAGE["review-requested"];

  if (item.kind === "issue") {
    if (!isOpen(item)) return STAGE.closed;
    if (linkage.session) return STAGE["in-progress"];
    if ((item.labels ?? []).length === 0) return STAGE.untriaged;
    return STAGE.open;
  }

  // Pull requests. Draft outranks CI: a draft is not asking for anything, so a
  // red check on one is the author's problem, not a queue entry.
  if (item.draft) return STAGE.draft;
  if (!isOpen(item)) return STAGE.closed;
  if (item.checkStatus === "failing") return STAGE["checks-failing"];
  if (item.checkStatus === "pending") return STAGE["checks-running"];
  if (item.checkStatus === "passing") return STAGE.ready;
  return STAGE.open;
}

export type GhSectionKey =
  | "needs"
  | "familiars"
  | "rest"
  | "ready"
  | "failing"
  | "running"
  | "draft"
  | "requested"
  | "progress"
  | "untriaged"
  | "open"
  | "closed";

export type GhStreamSection<T = GitHubItem> = {
  key: GhSectionKey;
  label: string;
  /** The header's trailing note — why this bucket exists, in the user's terms. */
  hint: string;
  tone: GhTone;
  entries: GhStreamEntry<T>[];
};

type SectionDef = {
  key: GhSectionKey;
  label: string;
  hint: string;
  tone: GhTone;
  match: (entry: GhStreamEntry<never>) => boolean;
};

/** Stages that mean a human is the blocker. Drives the Activity tab's top bucket. */
const BLOCKING: ReadonlySet<GhStageKey> = new Set<GhStageKey>([
  "review-requested",
  "checks-failing",
  "mentioned",
  "untriaged",
]);

const ACTIVITY_SECTIONS: SectionDef[] = [
  {
    key: "needs",
    label: "Needs you",
    hint: "blocked on your call",
    tone: "bad",
    match: (e) => BLOCKING.has(e.stage.key),
  },
  {
    key: "familiars",
    label: "Familiar sessions",
    hint: "tied to linked Cave work",
    tone: "acc",
    match: (e) => e.session != null || e.linkedCount > 0,
  },
  {
    key: "rest",
    label: "Everything else",
    hint: "read when you like",
    tone: "mute",
    match: () => true,
  },
];

const PR_SECTIONS: SectionDef[] = [
  { key: "ready", label: "Ready to merge", hint: "checks green · nothing blocking", tone: "ok", match: (e) => e.stage.key === "ready" },
  { key: "failing", label: "Checks failing", hint: "fix before review", tone: "bad", match: (e) => e.stage.key === "checks-failing" },
  { key: "running", label: "Checks running", hint: "waiting on CI", tone: "mute", match: (e) => e.stage.key === "checks-running" },
  { key: "open", label: "Open", hint: "no check rollup reported", tone: "acc", match: (e) => e.stage.key === "open" },
  { key: "draft", label: "Draft", hint: "not asking for anything yet", tone: "mute", match: (e) => e.stage.key === "draft" },
  { key: "closed", label: "Closed", hint: "landed or abandoned", tone: "mute", match: (e) => e.stage.key === "closed" },
];

const ISSUE_SECTIONS: SectionDef[] = [
  { key: "progress", label: "In progress", hint: "a familiar has it open", tone: "acc", match: (e) => e.stage.key === "in-progress" },
  { key: "untriaged", label: "Untriaged", hint: "no labels yet", tone: "warn", match: (e) => e.stage.key === "untriaged" },
  { key: "open", label: "Open", hint: "labelled and waiting", tone: "mute", match: (e) => e.stage.key === "open" },
  { key: "closed", label: "Closed", hint: "no longer open", tone: "mute", match: (e) => e.stage.key === "closed" },
];

const REVIEW_SECTIONS: SectionDef[] = [
  { key: "requested", label: "Requested of you", hint: "nobody else can unblock these", tone: "acc", match: (e) => e.stage.key === "review-requested" },
  { key: "rest", label: "Everything else", hint: "no longer waiting on your verdict", tone: "mute", match: () => true },
];

const SECTIONS_BY_FILTER: Record<Filter, SectionDef[]> = {
  all: ACTIVITY_SECTIONS,
  pr: PR_SECTIONS,
  issue: ISSUE_SECTIONS,
  review_request: REVIEW_SECTIONS,
};

/**
 * Bucket entries into the sections for this tab, first match wins, preserving
 * the caller's order inside each bucket. Empty sections are dropped — a
 * heading with nothing under it reads as a broken filter, not as good news.
 */
export function groupIntoSections<T>(
  filter: Filter,
  entries: GhStreamEntry<T>[],
): GhStreamSection<T>[] {
  const defs = SECTIONS_BY_FILTER[filter] ?? ACTIVITY_SECTIONS;
  const buckets = new Map<GhSectionKey, GhStreamEntry<T>[]>(defs.map((d) => [d.key, []]));
  for (const entry of entries) {
    const def = defs.find((d) => d.match(entry as unknown as GhStreamEntry<never>));
    if (def) buckets.get(def.key)!.push(entry);
  }
  return defs
    .map((d) => ({ key: d.key, label: d.label, hint: d.hint, tone: d.tone, entries: buckets.get(d.key)! }))
    .filter((s) => s.entries.length > 0);
}

export type GhFacet = {
  key: GhSectionKey;
  label: string;
  count: number;
  tone: GhTone;
};

/**
 * The facet chips are the sections themselves — same key, same label, same
 * count. That parity is the point: picking a chip narrows the list to exactly
 * the heading it names, and a chip can never advertise a count the list below
 * it does not contain.
 */
export function facetsFor<T>(sections: GhStreamSection<T>[]): GhFacet[] {
  return sections.map((s) => ({ key: s.key, label: s.label, count: s.entries.length, tone: s.tone }));
}

/**
 * The row's three signal segments — checks · linked work · triage — as tones.
 * Deliberately three fixed slots rather than a variable strip: the eye learns
 * "middle one is red" far faster than it re-reads a legend per row.
 */
export function signalSegments<T>(entry: GhStreamEntry<T>): GhTone[] {
  const item = entry.row as unknown as GitHubItem;
  const checks: GhTone =
    item.checkStatus === "failing" ? "bad"
      : item.checkStatus === "passing" ? "ok"
        : item.checkStatus === "pending" ? "warn"
          : "mute";
  const work: GhTone = entry.session ? "acc" : entry.linkedCount > 0 ? "ok" : "mute";
  const triage: GhTone =
    entry.stage.key === "untriaged" ? "warn"
      : entry.stage.key === "review-requested" || entry.stage.key === "mentioned" ? "acc"
        : "mute";
  return [checks, work, triage];
}

export const GH_SIGNAL_TITLE = "checks · linked work · triage";
