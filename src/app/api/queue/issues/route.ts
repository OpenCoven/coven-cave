import { NextResponse } from "next/server.js";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { MAX_SESSION_JSON_BYTES } from "@/lib/server/session-security";
import { resolveRepoRoot } from "@/lib/server/issue-worktree-provision";
import {
  ISSUE_PRIORITY_MAX,
  ISSUE_PRIORITY_MIN,
  claimIssue,
  closeIssue,
  commentOnIssue,
  createIssue,
  issueNumberFromId,
  readIssue,
  readIssueQueue,
  setIssuePriority,
  type GhResult,
} from "@/lib/server/github-issue-queue";
import { takeQueueIssueSnapshot } from "@/lib/queue-project-readiness";

/**
 * The Queue and Work surfaces' GitHub Issues adapter (#5566).
 *   GET  ?mode=ready|blocked|show&projectRoot=…[&id=#123]
 *   POST {action: create|claim|priority|comment|close, projectRoot, …}
 * `blocked` also returns `blockers`: each open blocker named, so the gates
 * rail can say what clears a gate rather than print bare ids.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ParsedField<T> = { ok: true; value: T } | { ok: false; error: string };

async function resolveProjectRoot(projectRoot: string | null) {
  // A packaged Cave runtime has no meaningful workspace cwd, so every caller
  // must name the project rather than fall back to process.cwd().
  if (!projectRoot) return { ok: false as const, status: 400, error: "projectRoot is required" };
  return resolveRepoRoot(projectRoot);
}

function projectRootErrorResponse(root: { status: number; error: string }) {
  const error = root.error || "path not allowed";
  if (error === "path not allowed") return NextResponse.json({ ok: false, error }, { status: 403 });
  return NextResponse.json({ ok: false, error }, { status: root.status });
}

function ghFailure(result: Extract<GhResult, { ok: false }>) {
  return NextResponse.json(
    { ok: false, error: result.error, stderr: result.stderr || undefined },
    { status: result.status },
  );
}

function readOptionalString(value: unknown, field: string): ParsedField<string | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== "string") return { ok: false, error: `${field} must be a string` };
  return { ok: true, value: value.trim() };
}

function readOptionalStringArray(value: unknown, field: string): ParsedField<string[] | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return { ok: false, error: `${field} must be an array of strings` };
  }
  return { ok: true, value: [...new Set((value as string[]).map((entry) => entry.trim()).filter(Boolean))] };
}

/**
 * Priority is a band 0–4 stored as a `P<n>` label; null clears it (Unranked).
 * Anything else is refused rather than coerced: the scheduler's undo replays a
 * recorded previous value, so a coerced band would land the undo elsewhere.
 */
