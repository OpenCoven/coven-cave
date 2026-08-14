/** Window event that asks the chat surface to select its Projects tab. */
export const CHAT_OPEN_PROJECTS_EVENT = "cave:chat-open-projects";

/** Window event that asks the Projects tab to expand and scroll a specific
 *  project into view. `detail.root` is the project's (un-normalized) root. */
export const CHAT_FOCUS_PROJECT_EVENT = "cave:chat-focus-project";

/** Window event that asks the chat surface to select its Group Chat (coven) tab.
 *  Dispatched by the Workspace when the retired standalone `groupchat` mode is
 *  requested (nav/deep link) so it lands on the in-chat tab instead of a page. */
export const CHAT_OPEN_COVEN_EVENT = "cave:chat-open-coven";

/** Window event that asks the chat surface to return to its normal Sessions tab.
 * Workspace history uses this when traversing from the Group Chat tab back to
 * the ordinary Chat destination without unmounting the surface. */
export const CHAT_OPEN_CONVERSATION_EVENT = "cave:chat-open-conversation";

/** Nested tab in Chat → Familiar → Settings for a studio handoff. */
export type FamiliarSettingsTab =
  | "chat"
  | "identity"
  | "brain"
  | "memory"
  | "projects"
  | "vault";

export type FamiliarSettingsTarget = {
  tab?: FamiliarSettingsTab;
};

const FAMILIAR_SETTINGS_TARGET_KEY = "cave:familiar-settings-target:v1";

/** Persist a one-shot nested Settings target before Chat mounts. */
export function markFamiliarSettingsPending(tab?: FamiliarSettingsTab): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      FAMILIAR_SETTINGS_TARGET_KEY,
      JSON.stringify(tab ? { tab } satisfies FamiliarSettingsTarget : {}),
    );
  } catch {
    /* storage may be unavailable */
  }
}

/** Consume the pending nested Settings target exactly once. */
export function consumeFamiliarSettingsPending(): FamiliarSettingsTarget | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(FAMILIAR_SETTINGS_TARGET_KEY);
    if (!raw) return null;
    window.localStorage.removeItem(FAMILIAR_SETTINGS_TARGET_KEY);
    const parsed = JSON.parse(raw) as FamiliarSettingsTarget;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return null;
  }
}

// A retained latch backing CHAT_OPEN_COVEN_EVENT. When the legacy `groupchat`
// mode is requested from a DIFFERENT surface, ChatSurface mounts fresh — and a
// fire-and-forget event can race its listener subscription. The Workspace sets
// this flag synchronously (before the mode flips), so a just-mounting
// ChatSurface can consume it on mount and open the Group tab deterministically.
// The event still covers the already-mounted case.
let covenTabPending = false;
export function markCovenTabPending(): void {
  covenTabPending = true;
}
export function consumeCovenTabPending(): boolean {
  const pending = covenTabPending;
  covenTabPending = false;
  return pending;
}

// Which coven to select once the tab opens. Promoting a solo chat (cave-9xadi)
// creates a group and then hands off to the coven surface, which otherwise
// mounts with no active group and would drop you on the empty state — next to
// the coven you just made. Same latch discipline as covenTabPending: set
// synchronously before the mode flips, consumed once by whoever mounts.
let pendingCovenGroupId: string | null = null;
export function markCovenGroupPending(groupId: string): void {
  pendingCovenGroupId = groupId.trim() || null;
}
export function consumeCovenGroupPending(): string | null {
  const pending = pendingCovenGroupId;
  pendingCovenGroupId = null;
  return pending;
}

// Same latch for the Skills tab (familiar scope): the composer "+" menu's
// "Manage skills" lives on surfaces (Home) where ChatSurface may not be
// mounted yet, so the mode flip + fire-and-forget event can race its listener.
let skillsTabPending = false;
export function markSkillsTabPending(): void {
  skillsTabPending = true;
}
export function consumeSkillsTabPending(): boolean {
  const pending = skillsTabPending;
  skillsTabPending = false;
  return pending;
}

/** Window event that asks the chat surface to select its Skills tab (the
 *  `familiar` scope). Paired with the retained latch above for fresh mounts. */
export const CHAT_OPEN_SKILLS_EVENT = "cave:chat-open-skills";

// Same latch for the Projects tab: board→Projects handoffs (board-inspector,
// ⌘9, /projects) dispatched CHAT_OPEN_PROJECTS_EVENT on a 0ms timeout while
// ChatSurface — the only listener — was still mounting; a lost race landed on
// Chat without the Projects tab (cave-c2zf).
let projectsTabPending = false;
export function markProjectsTabPending(): void {
  projectsTabPending = true;
}
export function consumeProjectsTabPending(): boolean {
  const pending = projectsTabPending;
  projectsTabPending = false;
  return pending;
}
