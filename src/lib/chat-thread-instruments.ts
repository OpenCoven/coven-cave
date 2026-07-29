// Pure model for the transcript's two navigation instruments (Chat.dc.html 2a,
// cave-j86la): the vertical run spine in the left gutter (one node per turn,
// that turn's tool calls rolled into a proportional category stack) and the
// thread minimap on the right edge (one bar per event; click to jump).
//
// Deliberately dependency-free: both instruments derive everything from the
// Turn[] the transcript already renders — no fetches, no @/ imports — so the
// derivation is unit-testable with bare node and can never disagree with the
// thread it annotates.

export type ThreadToolCategory =
  | "read"
  | "shell"
  | "edit"
  | "search"
  | "web"
  | "agent"
  | "wait"
  | "other";

/** Category order for stacks and legends — mirrors the design's NODE_TINT set. */
export const THREAD_TOOL_CATEGORIES: readonly ThreadToolCategory[] = [
  "read",
  "shell",
  "edit",
  "search",
  "web",
  "agent",
  "wait",
  "other",
];

/** Minimal structural slice of chat-turn-state's Turn the model reads. */
export type InstrumentTurn = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
  pending?: boolean;
  error?: boolean;
  durationMs?: number;
  tools?: {
    id: string;
    name: string;
    input?: string;
    status: "running" | "ok" | "error";
    durationMs?: number;
  }[];
};

/** Map a harness tool name onto the design's category palette. Checked in
 *  order so compounds resolve to their dominant register ("web_search" is web,
 *  not search). Unknown names are honest "other", never a guess. */
export function toolCategory(name: string): ThreadToolCategory {
  const n = name.trim().toLowerCase();
  if (!n) return "other";
  // Short tokens ("cat", "ls", "rg", "run") only match as whole words so they
  // can't fire inside unrelated names; longer stems match as substrings.
  const word = (token: string) => new RegExp(`(^|[_\\-.])${token}([_\\-.]|$)`).test(n);
  if (/web|fetch|http|browser|url/.test(n)) return "web";
  if (/bash|shell|exec|terminal|command|script/.test(n) || word("run") || word("cmd")) return "shell";
  if (/edit|write|apply|patch|str_replace|create/.test(n)) return "edit";
  if (/grep|search|find|glob/.test(n) || word("rg")) return "search";
  if (/read|view|open/.test(n) || word("cat") || word("ls") || word("list")) return "read";
  if (/agent|task|subagent|dispatch|workflow/.test(n)) return "agent";
  if (/wait|sleep|poll|monitor|watch/.test(n)) return "wait";
  return "other";
}

/** "18:19" from an ISO stamp; null when the stamp is absent or unparsable —
 *  a node with no time renders no label rather than inventing one. */
