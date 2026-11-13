import { filterVisibleChatSessions } from "./chat-projects.ts";
import { attentionLifecycle } from "./session-lifecycle.ts";
import type { SessionRow } from "./types.ts";

/**
 * The detached Chat window: the right Chat panel popped out of the main
 * window into a window of its own (`/quick-chat?view=window`).
 *
 * This module is the hand-off between the two windows and nothing else. The
 * main window calls {@link openChatWindow}; the detached window reads where to
 * land from its URL ({@link readChatWindowTarget}) and, while it is already
 * running, from a DOM event ({@link chatWindowTargetFromEvent}). There is no
 * shared state after that: each window keeps its own selection.
 */

/** Fired on the detached window when a later pop-out names a new target. The
 *  desktop shell dispatches it (show_chat_window_from_main in
 *  src-tauri/src/window_geometry.rs); in a browser the opener does. */
export const CHAT_WINDOW_TARGET_EVENT = "cave:chat-window-target";

/** Browser window name, so a second pop-out reuses the first popup. */
export const CHAT_WINDOW_NAME = "cave-chat-window";

/** The familiar the detached window last showed. Its own key: the main
 *  window's active familiar is deliberately never read here. */
export const CHAT_WINDOW_FAMILIAR_KEY = "cave:chat-window:familiar:v1";

/** Whether the conversation list is collapsed at widths where it can dock. */
export const CHAT_WINDOW_LIST_COLLAPSED_KEY = "cave:chat-window:list-collapsed:v1";

/** Per-familiar composer drafts of the detached window, separate from the
 *  in-app panel's so the two never overwrite each other. */
export const CHAT_WINDOW_DRAFT_KEY_PREFIX = "cave:chat-window-composer-draft:v1:";

const CHAT_WINDOW_ID_MAX_LENGTH = 200;
// Mirrors chat_window_id in window_geometry.rs: ids are short opaque tokens.
const CHAT_WINDOW_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

export type ChatWindowTarget = {
  familiarId: string | null;
  sessionId: string | null;
};

export const EMPTY_CHAT_WINDOW_TARGET: ChatWindowTarget = { familiarId: null, sessionId: null };

function chatWindowId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id || id.length > CHAT_WINDOW_ID_MAX_LENGTH || !CHAT_WINDOW_ID_PATTERN.test(id)) return null;
  return id;
}

/** Reduce any input to a target of plain, bounded ids. */
export function normalizeChatWindowTarget(input: unknown): ChatWindowTarget {
  if (!input || typeof input !== "object") return EMPTY_CHAT_WINDOW_TARGET;
  const record = input as Record<string, unknown>;
  return {
    familiarId: chatWindowId(record.familiarId),
    sessionId: chatWindowId(record.sessionId),
  };
}

/** The target the detached window was opened on, from its own URL. */
export function readChatWindowTarget(search: string): ChatWindowTarget {
  const params = new URLSearchParams(search);
  return normalizeChatWindowTarget({
    familiarId: params.get("familiar"),
    sessionId: params.get("session"),
  });
}

/** A later pop-out's target, or null when the event carries nothing usable. */
export function chatWindowTargetFromEvent(event: Event): ChatWindowTarget | null {
  const target = normalizeChatWindowTarget((event as CustomEvent<unknown>).detail);
  return target.familiarId || target.sessionId ? target : null;
}

/** Same-origin path of the detached window for `target`. */
export function chatWindowHref(target: ChatWindowTarget): string {
  const clean = normalizeChatWindowTarget(target);
  const params = new URLSearchParams({ view: "window" });
  if (clean.familiarId) params.set("familiar", clean.familiarId);
  if (clean.sessionId) params.set("session", clean.sessionId);
  return `/quick-chat?${params.toString()}`;
}

/** What a chat is doing that deserves a marker: a reply in progress, or an
 *  explicit request the person has not answered. */
export type ChatWindowChatState = "running" | "awaiting" | "blocked";

/**
 * A chat's marker state, or null when it needs none. "Left hanging" (a reply
 * nobody answered for a day) is deliberately not one: it is true of nearly
 * every finished chat, so marking it would light every row and every familiar
 * and say nothing. Only a familiar's explicit ask counts as needing the person.
 */
export function chatWindowChatState(session: SessionRow): ChatWindowChatState | null {
  if (session.status === "running") return "running";
  const state = session.attention?.state ?? "none";
  if (state !== "awaiting-human" && state !== "overdue-human") return null;
  return attentionLifecycle(state, session.attention?.reason ?? null);
}

export type ChatWindowActivity = {
  /** Conversations with a reply in progress. */
  running: number;
  /** Conversations where the familiar asked the person for something. */
  waiting: number;
};

