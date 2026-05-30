export type SlashCommand = {
  name: string;
  hint: string;
  description: string;
  /** Commands that need extra arg-style typing show a placeholder. */
  argPlaceholder?: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/new", hint: "new chat", description: "Start a fresh chat with the active familiar." },
  { name: "/sessions", hint: "open list", description: "Go back to the chat list." },
  { name: "/tui", hint: "open in Coven Code", description: "Open the current session in the external Coven Code TUI." },
  { name: "/clear", hint: "clear transcript", description: "Clear the local view (does not delete the daemon session)." },
  { name: "/familiar", hint: "switch", description: "Switch to a different familiar.", argPlaceholder: "name" },
  { name: "/help", hint: "show help", description: "Print available commands." },
  { name: "/run", hint: "run task", description: "Run a task through the active familiar's harness.", argPlaceholder: "task…" },
  { name: "/codex", hint: "codex harness", description: "Run a task through Codex regardless of active familiar.", argPlaceholder: "task…" },
  { name: "/claude", hint: "claude harness", description: "Run a task through Claude regardless of active familiar.", argPlaceholder: "task…" },
];

/** Quick prefix match for inline composer suggestions. */
export function matchSlash(prefix: string): SlashCommand[] {
  if (!prefix.startsWith("/")) return [];
  const q = prefix.toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.name.toLowerCase().startsWith(q));
}
