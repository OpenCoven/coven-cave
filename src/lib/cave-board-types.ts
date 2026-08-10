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

/**
 * What a task can be waiting on. Only `task` forms a graph edge — every other
 * kind is a terminal blocker, so an unreachable service or an unanswered human
 * can never put a card in a dependency cycle.
 */
export type TaskDependencyKind =
  | "task"
  | "github"
  | "human"
  | "credential"
  | "service"
  | "execution"
  | "external";

export type TaskDependencyState = "unresolved" | "resolved" | "waived";

/** Who wrote a record. Automation may rewrite `enhance`/`system`, never `human`. */
export type TaskRecordOrigin = "human" | "enhance" | "system";

/**
 * One unresolved thing holding a task. Typed so a reader can tell a
 * waiting-on-a-merge from a waiting-on-a-teammate without opening the card.
 */
export type TaskDependency = {
  /** Stable id, generated once, never reused. Referenced by `primaryBlockerId`. */
  id: string;
  kind: TaskDependencyKind;
  /** Imperative sentence: "Merge PR #4201". This is what a human reads at 2am. */
  label: string;
  /** Set only when kind is "task". Must name a live card. */
  taskId?: string | null;
  /** Stable external identity: "OpenCoven/coven-cave#4201", "svc:tailscale". */
  ref?: string | null;
  url?: string | null;
  state: TaskDependencyState;
  origin: TaskRecordOrigin;
  createdAt: string;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  /** Required to leave `unresolved`: what proves it. */
  evidence?: string | null;
};

/**
 * The next concrete action, structured rather than prose so an orchestrator can
 * route it without a human interpreting it first.
 */
export type TaskNextStep = {
  /** One imperative action, no conjunctions: "Rerun the failed e2e job". */
  summary: string;
  actorFamiliarId?: string | null;
  /** Named capability, skill, or tool the actor uses. */
  capability?: string | null;
  /** Repo, path, URL, project, or session the action lands on. */
  target?: string | null;
  inputs?: string[];
  /** True routes the step through the human gate and blocks auto-dispatch. */
  requiresApproval: boolean;
  origin: TaskRecordOrigin;
  updatedAt: string;
};

/** Derived on read from dependencies + primary blocker + next step. Never stored. */
export type TaskReadiness = "ready" | "waiting" | "incomplete" | "cyclic";

/** Machine-readable so the inspector can point at the offending field. */
export type OrchestrationErrorCode =
  | "blocked_requires_dependency"
  | "blocked_requires_primary"
  | "blocked_requires_next_step"
  | "dependency_cycle"
  | "dependency_dangling"
  | "dependency_needs_evidence"
  | "dependency_invalid"
  | "primary_blocker_invalid"
  | "next_step_invalid"
  | "dependency_authorship"
  | "next_step_authorship";

export type OrchestrationError = {
  code: OrchestrationErrorCode;
  /** Card field the error belongs to, for inspector focus. */
  field: "dependencies" | "primaryBlockerId" | "nextStep";
  message: string;
  /** The dependency at fault, when the error is about one. */
  dependencyId?: string;
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

/**
 * An explicit link from a Board card to the Bead it mirrors.
 *
 * The project id rides the reference even though the card already has a
 * `projectId`: a task's execution project may be repointed later, and that must
 * never silently repoint its delivery link at another repository.
 *
 * Shape deliberately matches the `cave-tjact` delivery-accounting design so the
 * two efforts converge rather than fork — see that spec's "Board data model".
 * Nothing infers a link: no title, note, label, PR or issue reference is read as
 * one. A link exists only because someone set it.
 */
export type CardBeadRef = {
  id: string;
  projectId: string;
};

export type Card = {
  id: string;
  title: string;
  notes: string;
  status: CardStatus;
  priority: CardPriority;
  familiarId: string | null;
  /** A model selected for this task's next work session. Null inherits the familiar binding. */
  modelOverride?: string | null;
  /** Canonical harness that supplied modelOverride. An override only applies to this runtime. */
  modelOverrideHarness?: string | null;
  sessionId: string | null;
  cwd: string | null;
  /** Stable project ID from cave-projects.json. Preferred over cwd. */
  projectId?: string | null;
  /**
   * The Bead this card mirrors, when one was explicitly linked. Its presence is
   * what makes the card a durable reference target, so routine Board cleanup
   * refuses to delete it (see `deleteCard`) — a linked mirror must be unlinked
   * deliberately before it can go.
   */
  beadRef?: CardBeadRef | null;
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
  /**
   * Everything unresolved holding this task. Array order is priority order and
   * is operator-editable — promotion walks it when the primary blocker clears.
   * Canonical: this is what Chart Room and every orchestrator read.
   */
  dependencies?: TaskDependency[];
  /** The one unresolved dependency answering "what is actually holding this?". */
  primaryBlockerId?: string | null;
  /** Freezes the operator's choice so promotion never moves it. */
  primaryBlockerPinned?: boolean;
  nextStep?: TaskNextStep | null;
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
