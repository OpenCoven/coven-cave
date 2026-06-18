/**
 * Layout presets for the Code workspace (mode "code"): quick re-weightings of
 * the chat | comux split so the user can jump between conversation-heavy,
 * balanced, and review-heavy layouts without dragging the separator.
 *
 * Mirrors src/lib/reading-width.ts: a small enum persisted in localStorage. The
 * preset only records *which chip is selected*; the actual pane sizes live in
 * react-resizable-panels' own persisted layout ("cave.code.widths.v1"), applied
 * by resizing the chat panel to CODE_PRESET_CHAT_SIZE. Values stay inside the
 * code-chat panel's min/max band (the comux pane fills the remainder, clamped to
 * its own minSize), so a preset never produces an impossible layout.
 */
import type { IconName } from "@/lib/icon";

export const CODE_PRESET_KEY = "cave.code.preset.v1";

export const CODE_PRESETS = ["chat", "split", "review"] as const;

export type CodePreset = (typeof CODE_PRESETS)[number];

export const DEFAULT_CODE_PRESET: CodePreset = "split";

/** Chat-pane width per preset; the comux pane fills what's left. */
export const CODE_PRESET_CHAT_SIZE: Record<CodePreset, string> = {
  chat: "65%", // conversation-forward (comux at its 35% min)
  split: "45%", // balanced
  review: "30%", // comux-forward for diff review
};

export const CODE_PRESET_LABELS: Record<CodePreset, string> = {
  chat: "Chat",
  split: "Split",
  review: "Review",
};

export const CODE_PRESET_ICONS: Record<CodePreset, IconName> = {
  chat: "ph:chats",
  split: "ph:columns",
  review: "ph:git-diff",
};

/** One-line hint shown in each preset chip's tooltip — what the mode is *for*. */
export const CODE_PRESET_HINTS: Record<CodePreset, string> = {
  chat: "Focus the conversation — widen chat, hide the projects list",
  split: "Balanced — chat beside the file tree & preview",
  review: "Review changes — widen code and open the git diff",
};

/**
 * A preset is more than a width: it sets up the whole Code workspace for a task.
 * These maps let the chat-pane toolbar (code-view) and the coding surface
 * (comux-view) agree on the *context* each preset implies, dispatched over the
 * events below so neither component has to reach into the other.
 */

/** Whether a preset hides the comux projects list (Chat focuses the chat). */
export const CODE_PRESET_HIDES_PROJECT_LIST: Record<CodePreset, boolean> = {
  chat: true,
  split: false,
  review: false,
};

/** Which comux right-pane a preset switches to, or null to leave it untouched. */
export const CODE_PRESET_RIGHT_VIEW: Record<CodePreset, "files" | "changes" | null> = {
  chat: null, // conversation-forward: don't disturb whatever's open
  split: "files", // balanced working layout → file tree & preview
  review: "changes", // review-forward → the git diff
};

/** localStorage key for whether the comux projects list is collapsed. */
export const CODE_PROJECT_LIST_KEY = "cave.code.projectListCollapsed.v1";

/** Fired by the Code toolbar (code-view) → consumed by comux-view to show/hide
 *  the projects list. `detail.collapsed: boolean`. */
export const CODE_PROJECT_LIST_EVENT = "cave:code-project-list";

/** Fired when a preset is chosen → comux-view switches its right pane to match.
 *  `detail.preset: CodePreset`. */
export const CODE_PRESET_EVENT = "cave:code-preset";

export function readProjectListCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CODE_PROJECT_LIST_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeProjectListCollapsed(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CODE_PROJECT_LIST_KEY, collapsed ? "1" : "0");
  } catch {
    /* ignore unavailable storage */
  }
}

export function normalizeCodePreset(value: unknown): CodePreset {
  return CODE_PRESETS.includes(value as CodePreset)
    ? (value as CodePreset)
    : DEFAULT_CODE_PRESET;
}

export function readCodePreset(): CodePreset {
  if (typeof window === "undefined") return DEFAULT_CODE_PRESET;
  try {
    return normalizeCodePreset(window.localStorage.getItem(CODE_PRESET_KEY));
  } catch {
    return DEFAULT_CODE_PRESET;
  }
}

export function writeCodePreset(preset: CodePreset): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CODE_PRESET_KEY, normalizeCodePreset(preset));
  } catch {
    /* ignore unavailable storage */
  }
}
