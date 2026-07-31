// Pure model for the tool-activity card the Chat.dc.html hybrid draws (2a ④,
// "Tool use, skills and capabilities as components"):
//
//   • BATCHES — a real agent fires a block of calls, writes some prose, then
//     fires again. The design bands each block with its own tinted header
//     (batch index · what ran · how it ran · how long).
//   • SKILLS — the eyebrow row above the card, one chip per skill or MCP
//     server the turn actually reached for, with its call count.
//
// Everything here is derived from the transcript's own ToolEvent[] — no new
// plumbing, no fetch, no invented facts. `textOffset` (the length of the turn
// text when a tool's first event arrived) is the honest batch signal: calls
// issued in one block share an offset, and the offset only moves once the
// model has streamed more prose. Turns persisted before that field existed all
// land in one batch, which the card renders without any batch chrome at all.
//
// Deliberately dependency-free apart from the shared tool-category map, so it
// is unit-testable with bare node and can never disagree with the rows it
// annotates.

import { toolCategory, type ToolCategory } from "@/lib/tool-visual";

/** Minimal structural slice of chat-turn-state's ToolEvent the model reads. */
export type BatchTool = {
  id: string;
  name: string;
  input?: string;
  status: "running" | "ok" | "error";
  durationMs?: number;
  textOffset?: number;
};

export type ToolBatch = {
  /** 1-based position of this batch within the turn. */
  index: number;
  /** Id of the batch's first tool — the row the header is rendered above. */
  headToolId: string;
  /** Every tool in the batch, in order. */
  toolIds: string[];
  /** Dominant category; drives the band's tint through data-tool-category. */
  category: ToolCategory;
  /** What ran — the distinct tool names, in first-use order. */
  label: string;
  /** How it ran, in the design's short mono register. */
  mode: string;
  /** Summed wall time; absent when no tool in the batch reported one. */
  durationMs?: number;
};

/** A batch whose calls together took at least this long reads as long-running
 *  rather than as a count — the interesting fact about a 19-minute CI watch is
 *  the wait, not that it was one call. */
export const LONG_RUNNING_BATCH_MS = 60_000;

/** Distinct tool names shown in a batch label before it rolls up to "+N". */
const LABEL_NAME_CAP = 3;

/** Consecutive tools that share a `textOffset` were issued in one block.
 *  A tool with no offset joins the batch in progress rather than starting a
 *  new one, so a legacy turn (no offsets at all) is a single batch. */
export function toolBatches(tools: readonly BatchTool[]): ToolBatch[] {
  const groups: BatchTool[][] = [];
  let currentOffset: number | undefined;
  for (const tool of tools) {
    const offset = Number.isFinite(tool.textOffset) ? tool.textOffset : undefined;
    const startsBatch =
      groups.length === 0 ||
      (offset !== undefined && currentOffset !== undefined && offset !== currentOffset);
    if (startsBatch) {
      groups.push([tool]);
      currentOffset = offset;
    } else {
      groups[groups.length - 1]!.push(tool);
      if (currentOffset === undefined) currentOffset = offset;
    }
  }
  return groups.map((group, i) => {
    const durationMs = batchDuration(group);
    return {
      index: i + 1,
      headToolId: group[0]!.id,
      toolIds: group.map((t) => t.id),
      category: dominantCategory(group),
      label: batchLabel(group),
      mode: batchMode(group, durationMs),
      ...(durationMs !== undefined ? { durationMs } : {}),
    };
  });
}

/** The batch's own register: the most-used category, first-use order breaking
 *  ties, so a read+read+edit block reads as "read" and not as its last call. */
