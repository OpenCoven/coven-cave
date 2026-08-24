// Pure model for the transcript's LEFT turn spine (Chat.dc.html 2a,
// cave-j86la): the vertical run spine in the left gutter — one node per turn,
// that turn's tool calls rolled into a proportional category stack.
//
// The right edge used to carry a second instrument here, the thread minimap
// (one bar per event, click to jump). It is gone for good (cave-5m5hv): the
// Design run rail in `chat-run-rail.ts` is the right-side instrument now, and
// keeping a retired derivation alive "just in case" is how a removal comes
// back. The spine is deliberately NOT part of that replacement — it annotates
// the left gutter, which the rail never occupied.
//
// Deliberately dependency-free: the spine derives everything from the Turn[]
// the transcript already renders — no fetches, no @/ imports — so the
// derivation is unit-testable with bare node and can never disagree with the
// thread it annotates. The category palette below is shared with the run rail,
// so the two instruments can never colour the same tool differently.

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

/** Convert category counts into bounded percentages for the vertical stack.
 * Reserve a readable minimum for every category, then distribute only the
 * remaining height by count so the minimum can never be renormalized away. */
export function spineSegmentHeights(cats: readonly { count: number }[]): number[] {
  if (cats.length === 0) return [];
  const counts = cats.map(({ count }) => Math.max(0, count));
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total <= 0) return counts.map(() => 0);
  const minimum = Math.min(8, 100 / counts.length);
  const remaining = 100 - minimum * counts.length;
  return counts.map((count) => minimum + (count / total) * remaining);
}
