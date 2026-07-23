import { NextResponse } from "next/server";
import { bindingFor, loadConfig, recordSessionFamiliar, setSessionTitle } from "@/lib/cave-config";
import { loadBoard, updateCard } from "@/lib/cave-board";
import { loadProjects, projectById } from "@/lib/cave-projects";
import { callDaemon, extractDaemonError } from "@/lib/coven-daemon";
import { canonicalHarnessId, isTrustedChatHarness } from "@/lib/harness-adapters";
import { buildInitialTaskChatPrompt } from "@/lib/task-chat-context";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { isAllowedHarness, MAX_SESSION_JSON_BYTES, normalizeProjectRoot } from "@/lib/server/session-security";
import { issueContentionKey, shouldIsolateInWorktree, type IssueWorktreeKind } from "@/lib/issue-worktree";
import { provisionIssueWorktree, resolveRepoRoot } from "@/lib/server/issue-worktree-provision";
import { assertProjectAccess, ProjectAccessDeniedError } from "@/lib/project-permissions";
import { ensureAdapterManifestScaffold } from "@/lib/server/adapter-manifest-scaffold";
import { isSshRuntime } from "@/lib/familiar-runtime";

// Match the daemon's "harness X is not a supported harness" rejection
// from `/api/v1/sessions`. The daemon emits this when the requested
// harness isn't registered for daemon-managed sessions. Trusted Chat runtimes
// can fall back to Cave's native Chat launch; anything else gets a friendly
// 409 instead of a misleading "daemon http 400".
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

  const config = await loadConfig();
  const binding = bindingFor(config, familiarId);
  // Familiar bindings can retain a package or binary alias from older setup
  // flows (for example `hermes-agent` or `opencode-ai`). Normalize before
  // both model-override validation and bridge routing so the task inspector,
  // Chat, and Board all select the same runtime behavior.
  binding.harness = canonicalHarnessId(binding.harness);

  // Resolve the project the task chat will run in. Security-critical: when the
  // card is assigned to a project we resolve the root SERVER-SIDE from
  // card.projectId (never trust a client-supplied body.projectRoot to point
  // elsewhere), reject a mismatched requested root, and authorize the familiar
  // for that project. Only when the card has no assigned project do we fall
  // back to the supplied/persisted root.
  //
  // NEVER silently fall back to the app's own working directory for an assigned
  // task: that roots the chat in the coven-cave checkout, records the wrong
  // project_root on the session, and the chat picker then shows the wrong
  // project for the task.
  let projectRoot: string | null = null;

  if (card.projectId) {
    const assignedProject = projectById(card.projectId, await loadProjects());
    if (!assignedProject) {
      return NextResponse.json({ ok: false, error: "assigned project not found" }, { status: 409 });
    }

    projectRoot = normalizeProjectRoot(assignedProject.root);
    if (!projectRoot) {
      return NextResponse.json({ ok: false, error: "assigned project root is invalid" }, { status: 409 });
    }

    if (body.projectRoot !== undefined && body.projectRoot !== null) {
      const requestedProjectRoot = normalizeProjectRoot(body.projectRoot);
      if (!requestedProjectRoot || requestedProjectRoot !== projectRoot) {
        return NextResponse.json(
          { ok: false, error: "project root does not match assigned task project" },
          { status: 403 },
        );
      }
    }

    try {
      await assertProjectAccess({ familiarId }, assignedProject.id, "session-launch");
    } catch (error) {
      if (error instanceof ProjectAccessDeniedError) {
        return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
      }
      throw error;
    }
  } else {
    const rawProjectRoot = body.projectRoot ?? card.cwd;
    if (!rawProjectRoot) {
      return NextResponse.json(
        { ok: false, error: "assign a project to this task before starting chat" },
        { status: 409 },
      );
    }
    projectRoot = normalizeProjectRoot(rawProjectRoot);
  }

  if (!projectRoot) {
    return NextResponse.json({ ok: false, error: "invalid project root" }, { status: 400 });
  }

  if (!isAllowedHarness(binding.harness)) {
    return NextResponse.json({ ok: false, error: "unsupported harness" }, { status: 400 });
  }

  // Repair the known Windows-only Hermes manifest before asking the daemon to
  // create its PTY. Without this the daemon attempts the POSIX-only
  // `hermes-coven` shim and the task can never start.
  await ensureAdapterManifestScaffold(binding.harness);

  // A familiar can be reconfigured from one runtime to another without the
  // card being reassigned. Model ids are runtime-specific, so only forward an
  // override that was chosen for this exact canonical harness. Legacy or stale
  // overrides are cleared before launch and the familiar's current default is
  // used instead.
  const taskModelOverride =
    card.modelOverride && card.modelOverrideHarness === binding.harness
      ? card.modelOverride
      : null;
  if (card.modelOverride && !taskModelOverride) {
    await updateCard(card.id, { modelOverride: null, modelOverrideHarness: null });
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

  // A native Chat launch works for bridge-backed and direct runtimes without
  // assuming how their executable was installed (npm shim, native binary,
  // package manager, or a registry adapter). The Board still owns worktree
  // isolation and the task link; Chat owns each runtime's launch contract.
  const reserveNativeChatTask = async () => {
    const sessionId = crypto.randomUUID();
    const updated = await updateCard(card.id, {
      sessionId,
      familiarId,
      ...(worktree
        ? { cwd: sessionRoot }
        : (card.projectId || body.projectRoot ? { cwd: projectRoot } : {})),
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
      projectRoot: sessionRoot,
      worktree,
      initialPrompt: buildInitialTaskChatPrompt(card),
      bridge: "native-chat",
    });
  };

  // OpenClaw has no daemon adapter, so it must never be sent to the daemon.
  // Its native bridge is local-only, though: reserving a card first for an
  // SSH-bound familiar would leave the card linked to a conversation that
  // chat/send must reject. Leave the card unmodified and surface the same
  // actionable limitation as the Chat surface instead.
  if (binding.harness === "openclaw") {
    if (isSshRuntime(binding.runtime)) {
      return NextResponse.json(
        {
          ok: false,
          error: "OpenClaw SSH runtime is not supported yet. Use a local OpenClaw familiar or connect the remote agent through a future OpenClaw node bridge.",
        },
        { status: 409 },
      );
    }
    return reserveNativeChatTask();
  }

  const res = await callDaemon<{ id: string; status: string }>({
    method: "POST",
    path: "/api/v1/sessions",
    body: {
      projectRoot: sessionRoot,
      harness: binding.harness,
      model: taskModelOverride ?? binding.model,
      prompt: buildInitialTaskChatPrompt(card),
    },
    timeoutMs: 8000,
  });

  if (!res.ok || !res.data?.id) {
    const daemonMsg = extractDaemonError(res);
    // Unsupported-harness errors aren't outages. A trusted runtime can use
    // native Chat; an untrusted one remains a configuration error with a
    // helpful 409 instead of a generic daemon failure.
    if (daemonMsg && UNSUPPORTED_HARNESS_RE.test(daemonMsg)) {
      // The daemon's adapter set can lag Cave's chat-supported runtimes.
      // Fall back only after the daemon has explicitly declined a trusted
      // runtime, preserving daemon sessions where they are supported while
      // allowing direct/registry runtimes such as Hermes to start task work.
      if (isTrustedChatHarness(binding.harness)) return reserveNativeChatTask();
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
    // behavior of recording the explicit project root when the caller supplied
    // one.
    ...(worktree
      ? { cwd: sessionRoot }
      : (card.projectId || body.projectRoot ? { cwd: projectRoot } : {})),
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
