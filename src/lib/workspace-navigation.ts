import type { IconName } from "@/lib/icon";
import type { WorkspaceMode } from "@/lib/workspace-mode";

export type WorkspaceNavMode = WorkspaceMode;

export type WorkspaceNavItem = {
  id: WorkspaceNavMode;
  label: string;
  iconName: IconName;
  kbd?: string;
  description: string;
  quiet?: boolean;
  navHidden?: boolean;
};

export const WORKSPACE_NAV_ITEMS: readonly WorkspaceNavItem[] = [
  { id: "home", label: "Home", iconName: "ph:house-bold", kbd: "⌘1", description: "Overview and quick actions" },
  { id: "chat", label: "Chat", iconName: "ph:chats", kbd: "⌘2", description: "Talk with your familiars — 1:1 or a Group tab for a whole coven" },
  { id: "board", label: "Tasks", iconName: "ph:kanban", kbd: "⌘3", description: "Track tasks across projects" },
  { id: "inbox", label: "Rituals", iconName: "ph:calendar-check", kbd: "⌘4", description: "Inbox, calendar, and scheduled jobs in one place" },
  { id: "journal", label: "Journal", iconName: "ph:book-open", description: "Your familiars' daily reflections — a tab in Memories", quiet: true, navHidden: true },
  { id: "grimoire", label: "Memories", iconName: "ph:books", description: "Edit memory, knowledge, and journal markdown as living documents", quiet: true },
  { id: "browser", label: "Browser", iconName: "ph:globe", kbd: "⌘5", description: "Built-in web browser", navHidden: true },
  { id: "salem", label: "Ask Salem", iconName: "ph:cat", description: "Ask the docs familiar — grounded answers from the Coven index and your Cave", navHidden: true },
  { id: "marketplace", label: "Marketplace", iconName: "ph:storefront-bold", description: "Browse the store and manage your familiars' crafts and skills", quiet: true },
  { id: "github", label: "GitHub", iconName: "ph:github-logo", description: "Assigned PRs, issues, and review requests across your repos", quiet: true },
];

export const VISIBLE_WORKSPACE_NAV_ITEMS = WORKSPACE_NAV_ITEMS.filter((item) => !item.navHidden);

export const PRIMARY_WORKSPACE_NAV_ITEMS = VISIBLE_WORKSPACE_NAV_ITEMS.filter((item) => !item.quiet);