/**
 * Per-familiar activity for the rail, from one unscoped session list. Counts
 * only what a chat list would show, so an archived or generated run never
 * lights a familiar's badge.
 */
export function summarizeChatWindowActivity(sessions: SessionRow[]): Map<string, ChatWindowActivity> {
  const summary = new Map<string, ChatWindowActivity>();
  for (const session of filterVisibleChatSessions(sessions, null)) {
    if (!session.familiarId) continue;
    const state = chatWindowChatState(session);
    if (!state) continue;
    const entry = summary.get(session.familiarId) ?? { running: 0, waiting: 0 };
    if (state === "running") entry.running += 1;
    else entry.waiting += 1;
    summary.set(session.familiarId, entry);
  }
  return summary;
}

/** Accessible reading of a familiar's activity; empty when it is idle. */
export function chatWindowActivityLabel(activity: ChatWindowActivity | undefined): string {
  if (!activity) return "";
  const parts: string[] = [];
  if (activity.running > 0) parts.push(activity.running === 1 ? "1 reply in progress" : `${activity.running} replies in progress`);
  if (activity.waiting > 0) parts.push(activity.waiting === 1 ? "1 chat awaiting you" : `${activity.waiting} chats awaiting you`);
  return parts.join(", ");
}

/**
 * Which familiar the window should show: a pop-out's target first, then the
 * one it showed last, then the first in the roster. Never the main window's
 * active familiar. Returns null until the roster has an entry.
 */
export function resolveChatWindowFamiliarId(
  familiarIds: readonly string[],
  preferred: readonly (string | null | undefined)[],
): string | null {
  for (const id of preferred) {
    if (id && familiarIds.includes(id)) return id;
  }
  return familiarIds[0] ?? null;
}

let browserPopup: Window | null = null;

function isTauriShell(): boolean {
  return typeof window !== "undefined" && (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;
}

/**
 * Pop the Chat panel out. Resolves true once the window is open (or already
 * was, and has been handed the target), false when it could not be opened —
 * a blocked popup, or a shell too old to know the command — so the caller can
 * leave the panel where it is.
 */
export async function openChatWindow(target: ChatWindowTarget): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const clean = normalizeChatWindowTarget(target);

  if (isTauriShell()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_chat_window", { familiarId: clean.familiarId, sessionId: clean.sessionId });
      return true;
    } catch (error) {
      console.warn("[chat-window] The desktop shell could not open the Chat window.", error);
      return false;
    }
  }

  // Browser: reuse a popup this page already opened rather than reloading it
  // onto a new URL, which would drop its live conversations.
  if (browserPopup && !browserPopup.closed) {
    try {
      const PopupEvent = (browserPopup as Window & typeof globalThis).CustomEvent;
      browserPopup.dispatchEvent(new PopupEvent(CHAT_WINDOW_TARGET_EVENT, { detail: clean }));
      browserPopup.focus();
      return true;
    } catch {
      browserPopup = null;
    }
  }
  // No `noopener`: the popup inherits this tab's sessionStorage, which is
  // where a token-gated server's access token lives.
  browserPopup = window.open(chatWindowHref(clean), CHAT_WINDOW_NAME, "popup,width=1080,height=760");
  return browserPopup !== null;
}

/**
 * Ask the main window to show a conversation. In the desktop shell this is
 * the same hand-off the tray quick chat uses. A browser has no main window to
 * address, so the conversation opens in a tab through its deep link.
 */
export async function openChatInMainWindow(target: ChatWindowTarget): Promise<void> {
  const clean = normalizeChatWindowTarget(target);
  if (!clean.sessionId) return;
  if (isTauriShell()) {
    try {
      const { emit } = await import("@tauri-apps/api/event");
      await emit("quick-chat:open-session", { sessionId: clean.sessionId, familiarId: clean.familiarId });
      return;
    } catch (error) {
      console.warn("[chat-window] Could not hand the chat to the main window.", error);
    }
  }
  window.open(`/#chat-${encodeURIComponent(clean.sessionId)}`, "_blank");
}

/**
 * Bring the main window forward, for the things that only exist there
 * (onboarding, tasks). The desktop shell focuses the main window on this
 * event whatever its payload; a browser opens the app in a tab.
 */
export async function focusMainWindow(): Promise<void> {
  if (isTauriShell()) {
    try {
      const { emit } = await import("@tauri-apps/api/event");
      await emit("quick-chat:open-session", {});
      return;
    } catch (error) {
      console.warn("[chat-window] Could not bring the main window forward.", error);
    }
  }
  window.open("/", "_blank");
}