function dominantCategory(group: readonly BatchTool[]): ToolCategory {
  const counts = new Map<ToolCategory, number>();
  for (const tool of group) {
    const category = toolCategory(tool.name);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  let best: ToolCategory = toolCategory(group[0]!.name);
  let bestCount = 0;
  for (const tool of group) {
    const category = toolCategory(tool.name);
    const count = counts.get(category) ?? 0;
    if (count > bestCount) {
      best = category;
      bestCount = count;
    }
  }
  return best;
}

/** What ran, named honestly: the distinct tool names in the order the batch
 *  used them, rolled up past three so a wide fan-out stays one line. */
function batchLabel(group: readonly BatchTool[]): string {
  const names: string[] = [];
  for (const tool of group) {
    const name = tool.name.trim();
    if (name && !names.includes(name)) names.push(name);
  }
  if (names.length === 0) return "";
  if (names.length <= LABEL_NAME_CAP) return names.join(" · ");
  return `${names.slice(0, LABEL_NAME_CAP).join(" · ")} +${names.length - LABEL_NAME_CAP}`;
}

/** How it ran. The transcript records no start times, so this never claims
 *  parallelism it cannot see — it reports the shape it can: one call, N calls,
 *  or a batch whose wall time makes the wait the headline. */
function batchMode(group: readonly BatchTool[], duration: number | undefined): string {
  if (duration !== undefined && duration >= LONG_RUNNING_BATCH_MS) return "long-running";
  if (group.length === 1) return "single call";
  return `${group.length} calls`;
}

function batchDuration(group: readonly BatchTool[]): number | undefined {
  let total: number | undefined;
  for (const tool of group) {
    if (!Number.isFinite(tool.durationMs)) continue;
    total = (total ?? 0) + (tool.durationMs as number);
  }
  return total;
}

/** The work line's quiet right-hand rollup — "4 batches · 6 ok". Only the
 *  settled good news lives here; running and failed calls keep their own
 *  tinted counters beside it, so a problem never reads as neutral mono. A
 *  lone batch is not worth saying, and neither is a zero. */
export function toolBatchSummary(
  tools: readonly BatchTool[],
  batches: readonly ToolBatch[],
): string {
  const parts: string[] = [];
  if (batches.length > 1) parts.push(`${batches.length} batches`);
  const ok = tools.filter((t) => t.status === "ok").length;
  if (ok) parts.push(`${ok} ok`);
  return parts.join(" · ");
}

/** The band's own duration, to the precision the number deserves: a batch of
 *  fast calls reads "0.4s" rather than the shared formatter's "0s", which
 *  claims the work took no time at all. Absent when nothing was reported. */
export function formatBatchDuration(durationMs: number | undefined): string {
  if (!Number.isFinite(durationMs) || (durationMs as number) < 0) return "";
  const ms = durationMs as number;
  if (ms < 1000) return `${Math.max(0.1, Math.round(ms / 100) / 10)}s`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

export type TurnSkill = {
  /** Stable chip key — `skill:<name>` or `mcp:<server>`. */
  id: string;
  /** What to show: the skill's own name, or the MCP server's. */
  name: string;
  source: "skill" | "mcp";
  /** How many calls in this turn went through it. */
  calls: number;
};

/** The capabilities the turn actually reached for, in first-use order: skills
 *  invoked through the harness's Skill tool, then MCP servers named by their
 *  `mcp__<server>__<tool>` calls. A skill whose name cannot be read off its
 *  input yields no chip — an unnamed capability is worse than none. */
export function turnSkills(tools: readonly BatchTool[]): TurnSkill[] {
  const found = new Map<string, TurnSkill>();
  const bump = (id: string, name: string, source: TurnSkill["source"]) => {
    const existing = found.get(id);
    if (existing) existing.calls += 1;
    else found.set(id, { id, name, source, calls: 1 });
  };
  for (const tool of tools) {
    const raw = tool.name.trim();
    const lower = raw.toLowerCase();
    if (lower === "skill" || lower === "skills") {
      const name = skillNameFromInput(tool.input);
      if (name) bump(`skill:${name}`, name, "skill");
      continue;
    }
    const server = mcpServer(raw);
    if (server) bump(`mcp:${server}`, server, "mcp");
  }
  return [...found.values()];
}

/** `mcp__github__list_runs` → `github`. Null for anything not MCP-namespaced. */
function mcpServer(name: string): string | null {
  const match = /^mcp_{1,2}(.+)$/i.exec(name);
  if (!match) return null;
  const rest = match[1] ?? "";
  const server = rest.split("__")[0] ?? "";
  return server.trim() || null;
}

/** The skill's name as the harness passed it — `{"skill":"release-audit"}`,
 *  `{"command":"/release-audit"}`, or a bare name. Null when the payload does
 *  not say, so the chip row never guesses. */
function skillNameFromInput(input: string | undefined): string | null {
  const text = (input ?? "").trim();
  if (!text) return null;
  if (!text.startsWith("{")) return cleanSkillName(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  for (const key of ["skill", "name", "command", "skill_name", "skillName"]) {
    const value = record[key];
    if (typeof value === "string") {
      const name = cleanSkillName(value);
      if (name) return name;
    }
  }
  return null;
}

function cleanSkillName(value: string): string | null {
  const name = value.trim().replace(/^\/+/, "").split(/\s+/)[0] ?? "";
  return name || null;
}
