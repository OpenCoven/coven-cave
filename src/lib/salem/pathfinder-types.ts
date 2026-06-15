// Salem pathfinder request/response contract (design §"Salem Response Contract").
// The card shape is model-ready: v0 fills it deterministically from the registry,
// a v1 model layer can later produce the same shape behind validation.

export type SalemPathfinderMode = "setup" | "home";

export type SalemPathfinderSurface =
  | "setup"
  | "home"
  | "projects"
  | "board"
  | "library"
  | "workflows"
  | "chat";

export type SalemRuntimeState = {
  id: string;
  label: string;
  status: "healthy" | "missing" | "unhealthy";
};

export type SalemPathfinderRequest = {
  mode: SalemPathfinderMode;
  userMessage: string;
  currentSurface?: SalemPathfinderSurface;
  machineState?: {
    platform?: "macos" | "windows" | "linux" | "unknown";
    covenCli?: "healthy" | "missing" | "unhealthy" | "unknown";
    daemon?: "running" | "stopped" | "unhealthy" | "unknown";
    runtimes?: SalemRuntimeState[];
    familiarCount?: number;
  };
  caveState?: {
    activeProjectId?: string;
    activeFamiliarId?: string;
    boardCardCount?: number;
    workflowCount?: number;
  };
};

export type SalemPathfinderConfidence = "high" | "medium" | "low";

export type SalemActionKind =
  | "cave-route"
  | "copy-command"
  | "run-doctor"
  | "save-board-checklist"
  | "external-link";

export type SalemPathfinderAction = {
  kind: SalemActionKind;
  label: string;
  target?: string;
};

export type SalemPathfinderStep = {
  id: string;
  title: string;
  body: string;
  command?: string;
  status?: "ready" | "blocked" | "optional";
};

export type SalemPathfinderCard = {
  schemaVersion: "salem.pathfinder.v1";
  mode: SalemPathfinderMode;
  recommendedPathId: string;
  confidence: SalemPathfinderConfidence;
  title: string;
  summary: string;
  why: string;
  assumptions: string[];
  steps: SalemPathfinderStep[];
  links: Array<{ label: string; url: string }>;
  blockers: Array<{ label: string; suggestion: string }>;
  primaryAction: SalemPathfinderAction;
  secondaryActions: SalemPathfinderAction[];
  transcriptSummary: string;
};

export type SalemPathfinderResult = {
  pathId: string;
  confidence: SalemPathfinderConfidence;
  assumptions: string[];
};
