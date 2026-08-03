// The Expand reader's footer views (Reader.dc.html 3a), beyond the batches
// chat-tool-batches.ts already derives.
//
// The design gives the Tools tab three ways to read the same 18 steps —
// "Batches" (what ran together), "By tool" (what did the most work), and
// "Timeline" (what happened when) — and the Skills tab a "By type" split.
// All four are regroupings of the turn's own ToolEvent[]; nothing here fetches,
// infers, or invents a fact the transcript does not already show.
//
// Deliberately dependency-free apart from the shared tool-category map, so it
// is unit-testable with bare node and can never disagree with the rows it
// summarises.

import { toolCategory, type ToolCategory } from "@/lib/tool-visual";
import type { BatchTool, TurnSkill } from "@/lib/chat-tool-batches";

/** One tool name, rolled up across every call the turn made through it. */
export type ToolRollup = {
  name: string;
  category: ToolCategory;
  calls: number;
  errors: number;
  /** Summed wall time; absent when no call through this tool reported one. */
  durationMs?: number;
  /** This tool's share of the turn's total reported time, 0–1. Zero when the
   *  turn reported no durations at all — the bar then reads as "unmeasured"
   *  rather than as "instant". */
  share: number;
};

/**
 * Every tool the turn used, heaviest first. Ordering is by summed duration and
 * falls back to call count, so the row at the top is the one that actually
 * cost something — a single 19-minute CI watch outranks nine instant reads,
 * which a count-ordered list would bury.
 */
export function toolRollups(tools: readonly BatchTool[]): ToolRollup[] {
  const byName = new Map<string, ToolRollup>();
  for (const tool of tools) {
    const name = tool.name.trim() || "tool";
    const existing = byName.get(name);
    const entry = existing ?? {
      name,
      category: toolCategory(name),
      calls: 0,
      errors: 0,
      durationMs: undefined as number | undefined,
      share: 0,
    };
    entry.calls += 1;
    if (tool.status === "error") entry.errors += 1;
    if (typeof tool.durationMs === "number") {
      entry.durationMs = (entry.durationMs ?? 0) + tool.durationMs;
    }
    if (!existing) byName.set(name, entry);
  }

  const rollups = [...byName.values()];
  const total = rollups.reduce((sum, r) => sum + (r.durationMs ?? 0), 0);
  for (const rollup of rollups) {
    rollup.share = total > 0 ? (rollup.durationMs ?? 0) / total : 0;
  }

  return rollups.sort(
    (a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0) || b.calls - a.calls || a.name.localeCompare(b.name),
  );
}

/** One call, in the order it was made — the Timeline view's row. */
export type ToolStep = {
  id: string;
  /** 1-based position in the turn. */
  n: number;
  name: string;
  category: ToolCategory;
  /** What it ran against, already trimmed to one line. Empty when the call
   *  recorded no input — better blank than a truncated JSON blob. */
  target: string;
  status: BatchTool["status"];
  durationMs?: number;
};

/** A tool input can be a whole JSON payload; the timeline has one line for it,
 *  so take the first line and cap it rather than wrapping a blob into the row. */
function stepTarget(input: string | undefined): string {
  const firstLine = (input ?? "").split("\n").find((line) => line.trim().length > 0) ?? "";
  const trimmed = firstLine.trim();
  return trimmed.length > 96 ? `${trimmed.slice(0, 96).trimEnd()}…` : trimmed;
}

export function toolSteps(tools: readonly BatchTool[]): ToolStep[] {
  return tools.map((tool, i) => {
    const name = tool.name.trim() || "tool";
    return {
      id: tool.id,
      n: i + 1,
      name,
      category: toolCategory(name),
      target: stepTarget(tool.input),
      status: tool.status,
      durationMs: tool.durationMs,
    };
  });
}

/** The Skills tab's "By type" split: harness skills, then connected servers.
 *  A group with no members is omitted rather than rendered empty. */
export type SkillGroup = { source: TurnSkill["source"]; label: string; skills: TurnSkill[] };

export function skillGroups(skills: readonly TurnSkill[]): SkillGroup[] {
  const groups: SkillGroup[] = [
    { source: "skill", label: "Skills", skills: skills.filter((s) => s.source === "skill") },
    { source: "mcp", label: "MCP servers", skills: skills.filter((s) => s.source === "mcp") },
  ];
  return groups.filter((group) => group.skills.length > 0);
}
