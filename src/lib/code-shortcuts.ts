/**
 * Rebindable Coding Room shortcuts (cave-0rcku).
 *
 * The `Cody Code Reading v2` frame ships a shortcuts dialog you can actually
 * rebind from — "press the new combo — saved on this device" — with one rule
 * spelled out in its footer: *a duplicate combo takes the key from the older
 * binding*. That is the interesting part and it lives here, because the
 * alternative (refusing a duplicate) leaves you staring at a combo you cannot
 * have without first hunting down whoever holds it.
 *
 * Combos are stored as a normalized string — `Mod+Shift+D` — where `Mod` is
 * Cmd on Apple platforms and Ctrl elsewhere. Storing the *intent* rather than
 * the resolved modifier is what lets one saved keymap follow a user between the
 * desktop shell and a browser on another OS.
 */

export type CodeShortcutId =
  | "picker"
  | "prompt"
  | "changes"
  | "pr"
  | "files"
  | "outline"
  | "terminal"
  | "help";

export type CodeShortcutDef = {
  id: CodeShortcutId;
  label: string;
  /** Factory default, in the normalized combo grammar. */
  combo: string;
};

/**
 * The bindable set. Deliberately only actions this surface owns — global
 * navigation already has bindings elsewhere, and shadowing them from a
 * per-surface dialog is how two keymaps start disagreeing.
 *
 * These must also stay clear of the Room's FIXED terminal bindings
 * (`code-room-shortcuts.ts`: ⇧⌘→ ⇧⌘← ⇧⌘D ⇧⌘E ⇧⌘X ⇧⌘B). Those resolve first,
 * inside the terminal, and are not rebindable — a default that collided would
 * be dead on arrival in exactly the pane it was meant for. `defaultCodeKeymap`
 * is asserted against that list in `code-shortcuts.test.ts`.
 */
export const CODE_SHORTCUTS: readonly CodeShortcutDef[] = [
  { id: "picker", label: "Switch session", combo: "Mod+P" },
  { id: "prompt", label: "Focus the follow-up prompt", combo: "Mod+J" },
  { id: "changes", label: "Changes in the review rail", combo: "Mod+Shift+C" },
  { id: "pr", label: "Pull request in the review rail", combo: "Mod+Shift+R" },
  { id: "files", label: "Focus the file tree", combo: "Mod+Shift+F" },
  { id: "outline", label: "Toggle the file outline", combo: "Mod+Shift+O" },
  { id: "terminal", label: "Terminal drawer", combo: "Mod+`" },
  { id: "help", label: "This dialog", combo: "?" },
] as const;

/** Fixed terminal bindings the rebindable set must never collide with. */
export const CODE_RESERVED_COMBOS: readonly string[] = [
  "Mod+Shift+ArrowRight",
  "Mod+Shift+ArrowLeft",
  "Mod+Shift+D",
  "Mod+Shift+E",
  "Mod+Shift+X",
  "Mod+Shift+B",
] as const;

export type CodeKeymap = Partial<Record<CodeShortcutId, string>>;

export const CODE_SHORTCUT_STORAGE_KEY = "cave.code.keymap";

/** Factory keymap — a fresh object each call so callers can mutate freely. */
export function defaultCodeKeymap(): Record<CodeShortcutId, string> {
  const out = {} as Record<CodeShortcutId, string>;
  for (const shortcut of CODE_SHORTCUTS) out[shortcut.id] = shortcut.combo;
  return out;
}

/**
 * Merge a stored keymap over the defaults, dropping unknown ids and non-string
 * values. An empty string is preserved: that is how a binding is *unbound*,
 * which the dialog offers and which must survive a reload.
 */
export function mergeCodeKeymap(stored: unknown): Record<CodeShortcutId, string> {
  const map = defaultCodeKeymap();
  if (!stored || typeof stored !== "object") return map;
  for (const shortcut of CODE_SHORTCUTS) {
    const value = (stored as Record<string, unknown>)[shortcut.id];
    if (typeof value === "string") map[shortcut.id] = value;
  }
  return map;
}

/**
 * Normalized combo for a keyboard event, or null for a bare modifier press
 * (which is what you get on the way to a real combo, not a binding).
 *
 * Shift is recorded only when it did not already do its work in the printed
 * character: `?` is `Shift+/` on a US layout, and storing it as `Shift+?` would
 * never match again.
 */
export function codeComboFromEvent(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): string | null {
  const key = event.key;
  if (key === "Shift" || key === "Meta" || key === "Control" || key === "Alt") return null;
  let printable = key.length === 1 ? key.toUpperCase() : key;
  if (printable === " ") printable = "Space";
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("Mod");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey && !(key.length === 1 && !/[A-Z0-9]/i.test(key))) parts.push("Shift");
  parts.push(printable);
  return parts.join("+");
}

/**
 * Bind `combo` to `id`, unbinding anything that already held it.
 *
 * This is the frame's stated rule and it is the humane one: the newest
 * intention wins, and the binding it displaced becomes visibly `unbound` in the
 * same dialog, so the cost of the collision is shown rather than hidden behind
 * a rejection.
 */
export function bindCodeShortcut(
  keymap: Record<CodeShortcutId, string>,
  id: CodeShortcutId,
  combo: string,
): Record<CodeShortcutId, string> {
  const next = { ...keymap };
  if (combo) {
    for (const shortcut of CODE_SHORTCUTS) {
      if (shortcut.id !== id && next[shortcut.id] === combo) next[shortcut.id] = "";
    }
  }
  next[id] = combo;
  return next;
}

/** Which action a live keypress triggers, or null. Unbound entries never match. */
export function codeShortcutForCombo(
  keymap: Record<CodeShortcutId, string>,
  combo: string | null,
): CodeShortcutId | null {
  if (!combo) return null;
  for (const shortcut of CODE_SHORTCUTS) {
    if (keymap[shortcut.id] && keymap[shortcut.id] === combo) return shortcut.id;
  }
  return null;
}

/**
 * Display chips for a combo — `Mod` resolved to the platform glyph so the
 * dialog reads like the platform it is running on rather than like storage.
 */
export function codeComboChips(combo: string, apple: boolean): string[] {
  if (!combo) return [];
  return combo.split("+").map((part) => {
    if (part === "Mod") return apple ? "⌘" : "Ctrl";
    if (part === "Alt") return apple ? "⌥" : "Alt";
    if (part === "Shift") return apple ? "⇧" : "Shift";
    if (part === "ArrowUp") return "↑";
    if (part === "ArrowDown") return "↓";
    if (part === "Enter") return "↵";
    if (part === "Escape") return "Esc";
    return part;
  });
}
