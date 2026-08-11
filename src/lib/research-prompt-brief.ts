/**
 * Prompt brief — the structured half of the Research Desk intake.
 *
 * The `Research Desk App.dc.html` handoff turns the composer from "a textarea"
 * into "a brief you can see": a five-element strength meter, a builder that
 * assembles those elements into the prompt, and an "assembled brief" strip that
 * reads the elements back out of whatever is in the textarea. All of it is pure
 * text — no network, no persistence — so it lives here and the composer stays a
 * view.
 *
 * The round-trip is the contract: `assembleBrief(parseBrief(text))` must be a
 * fixed point for any text the builder produced, which is what lets a user edit
 * inline, reopen the builder, and see their own words in the right fields.
 *
 * Recommendations are derived from REAL missions only (the frame's four cards
 * are mock state). No missions → no recommendations, same rule the suggested
 * angles already follow in research-mission-composer.tsx.
 */

import type { ResearchMission } from "@/lib/research-missions";

export type ResearchBriefKey = "question" | "goal" | "constraint" | "deliverable" | "sources";

export type ResearchBrief = Record<ResearchBriefKey, string>;

export const EMPTY_RESEARCH_BRIEF: ResearchBrief = {
  question: "",
  goal: "",
  constraint: "",
  deliverable: "",
  sources: "",
};

export type ResearchBriefFieldDef = {
  key: ResearchBriefKey;
  /** Field label in the builder and the assembled-brief strip. */
  label: string;
  /** Two-digit ordinal badge (01…05) — the frame's numbering. */
  badge: string;
  /** Rows the builder's textarea opens at. */
  rows: number;
  /** Sub-label: what a good answer does for the run. */
  hint: string;
  placeholder: string;
  /** One-tap starters, offered only while the field is empty. */
  chips: readonly string[];
};

/**
 * The five elements, in assembly order. `question` carries no chips — a canned
 * research question would be exactly the fabricated content this surface
 * refuses elsewhere; the other four are shapes, not topics, so they are safe.
 */
export const RESEARCH_BRIEF_FIELDS: readonly ResearchBriefFieldDef[] = [
  {
    key: "question",
    label: "Research question",
    badge: "01",
    rows: 2,
    hint: "one focused, answerable question",
    placeholder: "What should we investigate?",
    chips: [],
  },
  {
    key: "goal",
    label: "Goal",
    badge: "02",
    rows: 1,
    hint: "what a successful answer lets you decide",
    placeholder: "decide which approach we adopt",
    chips: ["decision-ready recommendation", "compare 3+ approaches", "identify open risks"],
  },
  {
    key: "constraint",
    label: "Constraints",
    badge: "03",
    rows: 1,
    hint: "boundaries the familiar must respect",
    placeholder: "recent sources only; exclude vendor marketing",
    chips: ["primary sources only", "exclude paywalled", "recent (≤12 mo)"],
  },
  {
    key: "deliverable",
    label: "Deliverable",
    badge: "04",
    rows: 1,
    hint: "the shape of the output",
    placeholder: "comparison matrix + cited report",
    chips: ["comparison matrix", "cited report", "decision memo"],
  },
  {
    key: "sources",
    label: "Source preferences",
    badge: "05",
    rows: 1,
    hint: "domains, types, recency",
    placeholder: "independent evaluations before vendor guides",
    chips: ["independent evaluations first", "include repositories", "peer-reviewed only"],
  },
] as const;

/** Keys that carry a `key:` prefix line in the assembled text. */
const PREFIXED_KEYS: readonly ResearchBriefKey[] = ["goal", "constraint", "deliverable", "sources"];

/** Alternation used to split the free-text head off the prefixed tail. */
const PREFIX_SPLIT = /^(?:goal|constraint|deliverable|sources|exclude):/im;

/**
 * Assemble the five elements into the prompt text the mission is started with.
 * Empty elements contribute nothing — a bare question stays a bare question.
 */