function readPriority(value: unknown): ParsedField<number | null> {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "number" || !Number.isInteger(value) || value < ISSUE_PRIORITY_MIN || value > ISSUE_PRIORITY_MAX) {
    return { ok: false, error: `priority must be an integer ${ISSUE_PRIORITY_MIN}-${ISSUE_PRIORITY_MAX} or null` };
  }
  return { ok: true, value };
}

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const url = new URL(req.url);
  const root = await resolveProjectRoot(url.searchParams.get("projectRoot"));
  if (!root.ok) return projectRootErrorResponse(root);

  const mode = url.searchParams.get("mode") ?? "ready";
  if (mode === "show") {
    const id = url.searchParams.get("id")?.trim() ?? "";
    const number = issueNumberFromId(id);
    if (!number) return NextResponse.json({ ok: false, error: "id must be an issue number such as #123" }, { status: 400 });
    const shown = await readIssue(root.repoRoot, number);
    if (!shown.ok) return ghFailure(shown);
    return NextResponse.json({ ok: true, mode, projectRoot: root.repoRoot, data: shown.item });
  }
  if (mode !== "ready" && mode !== "blocked") {
    return NextResponse.json({ ok: false, error: "unsupported mode" }, { status: 400 });
  }

  // Readiness has just read this queue; reuse it for the list that follows.
  const cached = mode === "ready" ? takeQueueIssueSnapshot(root.repoRoot) : null;
  const queue = cached ? { ok: true as const, snapshot: cached } : await readIssueQueue(root.repoRoot);
  if (!queue.ok) return ghFailure(queue);
  return NextResponse.json({
    ok: true,
    mode,
    projectRoot: root.repoRoot,
    repository: queue.snapshot.repository,
    data: mode === "ready" ? queue.snapshot.ready : queue.snapshot.blocked,
    ...(mode === "blocked" ? { blockers: queue.snapshot.blockers } : {}),
  });
}

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const parsed = await readJsonBody<Record<string, unknown>>(req, MAX_SESSION_JSON_BYTES);
  if (!parsed.ok) return parsed.response;

  const projectRoot = readOptionalString(parsed.body.projectRoot, "projectRoot");
  if (!projectRoot.ok) return NextResponse.json({ ok: false, error: projectRoot.error }, { status: 400 });
  const root = await resolveProjectRoot(projectRoot.value ?? null);
  if (!root.ok) return projectRootErrorResponse(root);

  const action = readOptionalString(parsed.body.action, "action");
  if (!action.ok) return NextResponse.json({ ok: false, error: action.error }, { status: 400 });

  // `create` files a new issue (from an external ticket or an unlinked PR)
  // and needs a title rather than an id.
  if (action.value === "create") {
    const title = readOptionalString(parsed.body.title, "title");
    if (!title.ok) return NextResponse.json({ ok: false, error: title.error }, { status: 400 });
    if (!title.value) return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
    const description = readOptionalString(parsed.body.description, "description");
    if (!description.ok) return NextResponse.json({ ok: false, error: description.error }, { status: 400 });
    const externalRef = readOptionalString(parsed.body.externalRef, "externalRef");
    if (!externalRef.ok) return NextResponse.json({ ok: false, error: externalRef.error }, { status: 400 });
    const labels = readOptionalStringArray(parsed.body.labels, "labels");
    if (!labels.ok) return NextResponse.json({ ok: false, error: labels.error }, { status: 400 });

    const body = [description.value, externalRef.value && !description.value?.includes(externalRef.value) ? `Source: ${externalRef.value}` : null]
      .filter(Boolean)
      .join("\n\n");
    const created = await createIssue(root.repoRoot, { title: title.value, body, labels: labels.value ?? [] });
    if (!created.ok) return ghFailure(created);
    return NextResponse.json({
      ok: true,
      action: "create",
      projectRoot: root.repoRoot,
      data: { id: `#${created.number}`, number: created.number, url: created.url },
    });
  }

  const id = readOptionalString(parsed.body.id, "id");
  if (!id.ok) return NextResponse.json({ ok: false, error: id.error }, { status: 400 });
  const number = issueNumberFromId(id.value ?? "");
  if (!number) return NextResponse.json({ ok: false, error: "id must be an issue number such as #123" }, { status: 400 });

  let result: GhResult;
  switch (action.value) {
    case "claim":
    case "priority": {
      // Both rewrite labels, so read the current set to know what to replace.
      const current = await readIssue(root.repoRoot, number);
      if (!current.ok) return ghFailure(current);
      if (action.value === "claim") {
        // Bare claim assigns the connected user; with an assignee the claim
        // also names that familiar through its `familiar:<id>` label.
        const assignee = readOptionalString(parsed.body.assignee, "assignee");
        if (!assignee.ok) return NextResponse.json({ ok: false, error: assignee.error }, { status: 400 });
        result = await claimIssue(root.repoRoot, number, assignee.value || null, current.item.labels);
      } else {
        // The Work scheduler's only ordering write: a stored band survives a
        // reload, which is why the scheduler has no free-position reorder.
        const priority = readPriority(parsed.body.priority);
        if (!priority.ok) return NextResponse.json({ ok: false, error: priority.error }, { status: 400 });
        result = await setIssuePriority(root.repoRoot, number, priority.value, current.item.labels);
      }
      break;
    }
    case "comment": {
      const comment = readOptionalString(parsed.body.comment, "comment");
      if (!comment.ok) return NextResponse.json({ ok: false, error: comment.error }, { status: 400 });
      if (!comment.value) return NextResponse.json({ ok: false, error: "comment required" }, { status: 400 });
      result = await commentOnIssue(root.repoRoot, number, comment.value);
      break;
    }
    case "close": {
      const reason = readOptionalString(parsed.body.reason, "reason");
      if (!reason.ok) return NextResponse.json({ ok: false, error: reason.error }, { status: 400 });
      result = await closeIssue(root.repoRoot, number, reason.value || "Completed");
      break;
    }
    default:
      return NextResponse.json({ ok: false, error: "unsupported action" }, { status: 400 });
  }
  if (!result.ok) return ghFailure(result);
  return NextResponse.json({ ok: true, action: action.value, projectRoot: root.repoRoot, data: { id: `#${number}` } });
}
