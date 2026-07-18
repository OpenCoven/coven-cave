import type { ChatAttachment } from "@/lib/chat-attachments";

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
  startDate?: string | null; // YYYY-MM-DD — schedules the step on the Gantt (group-by-task)
  endDate?: string | null;   // YYYY-MM-DD
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
  source?: "assigned" | "manual" | "legacy-link";
  savedAt?: string;
  updatedAt?: string;
};

export type CardAsanaKind = "task" | "subtask" | "project";

/**
 * A structured connection between a board card and an Asana object, mirroring
 * {@link CardGitHubLink}. Populated when a user attaches an assigned Asana task
 * from the inspector, pastes an app.asana.com URL into a card's links (backfilled
 * server-side), or a familiar working through the Asana MCP files the task here.
 * `url` is the Asana permalink; `gid` is Asana's stable object id.
 */
export type CardAsanaLink = {
  id: string;
  kind: CardAsanaKind;
  gid: string;
  title: string;
  url: string;
  projectGid?: string;
  projectName?: string;
  /** Assignee display name/email, when known from the assigned-tasks fetch. */
  assignee?: string;
  completed?: boolean;
  /** Due date as YYYY-MM-DD, when the task carries one. */
  dueOn?: string | null;
  source?: "assigned" | "manual" | "legacy-link";
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
  /** Stable project ID from cave-projects.json. Preferred over cwd. */
  projectId?: string | null;
  links: string[];
  github: CardGitHubLink[];
  asana: CardAsanaLink[];
  labels: string[];
  startDate?: string | null;
  endDate?: string | null;
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
  /** Files carried in from the composer when the card was created. Stored lean:
   * metadata + inlined text, but image `dataUrl`/`mimeType` are stripped so the
   * board JSON doesn't bloat with base64 payloads. Absent when none were staged. */
  attachments?: ChatAttachment[];
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
