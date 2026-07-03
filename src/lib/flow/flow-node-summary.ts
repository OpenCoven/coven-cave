// One-line config summary for a flow node card — what the node will actually
// do, without opening the detail panel: which familiar, what cron, which URL.
// Pure / framework-free so the canvas card and any list surface can share it.

import type { FlowNode, FlowParamValue } from "./flow-doc.ts";

function text(value: FlowParamValue | undefined): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value);
}

/** Count entries of a JSON-array/object param without throwing on drafts. */
function jsonCount(raw: string): number | null {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.length;
    if (parsed && typeof parsed === "object") return Object.keys(parsed).length;
    return null;
  } catch {
    return null;
  }
}

/**
 * A short human summary of the node's configuration, or null when there is
 * nothing meaningful to show (unconfigured node, or a type with no params).
 * Values are returned untruncated — the card ellipsizes and carries the full
 * text in a title attribute.
 */
export function flowNodeSummary(node: FlowNode): string | null {
  const params = node.params ?? {};
  const p = (key: string) => text(params[key]);
  switch (node.type) {
    case "trigger.schedule": {
      if (p("mode") === "cron" && p("cron")) return `cron ${p("cron")}`;
      return p("everyMinutes") ? `every ${p("everyMinutes")}m` : null;
    }
    case "trigger.webhook":
      return [p("method") || "POST", p("path")].filter(Boolean).join(" ") || null;
    case "trigger.chat":
      return p("familiar") ? `as ${p("familiar")}` : null;
    case "familiar": {
      const familiar = p("familiar");
      const prompt = p("prompt");
      if (familiar && prompt) return `${familiar} — ${prompt}`;
      return familiar || prompt || null;
    }
    case "ai.classify":
      return [p("familiar"), p("categories")].filter(Boolean).join(" · ") || null;
    case "skill":
      return [p("skill"), p("input")].filter(Boolean).join(" — ") || null;
    case "mcp":
      return [p("server"), p("tool")].filter(Boolean).join(" · ") || null;
    case "http":
      return p("url") ? `${p("method") || "GET"} ${p("url")}` : null;
    case "code":
      return p("language") || null;
    case "logic.if":
    case "logic.filter":
      return p("condition") || null;
    case "logic.switch": {
      const count = p("rules") ? jsonCount(p("rules")) : null;
      return count != null ? `${count} rule${count === 1 ? "" : "s"}` : null;
    }
    case "logic.merge":
      return p("mode") || null;
    case "logic.loop":
      return p("batchSize") ? `batches of ${p("batchSize")}` : null;
    case "logic.wait":
      return p("seconds") ? `${p("seconds")}s` : null;
    case "input.text":
      return p("label") || null;
    case "data.set": {
      const count = p("fields") ? jsonCount(p("fields")) : null;
      return count != null ? `${count} field${count === 1 ? "" : "s"}` : null;
    }
    case "data.output":
      return p("label") || null;
    case "data.execution":
      return p("key") ? (p("value") ? `${p("key")} = ${p("value")}` : p("key")) : null;
    case "human.gate":
      return p("prompt") || null;
    default:
      return null;
  }
}
