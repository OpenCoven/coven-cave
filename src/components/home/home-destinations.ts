import type { IconName } from "@/lib/icon";

export type Destination = "chat" | "board";

export const DESTINATIONS: { id: Destination; label: string; icon: IconName }[] = [
  { id: "chat", label: "Chat", icon: "ph:chat-circle-dots" },
  { id: "board", label: "Task", icon: "ph:kanban" },
];

/**
 * Placeholder copy for the Home composer textarea.
 *
 * Task mode addresses the *selected* familiar by name so the surface never
 * hardcodes a single seed familiar (see #3962). Falls back to neutral copy
 * when no familiar is selected.
 */
export function placeholderFor(
  destination: Destination,
  familiarName: string | null,
): string {
  if (destination === "chat") return "Summon something magical";
  const who = familiarName?.trim() || "a familiar";
  return `Describe what you want ${who} to complete…`;
}
