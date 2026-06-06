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

export type Card = {
  id: string;
  title: string;
  notes: string;
  status: CardStatus;
  priority: CardPriority;
  familiarId: string | null;
  sessionId: string | null;
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