export function assembleBrief(brief: Partial<ResearchBrief>): string {
  const lines: string[] = [];
  const question = (brief.question ?? "").trim();
  if (question) lines.push(question);
  for (const key of PREFIXED_KEYS) {
    const value = (brief[key] ?? "").trim();
    if (value) lines.push(`${key}: ${value}`);
  }
  return lines.join("\n");
}

/** Read one `key: value` line out of the prompt text. */
function grab(text: string, key: ResearchBriefKey): string {
  const match = text.match(new RegExp(`^${key}:\\s*(.*)$`, "im"));
  return match ? match[1].trim() : "";
}

/**
 * Parse prompt text back into elements. Everything before the first prefixed
 * line is the question, so hand-typed prose parses as a question with four
 * empty elements rather than as nothing at all.
 */
export function parseBrief(text: string): ResearchBrief {
  const lines = text.split("\n");
  const firstPrefixed = lines.findIndex((line) => PREFIX_SPLIT.test(line));
  const head = (firstPrefixed === -1 ? lines : lines.slice(0, firstPrefixed)).join("\n").trim();
  return {
    question: head,
    goal: grab(text, "goal"),
    constraint: grab(text, "constraint"),
    deliverable: grab(text, "deliverable"),
    sources: grab(text, "sources"),
  };
}

/** How many characters make a question a question (mirrors the intake gate). */
export const BRIEF_QUESTION_MIN_LENGTH = 12;

export type ResearchStrengthPart = {
  key: ResearchBriefKey;
  /** Short name used in the "add: …" line. */
  label: string;
  present: boolean;
};

export type ResearchPromptStrength = {
  parts: ResearchStrengthPart[];
  /** 0–5 elements present. */
  score: number;
  tone: "sparse" | "fair" | "strong";
  label: string;
  /** Elements still missing, in assembly order. */
  missing: string[];
  /** Tooltip: "Prompt strength — N of 5 elements present". */
  tip: string;
};

const STRENGTH_LABELS: Record<ResearchBriefKey, string> = {
  question: "question",
  goal: "goal",
  constraint: "constraints",
  deliverable: "deliverable",
  sources: "source prefs",
};

/**
 * Score the prompt on the five elements.
 *
 * Detection is deliberately looser than `parseBrief`: a goal can be stated with
 * a `goal:` prefix *or* by asking a question, a constraint by "only"/"exclude"/
 * "must", and so on — the meter rewards a well-formed prompt however it was
 * written, not only ones the builder produced. That keeps it a coach rather
 * than a syntax check.
 */
export function promptStrength(text: string): ResearchPromptStrength {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const brief = parseBrief(text);
  const parts: ResearchStrengthPart[] = [
    {
      key: "question",
      label: STRENGTH_LABELS.question,
      present: trimmed.length >= BRIEF_QUESTION_MIN_LENGTH,
    },
    {
      key: "goal",
      label: STRENGTH_LABELS.goal,
      present: Boolean(brief.goal) || /\?/.test(trimmed),
    },
    {
      key: "constraint",
      label: STRENGTH_LABELS.constraint,
      present: Boolean(brief.constraint) || /(^|\s)(exclude|only|must|without)\s/i.test(lower),
    },
    {
      key: "deliverable",
      label: STRENGTH_LABELS.deliverable,
      present:
        Boolean(brief.deliverable)
        || /(matrix|report|brief|comparison|memo|summary|ledger)/i.test(lower),
    },
    {
      key: "sources",
      label: STRENGTH_LABELS.sources,
      present:
        Boolean(brief.sources)
        || /(primary source|peer-reviewed|recent|arxiv|vendor|repositor|benchmark)/i.test(lower),
    },
  ];
  const score = parts.filter((part) => part.present).length;
  const tone = score >= 4 ? "strong" : score >= 2 ? "fair" : "sparse";
  return {
    parts,
    score,
    tone,
    label: tone,
    missing: parts.filter((part) => !part.present).map((part) => part.label),
    tip: `Prompt strength — ${score} of 5 elements present`,
  };
}

