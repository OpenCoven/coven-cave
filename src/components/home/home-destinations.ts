import type { IconName } from "@/lib/icon";

export type Destination = "chat" | "board";

export const DESTINATIONS: { id: Destination; label: string; icon: IconName }[] = [
  { id: "chat", label: "Chat", icon: "ph:chat-circle-dots" },
  { id: "board", label: "Task", icon: "ph:kanban" },
];

export const PLACEHOLDERS: Record<Destination, string> = {
  chat: "Summon something magical",
  board: "Describe what you want Nova to complete…",
};
