/**
 * Keyboard shortcut catalog — the single source of truth for the Shortcuts
 * sheet (⌘/ or `?`) and the Keyboard section of `/help`.
 *
 * Entries are authored with Mac-canonical glyphs (⌘ ⌥ ⌃ ⇧ ↵) just like the
 * slash command hints; UI surfaces retarget them per platform with
 * `platformizeHint` (src/lib/platform-keys.ts), and plain-text surfaces
 * (`/help`) use [`neutralizeKeys`] below for platform-neutral labels.
 *
 * Keep this list truthful: every entry must correspond to a binding that
 * actually exists in code —
 *   - panels/terminal: src/components/shell.tsx keydown handlers
 *   - palette, surfaces, familiars, new chat, this sheet: src/components/workspace.tsx
 *   - composer + slash menu: src/components/chat-view.tsx onComposerKey and
 *     src/components/home-composer.tsx handleKeyDown
 *   - "/" search focus: each surface's view (familiars-view, projects-view,
 *     capabilities-view, chat-list); "⌘F" sessions search: chat-list.tsx
 *   - terminal & panes: src/components/comux-view.tsx keydown handlers
 *   - browser pane: src/components/browser-pane.tsx (⌘L / ⌘K / [)
 *   - ⌘S save: familiar-daily-notes.tsx + journal/canvas-list.tsx;
 *     artifact refine ⌘↵: chat-artifact-viewer.tsx
 */

export type ShortcutEntry = {
  /** Key combo, Mac-canonical glyphs (run through platformizeHint to render). */
  keys: string;
  description: string;
};

export type ShortcutGroup = {
  id: "panels" | "terminal" | "browser" | "composer" | "slash-menu" | "other";
  label: string;
  entries: ShortcutEntry[];
};

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    id: "panels",
    label: "Panels & navigation",
    entries: [
      { keys: "⌘K", description: "Open the command palette" },
      { keys: "⌘B", description: "Toggle the left sidebar" },
      { keys: "⌘⇧B", description: "Toggle the right side panel" },
      { keys: "⌘\\", description: "Toggle the list panel" },
      { keys: "⌃`", description: "Toggle the integrated terminal (desktop app)" },
      { keys: "⌘1–⌘8", description: "Jump to a sidebar surface (Home … Code)" },
      { keys: "⌘0", description: "Jump to the Library" },
      { keys: "⌘9", description: "Jump to Projects (Chat surface)" },
      { keys: "⌘⇧C", description: "Jump to Calls (familiar activity)" },
      { keys: "⌘[ / ⌘]", description: "Previous / next surface" },
      { keys: "⌥1–⌥9", description: "Select the Nth familiar" },
      { keys: "⌘↑ / ⌘↓", description: "Cycle through familiars" },
      { keys: "⌘N", description: "New chat (on the Chat surface)" },
      { keys: "/", description: "Focus the search (Familiars, Projects, Capabilities, Sessions)" },
      { keys: "⌘F", description: "Focus the sessions search" },
    ],
  },
  {
    id: "terminal",
    label: "Terminal & panes",
    entries: [
      { keys: "⌘N", description: "New terminal session" },
      { keys: "⌘W", description: "Close the focused pane" },
      { keys: "⌘⌥←→↑↓", description: "Focus the pane in that direction" },
      { keys: "⌘[ / ⌘]", description: "Cycle to the previous / next pane" },
      { keys: "⌘1–⌘9", description: "Jump to pane N" },
      { keys: "⌘↵", description: "Zoom the focused pane (toggle)" },
      { keys: "⌘⇧B", description: "Broadcast input to every visible pane" },
    ],
  },
  {
    id: "browser",
    label: "Browser",
    entries: [
      { keys: "⌘L", description: "Focus the address bar" },
      { keys: "⌘K", description: "Open quick-open" },
      { keys: "[", description: "Toggle the rail pin" },
    ],
  },
  {
    id: "composer",
    label: "Composer",
    entries: [
      { keys: "↵", description: "Send the message" },
      { keys: "⇧↵", description: "Insert a newline" },
      { keys: "Esc", description: "Dismiss the slash menu, then cancel a streaming reply" },
      { keys: "↑ / ↓", description: "Recall prompt history (home composer, empty input)" },
    ],
  },
  {
    id: "slash-menu",
    label: "Slash menu",
    entries: [
      { keys: "↑ / ↓", description: "Move the highlight" },
      { keys: "Tab", description: "Complete the highlighted command" },
      { keys: "↵", description: "Run the highlighted command (completes first if it takes arguments)" },
      { keys: "Esc", description: "Dismiss the menu" },
    ],
  },
  {
    id: "other",
    label: "Other",
    entries: [
      { keys: "⌘,", description: "Open Settings" },
      { keys: "⌘S", description: "Save (daily notes, journal)" },
      { keys: "⌘↵", description: "Run the refine (artifact viewer)" },
      { keys: "⌘/", description: "Open this shortcuts sheet" },
      { keys: "?", description: "Open the shortcuts sheet (when not typing in a field)" },
      { keys: "Esc", description: "Close dialogs and modals" },
    ],
  },
];

/**
 * Platform-neutral plain-text rendering of a key combo, for surfaces that
 * can't (or shouldn't) detect the platform — e.g. the `/help` transcript
 * block. "⌘B" → "Cmd/Ctrl+B", "⇧↵" → "Shift+Enter".
 */
export function neutralizeKeys(keys: string): string {
  return keys
    .replaceAll("⌘", "Cmd/Ctrl+")
    .replaceAll("⌥", "Alt+")
    .replaceAll("⌃", "Ctrl+")
    .replaceAll("⇧", "Shift+")
    .replaceAll("↵", "Enter");
}
