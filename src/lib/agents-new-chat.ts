import type { InitialCommandControls } from "@/lib/command-controls";
import type { SessionOrigin } from "@/lib/types";

export const AGENTS_NEW_CHAT_EVENT = "cave:agents-new-chat";
export const PENDING_AGENTS_NEW_CHAT_KEY = "cave:pending-agents-new-chat";

export type AgentsNewChatRequest = {
  familiarId?: string | null;
  projectRoot?: string | null;
  /** Auto-sent by the chat surface once the new thread mounts. */
  initialPrompt?: string | null;
  initialControls?: InitialCommandControls | null;
  origin?: SessionOrigin;
};

/**
 * Launch a new familiar chat from anywhere in the app.
 *
 * On the main workspace page (`/`) this dispatches `cave:agents-new-chat`,
 * which Workspace/ChatSurface already handle. On standalone routes (e.g. the
 * familiar analytics pages under /familiars and /dashboard) no workspace
 * listeners are mounted, so a plain dispatch is a silent no-op — instead the
 * request is persisted to sessionStorage and the browser navigates to `/`,
 * where Workspace consumes it at boot (same handoff shape as open-external.ts).
 */
export function requestAgentsNewChat(detail: AgentsNewChatRequest): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/") {
    window.dispatchEvent(new CustomEvent(AGENTS_NEW_CHAT_EVENT, { detail }));
    return;
  }
  try {
    window.sessionStorage.setItem(PENDING_AGENTS_NEW_CHAT_KEY, JSON.stringify(detail));
  } catch {
    // Storage denied/full — still navigate; the chat opens unprimed.
  }
  window.location.assign("/");
}

/** Read-and-clear the pending cross-page request. Called by Workspace on boot. */
export function consumePendingAgentsNewChat(): AgentsNewChatRequest | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(PENDING_AGENTS_NEW_CHAT_KEY);
    if (raw !== null) window.sessionStorage.removeItem(PENDING_AGENTS_NEW_CHAT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as AgentsNewChatRequest;
  } catch {
    return null;
  }
}
