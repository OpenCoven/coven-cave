// ── GitHub item context (for attaching to board / chat / familiar) ───────────

import type { CardGitHubLink } from "@/lib/cave-board-types";
import {
  mergeLinksWithGitHub,
  mergeTaskGitHubLinks,
  taskGitHubLinkFromGitHubItem,
  taskGitHubLinkFromUrl,
} from "@/lib/task-github";

export type GitHubItem = {
  kind: "pr" | "issue" | "review_request" | "notification";
  id: string;
  title: string;
  repo: string;
  number?: number;
  url: string;
  state?: string;
  updatedAt: string;
  draft?: boolean;
  labels?: string[];
  /** CI rollup for PR rows; only "failing" is surfaced in the UI. See
   *  {@link import("./github-checks").summarizeChecks}. */
  checkStatus?: "passing" | "failing" | "pending" | null;
};

export type GitHubItemContext = {
  title: string;
  url: string;
  repo: string;
  number?: number;
  kind: GitHubItem["kind"];
  body?: string;
};

export function itemToContext(item: GitHubItem): GitHubItemContext {
  return {
    title: item.title,
    url: item.url,
    repo: item.repo,
    number: item.number,
    kind: item.kind,
  };
}

export async function createBoardCardFromGitHubItem(
  item: GitHubItem,
  familiarId: string | null,
): Promise<{ ok: boolean; cardId?: string; error?: string }> {
  const ctx = itemToContext(item);
  const kindLabel: Record<GitHubItem["kind"], string> = {
    pr: "PR",
    issue: "Issue",
    review_request: "Review Request",
    notification: "Notification",
  };
  const label = kindLabel[item.kind];
  const numberSuffix = item.number != null ? ` #${item.number}` : "";
  const title = `[${label}${numberSuffix}] ${item.title}`;
  const notes = `Repo: ${ctx.repo}\nURL: ${ctx.url}`;

  try {
    const res = await fetch("/api/board", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        notes,
        familiarId,
        links: [item.url],
        github: [taskGitHubLinkFromGitHubItem(item)],
        status: "inbox" as const,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, cardId: data.card?.id as string | undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}

export async function attachGitHubItemToCard(
  cardId: string,
  item: GitHubItem | string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const githubLink = typeof item === "string"
      ? taskGitHubLinkFromUrl(item)
      : taskGitHubLinkFromGitHubItem(item);
    const url = typeof item === "string" ? item : item.url;
    // Fetch existing card first to merge links
    const getRes = await fetch("/api/board");
    const getData = await getRes.json().catch(() => null);
    const cards: Array<{ id: string; links?: string[]; github?: CardGitHubLink[] }> = getData?.cards ?? [];
    const existing = cards.find((c) => c.id === cardId);
    const existingLinks: string[] = existing?.links ?? [];
    const existingGitHub: CardGitHubLink[] = existing?.github ?? [];
    const github = githubLink
      ? mergeTaskGitHubLinks(
          existingGitHub,
          typeof item === "string" ? githubLink : taskGitHubLinkFromGitHubItem(item),
        )
      : existingGitHub;
    const mergedLinks = mergeLinksWithGitHub([...new Set([...existingLinks, url])], github);

    const res = await fetch(`/api/board/${cardId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ links: mergedLinks, github }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}

// ── GitHub task types (pre-existing) ─────────────────────────────────────────

export type GitHubTaskStatus = "running" | "review" | "done" | "failed";

export type GitHubTask = {
  id: string;
  repo: string;
  issueNumber: number;
  issueTitle: string;
  branch?: string;
  prNumber?: number;
  prUrl?: string;
  status: GitHubTaskStatus;
  familiarId: string;
  familiarName: string;
  sessionId?: string;
  updatedAt: string;
  checkRunUrl?: string;
};

export type GitHubTasksResult = {
  ok: true;
  tasks: GitHubTask[];
};

type WireTask = Record<string, unknown>;

export async function loadGitHubTasks(): Promise<GitHubTasksResult> {
  const res = await fetch("/api/github/tasks", { cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.ok === false) {
    throw new Error(
      (data && typeof data.error === "string" && data.error) ||
        `GitHub tasks unavailable (${res.status})`,
    );
  }

  return { ok: true, tasks: normalizeGitHubTasks(data) };
}

export function normalizeGitHubTasks(data: unknown): GitHubTask[] {
  const rawTasks = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.tasks)
      ? data.tasks
      : [];

  return rawTasks
    .map((task) => normalizeGitHubTask(task))
    .filter((task): task is GitHubTask => task !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function normalizeGitHubTask(input: unknown): GitHubTask | null {
  if (!isRecord(input)) return null;
  const id = stringField(input, "id");
  const repo = stringField(input, "repo") ?? fullRepo(input);
  const issueNumber = numberField(input, "issueNumber") ?? numberField(input, "issue_number");
  const issueTitle =
    stringField(input, "issueTitle") ??
    stringField(input, "issue_title") ??
    stringField(input, "title");
  const status = normalizeStatus(stringField(input, "status"));
  const familiarId = stringField(input, "familiarId") ?? stringField(input, "familiar_id") ?? "unknown";
  const familiarName =
    stringField(input, "familiarName") ??
    stringField(input, "familiar_name") ??
    familiarId;

  if (!id || !repo || issueNumber == null || !issueTitle || !status) return null;

  return {
    id,
    repo,
    issueNumber,
    issueTitle,
    branch: stringField(input, "branch"),
    prNumber: numberField(input, "prNumber") ?? numberField(input, "pr_number"),
    prUrl: stringField(input, "prUrl") ?? stringField(input, "pr_url"),
    status,
    familiarId,
    familiarName,
    sessionId: stringField(input, "sessionId") ?? stringField(input, "session_id"),
    updatedAt:
      stringField(input, "updatedAt") ??
      stringField(input, "updated_at") ??
      new Date().toISOString(),
    checkRunUrl: stringField(input, "checkRunUrl") ?? stringField(input, "check_run_url"),
  };
}

function normalizeStatus(status: string | undefined): GitHubTaskStatus | null {
  switch (status) {
    case "queued":
    case "in_progress":
    case "running":
      return "running";
    case "needs_input":
    case "review":
    case "partial":
      return "review";
    case "completed":
    case "success":
    case "done":
      return "done";
    case "cancelled":
    case "failure":
    case "failed":
      return "failed";
    default:
      return null;
  }
}

function fullRepo(input: WireTask): string | undefined {
  const owner = stringField(input, "repoOwner") ?? stringField(input, "repo_owner");
  const name = stringField(input, "repoName") ?? stringField(input, "repo_name");
  return owner && name ? `${owner}/${name}` : undefined;
}

function stringField(input: WireTask, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberField(input: WireTask, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is WireTask {
  return typeof value === "object" && value !== null;
}
