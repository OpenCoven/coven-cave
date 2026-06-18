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
