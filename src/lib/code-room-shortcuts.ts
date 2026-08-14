/**
 * Coding Desk keyboard shortcuts (cave-uod42).
 *
 * The Room's approved design asks for five bindings — focus next terminal,
 * split right, split down, close pane, toggle broadcast — and adds one hard
 * constraint: "Shortcuts do not fire from text inputs outside xterm."
 *
 * Why a pure resolver rather than an inline keydown block: the Room's center is
 * a terminal, so the cost of getting a combo wrong is a keystroke silently
 * eaten from a running shell. Keeping the mapping data lets a test enumerate
 * every combo and assert the negatives — plain letters, bare Ctrl, and typing
 * targets — which is the half that a hand-rolled handler never covers.
 *
 * Modifier choice: every binding is Cmd/Ctrl **plus Shift**. Bare Ctrl+letter
 * is shell signal territory (Ctrl+C, Ctrl+D) and Alt+letter is an escape
 * sequence, so both would collide with the surface these shortcuts control.
 * Ctrl/Cmd+Shift+letter emits nothing on any terminal transport we ship, and
 * no ⇧⌘ combo exists anywhere else in the app's catalog.
 */

export type CodeRoomShortcut =
  | "focus-next-terminal"
  | "focus-previous-terminal"
  | "split-right"
  | "split-down"
  | "close-terminal"
  | "toggle-broadcast";

/** The subset of KeyboardEvent this resolver reads — so tests (and non-DOM
 *  callers) can describe a keypress without constructing a real event. */
export type CodeRoomKeyDescriptor = {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
};

const BINDINGS: ReadonlyArray<{ key: string; shortcut: CodeRoomShortcut }> = [
  { key: "arrowright", shortcut: "focus-next-terminal" },
  { key: "arrowleft", shortcut: "focus-previous-terminal" },
  { key: "d", shortcut: "split-right" },
  { key: "e", shortcut: "split-down" },
  { key: "x", shortcut: "close-terminal" },
  { key: "b", shortcut: "toggle-broadcast" },
];

/** Mac-canonical hints for the shortcuts sheet and button tooltips. Kept beside
 *  the bindings so the advertised combo and the wired one move together. */
export const CODE_ROOM_SHORTCUT_HINTS: Record<CodeRoomShortcut, string> = {
  "focus-next-terminal": "⇧⌘→",
  "focus-previous-terminal": "⇧⌘←",
  "split-right": "⇧⌘D",
  "split-down": "⇧⌘E",
  "close-terminal": "⇧⌘X",
  "toggle-broadcast": "⇧⌘B",
};

/** Does this element swallow the shortcut because the user is writing prose?
 *
 * xterm is the deliberate exception: it renders a hidden `textarea`, so a naive
 * "is this a text field?" test would disable every Room shortcut precisely
 * where they matter most. The terminal marks its own subtree, and we honour
 * that marker over the tag name. */
export function isCodeRoomTypingTarget(target: EventTarget | null): boolean {
  // Duck-typed rather than `instanceof HTMLElement`: this module is imported by
  // a plain Node test runner where that global does not exist, and an
  // exception thrown on the keydown hot path would be a worse bug than any it
  // could catch.
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  if (typeof el.closest === "function" && el.closest(".xterm")) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

/** The Room action for a keypress, or null when the event is not ours.
 *
 * Returns null rather than throwing for every non-match, because this runs on
 * the hot path of every keystroke typed into a shell. */
export function resolveCodeRoomShortcut(
  event: CodeRoomKeyDescriptor,
): CodeRoomShortcut | null {
  // Alt is reserved for the terminal's own escape sequences; a combo that
  // includes it is meant for the shell, not the Room.
  if (event.altKey) return null;
  if (!event.shiftKey) return null;
  if (!event.metaKey && !event.ctrlKey) return null;
  const key = event.key.toLowerCase();
  return BINDINGS.find((binding) => binding.key === key)?.shortcut ?? null;
}