export function instrumentTime(createdAt: string | undefined): string | null {
  if (!createdAt) return null;
  const ms = Date.parse(createdAt);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** First line of a turn, trimmed to a hover-card measure. */
export function instrumentSummary(text: string, max = 96): string {
  const line = text.trim().split(/\n/, 1)[0] ?? "";
  if (line.length <= max) return line;
  return `${line.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export type SpineNode = {
  turnId: string;
  role: "user" | "assistant";
  /** "18:19" or null. */
  time: string | null;
  /** Who speaks at this node — operator name or the familiar's. */
  name: string;
  summary: string;
  error: boolean;
  running: boolean;
  /** Aggregated tool calls, in THREAD_TOOL_CATEGORIES order, zero-counts dropped. */
  cats: { cat: ThreadToolCategory; count: number }[];
  total: number;
};

export function spineNodes(
  turns: InstrumentTurn[],
  names: { operatorName: string; familiarName: string },
): SpineNode[] {
  const nodes: SpineNode[] = [];
  for (const turn of turns) {
    if (turn.role !== "user" && turn.role !== "assistant") continue;
    const counts = new Map<ThreadToolCategory, number>();
    for (const tool of turn.tools ?? []) {
      const cat = toolCategory(tool.name);
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    const cats = THREAD_TOOL_CATEGORIES.filter((cat) => counts.has(cat)).map((cat) => ({
      cat,
      count: counts.get(cat)!,
    }));
    nodes.push({
      turnId: turn.id,
      role: turn.role,
      time: instrumentTime(turn.createdAt),
      name: turn.role === "user" ? names.operatorName : names.familiarName,
      summary: instrumentSummary(turn.text),
      error: Boolean(turn.error),
      running: Boolean(turn.pending),
      cats,
      total: cats.reduce((n, c) => n + c.count, 0),
    });
  }
  return nodes;
}

/** Stack height for a node's tool rollup — the design's max(28, total × 2.4),
 *  capped so a 100-step turn doesn't dominate the gutter. */
export function spineStackHeight(total: number): number {
  if (total <= 0) return 0;
  return Math.min(96, Math.max(28, Math.round(total * 2.4)));
}

export type ThreadMapEvent = {
  /** Stable per-thread id ("<turnId>:prompt" | "<turnId>:tool:<toolId>" | "<turnId>:answer"). */
  id: string;
  turnId: string;
  kind: "turn" | "answer" | ThreadToolCategory;
  /** Hover-card headline: "Val · prompt", "bash · gh run list", "Kitty · answer". */
  label: string;
  /** Mono initials shown inline on turn rows ("VAL"). */
  turnLabel: string | null;
  /** Owner attribution rows for the hover card. */
  ownerName: string;
  ownerTime: string | null;
  /** Bar width, 24–100 (%). Turn/answer bars are full-width by design. */
  width: number;
  /** "1.2s" for tool events with a known duration. */
  took: string | null;
  error: boolean;
};

/** Deterministic tool-bar width: duration-scaled when known (log steps so 100ms
 *  and 10s both stay readable), otherwise a stable name-keyed spread — never
 *  random, so the map is identical across renders and resumes. */
export function toolBarWidth(name: string, durationMs?: number): number {
  if (durationMs != null && Number.isFinite(durationMs) && durationMs > 0) {
    return Math.min(96, Math.max(24, Math.round(24 + Math.log10(1 + durationMs) * 16)));
  }
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return 32 + (hash % 41);
}

export function formatTookLabel(durationMs?: number): string | null {
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs <= 0) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  const secs = durationMs / 1000;
  if (secs < 60) return `${Math.round(secs * 10) / 10}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${Math.round(secs % 60)}s`;
}

function initials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "?";
  return cleaned.slice(0, 3).toUpperCase();
}

export function threadMapEvents(
  turns: InstrumentTurn[],
  names: { operatorName: string; familiarName: string },
): ThreadMapEvent[] {
  const events: ThreadMapEvent[] = [];
  for (const turn of turns) {
    if (turn.role === "user") {
      events.push({
        id: `${turn.id}:prompt`,
        turnId: turn.id,
        kind: "turn",
        label: `${names.operatorName} · prompt`,
        turnLabel: initials(names.operatorName),
        ownerName: names.operatorName,
        ownerTime: instrumentTime(turn.createdAt),
        width: 100,
        took: null,
        error: false,
      });
      continue;
    }
    if (turn.role !== "assistant") continue;
    const ownerTime = instrumentTime(turn.createdAt);
    for (const tool of turn.tools ?? []) {
      const cat = toolCategory(tool.name);
      const arg = tool.input?.trim().split(/\n/, 1)[0] ?? "";
      events.push({
        id: `${turn.id}:tool:${tool.id}`,
        turnId: turn.id,
        kind: cat,
        label: arg ? `${tool.name} · ${instrumentSummary(arg, 48)}` : tool.name,
        turnLabel: null,
        ownerName: names.familiarName,
        ownerTime,
        width: toolBarWidth(tool.name, tool.durationMs),
        took: formatTookLabel(tool.durationMs),
        error: tool.status === "error",
      });
    }
    events.push({
      id: `${turn.id}:answer`,
      turnId: turn.id,
      kind: "answer",
      label: `${names.familiarName} · answer`,
      turnLabel: initials(names.familiarName),
      ownerName: names.familiarName,
      ownerTime,
      width: 100,
      took: formatTookLabel(turn.durationMs),
      error: Boolean(turn.error),
    });
  }
  return events;
}
