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
  { id: "builder", name: "Builder", status: "active", familiar: familiar("builder", "Builder", "ph:robot") },
  { id: "operator", name: "Operator", status: "done", familiar: familiar("operator", "Operator", "ph:terminal-window") },
  { id: "researcher", name: "Researcher", status: "idle", familiar: familiar("researcher", "Researcher", "ph:book-open") },
  { id: "archivist", name: "Archivist", status: "done", familiar: familiar("archivist", "Archivist", "ph:chats") },
  { id: "strategist", name: "Strategist", status: "idle", familiar: familiar("strategist", "Strategist", "ph:sparkle") },
];

export const mockSources: SourceData[] = [];
