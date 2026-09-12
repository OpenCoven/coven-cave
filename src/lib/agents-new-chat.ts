import type { InitialCommandControls } from "@/lib/command-controls";
import type { SessionOrigin } from "@/lib/types";

export const AGENTS_NEW_CHAT_EVENT = "cave:agents-new-chat";
export const AGENTS_NEW_RIGHT_CHAT_EVENT = "cave:agents-new-right-chat";
export const AGENTS_RIGHT_CHAT_FAILED_EVENT = "cave:agents-right-chat-failed";
export const PENDING_AGENTS_NEW_CHAT_KEY = "cave:pending-agents-new-chat";

export type AgentsNewChatRequest = {
  /** Omitted for the ordinary main Chat destination. */
  destination?: "main" | "right-panel";
  /** Correlates a live handoff failure with its originating action. */
  requestId?: string;
  familiarId?: string | null;
  projectRoot?: string | null;
  /** Resolve the source thread's project without changing the workspace scope. */
  sourceSessionId?: string | null;
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
    (request.destination === undefined || request.destination === "main" || request.destination === "right-panel")
    && (request.requestId === undefined || typeof request.requestId === "string")
    && (request.familiarId === undefined || isNullableString(request.familiarId))
    && (request.projectRoot === undefined || isNullableString(request.projectRoot))
    && (request.sourceSessionId === undefined || isNullableString(request.sourceSessionId))
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
 *
 * Right-panel requests have their own acknowledged event. Standalone pages
 * stage them in a new tab instead, preserving the source page. A successful
 * result means handed off, not created/sent: Workspace still validates the
 * actor and project, and the panel reports loading and send failures.
 */
export type AgentsNewChatDispatchResult =
  | { ok: true; destination: "workspace" | "new-window" }
  | { ok: false; error: string };

export function hasIndependentRightChatProject(request: AgentsNewChatRequest): boolean {
  return request.destination === "right-panel"
    && (request.projectRoot != null || Boolean(request.sourceSessionId));
}

export async function resolveRightChatProjectRoot(request: AgentsNewChatRequest): Promise<string> {
  if (request.projectRoot) return request.projectRoot;
  if (!request.sourceSessionId || !request.familiarId) throw new Error("Choose a project for this fix thread.");
  const params = new URLSearchParams({ familiarId: request.familiarId, includeArchived: "1" });
  const response = await fetch(`/api/sessions/list?${params}`, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok || !payload.ok || !Array.isArray(payload.sessions)) {
    throw new Error("Couldn't load the source thread's project. Try again.");
  }
  const source = payload.sessions.find((session: { id?: string }) => session.id === request.sourceSessionId);
  if (
    !source
    || (source.familiarId && source.familiarId !== request.familiarId)
    || typeof source.project_root !== "string"
    || !source.project_root.trim()
  ) throw new Error("The source thread's project is unavailable. Choose a project and try again.");
  return source.project_root;
}

export function requestAgentsNewChat(detail: AgentsNewChatRequest): AgentsNewChatDispatchResult {
  if (typeof window === "undefined") return { ok: false, error: "Chat is unavailable outside the app." };
  if (detail.destination === "right-panel") {
    if (window.location.pathname === "/") {
      // A separate, acknowledged event has one owner even when main Chat is
      // mounted. Ordinary ChatSurface listeners must never consume this request.
      const event = new CustomEvent(AGENTS_NEW_RIGHT_CHAT_EVENT, { detail, cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented
        ? { ok: true, destination: "workspace" }
        : { ok: false, error: "The Chat panel is not ready. Try again." };
    }
    // Standalone analytics has no Shell. Keep its page intact, and stage the
    // handoff before loading a workspace in a separate browsing context.
    let target: Window | null = null;
    try {
      target = window.open("about:blank", "_blank");
      if (!target) return { ok: false, error: "Allow pop-ups to open the Chat panel in a new tab." };
      target.opener = null;
      target.sessionStorage.setItem(PENDING_AGENTS_NEW_CHAT_KEY, JSON.stringify(detail));
      target.location.replace("/");
      return { ok: true, destination: "new-window" };
    } catch {
      target?.close();
      return { ok: false, error: "Couldn't prepare the Chat panel. Allow session storage and try again." };
    }
  }
  if (window.location.pathname === "/") {
    window.dispatchEvent(new CustomEvent(AGENTS_NEW_CHAT_EVENT, { detail }));
    return { ok: true, destination: "workspace" };
  }
  try {
    window.sessionStorage.setItem(PENDING_AGENTS_NEW_CHAT_KEY, JSON.stringify(detail));
  } catch {
    // Storage denied/full — still navigate; the chat opens unprimed.
  }
  window.location.assign("/");
  return { ok: true, destination: "workspace" };
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


type RightChatFailure = { requestId: string; error: string };
let failureChannel: BroadcastChannel | null = null;
let failureSubscribers = 0;

function rightChatFailureChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof window.BroadcastChannel === "undefined") return null;
  failureChannel ??= new window.BroadcastChannel(AGENTS_RIGHT_CHAT_FAILED_EVENT);
  return failureChannel;
}

/** Acknowledge failed or superseded launches to the source card in any window. */
export function publishRightChatFailure(request: AgentsNewChatRequest | undefined, error: string): void {
  if (typeof window === "undefined" || request?.destination !== "right-panel" || !request.requestId) return;
  const detail: RightChatFailure = { requestId: request.requestId, error };
  window.dispatchEvent(new CustomEvent(AGENTS_RIGHT_CHAT_FAILED_EVENT, { detail }));
  rightChatFailureChannel()?.postMessage(detail);
  if (failureSubscribers === 0) {
    failureChannel?.close();
    failureChannel = null;
  }
}

export function subscribeRightChatFailures(listener: (failure: RightChatFailure) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const sourceWindow = window;
  const receive = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const detail = value as Partial<RightChatFailure>;
    if (typeof detail.requestId === "string" && typeof detail.error === "string") {
      listener({ requestId: detail.requestId, error: detail.error });
    }
  };
  const onLocal = (event: Event) => receive((event as CustomEvent<unknown>).detail);
  const onMessage = (event: MessageEvent<unknown>) => receive(event.data);
  sourceWindow.addEventListener(AGENTS_RIGHT_CHAT_FAILED_EVENT, onLocal);
  const channel = rightChatFailureChannel();
  channel?.addEventListener("message", onMessage);
  failureSubscribers++;
  return () => {
    sourceWindow.removeEventListener(AGENTS_RIGHT_CHAT_FAILED_EVENT, onLocal);
    channel?.removeEventListener("message", onMessage);
    if (--failureSubscribers === 0) {
      failureChannel?.close();
      failureChannel = null;
    }
  };
}
