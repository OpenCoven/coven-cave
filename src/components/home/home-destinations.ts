import type { IconName } from "@/lib/icon";
import { isOmnigentHostOptionId } from "@/lib/omnigent/ids";

export type Destination = "chat" | "board";

export const DESTINATIONS: { id: Destination; label: string; icon: IconName }[] = [
  { id: "chat", label: "Chat", icon: "ph:chat-circle-dots" },
  { id: "board", label: "Task", icon: "ph:kanban" },
];

export function homeSubmitLabel(destination: Destination, runtimeHost: string | null, prompt: string) {
  if (destination === "board") return "Create task";
  if (runtimeHost && prompt.trim() && isOmnigentHostOptionId(runtimeHost)) return "Start Omnigent run";
  return "Send message";
}

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
  if (destination === "chat") {
    return familiarName?.trim() ? `Message ${familiarName.trim()}…` : "Describe the work…";
  }
  const who = familiarName?.trim() || "a familiar";
  return `Describe what you want ${who} to complete…`;
}
