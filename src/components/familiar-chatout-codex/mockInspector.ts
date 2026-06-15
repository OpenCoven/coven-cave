import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

export type EnvironmentInspectorData = {
  changes: number;
  branch: string;
  commitState: string;
};

export type SubagentStatus = "active" | "idle" | "done";

export type SubagentData = {
  id: string;
  name: string;
  status: SubagentStatus;
  familiar: ResolvedFamiliar;
};

export type SourceData = {
  id: string;
  title: string;
  time: string;
};

function familiar(id: string, displayName: string, icon: string): ResolvedFamiliar {
  return {
    id,
    name: displayName.toLowerCase(),
    display_name: displayName,
    role: "Familiar",
    color: "#A78BFA",
    archived: false,
    glyph: { kind: "icon", name: icon },
  };
}

export const mockEnvironment: EnvironmentInspectorData = {
  changes: 9,
  branch: "feat/familiar-chatout-codex",
  commitState: "Push pending",
};

export const mockSubagents: SubagentData[] = [
  { id: "cody", name: "Cody", status: "active", familiar: familiar("cody", "Cody", "ph:robot") },
  { id: "kitty", name: "Kitty", status: "done", familiar: familiar("kitty", "Kitty", "ph:cat") },
  { id: "sage", name: "Sage", status: "idle", familiar: familiar("sage", "Sage", "ph:book-open") },
  { id: "echo", name: "Echo", status: "done", familiar: familiar("echo", "Echo", "ph:chats") },
  { id: "astra", name: "Astra", status: "idle", familiar: familiar("astra", "Astra", "ph:sparkle") },
];

export const mockSources: SourceData[] = [];
