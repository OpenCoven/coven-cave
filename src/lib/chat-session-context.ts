// Pure model for the chat session's slim context row (Chat.dc.html 2a ③).
//
// The design splits the old single header band in two: a human title row
// (serif title + lifecycle actions) and a machine-readable context row —
// everything you'd otherwise hunt for in a kebab: which project the session
// runs in, on which branch, through which model and working directory, plus
// the live cost of the thread on the right.
//
// Kept free of React so the chip/stat derivation is unit-testable and so the
// row never invents facts: every chip is dropped when its fact is unknown.

import { computeContextMeter } from "./context-meter.ts";
import { formatRuntime } from "./chat-response-metadata.ts";
import { formatCost, formatTokens, type TurnUsage } from "./usage-format.ts";

/** Accent used for the chip glyph / stat dot. Maps to a CSS custom property
 *  in the stylesheet rather than a raw colour so themes stay in charge. */
export type ChatContextTint = "accent" | "success" | "warning" | "danger" | "muted";

export type ChatContextChip = {
  id: "runtime" | "project" | "branch" | "cwd";
  /** Phosphor name from the curated subset (src/lib/icon.tsx). */
  icon: "ph:folder" | "ph:git-branch" | "ph:sparkle" | "ph:terminal-window";
  /** Dim key, e.g. "project". */
  label: string;
  /** Bright value, e.g. "coven-cave". */
  value: string;
  title: string;
  tint: ChatContextTint;
};

export type ChatContextStat = {
  id: "done" | "elapsed" | "context" | "tokens" | "cost";
  label: string;
  value: string;
  title: string;
  tint: ChatContextTint;
  /** Present only on the context-window stat: 0–100, drives the mini meter. */
  percent?: number;
  detail?: ChatContextDetail;
};

export type ChatContextDetailRow = {
  id: string;
  label: string;
  value: string;
  tint: ChatContextTint;
  percent?: number;
};

export type ChatContextDetail = {
  heading: string;
  rows: ChatContextDetailRow[];
  note?: string;
};

export type ChatContextTurn = {
  role: "user" | "assistant" | "system";
  durationMs?: number;
  reasoning?: string;
  tools?: Array<{
    name: string;
    input?: string;
    status: "running" | "ok" | "error";
    durationMs?: number;
  }>;
};

export type ChatContextDetails = {
  done: (ChatContextDetail & { value: string }) | null;
  elapsed: (ChatContextDetail & { value: string }) | null;
  context: (ChatContextDetail & { value: string; percent: number }) | null;
};

/** Duration in the row's compact grammar: 38s · 4m 12s · 1h 03m. */
export function formatContextDuration(ms?: number): string | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins < 60) return `${mins}m ${String(secs).padStart(2, "0")}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${String(mins % 60).padStart(2, "0")}m`;
}

/** Model id trimmed to its display tail — "anthropic/claude-opus-5" → "opus-5".
 *  Mirrors chat-view's header label so the two rows never disagree. */
export function shortContextModel(model: string): string {
  const afterVendor = model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : model;
  return afterVendor.replace(/^claude-/i, "") || afterVendor;
}

export function chatContextChips(args: {
  projectName?: string | null;
  projectRoot?: string | null;
  harness?: string | null;
  runtime?: string | null;
  branch?: string | null;
  model?: string | null;
}): ChatContextChip[] {
  const chips: ChatContextChip[] = [];
  // Both sides go through formatRuntime before they're compared — its titles
  // are home-relative, so comparing one against a raw root would never match.
  const projectDir = formatRuntime(args.projectRoot ? `local:${args.projectRoot}` : null);
  const dir = formatRuntime(args.runtime) ?? projectDir;
  const projectName = args.projectName?.trim();
  const harness = args.harness?.trim();
  const model = args.model?.trim();
  const runtimeValue = [harness, model ? shortContextModel(model) : null].filter(Boolean).join(" / ");
  if (runtimeValue) {
    chips.push({
      id: "runtime",
      icon: "ph:terminal-window",
      label: "runtime",
      value: runtimeValue,
      title: `Runtime ${runtimeValue}`,
      tint: "accent",
    });
  }
  const branch = args.branch?.trim();
  if (branch) {
    chips.push({
      id: "branch",
      icon: "ph:git-branch",
      label: "branch",
      value: branch,
      title: `Git branch ${branch}`,
      tint: "success",
    });
  }
  if (projectName) {
    chips.push({
      id: "project",
      icon: "ph:folder",
      label: "project",
      value: projectName,
      title: args.projectRoot ? `Project ${projectName} — ${args.projectRoot}` : `Project ${projectName}`,
      tint: "accent",
    });
  }
  // The cwd only earns its own chip when it isn't already implied by the
  // project chip — otherwise the row says the same thing twice.
  if (dir && (!projectName || dir.title !== projectDir?.title)) {
    chips.push({
      id: "cwd",
      icon: "ph:terminal-window",
      label: "cwd",
      value: dir.label,
      title: dir.title,
      tint: "muted",
    });
  }
  return chips;
}

