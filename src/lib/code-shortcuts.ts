/**
 * Rebindable Coding Desk shortcuts (cave-0rcku).
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
  | "next-file"
  | "previous-file"
  | "help";

export type CodeShortcutDef = {
  id: CodeShortcutId;
  label: string;
  /** Factory default, in the normalized combo grammar. */
  combo: string;
};

export type CodeFixedShortcutDef = {
  id: string;
  label: string;
  combo: string;
};

/**
 * The bindable set. Deliberately only actions this surface owns — global
 * navigation already has bindings elsewhere, and shadowing them from a
 * per-surface dialog is how two keymaps start disagreeing.
 *
 * These must also stay clear of the Room's FIXED bindings: the terminal-pane
 * controls (`code-room-shortcuts.ts`: ⇧⌘→ ⇧⌘← ⇧⌘D ⇧⌘E ⇧⌘X ⇧⌘B) and the session
 * queue's own `/`, `J`, `K`, and `Shift+A`. Those resolve first and are not
 * rebindable — a default that collided would be dead on arrival in exactly the
 * surface it was meant for. `defaultCodeKeymap` is asserted against that list
 * in `code-shortcuts.test.ts`.
 */
export const CODE_SHORTCUTS: readonly CodeShortcutDef[] = [
  { id: "picker", label: "Switch session", combo: "Mod+P" },
  // Not Mod+J (#5729): that is the app's quick chat, whose handler runs first,
  // so the desk binding never fired and the key left the desk for a new chat.
  { id: "prompt", label: "Focus the follow-up prompt", combo: "Mod+I" },
  { id: "changes", label: "Changes in the review rail", combo: "Mod+Shift+C" },
  { id: "pr", label: "Pull request in the review rail", combo: "Mod+Shift+R" },
  { id: "files", label: "Focus the file tree", combo: "Mod+Shift+F" },
  { id: "outline", label: "Toggle the file outline", combo: "Mod+Shift+O" },
  { id: "terminal", label: "Terminal drawer", combo: "Mod+`" },
  // Open-file tabs (#5705). Alt+Arrow rather than Mod+Shift+[ ] because the
  // bracket pair is the browser's own tab switch on every platform and cannot
  // be prevented from a page; Option+Arrow prints no dead key on macOS.
  { id: "next-file", label: "Next open file", combo: "Alt+ArrowDown" },
  { id: "previous-file", label: "Previous open file", combo: "Alt+ArrowUp" },
  // Unbound by default (#5729). "?" and ⌘/ open the app's shortcuts sheet,
  // whose handler runs first, so the desk binding never fired; ⌘? is the macOS
  // Help menu in the browser and in the desktop shell. The header's Shortcuts
  // button opens this dialog, and any free key can be bound here.
  { id: "help", label: "This dialog", combo: "" },
] as const;

/** Fixed terminal bindings the rebindable set must never collide with. */
export const CODE_FIXED_TERMINAL_SHORTCUTS: readonly CodeFixedShortcutDef[] = [
  { id: "focus-next-terminal", label: "Focus the next terminal pane", combo: "Mod+Shift+ArrowRight" },
  { id: "focus-previous-terminal", label: "Focus the previous terminal pane", combo: "Mod+Shift+ArrowLeft" },
  { id: "split-right", label: "Split the pane right", combo: "Mod+Shift+D" },
  { id: "split-down", label: "Split the pane down", combo: "Mod+Shift+E" },
  { id: "close-terminal", label: "Close the pane", combo: "Mod+Shift+X" },
  { id: "toggle-broadcast", label: "Broadcast typing to every pane", combo: "Mod+Shift+B" },
] as const;

/** Fixed queue bindings owned by the Sessions view, not the per-session room. */
export const CODE_FIXED_QUEUE_SHORTCUTS: readonly CodeFixedShortcutDef[] = [
  { id: "queue-search", label: "Search sessions", combo: "/" },
  { id: "queue-next", label: "Focus the next visible session", combo: "J" },
  { id: "queue-previous", label: "Focus the previous visible session", combo: "K" },
  { id: "queue-scope", label: "Toggle Reviewable / All local", combo: "Shift+A" },
] as const;

/**
 * App-wide keys whose handler (workspace.tsx) runs before the desk's and
 * claims them on every surface (#5729). A desk binding on one of these is dead
 * on arrival, so they are reserved and listed in the dialog.
 */
export const CODE_APP_RESERVED_SHORTCUTS: readonly CodeFixedShortcutDef[] = [
  { id: "app-palette", label: "Command palette", combo: "Mod+K" },
  { id: "app-quick-chat", label: "Quick chat", combo: "Mod+J" },
  { id: "app-shortcuts-sheet", label: "App shortcuts sheet", combo: "Mod+/" },
  { id: "app-shortcuts-sheet-bare", label: "App shortcuts sheet (outside fields)", combo: "?" },
] as const;

