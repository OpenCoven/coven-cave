export type AutomationStatus = "ACTIVE" | "PAUSED";

export type CodexAutomation = {
  id: string;
  name: string;
  kind: string;
  status: AutomationStatus;
  rrule: string | null;
  model: string | null;
  reasoningEffort: string | null;
  executionEnvironment: string | null;
  cwds: string[];
  tags: string[];
  prompt: string;
  skillPath: string | null;
  scheduleHuman: string;
};

export type CodexAutomationRecord = CodexAutomation & {
  tomlPath: string;
};

export type CodexAutomationPatch = {
  name?: string;
  prompt?: string;
  status?: AutomationStatus;
  rrule?: string;
  model?: string;
  reasoning_effort?: string;
  execution_environment?: string;
  cwds?: string[];
  tags?: string[];
  skill_path?: string;
};
