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
  id: "project" | "branch" | "model" | "cwd";
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
  id: "context" | "tokens" | "cost" | "duration";
  label: string;
  value: string;
  title: string;
  tint: ChatContextTint;
  /** Present only on the context-window stat: 0–100, drives the mini meter. */
  percent?: number;
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
  const model = args.model?.trim();
  if (model) {
    chips.push({
      id: "model",
      icon: "ph:sparkle",
      label: "model",
      value: shortContextModel(model),
      title: `Model ${model}`,
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

export function chatContextStats(args: {
  usage?: TurnUsage;
  costUsd?: number;
  durationMs?: number;
  model?: string | null;
}): ChatContextStat[] {
  const stats: ChatContextStat[] = [];
  const meter = computeContextMeter(args.usage, args.model ?? undefined);
  if (meter) {
    stats.push({
      id: "context",
      label: "context",
      value: `${meter.percent}%`,
      percent: meter.percent,
      tint: meter.level === "high" ? "danger" : meter.level === "warn" ? "warning" : "accent",
      title: `Context ${meter.percent}% full — ${meter.usedTokens.toLocaleString()} of ${meter.windowTokens.toLocaleString()} tokens${meter.known ? "" : " (window size estimated)"}`,
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
    stats.push({ id: "cost", label: "cost", value: cost, tint: "success", title: `Last run cost ${cost}` });
  }
  const duration = formatContextDuration(args.durationMs);
  if (duration) {
    stats.push({ id: "duration", label: "ran", value: duration, tint: "muted", title: `Last run took ${duration}` });
  }
  return stats;
}
