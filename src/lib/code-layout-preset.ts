/**
 * Layout modes for the Code workspace (mode "code"): a two-option switch
 * between the code/files pane and the git changes pane. The selected mode also
 * re-weights the chat | worktree columns to keep the active task at 2/3 width.
 *
 * Mirrors src/lib/reading-width.ts: a small enum persisted in localStorage. The
 * preset records which chip is selected; Comux maps that to the visible
 * right-pane and column flex weights.
 */
import type { IconName } from "@/lib/icon";

export const CODE_PRESET_KEY = "cave.code.preset.v1";

export const CODE_PRESETS = ["code", "changes"] as const;

export type CodePreset = (typeof CODE_PRESETS)[number];

export const DEFAULT_CODE_PRESET: CodePreset = "code";

/** Two-pane Code workspace weights: chat column | worktree column. */
export const CODE_PRESET_COLUMN_FLEX: Record<CodePreset, { chat: number; worktree: number }> = {
  code: { chat: 2, worktree: 1 },
  changes: { chat: 1, worktree: 2 },
};

export const CODE_PRESET_LABELS: Record<CodePreset, string> = {
  code: "Code",
  changes: "Changes",
};

export const CODE_PRESET_ICONS: Record<CodePreset, IconName> = {
  code: "ph:code",
  changes: "ph:git-diff",
};

/** One-line hint shown in each preset chip's tooltip — what the mode is *for*. */
export const CODE_PRESET_HINTS: Record<CodePreset, string> = {
  code: "Focus the chat with the code preview available",
  changes: "Focus the git diff and uncommitted changes",
};

/**
 * A preset is more than a width: it sets up the whole Code workspace for a task.
 * These maps let external controls and the coding surface (comux-view) agree on
 * the *context* each preset implies, dispatched over the events below so neither
 * component has to reach into the other.
 */

/** Which comux right-pane a preset switches to, or null to leave it untouched. */
export const CODE_PRESET_RIGHT_VIEW: Record<CodePreset, "files" | "changes"> = {
  code: "files",
  changes: "changes",
};

/** localStorage key for whether the comux projects list is collapsed. */
export const CODE_PROJECT_LIST_KEY = "cave.code.projectListCollapsed.v1";

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
