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

/** Preset tile tints — the same oklch recipe projectTint() hashes into, at
 *  fixed hues, so a hand-picked color sits naturally next to auto-tinted
 *  tiles. Stored verbatim in CaveProject.color. */
export const PROJECT_COLOR_SWATCHES: { name: string; value: string }[] = [
  { name: "Clay", value: "oklch(0.74 0.12 25)" },
  { name: "Amber", value: "oklch(0.74 0.12 70)" },
  { name: "Fern", value: "oklch(0.74 0.12 145)" },
  { name: "Teal", value: "oklch(0.74 0.12 200)" },
  { name: "Sky", value: "oklch(0.74 0.12 250)" },
  { name: "Violet", value: "oklch(0.74 0.12 300)" },
  { name: "Rose", value: "oklch(0.74 0.12 340)" },
];

/** True when the desktop shell's native bridge is reachable (Tauri webview). */
export function hasDesktopBridge(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Open the project folder in the OS file manager (Finder/Explorer/xdg-open).
 *  Desktop shell only — resolves false in a plain browser so callers can hide
 *  or fall back. Uses the app's `shell_open_path` command (absolute,
 *  must-exist paths enforced on the Rust side). */
export async function revealProjectFolder(root: string): Promise<boolean> {
  if (!hasDesktopBridge()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("shell_open_path", { path: root });
    return true;
  } catch {
    return false;
  }
}
