/** Window event that asks the chat surface to select its Projects tab. */
export const CHAT_OPEN_PROJECTS_EVENT = "cave:chat-open-projects";

/** Window event that asks the Projects tab to expand and scroll a specific
 *  project into view. `detail.root` is the project's (un-normalized) root. */
export const CHAT_FOCUS_PROJECT_EVENT = "cave:chat-focus-project";

/** Window event that asks the chat surface to select its Group Chat (coven) tab.
 *  Dispatched by the Workspace when the retired standalone `groupchat` mode is
 *  requested (nav/deep link) so it lands on the in-chat tab instead of a page. */
export const CHAT_OPEN_COVEN_EVENT = "cave:chat-open-coven";

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
