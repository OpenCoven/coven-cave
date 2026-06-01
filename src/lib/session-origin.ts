import type { SessionOrigin, SessionRow } from "@/lib/types";
import type { IconName } from "@/lib/icon";

export const SESSION_ORIGINS: readonly SessionOrigin[] = [
  "chat",
  "mention",
  "board",
  "cron",
  "heartbeat",
  "call",
] as const;

export const ORIGIN_LABEL: Record<SessionOrigin, string> = {
  chat: "chat",
  mention: "mention",
  board: "board",
  cron: "cron",
  heartbeat: "heartbeat",
  call: "call",
};

export const ORIGIN_ICON: Record<SessionOrigin, IconName> = {
  chat: "ph:chat-circle-dots-fill",
  mention: "ph:at",
  board: "ph:kanban",
  cron: "ph:alarm-fill",
  heartbeat: "ph:heartbeat",
  call: "ph:magic-wand-fill",
};

/**
 * Best-effort origin inference for an existing daemon session that has no
 * explicit `origin` metadata. The daemon doesn't yet record provenance, so
 * Cave guesses from harness name + title conventions and defaults to `chat`
 * (the overwhelmingly common case). When the daemon gains an origin field
 * this stays as a fallback only.
 *
 * Pure function so it stays trivially testable.
 */
export function inferOrigin(
  s: Pick<SessionRow, "harness" | "title">,
): SessionOrigin {
  const h = (s.harness ?? "").toLowerCase();
  if (h === "cron" || h.startsWith("cron:")) return "cron";
  if (h === "heartbeat" || h.startsWith("heartbeat:")) return "heartbeat";

  const title = (s.title ?? "").trim();
  const lower = title.toLowerCase();
  if (lower.startsWith("[cron]")) return "cron";
  if (lower.startsWith("[heartbeat]")) return "heartbeat";
  if (lower.startsWith("[board]") || lower.startsWith("board:")) return "board";
  if (lower.startsWith("[call]") || / from [a-z]+$/i.test(title)) return "call";
  if (title.startsWith("@")) return "mention";

  return "chat";
}