function positiveMs(value: number | undefined): number {
  return value != null && Number.isFinite(value) && value > 0 ? value : 0;
}

function callLabel(count: number): string {
  return `${count} ${count === 1 ? "call" : "calls"}`;
}

type ToolCategory = "shell" | "read" | "edit" | "github" | "search" | "other";

const TOOL_CATEGORY_ORDER: readonly ToolCategory[] = [
  "shell",
  "read",
  "edit",
  "github",
  "search",
  "other",
];

const TOOL_CATEGORY_TINT: Record<ToolCategory, ChatContextTint> = {
  shell: "success",
  read: "accent",
  edit: "warning",
  github: "accent",
  search: "muted",
  other: "muted",
};

function contextToolCategory(name: string, input?: string): ToolCategory {
  const haystack = `${name} ${input ?? ""}`.trim().toLowerCase();
  if (/(^|\s)gh\s|github|pull request|issue/.test(haystack)) return "github";
  if (/bash|shell|exec|terminal|command|script/.test(haystack)) return "shell";
  if (/edit|write|apply|patch|str_replace|create/.test(haystack)) return "edit";
  if (/grep|search|find|glob|\brg\b/.test(haystack)) return "search";
  if (/read|view|open|\bcat\b|\bls\b|\blist\b/.test(haystack)) return "read";
  return "other";
}

