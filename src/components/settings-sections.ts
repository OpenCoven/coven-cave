// Settings section catalog — the navigable sections plus the metadata the
// per-section overview header renders (accent, one-line description, and a short
// "what's in here" highlight strip). Kept in its own module so the shell nav and
// the SettingsOverview header share one source of truth.
//
import type { FamiliarStudioTab } from "@/lib/familiar-studio-context";

export type Section =
  | "general"
  | "daemon"
  | "familiars"
  | "mobile"
  | "appearance"
  | "about";

export type SectionMeta = { id: Section; label: string; icon: string; description: string; accent: string };

// `familiarTab` marks an entry that lives inside the Familiars studio panel —
// picking it activates that studio tab instead of scrolling to a SettingsGroup.
export type SettingsIndexEntry = {
  section: Section;
  group?: string;
  keywords: string;
  familiarTab?: FamiliarStudioTab;
};

export const SECTIONS: SectionMeta[] = [
  { id: "general", label: "General", icon: "ph:sliders-horizontal", description: "Workspace, startup, and app-wide defaults.", accent: "#9a8ecd" },
  { id: "daemon", label: "Daemon", icon: "ph:terminal-window", description: "Local runtime status and process controls.", accent: "#69d6a6" },
  { id: "familiars", label: "Familiars", icon: "ph:users-three", description: "Roster, identity, permissions, and pin order.", accent: "#d8a9ff" },
  { id: "mobile", label: "Phone", icon: "ph:device-mobile", description: "Native iOS handoff over your Tailscale network.", accent: "#73d9d0" },
  { id: "appearance", label: "Appearance", icon: "ph:paint-brush", description: "Theme, typography, and reading controls.", accent: "#ff9fb5" },
  { id: "about", label: "About", icon: "ph:info", description: "Version, updates, and project links.", accent: "#b8d8ff" },
];

export const SECTION_HIGHLIGHTS: Record<Section, string[]> = {
  general: ["Workspace path", "Launch behavior", "Default start view"],
  daemon: ["Runtime health", "Local/hub routing", "Socket & version"],
  familiars: ["Roster & identity", "Per-familiar permissions", "Pinned strip order"],
  mobile: ["Mobile mode", "Tailscale handoff", "Native iOS guide"],
  appearance: ["Theme & colors", "Typography", "Reading comfort"],
  about: ["App version", "Tool updates", "Project links"],
};

export const SETTINGS_INDEX: SettingsIndexEntry[] = [
  { section: "general", group: "Workspace", keywords: "workspace directory root folder project path" },
  { section: "general", group: "Home", keywords: "news headlines rss carousel media home digest daily summary" },
  { section: "general", group: "Startup", keywords: "startup launch autostart open boot" },
  { section: "daemon", group: "Status", keywords: "daemon status running start stop restart hub server executor private network tailscale" },
  { section: "daemon", group: "Connection", keywords: "daemon hub server executor private network tailscale remote multihost multi host" },
  { section: "daemon", group: "Info", keywords: "daemon info version socket pid api" },
  { section: "familiars", keywords: "familiars agents personas roster" },
  { section: "familiars", group: "Identity", familiarTab: "identity", keywords: "identity name role pronouns description rename" },
  { section: "familiars", group: "Look", familiarTab: "look", keywords: "look avatar image photo upload icon glyph color accent swatch palette" },
  { section: "familiars", group: "Brain", familiarTab: "brain", keywords: "brain runtime harness model voice system prompt note capabilities" },
  { section: "familiars", group: "Lifecycle", familiarTab: "lifecycle", keywords: "lifecycle archive unarchive reorder roster order reset overrides" },
  { section: "familiars", group: "Memory", familiarTab: "memory", keywords: "memory memories daily notes recall" },
  { section: "familiars", group: "Projects", familiarTab: "projects", keywords: "projects access grants allow deny tool policy guard security audit requests permissions" },
  { section: "familiars", group: "Vault", familiarTab: "vault", keywords: "vault secrets env environment keys tokens credentials 1password" },
  { section: "mobile", group: "Steps", keywords: "phone mobile connect qr pair tailscale" },
  { section: "mobile", group: "Why there’s no password", keywords: "password security auth login" },
  { section: "mobile", group: "Get the app", keywords: "app download ios testflight install" },
  { section: "appearance", group: "Mode", keywords: "mode dark light system appearance scheme" },
  { section: "appearance", group: "Theme", keywords: "theme color palette swatch preset" },
  { section: "appearance", group: "Theme tokens", keywords: "theme tokens colors hex custom background accent border" },
  { section: "appearance", group: "Import from tweakcn", keywords: "import tweakcn css variables theme" },
  { section: "appearance", group: "Familiar switcher", keywords: "familiar switcher style strip scope" },
  { section: "appearance", group: "Corners", keywords: "corners radius rounded sharp square" },
  { section: "appearance", group: "Reading text", keywords: "font typeface family size reading text density relative time chat" },
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
