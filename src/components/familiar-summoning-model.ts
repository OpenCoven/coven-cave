import type { IconName } from "@/lib/icon";

export type VesselKind = "local" | "ssh" | "openclaw";

export type HarnessReport = {
  id: string;
  label: string;
  chatSupported: boolean;
  installed: boolean;
};

export type OpenClawAgent = {
  id: string;
  displayName: string;
  role: string;
  workspacePath: string | null;
};

export type SshCheckState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; detail: string }
  | { state: "fail"; detail: string };

export const STARTER_GLYPHS = [
  "ph:sparkle-fill", "ph:cat-fill", "ph:robot-fill", "ph:ghost-fill",
  "ph:brain-fill", "ph:flask-fill", "ph:rocket-fill", "ph:magic-wand-fill",
  "ph:code-fill", "ph:books-fill", "ph:palette-fill", "ph:chart-bar-fill",
  "ph:compass-fill", "ph:detective-fill", "ph:planet-fill", "ph:butterfly-fill",
] as const;

export const DEFAULT_GLYPH = "ph:sparkle-fill";

export const AURA_PRESETS: { label: string; color: string }[] = [
  { label: "Theme", color: "color-mix(in oklch, var(--accent-presence) 72%, white 28%)" },
  { label: "Lilac", color: "oklch(0.82 0.08 305)" },
  { label: "Rose", color: "oklch(0.82 0.08 20)" },
  { label: "Ember", color: "oklch(0.80 0.10 60)" },
  { label: "Moss", color: "oklch(0.82 0.09 150)" },
  { label: "Tide", color: "oklch(0.82 0.08 220)" },
  { label: "Gold", color: "oklch(0.85 0.10 95)" },
  { label: "Slate", color: "oklch(0.75 0.02 270)" },
];

export const NAME_POOL = [
  "Wren", "Ember", "Onyx", "Luna", "Rook", "Hazel", "Fenn", "Moss", "Thistle", "Juniper",
  "Ivy", "Basil", "Clove", "Nyx", "Ash", "Briar", "Pip", "Marlow", "Quill", "Vesper",
] as const;

export const STAGES = [
  { key: "vessel", numeral: "I", title: "The vessel", hint: "Choose where your familiar lives — the machine or agent its mind runs on." },
  { key: "name", numeral: "II", title: "The name", hint: "Every familiar answers to a name." },
  { key: "form", numeral: "III", title: "The form", hint: "Give it a sigil and an aura." },
  { key: "summon", numeral: "IV", title: "The summoning", hint: "Read the incantation, then call." },
] as const;

export const IDENTITY_PRESETS: { label: string; icon: IconName; role: string; description: string }[] = [
  { label: "Code reviewer", icon: "ph:git-branch-bold", role: "Code reviewer", description: "Reviews changes for bugs, regressions, and unclear code, and suggests focused fixes with reasoning." },
  { label: "Research assistant", icon: "ph:magnifying-glass", role: "Researcher", description: "Digs into questions, compares sources and trade-offs, and reports findings with clear summaries." },
  { label: "Project planner", icon: "ph:kanban", role: "Planner", description: "Breaks goals into small, ordered tasks, tracks what's blocked, and keeps the board tidy." },
  { label: "Writing partner", icon: "ph:pencil-line-bold", role: "Editor", description: "Drafts, tightens, and restructures prose while keeping the writer's voice and intent." },
];

export type StageIndex = 0 | 1 | 2 | 3;
