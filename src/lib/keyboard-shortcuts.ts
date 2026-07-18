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
 *   - panels: src/components/shell.tsx keydown handlers
 *   - palette, surfaces, familiars, new chat, this sheet: src/components/workspace.tsx
 *   - composer + slash menu: src/components/chat-view.tsx onComposerKey and
 *     src/components/home-composer.tsx handleKeyDown
 *   - "/" search focus: each surface's view (familiars-view, projects-view,
 *     marketplace-view, chat-list); "⌘F" sessions search: chat-list.tsx
 *   - split chat panes (⌥↵ / ⌥⌘arrows / ⌥⌘W): chat-project-sidebar.tsx row
 *     keydown + the chat-router.tsx split-keyboard effect
 *   - browser pane: src/components/browser-pane.tsx (⌘L / ⌘K / [)
 *   - ⌘S save: familiar-daily-notes.tsx;
 *     artifact refine ⌘↵: chat-artifact-viewer.tsx
 *
 * (cave-7c9i) The sheet used to advertise ⌘6–⌘8 / a retired "Code" surface,
 * a ⌃` terminal toggle whose Shell `bottom` slot the Workspace never passes,
 * and a whole "Terminal & panes" group implemented only in the unmounted
 * ComuxView. Advertised-but-dead shortcuts erode trust in the whole sheet —
 * if a binding lands, add it here in the same change that wires it.
 */

export type ShortcutEntry = {
  /** Key combo, Mac-canonical glyphs (run through platformizeHint to render). */
  keys: string;
  description: string;
};

export type ShortcutGroup = {
  id: "panels" | "browser" | "composer" | "slash-menu" | "other";
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
      { keys: "⌘\\", description: "Toggle the list panel" },
      { keys: "⌘1–⌘5", description: "Jump to a surface (Home, Chat, Tasks, Rituals, Browser)" },
      { keys: "⌘9", description: "Jump to Projects (Chat surface)" },
      { keys: "⌘[ / ⌘]", description: "Previous / next surface" },
      { keys: "⌥1–⌥9", description: "Select the Nth familiar" },
      { keys: "⌘↑ / ⌘↓", description: "Cycle through familiars" },
      { keys: "⌘N", description: "New chat (on the Chat surface)" },
      { keys: "⌥↵", description: "Thread rail: open the focused chat in a split pane" },
      { keys: "⌥⌘← / ⌥⌘→", description: "Move focus between split chat panes (also ⌥⌘↑ / ⌥⌘↓)" },
      { keys: "⌥⌘W", description: "Close the focused split chat pane" },
      { keys: "/", description: "Focus the search (Familiars, Projects, Capabilities, Sessions)" },
      { keys: "⌘F", description: "Focus the sessions search" },
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
      { keys: "⌘J", description: "Toggle quick chat" },
      { keys: "⌘,", description: "Open Settings" },
      { keys: "⌘S", description: "Save (daily notes)" },
      { keys: "⌘Z", description: "Undo the last delete (while the undo toast is showing)" },
      { keys: "⌘↵", description: "Run the refine (artifact viewer)" },
      { keys: "↑ / ↓", description: "GitHub: move through activity rows" },
      { keys: "↵", description: "GitHub: open the selected item" },
      { keys: "⌘R", description: "GitHub: refresh activity" },
      { keys: "← / →", description: "Calendar: previous / next period" },
      { keys: "T", description: "Calendar: jump to today" },
      { keys: "D / W / M / A", description: "Calendar: Day / Week / Month / Agenda view" },
      { keys: "N", description: "Calendar: new event" },
      { keys: "⌥↑ / ⌥↓", description: "Calendar: reschedule the focused event (±15min, +⇧ = 1h)" },
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