/**
 * Does the app's global handler (workspace.tsx) take this combo before the
 * desk sees it? It mirrors that handler rather than listing combos (#5737
 * review): with Mod held it matches the lowercased key, so ⌘K and ⌘J are taken
 * with any Alt or Shift, and ⌘/ with any Alt. Without Mod it takes "?" outside
 * fields, Alt included — and outside fields is the only place the desk's own
 * shortcuts fire.
 */
export function isAppClaimedCombo(combo: string): boolean {
  if (!combo) return false;
  const parts = combo.split("+");
  const key = parts[parts.length - 1];
  if (parts.slice(0, -1).includes("Mod")) return key === "K" || key === "J" || key === "/";
  return key === "?";
}

/** Every non-rebindable combo, in the same normalized grammar as storage/events. */
export const CODE_RESERVED_COMBOS: readonly string[] = [
  ...CODE_FIXED_TERMINAL_SHORTCUTS.map((shortcut) => shortcut.combo),
  ...CODE_FIXED_QUEUE_SHORTCUTS.map((shortcut) => shortcut.combo),
  ...CODE_APP_RESERVED_SHORTCUTS.map((shortcut) => shortcut.combo),
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
    // A bare navigation key saved before it was refused (#5795) is ignored:
    // a picker bound to Tab took every Tab on the desk.
    if (typeof value === "string" && !isCodeReservedCombo(value) && !isCodeNavigationCombo(value)) map[shortcut.id] = value;
  }
  // A required action never loads unbound — not even from a keymap saved
  // before the rule existed (#5729).
  for (const id of CODE_REQUIRED_SHORTCUTS) {
    if (!map[id]) map[id] = defaultCodeKeymap()[id];
  }
  return map;
}

/**
 * Actions that can be rebound but never left without a key (#5729). The
 * terminal toggle is the one way out of a focused terminal: xterm consumes Tab
 * and Shift+Tab, so unbinding it — or letting another action take its key —
 * would turn the terminal back into a keyboard trap.
 */
export const CODE_REQUIRED_SHORTCUTS: readonly CodeShortcutId[] = ["terminal"];

export function isCodeShortcutRequired(id: CodeShortcutId): boolean {
  return CODE_REQUIRED_SHORTCUTS.includes(id);
}

/** The required action already holding `combo`, other than `id`, if any. */
export function codeRequiredComboHolder(
  keymap: Record<CodeShortcutId, string>,
  id: CodeShortcutId,
  combo: string,
): CodeShortcutId | null {
  if (!combo) return null;
  return CODE_REQUIRED_SHORTCUTS.find((required) => required !== id && keymap[required] === combo) ?? null;
}

/**
 * Keys that move around the page and press its controls (#5795). Capture took
 * them like any other: Tab pressed to move on from Rebind became the binding,
 * and from then on Tab from any desk button opened the session picker. Enter
 * or Space would have stopped every desk button working.
 */
const NAVIGATION_KEYS = new Set([
  "Tab", "Enter", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown",
]);

/** A navigation key without ⌘/Ctrl or Alt (Shift alone doesn't count: it
 *  selects, or reverses Tab). Never a desk shortcut. */
export function isCodeNavigationCombo(combo: string): boolean {
  if (!combo) return false;
  const parts = combo.split("+");
  const modifiers = parts.slice(0, -1);
  if (modifiers.includes("Mod") || modifiers.includes("Alt")) return false;
  return NAVIGATION_KEYS.has(parts[parts.length - 1]);
}

export function isCodeReservedCombo(combo: string): boolean {
  return CODE_RESERVED_COMBOS.includes(combo) || isAppClaimedCombo(combo);
}

export function codeReservedComboOwner(combo: string): "session queue" | "terminal panes" | "app" | null {
  if (CODE_FIXED_QUEUE_SHORTCUTS.some((shortcut) => shortcut.combo === combo)) return "session queue";
  if (CODE_FIXED_TERMINAL_SHORTCUTS.some((shortcut) => shortcut.combo === combo)) return "terminal panes";
  if (isAppClaimedCombo(combo)) return "app";
  return null;
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
  // Mod is the INTENT, resolved per platform only at display time
  // (`codeComboChips`). Reading `navigator` here was tried and reverted: it
  // makes a pure function platform-dependent, so a keymap saved on a Mac stops
  // matching in a browser on another OS — the exact portability this grammar
  // exists to provide — and it silently changes what the model returns under a
  // Node test runner, which exposes `navigator.platform` as "MacIntel".
  //
  // The hazard that change was aiming at is real but lives elsewhere: on macOS
  // Ctrl+P belongs to the shell, not to us. That is fixed where it belongs, in
  // the room's global handler, by refusing to act on a keystroke aimed at a
  // focused terminal pane (see `isCodeShortcutTarget`).
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
  if (combo && (isCodeReservedCombo(combo) || isCodeNavigationCombo(combo))) return { ...keymap };
  // A required action keeps a key: it can't be unbound, and its key can't be
  // taken by another action (#5729).
  if (!combo && isCodeShortcutRequired(id)) return { ...keymap };
  if (codeRequiredComboHolder(keymap, id, combo)) return { ...keymap };
  const next = { ...keymap };
  if (combo) {
    for (const shortcut of CODE_SHORTCUTS) {
      if (shortcut.id !== id && next[shortcut.id] === combo) next[shortcut.id] = "";
    }
  }
  next[id] = combo;
  return next;
}

