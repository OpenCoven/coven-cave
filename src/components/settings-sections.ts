// Settings section catalog — the navigable sections plus the metadata the
// per-section overview header renders (accent, one-line description, and a short
// "what's in here" highlight strip). Kept in its own module so the shell nav and
// the SettingsOverview header share one source of truth.
//
export type Section =
  | "general"
  | "daemon"
  | "familiars"
  | "addons"
  | "mobile"
  | "appearance"
  | "about";

export type SectionMeta = { id: Section; label: string; icon: string; description: string; accent: string };

export type SettingsIndexEntry = { section: Section; group?: string; keywords: string };

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

export const SETTINGS_INDEX: SettingsIndexEntry[] = [
  { section: "general", group: "Workspace", keywords: "workspace directory root folder project path" },
  { section: "general", group: "Startup", keywords: "startup launch autostart open boot" },
  { section: "daemon", group: "Status", keywords: "daemon status running start stop restart" },
  { section: "daemon", group: "Info", keywords: "daemon info version socket pid api" },
  { section: "familiars", keywords: "familiars agents personas avatar name look permissions projects access grants allow deny tool policy guard security audit requests vault memory" },
  { section: "addons", group: "Integrations", keywords: "add-ons addons integrations plugins github youtube sidebar surfaces code terminal browser flow roles journal coven group chat library" },
  { section: "mobile", group: "Steps", keywords: "phone mobile connect qr pair tailscale" },
  { section: "mobile", group: "Why there’s no password", keywords: "password security auth login" },
  { section: "mobile", group: "Get the app", keywords: "app download ios testflight install" },
  { section: "appearance", group: "Mode", keywords: "mode dark light system appearance scheme" },
  { section: "appearance", group: "Theme", keywords: "theme color palette swatch preset" },
  { section: "appearance", group: "Theme tokens", keywords: "theme tokens colors hex custom background accent border" },
  { section: "appearance", group: "Import from tweakcn", keywords: "import tweakcn css variables theme" },
  { section: "appearance", group: "Familiar switcher", keywords: "familiar switcher style strip scope" },
  { section: "appearance", group: "Corners", keywords: "corners radius rounded sharp square" },
  { section: "appearance", group: "Reading text", keywords: "font typeface family size reading text density relative time chat library" },
  { section: "about", group: "CovenCave", keywords: "about version covencave build" },
  { section: "about", group: "OpenCoven tools", keywords: "tools update cli opencoven" },
  { section: "about", group: "Links", keywords: "links docs help github support" },
];

export function getSectionMeta(section: Section): SectionMeta {
  return SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
}

export function settingsSectionLabel(section: Section): string {
  return getSectionMeta(section).label;
}
