// Maps a tool name to a stable visual identity (category + icon) so tool-use
// rows in the chat can be color-coded for quick visual inspection. Pure and
// unit-tested; the colors themselves live in cave-chat.css keyed by the
// `data-tool-category` attribute this drives.

import type { IconName } from "@/lib/icon";

export type ToolCategory =
  | "shell"
  | "read"
  | "search"
  | "edit"
  | "agent"
  | "web"
  | "task"
  | "mcp"
  | "other";

export type ToolVisual = { category: ToolCategory; icon: IconName };

const ICON_BY_CATEGORY: Record<ToolCategory, IconName> = {
  shell: "ph:terminal-window",
  read: "ph:file-text",
  search: "ph:magnifying-glass",
  edit: "ph:pencil-simple",
  agent: "ph:robot",
  web: "ph:globe",
  task: "ph:kanban",
  mcp: "ph:plug",
  other: "ph:wrench",
};

/** Classify a tool by name into a coarse, color-coded category. */
export function toolCategory(name: string): ToolCategory {
  const n = (name || "").trim().toLowerCase();
  if (!n) return "other";

  // MCP tools are namespaced `mcp__server__tool` — group them together.
  if (n.startsWith("mcp__") || n.startsWith("mcp_")) return "mcp";

  // Order matters: more specific buckets win before the broad ones.
  if (/(todo|task(create|update|list|get|output|stop)|cron|schedule|reminder)/.test(n)) return "task";
  if (/(edit|write|str_replace|notebook|apply.?patch|create.?file)/.test(n)) return "edit";
  if (/(bash|shell|terminal|exec|command|run.?command)/.test(n)) return "shell";
  if (/(web|fetch|http|url|browse|crawl|google)/.test(n)) return "web";
  if (/(grep|glob|search|ripgrep|find|locate|toolsearch)/.test(n)) return "search";
  if (/(^|_)(read|view|cat|open|ls|list.?dir|file.?read)/.test(n)) return "read";
  if (/(agent|task|dispatch|subagent|spawn|fork|workflow)/.test(n)) return "agent";

  return "other";
}

/** Full visual identity (category + icon) for a tool name. */
export function toolVisual(name: string): ToolVisual {
  const category = toolCategory(name);
  return { category, icon: ICON_BY_CATEGORY[category] };
}