/**
 * Should a room shortcut act on a keystroke aimed at this element?
 *
 * No for prose fields (the composer, the picker's filter, the editor) — a
 * global `?` that ate a question mark mid-sentence would be indefensible — and
 * no for a focused TERMINAL pane. The terminal case is the subtle one:
 * `isCodeRoomTypingTarget` deliberately answers "not a typing target" for
 * xterm so the terminal's OWN ⇧⌘ split bindings resolve, which means the room
 * would otherwise happily steal Ctrl+P and Ctrl+C from a running shell.
 * Keystrokes inside a terminal belong to the terminal.
 */
export function isCodeShortcutTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return true;
  if (typeof el.closest === "function" && el.closest(".xterm")) return false;
  if (el.isContentEditable) return false;
  const tag = el.tagName.toLowerCase();
  return tag !== "input" && tag !== "textarea" && tag !== "select";
}

/**
 * A field's own ⌘ keys (#5795): select all, the clipboard, undo and redo, and
 * moving or deleting by word or line. A desk action bound to one of them acts
 * outside fields, but never takes it from one.
 */
const FIELD_MOD_KEYS = new Set([
  "A", "C", "V", "X", "Z", "Y", "Backspace", "Delete", "Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End",
]);

/** A ⌘/Ctrl chord a text field doesn't use for editing (#5795). */
function isFieldFreeModCombo(combo: string | null): boolean {
  if (!combo) return false;
  const parts = combo.split("+");
  return parts.slice(0, -1).includes("Mod") && !FIELD_MOD_KEYS.has(parts[parts.length - 1]);
}

/**
 * May this room action act on a keystroke aimed at `target`?
 *
 * Everything `isCodeShortcutTarget` allows, plus exactly one key from inside
 * a focused terminal: the terminal drawer's own toggle (#5729). Every other
 * key there still belongs to the shell. Without this exception a focused
 * terminal was a keyboard trap — xterm consumes Tab and Shift+Tab, and the
 * "close" hint on the drawer bar sent its key to the shell instead.
 *
 * In a field — the follow-up box, the commit box, the editor — a ⌘/Ctrl
 * chord (`combo`) acts too (#5795). The field exemption left those keys to the
 * browser: ⌘⇧R is a hard reload there, which dropped the follow-up draft, the
 * open tabs and the viewed ticks, and ⌘P opened Print. Keys without ⌘ stay
 * the field's (Alt+↑ moves the caret), and so do its own editing chords.
 */
export function isCodeShortcutAllowed(
  target: EventTarget | null,
  action: CodeShortcutId | null,
  combo: string | null = null,
): boolean {
  if (!action) return false;
  if (isCodeShortcutTarget(target)) return true;
  const el = target as HTMLElement | null;
  const inTerminal = typeof el?.closest === "function" && Boolean(el.closest(".xterm"));
  if (inTerminal) return action === "terminal";
  return isFieldFreeModCombo(combo);
}

/** Is a modal dialog open anywhere on the page (#5795)? Closed ones can stay
 *  mounted, hidden (the phone layout's chat drawer), so a dialog counts only
 *  while it is shown. */
export function isModalDialogOpen(): boolean {
  if (typeof document === "undefined") return false;
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')].some(
    (dialog) => !dialog.closest('[hidden], [aria-hidden="true"], [inert]') && dialog.getClientRects().length > 0,
  );
}

/**
 * Is a key pressed with focus on `origin` the desk's to act on (#5795)? Yes
 * from inside `desk`, from the pane that holds it (a click on the desk's own
 * text focuses that pane), or with focus fallen to the page itself; never
 * behind a modal dialog, nor from another pane or the chat composer. ⌘S had no
 * such scope: pressed in the chat composer or a dialog it saved the desk's
 * edit, and beside Settings one ⌘S saved both.
 */
export function isCodeDeskKeyOrigin(origin: EventTarget | null, desk: Element | null | undefined): boolean {
  if (typeof document === "undefined" || isModalDialogOpen()) return false;
  if (!(origin instanceof Node) || origin === document.body || origin === document.documentElement) return true;
  return Boolean(desk && (desk.contains(origin) || origin.contains(desk)));
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
