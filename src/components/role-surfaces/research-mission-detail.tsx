"use client";

/**
 * Mission detail — the Desk tab's center column + right rail (cave-dl74 B2).
 *
 * Center: kicker/title header, horizontal 6-phase stepper card with the bound
 * readings row, one status block per mission state (checkpoint tiles + refine,
 * live activity, completed abstract, a Grimoire/workspace "Saved" summary on
 * completed or checkpoint runs, failed retry config), the pinned
 * decision-first stop banner, and a sticky action bar driven by
 * allowedResearchActions()/researchContinueLabel().
 *
 * Right rail: a state-dependent evidence panel (checkpoint delta triage,
 * streaming sources, artifact cards with the shared view/download/Grimoire/
 * publish actions), quick links, and the full evidence ledger folded into a
 * disclosure so every ledger affordance stays reachable.
 *
 * Every number shown is derived from real mission data; tiles whose datum is
 * missing are omitted rather than invented.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { copyText } from "@/lib/clipboard";
import { Icon } from "@/lib/icon";
import {
  allowedResearchActions,
  describeResearchSchedule,
  researchBoundReadings,
  researchContinueLabel,
  researchIntentAddsContext,
  researchPhaseStatuses,
  researchSourceStatusCounts,
  type ResearchMission,
  type ResearchMissionAction,
  type ResearchMissionActionInput,
  type ResearchSourceRef,
} from "@/lib/research-missions";
import { relativeTime } from "@/lib/relative-time";
import { useMinuteTick } from "@/lib/use-minute-tick";
import { ResearchArtifactActions, fetchResearchWorkspacePath } from "./research-artifact-actions";
import { ResearchEvidenceLedger } from "./research-evidence-ledger";

type Props = {
  mission: ResearchMission | null;
  onOpenSession(sessionId: string): void;
  onOpenUrl(url: string): void;
  /** Quick link to the Resources tab (Saved resources). */
  onShowResources(): void;
  onAction(input: ResearchMissionActionInput): Promise<{ ok: boolean; error?: string }>;
  onSchedule(rrule: string): Promise<{ ok: boolean; error?: string }>;
  onAutomationAction(
    automationId: string,
    action: "pause" | "resume" | "run-now",
  ): Promise<{ ok: boolean; error?: string }>;
};

/** Display phases: the runner's trigger phase is real but reads as plumbing,
 *  so the stepper shows the six research phases scope→publish. Statuses stay
 *  reconciled by researchPhaseStatuses over exactly these ids. */
const PHASES = [
  ["scope", "Scope"],
  ["gather", "Gather"],
  ["challenge", "Challenge"],
  ["synthesize", "Synthesize"],
  ["control", "Control"],
  ["publish", "Publish"],
] as const;

const PHASE_IDS = PHASES.map(([id]) => id);

const ACTION_LABELS: Partial<Record<ResearchMissionAction, string>> = {
  continue: "Continue",
  retry: "Retry",
  finish: "Finish now",
  resume: "Resume",
  pause: "Pause",
  cancel: "Cancel run",
  archive: "Archive",
};

/** End-of-run actions sit right-aligned in the bar, per the design. */
const END_ACTIONS: ReadonlySet<ResearchMissionAction> = new Set(["cancel", "archive"]);

/** Note marker appended by "Verify next pass" — the source stays conflicting
 *  so the agent re-checks it, and the marker records the request. */
const VERIFY_NOTE = "Verify next pass";

const LIVE_STATUSES = new Set<ResearchMission["status"]>(["queued", "planning", "running"]);

