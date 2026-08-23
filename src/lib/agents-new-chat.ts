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

const SESSION_ORIGINS: ReadonlySet<SessionOrigin> = new Set([
  "chat",
  "mention",
  "board",
  "cron",
  "heartbeat",
  "call",
  "canvas",
  "journal",
  "enhance",
]);

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isInitialCommandControls(value: unknown): value is InitialCommandControls {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const controls = value as Record<string, unknown>;
  return (
    (controls.thinkingEffort === undefined
      || controls.thinkingEffort === "low"
      || controls.thinkingEffort === "medium"
      || controls.thinkingEffort === "high")
    && (controls.responseSpeed === undefined
      || controls.responseSpeed === "fast"
      || controls.responseSpeed === "balanced"
      || controls.responseSpeed === "careful")
    && (controls.runtimeHost === undefined || typeof controls.runtimeHost === "string")
    && (controls.modelOverride === undefined || typeof controls.modelOverride === "string")
    && (controls.modelOverrideScope === undefined
      || controls.modelOverrideScope === "next-message"
      || controls.modelOverrideScope === "session"
      || controls.modelOverrideScope === "runtime-default")
  );
}

function isAgentsNewChatRequest(value: unknown): value is AgentsNewChatRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return (
    (request.familiarId === undefined || isNullableString(request.familiarId))
    && (request.projectRoot === undefined || isNullableString(request.projectRoot))
    && (request.initialPrompt === undefined || isNullableString(request.initialPrompt))
    && (request.initialControls === undefined
      || request.initialControls === null
      || isInitialCommandControls(request.initialControls))
    && (request.origin === undefined
      || (typeof request.origin === "string" && SESSION_ORIGINS.has(request.origin as SessionOrigin)))
  );
}

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

/** Read a pending cross-page request without discarding a launch that must wait. */
export function readPendingAgentsNewChat(): AgentsNewChatRequest | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(PENDING_AGENTS_NEW_CHAT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isAgentsNewChatRequest(parsed)) {
      clearPendingAgentsNewChat();
      return null;
    }
    return parsed;
  } catch {
    clearPendingAgentsNewChat();
    return null;
  }
}

export function clearPendingAgentsNewChat(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PENDING_AGENTS_NEW_CHAT_KEY);
  } catch {
    // Storage is unavailable; there is no durable request to clear.
  }
}

/** Read-and-clear compatibility helper for consumers that can launch immediately. */
export function consumePendingAgentsNewChat(): AgentsNewChatRequest | null {
  const pending = readPendingAgentsNewChat();
  if (pending) clearPendingAgentsNewChat();
  return pending;
}
