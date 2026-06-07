export type CardStatus = "backlog" | "inbox" | "running" | "review" | "blocked" | "done";
export type CardPriority = "low" | "medium" | "high" | "urgent";
export type CardLifecycle =
  | "queued"
  | "dispatched"
  | "running"
  | "review"
  | "completed"
  | "failed"
  | "cancelled";

export type CardStep = {
  id: string;        // nanoid — stable across edits
  text: string;      // what needs to be done
  done: boolean;     // completed?
  addedAt: string;   // ISO timestamp when step was created
  doneAt?: string;   // ISO timestamp when step was checked off
};

export type CardGitHubKind = "repo" | "issue" | "pr" | "discussion" | "review_request" | "notification";

export type CardGitHubLink = {
  id: string;
  kind: CardGitHubKind;
  repo: string;
  number?: number;
  title: string;
  url: string;
  state?: string;
  labels: string[];
  source?: "library" | "assigned" | "manual" | "legacy-link";
  savedAt?: string;
  updatedAt?: string;
};

export type Card = {
  id: string;
  title: string;
  notes: string;
  status: CardStatus;
  priority: CardPriority;
  familiarId: string | null;
  sessionId: string | null;
  cwd: string | null;
  links: string[];
  github: CardGitHubLink[];
  labels: string[];
  template?: string | null;
  createdAt: string;
  updatedAt: string;
  lifecycle: CardLifecycle;
  lifecycleAt: string;
  lifecycleReason?: string;
  needsHuman?: boolean;
  timeoutMs?: number;
  runningSince?: string;
  retryCount: number;
  maxRetries: number;
  steps: CardStep[];
};

export const STATUSES: CardStatus[] = ["backlog", "inbox", "running", "review", "blocked", "done"];
export const PRIORITIES: CardPriority[] = ["urgent", "high", "medium", "low"];
export const LIFECYCLES: CardLifecycle[] = [
  "queued",
  "dispatched",
  "running",
  "review",
  "completed",
  "failed",
  "cancelled",
];

export const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2h
export const DEFAULT_MAX_RETRIES = 2;
