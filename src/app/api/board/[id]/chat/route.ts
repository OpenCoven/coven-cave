import { NextResponse } from "next/server";
import { bindingFor, loadConfig, recordSessionFamiliar, setSessionTitle } from "@/lib/cave-config";
import { loadBoard, updateCard } from "@/lib/cave-board";
import { callDaemon, extractDaemonError } from "@/lib/coven-daemon";
import { buildInitialTaskChatPrompt } from "@/lib/task-chat-context";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { isAllowedHarness, MAX_SESSION_JSON_BYTES, normalizeProjectRoot } from "@/lib/server/session-security";
import { issueContentionKey, shouldIsolateInWorktree, type IssueWorktreeKind } from "@/lib/issue-worktree";
import { provisionIssueWorktree, resolveRepoRoot } from "@/lib/server/issue-worktree-provision";

// Match the daemon's "harness X is not a supported harness" rejection
// from `/api/v1/sessions`. The daemon emits this when the requested
// harness isn't registered for daemon-managed sessions (e.g. `openclaw`
// and `hermes` today, which ship as their own CLI flows in chat/send
// but don't yet have a daemon session adapter). Surfacing a friendly
// 409 here saves the user from staring at "daemon http 400" with no
// idea what to do.
const UNSUPPORTED_HARNESS_RE = /not a supported harness/i;

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const { id } = await params;
  const parsed = await readJsonBody<{ familiarId?: string | null; projectRoot?: string | null }>(
    req,
    MAX_SESSION_JSON_BYTES,
  );
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const board = await loadBoard();
  const card = board.cards.find((candidate) => candidate.id === id);
  if (!card) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const familiarId = card.familiarId ?? body.familiarId ?? null;
  if (!familiarId) {
    return NextResponse.json(
      { ok: false, error: "assign a familiar before starting a task chat" },
      { status: 409 },
    );
  }

  if (card.sessionId) {
    await recordSessionFamiliar(card.sessionId, familiarId);
    return NextResponse.json({
      ok: true,
      reused: true,
      card,
      sessionId: card.sessionId,
      familiarId,
    });
  }

  // card.cwd wins; body.projectRoot covers "card had no CWD, user supplied one" flow.
  const projectRoot = normalizeProjectRoot(card.cwd ?? body.projectRoot ?? process.cwd());
  if (!projectRoot) {
    return NextResponse.json({ ok: false, error: "invalid project root" }, { status: 400 });
  }

  const config = await loadConfig();
  const binding = bindingFor(config, familiarId);
  if (!isAllowedHarness(binding.harness)) {
    return NextResponse.json({ ok: false, error: "unsupported harness" }, { status: 400 });
  }

  // ── Intelligent worktree isolation ────────────────────────────────────────
  // If another card already has a live session for a *different* issue in the
  // same GitHub repo, this issue gets its own dedicated git worktree so the
  // concurrent agents can't trample each other in the shared checkout. The
  // first/only issue in flight stays in the main checkout. This is strictly
  // best-effort: any resolution or git failure falls back to the shared root,
  // so isolation never blocks starting a session.
  let sessionRoot = projectRoot;
  let worktree: { path: string; branch: string } | null = null;
  const ghLink = card.github.find(
    (g) => g.number && (g.kind === "issue" || g.kind === "pr" || g.kind === "review_request"),
  );
  if (ghLink) {
    const activeKeys = board.cards
      .filter((c) => c.id !== card.id && c.sessionId)
      .flatMap((c) => c.github)
      .filter((g) => g.repo === ghLink.repo && g.number)
      .map((g) => issueContentionKey(g.repo, g.number));
    if (shouldIsolateInWorktree(activeKeys, issueContentionKey(ghLink.repo, ghLink.number))) {
      try {
        const root = await resolveRepoRoot(projectRoot);
        if (root.ok) {
          const prov = await provisionIssueWorktree(root.repoRoot, {
            kind: ghLink.kind as IssueWorktreeKind,
            number: ghLink.number,
            title: ghLink.title ?? card.title,
          });
          if (prov.ok) {
            sessionRoot = prov.worktree;
            worktree = { path: prov.worktree, branch: prov.branch };
          }
        }
      } catch {
        /* fall back to the shared checkout */
      }
    }
  }

  const res = await callDaemon<{ id: string; status: string }>({
    method: "POST",
    path: "/api/v1/sessions",
    body: {
      projectRoot: sessionRoot,
      harness: binding.harness,
      prompt: buildInitialTaskChatPrompt(card),
    },
    timeoutMs: 8000,
  });

  if (!res.ok || !res.data?.id) {
    const daemonMsg = extractDaemonError(res);
    // Unsupported-harness errors aren't outages — they're a
    // misconfiguration: the card is assigned to a familiar whose
    // harness this daemon doesn't run as a task session. Return a 409
    // with a message that tells the user what to do, instead of a 502
    // that reads as "the daemon is broken".
    if (daemonMsg && UNSUPPORTED_HARNESS_RE.test(daemonMsg)) {
      return NextResponse.json(
        {
          ok: false,
          error: `This familiar uses the '${binding.harness}' harness, which the daemon doesn't start as a task session. Reassign the card to a familiar with a daemon-supported harness, or use the regular Chat surface (daemon detail: ${daemonMsg}).`,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { ok: false, error: daemonMsg ?? res.error ?? `daemon http ${res.status}` },
      { status: 502 },
    );
  }

  const sessionId = res.data.id;
  // Persist a start-time CWD onto the card so the next chat (and the
  // board inspector) see it.
  const updated = await updateCard(card.id, {
    sessionId,
    familiarId,
    // When we isolated into a worktree, pin the card's CWD to it so reopening
    // the chat lands back in the same worktree. Otherwise keep the prior
    // behavior of recording a start-time CWD only when the card had none.
    ...(worktree
      ? { cwd: sessionRoot }
      : (!card.cwd && body.projectRoot ? { cwd: body.projectRoot } : {})),
  });
  if (!updated) {
    return NextResponse.json({ ok: false, error: "card disappeared" }, { status: 404 });
  }
  await Promise.all([
    recordSessionFamiliar(sessionId, familiarId),
    setSessionTitle(sessionId, `Task: ${card.title.trim()}`),
  ]);

  return NextResponse.json({
    ok: true,
    reused: false,
    card: updated,
    sessionId,
    familiarId,
    worktree,
  });
}
