/**
 * CovenCave slash command catalog — aligned with the Coven Code TUI
 * (see coven/crates/coven-cli/src/tui/chat/app.rs SLASH_COMMANDS and
 * tui/chat/render.rs help block). Aliases are first-class so a user can type
 * /h, /cls, /q, etc. and get the same behavior as the canonical command.
 */

import { SHORTCUT_GROUPS, neutralizeKeys } from "./keyboard-shortcuts";

export type SlashCommand = {
  name: string;
  aliases?: string[];
  hint: string;
  description: string;
  argPlaceholder?: string;
  /** Section in the /help output. */
  section?: "chat" | "familiar" | "daemon" | "view" | "launch";
};

export const SLASH_COMMANDS: SlashCommand[] = [
  // Chat
  { name: "/help", aliases: ["/h"], hint: "show help", description: "Show available commands.", section: "chat" },
  { name: "/clear", aliases: ["/cls"], hint: "clear transcript", description: "Clear the local view (daemon session is untouched).", section: "chat" },
  { name: "/quit", aliases: ["/exit", "/q"], hint: "back to chats", description: "Close this chat and return to the chat list.", section: "chat" },
  { name: "/palette", hint: "open ⌘K", description: "Open the command palette.", section: "chat" },
  { name: "/shortcuts", aliases: ["/keys"], hint: "open ⌘/ sheet", description: "Open the keyboard shortcuts sheet.", section: "chat" },
  { name: "/new", hint: "new chat", description: "Start a fresh chat with the active familiar.", section: "chat" },

  // Familiar
  { name: "/familiar", aliases: ["/agent"], hint: "switch", description: "Open the familiar picker. Pass a name to switch directly.", argPlaceholder: "name", section: "familiar" },

  // Daemon / health
  { name: "/doctor", hint: "setup checks", description: "Run `coven doctor` and print the result inline.", section: "daemon" },
  { name: "/daemon", hint: "daemon status", description: "Show `coven daemon status` inline.", section: "daemon" },

  // Sessions
  { name: "/sessions", hint: "all sessions", description: "Open all sessions across familiars and harnesses.", section: "view" },
  { name: "/attach", hint: "open session", description: "Open a specific daemon session by id.", argPlaceholder: "session-id", section: "view" },
  { name: "/tui", hint: "open in Coven Code", description: "Open the current session in the external Coven Code TUI.", section: "view" },
  { name: "/board", hint: "Tasks", description: "Open the Tasks kanban and table view.", section: "view" },
  { name: "/chats", hint: "Chats", description: "Switch back to the Chats view.", section: "view" },
  { name: "/inbox", hint: "Schedules", description: "Open Schedules.", section: "view" },
  { name: "/remind", hint: "new reminder", description: "Create a reminder. Try “/remind in 30m check the build”.", argPlaceholder: "when + text", section: "view" },

  { name: "/terminal", aliases: ["/comux"], hint: "Terminal", description: "Open the integrated terminal view.", section: "view" },
  { name: "/projects", hint: "Projects", description: "Open the project browser and file preview view.", section: "view" },
  { name: "/toggle-agent", hint: "\u2318\u21E7B", description: "Toggle the Familiar Chat side panel.", section: "view" },

  // Launch
  { name: "/run", hint: "run task", description: "Run a task through the active familiar's harness.", argPlaceholder: "task…", section: "launch" },
  { name: "/codex", hint: "codex harness", description: "Run a task through Codex regardless of active familiar.", argPlaceholder: "task…", section: "launch" },
  { name: "/claude", hint: "claude harness", description: "Run a task through Claude regardless of active familiar.", argPlaceholder: "task…", section: "launch" },

  // Library
  { name: "/save", aliases: ["/bookmark", "/read"], hint: "/save <url> [bookmarks|reading|github] [#tag]", description: "Route a URL into the library (auto-classified).", section: "view" },
];

/** Build a lookup that includes every name + every alias → canonical name. */
const CANONICAL_BY_NAME: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const c of SLASH_COMMANDS) {
    m.set(c.name, c.name);
    for (const a of c.aliases ?? []) m.set(a, c.name);
  }
  return m;
})();

/**
 * Resolve a user-typed leading slash token to its canonical command name.
 * Returns null if the token doesn't match any known command or alias.
 */
export function canonicalize(token: string): string | null {
  if (!token.startsWith("/")) return null;
  return CANONICAL_BY_NAME.get(token) ?? null;
}

/** Typeahead match — also matches aliases so `/h` autocompletes to /help. */
export function matchSlash(prefix: string): SlashCommand[] {
  if (!prefix.startsWith("/")) return [];
  const q = prefix.toLowerCase();
  return SLASH_COMMANDS.filter(
    (c) =>
      c.name.toLowerCase().startsWith(q) ||
      (c.aliases ?? []).some((a) => a.toLowerCase().startsWith(q)),
  );
}

/** Render a /help block grouped by section. */
export function formatHelp(): string {
  const sections: Record<string, string> = {
    chat: "Chat",
    familiar: "Familiars",
    daemon: "Daemon",
    view: "View / Sessions",
    launch: "Launch",
  };
  const lines: string[] = [];
  for (const [key, label] of Object.entries(sections)) {
    const items = SLASH_COMMANDS.filter((c) => c.section === key);
    if (items.length === 0) continue;
    lines.push(`${label}`);
    for (const c of items) {
      const names = [c.name, ...(c.aliases ?? [])].join(", ");
      const arg = c.argPlaceholder ? ` <${c.argPlaceholder}>` : "";
      lines.push(`  ${names}${arg} — ${c.description}`);
    }
    lines.push("");
  }
  // Keyboard shortcuts — sourced from the same catalog as the ⌘/ sheet
  // (src/lib/keyboard-shortcuts.ts). /help is rendered as plain transcript
  // text with no platform detection, so use neutral Cmd/Ctrl labels.
  lines.push("Keyboard");
  for (const group of SHORTCUT_GROUPS) {
    lines.push(`  ${group.label}`);
    for (const entry of group.entries) {
      lines.push(`    ${neutralizeKeys(entry.keys)} — ${entry.description}`);
    }
  }
  lines.push("");
  lines.push("Press Cmd/Ctrl+/ (or ? outside an input) to open the keyboard shortcuts sheet.");
  return lines.join("\n").trim();
}
