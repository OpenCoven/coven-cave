import type { SessionRow } from "@/lib/types";

// Cap nested chats per project card so a busy project doesn't bury the others;
// a "Show all" toggle expands the rest.
export const CHAT_CAP = 8;

export function chatDotClass(status: string): string {
  if (status === "running") return "bg-[var(--accent-presence)]";
  if (status === "failed" || status === "error") return "bg-[var(--color-danger)]";
  if (status === "recent") return "bg-[var(--color-success)]";
  return "bg-[var(--text-muted)]";
}


/** Most-recent activity across a project's sessions (epoch ms; 0 when empty). */
export function lastActiveMs(chats: SessionRow[]): number {
  let max = 0;
  for (const s of chats) {
    const t = new Date(s.updated_at).getTime();
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max;
}

/** Collapse $HOME to ~ and left-truncate long paths to "first/…/repo" so the
 *  identical absolute prefix stops dominating each row. Full path stays in the
 *  title attribute (and the inline editor still edits the real root). */
export function shortRoot(p: string): string {
  const home = p.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
  const isAbs = home.startsWith("/");
  const parts = home.split("/").filter(Boolean);
  if (parts.length <= 2) return home;
  return `${isAbs ? "/" : ""}${parts[0]}/…/${parts[parts.length - 1]}`;
}

export function openSessionById(sessionId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("cave:agents-open-session", { detail: { sessionId } }));
}

/** A project a chat can be moved into (from the row's context menu). root is normalized. */
export type MoveTarget = { id: string; name: string; root: string };
