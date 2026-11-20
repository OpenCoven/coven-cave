/** Schedule payload shared by core clients and the optional Research engine. */
export type ResearchAutomationScheduleInput = {
  rrule: string;
  model?: string;
  reasoningEffort?: string;
  executionEnvironment?: string;
  skillPath?: string | null;
};