export function ResearchMissionDetail({
  mission,
  onOpenSession,
  onOpenUrl,
  onShowResources,
  onAction,
  onSchedule,
  onAutomationAction,
}: Props) {
  const { announce } = useAnnouncer();
  // Keeps the running wall-clock reading and "updated Xm ago" stamps advancing
  // between mission polls.
  useMinuteTick();
  const [busy, setBusy] = useState(false);
  const [direction, setDirection] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  // null = untouched; the retry payload then adapts to the failure instead.
  const [retryRoot, setRetryRoot] = useState<string | null>(null);
  // Toggles the "Saved" summary's copy-workspace-path button label; reverted
  // by copyTimer below.
  const [workspaceCopied, setWorkspaceCopied] = useState(false);
  const missionId = mission?.id ?? null;
  // Tracks the mission currently on screen so an action that settles after
  // the user switched missions is discarded instead of applying its
  // busy/error/announce state to the wrong mission's view.
  const missionIdRef = useRef(missionId);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A mission switch resets every piece of per-mission action state — the
  // in-flight action belongs to the previous mission (its settle handlers
  // check missionIdRef and discard), so the fresh mission starts unblocked.
  useEffect(() => {
    missionIdRef.current = missionId;
    setBusy(false);
    setRetryRoot(null);
    setActionError(null);
    setDirection("");
  }, [missionId]);

  // The copied-path confirmation is per-mission UI state too. Its cleanup
  // clears any pending revert timer before the next mission's effect runs
  // (or on unmount) so a stale timer from mission A can never flip mission
  // B's confirmation back off early.
  useEffect(() => {
    setWorkspaceCopied(false);
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, [missionId]);

  if (!mission) {
    return (
      <section className="research-mission-empty" aria-label="Research mission detail">
        <Icon name="ph:detective" width={28} height={28} aria-hidden />
        <h2>Turn a question into durable knowledge.</h2>
        <p>Start with a bounded brief, landscape sweep, paper, or autoresearch loop.</p>
      </section>
    );
  }

  const iteration = mission.iterations.at(-1);
  const sessionId = iteration?.sessionId;
  const actions = allowedResearchActions(mission);
  const mainActions = actions.filter((action) => action !== "refine" && !END_ACTIONS.has(action));
  const endActions = actions.filter((action) => END_ACTIONS.has(action));
  const sourceCounts = researchSourceStatusCounts(mission.sources);
  const passNote = mission.status === "completed"
    ? "final"
    : iteration
      ? `pass ${iteration.number} of ${mission.bounds.maxIterations}`
      : `0 of ${mission.bounds.maxIterations} passes`;
  // The design's "draft synthesis updated · vN" tile — only when the primary
  // deliverable is still a working draft; its version is the iteration that
  // wrote it. Every mission now also carries the 3 standard refs (findings,
  // source-ledger, research-log), so picking the last working ref by array
  // position would resolve to the research-log instead of the primary draft.
  // No fallback to a standard ref: once the primary is rejected the tile
  // disappears, matching pre-standard-refs behavior.
  const draftArtifact = mission.artifacts.find(
    (artifact) => artifact.relativePath === "artifacts/primary.md" && artifact.state === "working",
  );
  const isCheckpointLike = mission.status === "checkpoint" || mission.status === "paused";
  const isLive = LIVE_STATUSES.has(mission.status);
  // Archived missions are read-only: automation controls gate on this the
  // same way "Create schedule" already does.
  const isArchived = mission.status === "archived";
  const showArtifactRail = !isCheckpointLike && !isLive;

  // Root-blocked failures get a self-healing Retry: untouched config clears the
  // rejected root so the retried iteration runs in the mission workspace.
  const rootFailure = mission.status === "failed" && /project root/i.test(mission.lastError ?? "");
  const showRetryConfig = actions.includes("retry") && (rootFailure || Boolean(mission.projectRoot));
  const retryRootValue = retryRoot ?? mission.projectRoot ?? "";
  const plannedRetry: { action: "retry"; projectRoot?: string | null } = (() => {
    if (retryRoot !== null) return { action: "retry", projectRoot: retryRoot.trim() || null };
    if (rootFailure && mission.projectRoot) return { action: "retry", projectRoot: null };
    return { action: "retry" };
  })();
  const retryLabel = plannedRetry.projectRoot === undefined
    ? "Retry"
    : plannedRetry.projectRoot === null
      ? (mission.projectRoot ? "Retry in workspace" : "Retry")
      : plannedRetry.projectRoot === mission.projectRoot ? "Retry" : "Retry with new root";
  const continueInfo = researchContinueLabel(mission);

  /** Shared settle path for every mission action. The hook reports failures
   *  as { ok: false }; the catch is transport defense only — a throw skips
   *  the ok branch, so a failure is never reported twice. State from an
   *  action that settles after a mission switch is discarded, and the busy
   *  flag always clears for the mission that set it. */
  const runMissionAction = async (
    fallbackError: string,
    perform: () => Promise<{ ok: boolean; error?: string }>,
    onSuccess: () => void,
  ) => {
    const startedFor = mission.id;
    const stillCurrent = () => missionIdRef.current === startedFor;
    setBusy(true);
    setActionError(null);
    try {
      const result = await perform();
      if (!stillCurrent()) return;
      if (!result.ok) {
        const message = result.error ?? fallbackError;
        setActionError(message);
        announce(message);
        return;
      }
      onSuccess();
    } catch (error) {
      if (!stillCurrent()) return;
      const message = error instanceof Error ? error.message : fallbackError;
      setActionError(message);
      announce(message);
    } finally {
      if (stillCurrent()) setBusy(false);
    }
  };
  // Publishing is offered on settled missions only — a cancelled/archived run
  // should not gain a fresh Grimoire entry after the fact.
  const settled = ["checkpoint", "completed", "failed"].includes(mission.status);
  const publishArtifact = (artifactKey: string) => {
    void runMissionAction(
      "Artifact could not be published",
      () => onAction({ action: "publish-artifact", artifactKey }),
      () => announce("Artifact published to the Grimoire."),
    );
  };
  const runAction = (input: ResearchMissionActionInput) => runMissionAction(
    "Research action failed",
    () => onAction(input),
    () => {
      if (input.action === "refine") setDirection("");
      if (input.action === "retry") setRetryRoot(null);
      announce(`Research ${input.action} applied.`);
    },
  );
  const runAutomationAction = async (action: "pause" | "resume" | "run-now") => {
    const automation = mission.automation;
    if (!automation) return;
    await runMissionAction(
      "Automation action failed",
      () => onAutomationAction(automation.id, action),
      () => announce(action === "run-now" ? "Research iteration started." : `Schedule ${action}d.`),
    );
  };
  const createSchedule = () => runMissionAction(
    "Research schedule could not be created",
    () => onSchedule("RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0"),
    () => announce("Paused daily research schedule created."),
  );
  // Copies the mission workspace's on-disk path so an operator can open the
  // working files directly. copyText falls back to execCommand outside
  // secure contexts (the packaged Tauri webview), so the confirmation only
  // shows on a real, verified copy.
  const copyWorkspacePath = async () => {
    const workspacePath = await fetchResearchWorkspacePath(mission.id);
    if (!workspacePath) {
      announce("Workspace path could not be resolved.");
      return;
    }
    const copied = await copyText(workspacePath);
    if (!copied) {
      announce("Workspace path could not be copied.");
      return;
    }
    setWorkspaceCopied(true);
    announce("Workspace path copied.");
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setWorkspaceCopied(false), 2000);
  };

  // Evidence-delta triage reuses the ledger's exact source-update mechanism:
  // Keep → used, Reject → rejected, Verify → stays conflicting + appends note.
  const keepSource = (source: ResearchSourceRef) => runAction({
    action: "update-source",
    sourceId: source.id,
    patch: { status: "used" },
  });
  const rejectSource = (source: ResearchSourceRef) => runAction({
    action: "update-source",
    sourceId: source.id,
    patch: { status: "rejected" },
  });
  const verifySourceNextPass = (source: ResearchSourceRef) => runAction({
    action: "update-source",
    sourceId: source.id,
    patch: {
      status: "conflicting",
      note: source.note ? `${source.note}\n${VERIFY_NOTE}` : VERIFY_NOTE,
    },
  });

  const renderActionButton = (action: ResearchMissionAction) => (
    <Button
      key={action}
      size="xs"
      variant={
        action === "continue"
          ? (continueInfo.gated ? "ghost" : "primary")
          : action === "retry"
            ? "primary"
            : action === "cancel"
              ? "danger-ghost"
              : action === "finish" || action === "resume" || action === "pause"
                ? "secondary"
                : "ghost"
      }
      disabled={busy}
      {...(action === "continue"
        ? { "aria-label": continueInfo.description, title: continueInfo.description }
        : {})}
      onClick={() => void runAction(action === "retry" ? plannedRetry : { action })}
    >
      {action === "continue"
        ? continueInfo.label
        : action === "retry" ? retryLabel : ACTION_LABELS[action] ?? action}
    </Button>
  );

  const renderSourceTitle = (source: ResearchSourceRef) => source.url ? (
    <button
      type="button"
      className="research-desk-delta__title"
      onClick={() => onOpenUrl(source.url!)}
    >
      <strong>{source.title}</strong>
      <Icon name="ph:arrow-square-out" width={11} height={11} aria-hidden />
      <span className="sr-only"> — opens the source</span>
    </button>
  ) : (
    <strong>{source.title}</strong>
  );

  return (
    <section className="research-mission-detail" aria-labelledby="research-mission-title">
      <div className="research-mission-detail__body">
        <div className="research-desk-center">
          <header className="research-mission-detail__header">
            <div>
              <span className="research-mission-detail__eyebrow">
                {mission.mode} · {mission.status}
                {iteration ? ` · pass ${iteration.number}/${mission.bounds.maxIterations}` : ""}
                {" · "}
                <time dateTime={mission.updatedAt}>updated {relativeTime(mission.updatedAt) || "just now"}</time>
              </span>
              <h2 id="research-mission-title">{mission.title}</h2>
              {researchIntentAddsContext(mission) ? <p>{mission.intent}</p> : null}
            </div>
            {sessionId ? (
              <Button
                size="xs"
                variant="secondary"
                leadingIcon="ph:chat-circle-dots"
                onClick={() => onOpenSession(sessionId)}
              >
                Open session
              </Button>
            ) : null}
          </header>

          {/* ── Stepper card: 6 reconciled phases + bounds row ── */}
          <div className="research-desk-stepper">
            <ol className="research-desk-stepper__track" aria-label="Research progress">
              {researchPhaseStatuses(mission, PHASE_IDS).map((status, index) => {
                const [id, label] = PHASES[index];
                const step = iteration?.steps?.find((item) => item.id === id);
                // A stale step detail ("Searching sources…") contradicts a
                // reconciled status; expose the detail only when the status is
                // still the step's own report.
                const reconciled = status !== (step?.status ?? "pending");
                return (
                  <li key={id} className={`research-desk-step research-desk-step--${status}`}>
                    <span className="research-desk-step__node" aria-hidden>
                      {status === "succeeded" ? (
                        <Icon name="ph:check" width={11} height={11} aria-hidden />
                      ) : status === "failed" ? (
                        <Icon name="ph:x" width={10} height={10} aria-hidden />
                      ) : null}
                    </span>
                    <span className="research-desk-step__label">{label}</span>
                    <span className="sr-only"> — {reconciled ? status : step?.detail || status}</span>
                  </li>
                );
              })}
            </ol>
            <div className="research-desk-stepper__bounds">
              <dl className="research-bound-meter">
                {researchBoundReadings(mission).map((reading) => (
                  <div
                    key={reading.id}
                    className={reading.tone === "neutral" ? undefined : `research-bound--${reading.tone}`}
                    title={reading.detail}
                  >
                    <dt>{reading.label}</dt>
                    <dd>
                      {reading.value}
                      {reading.badge ? (
                        <em className="research-bound-badge" aria-hidden>{reading.badge}</em>
                      ) : null}
                      <span className="sr-only"> — {reading.detail}</span>
                    </dd>
                  </div>
                ))}
              </dl>
              <span className="research-desk-stepper__pass">{passNote}</span>
            </div>
          </div>

          {/* Why the run stopped reads before what to do about it. */}
          {mission.lastError ? (
            <div className="research-mission-stop" role="status">
              <Icon name="ph:warning" width={14} height={14} aria-hidden />
              <span>{mission.lastError}</span>
            </div>
          ) : iteration?.decisionReason ? (
            <div className="research-mission-decision" role="status">
              <span>{iteration.decision ?? "checkpoint"}</span>
              <p>{iteration.decisionReason}</p>
            </div>
          ) : null}

          {/* ── Checkpoint / paused: what changed + refine box.
                Tiles derive from real data only — a tile whose datum is
                missing is omitted, never invented. Per-iteration source
                attribution does not exist in the mission model, so the
                design's "+N new sources" tile ships as the honest ledger
                total instead. ── */}
          {isCheckpointLike ? (
            <section className="research-desk-block" aria-label={`What changed in pass ${iteration?.number ?? 0}`}>
              <span className="research-desk-block__kicker">
                What changed in pass {iteration?.number ?? 0}
              </span>
              <div className="research-desk-tiles">
                {mission.sources.length > 0 ? (
                  <div className="research-desk-tile">
                    <strong>{mission.sources.length}</strong>
                    <span>sources gathered so far</span>
                  </div>
                ) : null}
                {sourceCounts.conflicting > 0 ? (
                  <div className="research-desk-tile research-desk-tile--warn">
                    <strong>{sourceCounts.conflicting}</strong>
                    <span>conflicting claims flagged</span>
                  </div>
                ) : null}
                {draftArtifact ? (
                  <div className="research-desk-tile">
                    <strong>v{draftArtifact.iteration}</strong>
                    <span>draft synthesis updated</span>
                  </div>
                ) : null}
              </div>
              {iteration?.summary ? (
                <p className="research-desk-block__note">{iteration.summary}</p>
              ) : null}
            </section>
          ) : null}

          {/* ── Running: live activity from the latest iteration's real step
                reports — no fake timestamps, honest when detail is absent. ── */}
          {isLive ? (
            <section className="research-desk-block" aria-label="Live activity">
              <div className="research-desk-block__head">
                <span className="research-desk-block__kicker">Live activity</span>
                <span className="research-desk-block__aside">
                  {mission.bounds.checkpointEvery === 1
                    ? "checkpoint after this pass"
                    : `checkpoint every ${mission.bounds.checkpointEvery} passes`}
                </span>
              </div>
              {iteration?.steps?.length ? (
                <ul className="research-desk-activity">
                  {iteration.steps.map((step) => (
                    <li key={step.id} data-status={step.status}>
                      <em>{step.id}</em>
                      <span>{step.detail || step.status}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="research-desk-block__empty">
                  No step detail reported yet — activity appears as the pass advances.
                </p>
              )}
            </section>
          ) : null}

          {/* ── Completed: iteration summary as abstract + honest meta line.
                Findings chips are not derivable from mission data — skipped. ── */}
          {mission.status === "completed" ? (
            <section className="research-desk-block" aria-label="Findings">
              <div className="research-desk-block__head">
                <span className="research-desk-block__kicker">Findings · published</span>
                <span className="research-desk-block__aside">
                  {mission.sources.length} sources · {sourceCounts.used} used ·{" "}
                  {mission.iterations.length} pass{mission.iterations.length === 1 ? "" : "es"}
                </span>
              </div>
              {iteration?.summary ? (
                <p className="research-desk-block__abstract">{iteration.summary}</p>
              ) : (
                <p className="research-desk-block__empty">
                  The run finished without a written summary — open the artifacts for the findings.
                </p>
              )}
            </section>
          ) : null}

          {/* ── Saved: how many artifacts are Grimoire-published (completed)
                or still working in the mission workspace (checkpoint), plus a
                quick way to copy that workspace's on-disk path. ── */}
          {mission.status === "completed" || mission.status === "checkpoint" ? (
            <section className="research-desk-block" aria-label="Saved artifacts">
              <span className="research-desk-block__kicker">Saved</span>
              <p className="research-desk-block__note">
                {mission.status === "completed"
                  ? `${mission.artifacts.filter((artifact) => artifact.knowledgeId).length} of ${mission.artifacts.filter((artifact) => artifact.state !== "rejected").length} artifacts published to the Grimoire.`
                  : `${mission.artifacts.filter((artifact) => artifact.state === "working").length} working files saved in the mission workspace.`}
              </p>
              <button
                type="button"
                className="research-desk-artifact__open focus-ring"
                onClick={() => void copyWorkspacePath()}
              >
                <Icon name="ph:copy" width={12} height={12} aria-hidden />
                {workspaceCopied ? "Workspace path copied" : "Copy workspace path"}
              </button>
            </section>
          ) : null}

          {/* ── Failed: retry-root config next to the pinned stop banner. ── */}
          {showRetryConfig ? (
            <div className="research-retry-config">
              <label htmlFor="research-retry-root">Retry project root</label>
              <input
                id="research-retry-root"
                type="text"
                value={retryRootValue}
                placeholder="Leave empty to run in the mission workspace"
                spellCheck={false}
                onChange={(event) => setRetryRoot(event.target.value)}
              />
              {rootFailure ? (
                <p>
                  The last run could not start in its project root. Retry runs in the
                  mission workspace unless a valid root is set above.
                </p>
              ) : null}
            </div>
          ) : null}

          {/* ── Refine box: the design's "✦ Refine direction before continuing"
                wired to the existing refine action. ── */}
          {actions.includes("refine") ? (
            <div className="research-desk-refine">
              <span className="research-desk-refine__kicker">
                <Icon name="ph:sparkle" width={12} height={12} aria-hidden />
                Refine direction before continuing
              </span>
              <textarea
                value={direction}
                onChange={(event) => setDirection(event.target.value)}
                placeholder="What should the next iteration prioritize?"
                aria-label="Refined research direction"
              />
              <Button
                size="xs"
                variant="secondary"
                disabled={busy || !direction.trim()}
                onClick={() => void runAction({ action: "refine", direction })}
              >
                Refine and continue
              </Button>
            </div>
          ) : null}

          {mission.mode === "autoresearch" ? (
            <section className="research-automation" aria-label="AutoResearch schedule">
              <div className="research-automation__summary">
                <div>
                  <span>Codex Automation</span>
                  <strong>
                    {mission.automation
                      ? describeResearchSchedule(mission.automation.rrule)
                      : "Daily at 09:00 · paused on creation"}
                  </strong>
                </div>
                <span className={`research-automation__status research-automation__status--${mission.automation?.status.toLowerCase() ?? "draft"}`}>
                  {mission.automation?.status ?? "not scheduled"}
                </span>
              </div>
              {mission.automation ? (
                <>
                  <div className="research-automation__controls">
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busy || isArchived}
                      onClick={() => void runAutomationAction(mission.automation!.status === "ACTIVE" ? "pause" : "resume")}
                    >
                      {mission.automation.status === "ACTIVE" ? "Pause schedule" : "Resume schedule"}
                    </Button>
                    <Button
                      size="xs"
                      variant="primary"
                      disabled={busy || isArchived || mission.status === "completed"}
                      onClick={() => void runAutomationAction("run-now")}
                    >
                      Run now
                    </Button>
                  </div>
                  {mission.automation.lastRunStatus ? (
                    <p>
                      Last run: {mission.automation.lastRunStatus}
                      {mission.automation.lastRunAt ? (
                        <>
                          {" · "}
                          <time dateTime={mission.automation.lastRunAt}>
                            {relativeTime(mission.automation.lastRunAt) || "just now"}
                          </time>
                        </>
                      ) : null}
                    </p>
                  ) : null}
                  {mission.automation.stopReason ? <p className="research-automation__stop">Stopped: {mission.automation.stopReason}</p> : null}
                </>
              ) : (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy || ["completed", "cancelled", "archived"].includes(mission.status)}
                  onClick={() => void createSchedule()}
                >
                  Create schedule
                </Button>
              )}
            </section>
          ) : null}

          {actionError ? <p className="research-mission-error" role="alert">{actionError}</p> : null}

          {/* ── Sticky action bar: main actions left, end actions right.
                No kbd chip — the desk has no registered shortcut to claim. ── */}
          {actions.length > 0 ? (
            <div className="research-mission-actions" aria-label="Research mission actions">
              {mainActions.map(renderActionButton)}
              <span className="research-mission-actions__spacer" aria-hidden />
              {endActions.map(renderActionButton)}
            </div>
          ) : null}
        </div>

        {/* ── Right rail: state-dependent evidence, quick links, ledger. ── */}
        <aside className="research-desk-rail" aria-label="Run evidence and links">
          {isCheckpointLike ? (
            <section className="research-desk-rail__panel" aria-label="Evidence delta">
              <h3 className="research-desk-rail__title">
                Evidence delta — pass {iteration?.number ?? 0}
              </h3>
              <p className="research-desk-rail__hint">
                Triage now or leave it for the agent to resolve next pass.
              </p>
              {mission.sources.length === 0 ? (
                <p className="research-desk-block__empty">No sources in the ledger yet.</p>
              ) : (
                <ul className="research-desk-delta">
                  {mission.sources
                    .filter((source) => source.status !== "rejected")
                    .slice(-6)
                    .map((source) => (
                      <li
                        key={source.id}
                        className={`research-desk-delta__card research-desk-delta__card--${source.status}`}
                      >
                        <span className={`research-source-status research-source-status--${source.status}`}>
                          <i aria-hidden />{source.status}
                        </span>
                        {renderSourceTitle(source)}
                        {source.claim ? <p>{source.claim}</p> : null}
                        {source.status === "conflicting" || source.status === "candidate" ? (
                          <div className="research-desk-delta__actions">
                            <Button size="xs" variant="secondary" disabled={busy} onClick={() => void keepSource(source)}>
                              Keep
                            </Button>
                            <Button size="xs" variant="secondary" disabled={busy} onClick={() => void rejectSource(source)}>
                              Reject
                            </Button>
                            {source.status === "conflicting" ? (
                              <Button
                                size="xs"
                                variant="ghost"
                                disabled={busy || (source.note ?? "").includes(VERIFY_NOTE)}
                                onClick={() => void verifySourceNextPass(source)}
                              >
                                Verify next pass
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    ))}
                </ul>
              )}
            </section>
          ) : null}

          {isLive ? (
            <section className="research-desk-rail__panel" aria-label="Sources streaming in">
              <h3 className="research-desk-rail__title">Sources streaming in</h3>
              <p className="research-desk-rail__hint">
                {mission.sources.length} of {mission.bounds.sourceTarget} targeted — review anytime.
              </p>
              {mission.sources.length === 0 ? (
                <p className="research-desk-block__empty">No sources recorded yet.</p>
              ) : (
                <ul className="research-desk-stream">
                  {mission.sources.slice(-6).map((source, index, recent) => {
                    const latest = index === recent.length - 1;
                    return (
                      <li key={source.id} className={latest ? "is-latest" : undefined}>
                        <i aria-hidden />
                        <span>{source.title}</span>
                        {latest ? <span className="sr-only"> — most recently added</span> : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ) : null}

          {showArtifactRail ? (
            <section className="research-desk-rail__panel" aria-label="Artifacts">
              <h3 className="research-desk-rail__title">
                {mission.status === "failed" && iteration
                  ? `Artifacts from pass ${iteration.number}`
                  : "Artifacts"}
              </h3>
              {mission.artifacts.length === 0 ? (
                <p className="research-desk-block__empty">No artifacts yet.</p>
              ) : (
                <ul className="research-desk-artifacts">
                  {mission.artifacts.map((artifact) => (
                    <li key={artifact.key} className="research-desk-artifact">
                      <span className="research-desk-artifact__kicker">
                        {artifact.kind} · {artifact.state}
                      </span>
                      <strong>{artifact.title}</strong>
                      <span className="research-desk-artifact__meta">
                        iteration {artifact.iteration} ·{" "}
                        <time dateTime={artifact.updatedAt}>{relativeTime(artifact.updatedAt) || "just now"}</time>
                      </span>
                      <ResearchArtifactActions
                        mission={mission}
                        artifact={artifact}
                        busy={busy}
                        onPublish={settled ? publishArtifact : undefined}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          <div className="research-desk-rail__links">
            {sessionId ? (
              <button
                type="button"
                className="research-desk-rail__link focus-ring"
                onClick={() => onOpenSession(sessionId)}
              >
                <Icon name="ph:chat-circle-dots" width={14} height={14} aria-hidden />
                <span>Discuss this run in chat</span>
                <span className="research-desk-rail__link-chevron" aria-hidden>›</span>
              </button>
            ) : null}
            <button
              type="button"
              className="research-desk-rail__link focus-ring"
              onClick={onShowResources}
            >
              <Icon name="ph:link" width={14} height={14} aria-hidden />
              <span>Saved resources</span>
              <span className="research-desk-rail__link-chevron" aria-hidden>›</span>
            </button>
          </div>

          {/* Full evidence ledger stays reachable below the state panel. */}
          <details className="research-desk-rail__ledger">
            <summary>
              Evidence ledger
              <span>
                {mission.artifacts.length} artifact{mission.artifacts.length === 1 ? "" : "s"} ·{" "}
                {mission.sources.length} source{mission.sources.length === 1 ? "" : "s"}
              </span>
            </summary>
            <ResearchEvidenceLedger mission={mission} onAction={onAction} onOpenUrl={onOpenUrl} />
          </details>
        </aside>
      </div>
    </section>
  );
}
