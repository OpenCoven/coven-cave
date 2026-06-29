// Settings section catalog — the navigable sections plus the metadata the
// per-section overview header renders (accent, one-line description, and a short
// "what's in here" highlight strip). Kept in its own module so the shell nav and
// the SettingsOverview header share one source of truth.
//
// NOTE: the search index (SETTINGS_INDEX) intentionally stays in settings-shell
// next to the search box it drives.

export type Section =
  | "general"
  | "daemon"
  | "familiars"
  | "addons"
  | "mobile"
  | "appearance"
  | "about";

export type SectionMeta = {
  id: Section;
  label: string;
  icon: string;
  /** One-line summary shown under the section title in the overview header. */
  description: string;
  /** Accent colour for the section mark (kept subtle; section identity cue). */
  accent: string;
};

export const SECTIONS: SectionMeta[] = [
  { id: "general", label: "General", icon: "ph:sliders-horizontal", description: "Workspace, startup, and app-wide defaults.", accent: "#9a8ecd" },
  { id: "daemon", label: "Daemon", icon: "ph:terminal-window", description: "Local runtime status and process controls.", accent: "#69d6a6" },
  { id: "familiars", label: "Familiars", icon: "ph:users-three", description: "Roster, identity, permissions, and pin order.", accent: "#d8a9ff" },
  { id: "addons", label: "Add-ons", icon: "ph:puzzle-piece", description: "Optional integrations and sidebar surfaces.", accent: "#7bb7ff" },
  { id: "mobile", label: "Phone", icon: "ph:device-mobile", description: "Native iOS handoff over your Tailscale network.", accent: "#73d9d0" },
  { id: "appearance", label: "Appearance", icon: "ph:paint-brush", description: "Theme, typography, and reading controls.", accent: "#ff9fb5" },
  { id: "about", label: "About", icon: "ph:info", description: "Version, updates, and project links.", accent: "#b8d8ff" },
];

export const SECTION_HIGHLIGHTS: Record<Section, string[]> = {
  general: ["Workspace path", "Launch behavior", "Default start view"],
  daemon: ["Runtime health", "Restart action", "Socket & version"],
  familiars: ["Roster & identity", "Per-familiar permissions", "Pinned strip order"],
  addons: ["Sidebar surfaces", "Integrations", "Hidden when disabled"],
  mobile: ["Mobile mode", "Tailscale handoff", "Native iOS guide"],
  appearance: ["Theme & colors", "Typography", "Reading comfort"],
  about: ["App version", "Tool updates", "Project links"],
};

export function getSectionMeta(section: Section): SectionMeta {
  return SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
}

export function settingsSectionLabel(section: Section): string {
  return getSectionMeta(section).label;
}