/** Coaching copy under the builder's live preview, keyed to how full it is. */
export function builderCoach(filled: number): string {
  if (filled <= 1) {
    return "Each element you add tightens the familiar's bounds: goals steer synthesis, constraints prune weak sources early, and a named deliverable shapes the report.";
  }
  if (filled <= 3) {
    return "Constraints and deliverables are what separate a sweep from a wander. Source preferences seed the Gather stage directly.";
  }
  return "Strong brief. The familiar echoes these bounds at every checkpoint, so drift shows up immediately.";
}

export type ResearchPromptRecommendation = {
  id: string;
  /** The prompt text this card loads into the composer. */
  title: string;
  /** Why it is being offered — always traceable to a real mission. */
  why: string;
  tone: "warning" | "accent" | "danger" | "success";
  brief: ResearchBrief;
};

/** Trim a mission title down to something that reads as a prompt subject. */
function subject(mission: ResearchMission): string {
  return mission.title.replace(/\s+/g, " ").trim();
}

/**
 * Recommendations grounded in the mission list.
 *
 * Every card names the mission it came from, so a user can always answer "why
 * am I being shown this?". The frame's own four cards are invented; these are
 * the same four *shapes* re-derived from state the desk actually has:
 * a stopped run to retry, a checkpoint awaiting direction, a finished run to
 * build on, and a run short of its source target. Missions the desk has none
 * of simply contribute no card.
 */
export function promptRecommendations(
  missions: readonly ResearchMission[],
  limit = 4,
): ResearchPromptRecommendation[] {
  const out: ResearchPromptRecommendation[] = [];
  const live = missions.filter((mission) => mission.status !== "archived");

  const failed = live.find((mission) => mission.status === "failed");
  if (failed) {
    out.push({
      id: `rec-retry-${failed.id}`,
      title: subject(failed),
      why: "stopped run · rerun with a wider budget",
      tone: "danger",
      brief: {
        ...EMPTY_RESEARCH_BRIEF,
        question: subject(failed),
        goal: "finish the stopped run and answer the original question",
        deliverable: "brief",
      },
    });
  }

  const checkpoint = live.find((mission) => mission.status === "checkpoint");
  if (checkpoint) {
    out.push({
      id: `rec-deepen-${checkpoint.id}`,
      title: subject(checkpoint),
      why: "checkpoint waiting · split the open question into its own run",
      tone: "warning",
      brief: {
        ...EMPTY_RESEARCH_BRIEF,
        question: subject(checkpoint),
        goal: "settle the open question blocking the checkpoint",
        deliverable: "cited verdict memo",
      },
    });
  }

  const completed = live.find((mission) => mission.status === "completed");
  if (completed) {
    out.push({
      id: `rec-extend-${completed.id}`,
      title: subject(completed),
      why: "finished run · extend it with a comparison",
      tone: "success",
      brief: {
        ...EMPTY_RESEARCH_BRIEF,
        question: subject(completed),
        goal: "compare the leading approaches the finished run surfaced",
        deliverable: "comparison matrix",
      },
    });
  }

  const thin = live.find(
    (mission) =>
      mission.status !== "failed"
      && mission.sources.length > 0
      && mission.sources.length < mission.bounds.sourceTarget
      && !out.some((entry) => entry.id.endsWith(mission.id)),
  );
  if (thin) {
    out.push({
      id: `rec-evidence-${thin.id}`,
      title: subject(thin),
      why: `thin evidence · ${thin.sources.length} of ${thin.bounds.sourceTarget} sources`,
      tone: "accent",
      brief: {
        ...EMPTY_RESEARCH_BRIEF,
        question: subject(thin),
        goal: "strengthen the weakest claims with primary evidence",
        constraint: "primary sources only",
        deliverable: "findings + source ledger",
      },
    });
  }

  return out.slice(0, limit);
}