export function chatContextDetails(args: {
  turns?: ChatContextTurn[];
  usage?: TurnUsage;
  model?: string | null;
}): ChatContextDetails {
  const assistantTurns = (args.turns ?? []).filter((turn) => turn.role === "assistant");
  const completedTools = assistantTurns
    .flatMap((turn) => turn.tools ?? [])
    .filter((tool) => tool.status === "ok");
  const counts = new Map<ToolCategory, number>();
  for (const tool of completedTools) {
    const category = contextToolCategory(tool.name, tool.input);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const doneRows = TOOL_CATEGORY_ORDER.flatMap((category) => {
    const count = counts.get(category) ?? 0;
    return count > 0
      ? [{
          id: category,
          label: category,
          value: callLabel(count),
          tint: TOOL_CATEGORY_TINT[category],
        }]
      : [];
  });
  const done = completedTools.length > 0
    ? {
        heading: "Done",
        value: String(completedTools.length),
        rows: doneRows,
      }
    : null;

  let totalDuration = 0;
  let toolDuration = 0;
  let thinkingDuration = 0;
  for (const turn of assistantTurns) {
    const turnDuration = positiveMs(turn.durationMs);
    const turnToolDuration = (turn.tools ?? []).reduce(
      (sum, tool) => sum + positiveMs(tool.durationMs),
      0,
    );
    totalDuration += turnDuration;
    toolDuration += turnToolDuration;
    if (turn.reasoning?.trim()) {
      thinkingDuration += Math.max(0, turnDuration - turnToolDuration);
    }
  }
  toolDuration = Math.min(totalDuration, toolDuration);
  thinkingDuration = Math.min(Math.max(0, totalDuration - toolDuration), thinkingDuration);
  const idleDuration = Math.max(0, totalDuration - toolDuration - thinkingDuration);
  const elapsedRows: ChatContextDetailRow[] = [];
  const pushDuration = (id: string, label: string, value: number, tint: ChatContextTint) => {
    const formatted = formatContextDuration(value);
    if (formatted) elapsedRows.push({ id, label, value: formatted, tint });
  };
  pushDuration("thinking", "thinking", thinkingDuration, "accent");
  pushDuration("tools", "tools", toolDuration, "success");
  pushDuration("idle", "idle", idleDuration, "muted");
  const elapsedValue = formatContextDuration(totalDuration);
  const elapsed = elapsedValue
    ? { heading: "Elapsed", value: elapsedValue, rows: elapsedRows }
    : null;

  const meter = computeContextMeter(args.usage, args.model ?? undefined);
  let context: ChatContextDetails["context"] = null;
  if (meter) {
    const usage = args.usage;
    const cacheRead = Math.max(0, usage?.cacheReadTokens ?? 0);
    const cacheCreation = Math.max(0, usage?.cacheCreationTokens ?? 0);
    const input = Math.max(0, usage?.inputTokens ?? 0);
    const free = Math.max(0, meter.windowTokens - meter.usedTokens);
    const contextParts: ChatContextDetailRow[] = [
      { id: "transcript", label: "transcript", value: formatTokens(input) ?? String(input), tint: "accent", percent: input / meter.windowTokens * 100 },
      { id: "cached", label: "cached", value: formatTokens(cacheRead) ?? String(cacheRead), tint: "success", percent: cacheRead / meter.windowTokens * 100 },
      { id: "cache-write", label: "cache write", value: formatTokens(cacheCreation) ?? String(cacheCreation), tint: "warning", percent: cacheCreation / meter.windowTokens * 100 },
      { id: "free", label: "free", value: formatTokens(free) ?? String(free), tint: "muted", percent: free / meter.windowTokens * 100 },
    ];
    const contextRows = contextParts.filter((row) => row.id === "free" || (row.percent ?? 0) > 0);
    const used = formatTokens(meter.usedTokens) ?? String(meter.usedTokens);
    const window = formatTokens(meter.windowTokens) ?? String(meter.windowTokens);
    context = {
      heading: "Context",
      value: `${used} / ${window}`,
      percent: meter.percent,
      rows: contextRows,
      note: meter.known ? undefined : "Window size estimated",
    };
  }

  return { done, elapsed, context };
}

export function chatContextStats(args: {
  turns?: ChatContextTurn[];
  usage?: TurnUsage;
  costUsd?: number;
  durationMs?: number;
  model?: string | null;
}): ChatContextStat[] {
  const stats: ChatContextStat[] = [];
  const turns = args.turns ?? (args.durationMs
    ? [{ role: "assistant" as const, durationMs: args.durationMs }]
    : []);
  const details = chatContextDetails({ turns, usage: args.usage, model: args.model });
  if (details.done) {
    stats.push({
      id: "done",
      label: "done",
      value: details.done.value,
      tint: "success",
      title: `${details.done.value} completed tool calls`,
      detail: details.done,
    });
  }
  if (details.elapsed) {
    stats.push({
      id: "elapsed",
      label: "elapsed",
      value: details.elapsed.value,
      tint: "accent",
      title: `Elapsed ${details.elapsed.value}`,
      detail: details.elapsed,
    });
  }
  if (details.context) {
    stats.push({
      id: "context",
      label: "context",
      value: details.context.value,
      percent: details.context.percent,
      tint: details.context.percent >= 90 ? "danger" : details.context.percent >= 70 ? "warning" : "success",
      title: `Context ${details.context.percent}% full — ${details.context.value} tokens`,
      detail: details.context,
    });
  }
  const total = args.usage ? args.usage.inputTokens + args.usage.outputTokens : 0;
  const tokens = total > 0 ? formatTokens(total) : null;
  if (tokens) {
    stats.push({
      id: "tokens",
      label: "tokens",
      value: tokens,
      tint: "muted",
      title: `${total.toLocaleString()} tokens on the last run`,
    });
  }
  const cost = formatCost(args.costUsd);
  if (cost) {
    stats.push({ id: "cost", label: "cost", value: cost, tint: "warning", title: `Last run cost ${cost}` });
  }
  return stats;
}
