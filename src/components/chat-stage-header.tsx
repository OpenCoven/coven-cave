"use client";

/**
 * Chat stage header (cave-fpqx.10, design docs/chat-github-integration.md §4):
 * a slim pipeline strip between the chat top bar and the transcript reading
 * `bead → PR → checks → review → merged` for the session's branch. Lane truth
 * comes from the same PR bridge + stage model the Familiar Work Queue uses
 * (resolveStageForBranch), so stage reads identically across surfaces.
 *
 * Renders NOTHING unless the branch resolves to a PR (open or recently
 * merged) or a linked bead — plain chat stays clean; the composer git chip
 * already covers bare branch context.
 */

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { useChangesSummary } from "@/lib/use-changes-summary";
import { resolveStageForBranch, type StageSnapshot, type StageStep } from "@/lib/stage-model";
import { publishStageChecks } from "@/lib/use-stage-checks-badge";
import type { PullRequestSummary } from "@/lib/beads-pr-management";
import type { MergedPrRef, ReadyBead } from "@/lib/beads-work-queue";

const POLL_MS = 60_000;

type BridgeState = {
  open: PullRequestSummary[];
  merged: MergedPrRef[];
  beads: ReadyBead[];
  loaded: boolean;
};

const EMPTY_BRIDGE: BridgeState = { open: [], merged: [], beads: [], loaded: false };

function useStageSnapshot(projectRoot: string | null | undefined, branch: string | null): StageSnapshot | null {
  const [state, setState] = useState<BridgeState>(EMPTY_BRIDGE);
  const [tick, setTick] = useState(0);
  // Identity guard: when the (projectRoot, branch) pair changes, drop the
  // previous pair's data BEFORE fetching so a stale stage can't render for
  // the wrong project/session while the new fetch is in flight.
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!projectRoot || !branch) {
      keyRef.current = null;
      setState(EMPTY_BRIDGE);
      return;
    }
    const key = `${projectRoot}\u0000${branch}`;
    if (keyRef.current !== key) {
      keyRef.current = key;
      setState(EMPTY_BRIDGE);
    }
    let cancelled = false;
    (async () => {
      try {
        const [prsRes, beadsRes] = await Promise.all([
          fetch(`/api/beads/prs?projectRoot=${encodeURIComponent(projectRoot)}`, { cache: "no-store" }),
          fetch(`/api/beads?mode=ready&projectRoot=${encodeURIComponent(projectRoot)}`, { cache: "no-store" }),
        ]);
        const prs = (await prsRes.json().catch(() => null)) as
          | { ok?: boolean; open?: PullRequestSummary[]; merged?: MergedPrRef[] }
          | null;
        const beads = (await beadsRes.json().catch(() => null)) as { ok?: boolean; data?: unknown } | null;
        if (cancelled) return;
        setState({
          open: prs?.ok && Array.isArray(prs.open) ? prs.open : [],
          merged: prs?.ok && Array.isArray(prs.merged) ? prs.merged : [],
          beads: beads?.ok && Array.isArray(beads.data) ? (beads.data as ReadyBead[]) : [],
          loaded: true,
        });
      } catch {
        // Clear rather than preserve: a failed fetch hides the header (it's
        // optional chrome) instead of showing another project's stage.
        if (!cancelled) setState({ ...EMPTY_BRIDGE, loaded: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectRoot, branch, tick]);

  const snapshot = state.loaded ? resolveStageForBranch({ branch, open: state.open, merged: state.merged, beads: state.beads }) : null;
  // Live-refresh while an open PR anchors the stage — checks/review flip
  // often. Bead-only and merged stages refresh on (root, branch) changes.
  usePausablePoll(() => setTick((t) => t + 1), POLL_MS, {
    enabled: Boolean(projectRoot && branch && snapshot?.pr),
  });
  return snapshot;
}

function stepVisual(step: StageStep): { glyph: string; cls: string } {
  switch (step.state) {
    case "done":
      return { glyph: "✓", cls: "text-[var(--color-success)]" };
    case "failed":
      return { glyph: "✕", cls: "text-[var(--color-warning)]" };
    case "active":
      return { glyph: "●", cls: "text-[var(--accent-presence)]" };
    default:
      return { glyph: "○", cls: "text-[var(--text-secondary)]" };
  }
}

export function ChatStageHeader({
  projectRoot,
  onOpenUrl,
}: {
  projectRoot: string | null | undefined;
  onOpenUrl?: (url: string) => void;
}) {
  const { branch } = useChangesSummary(projectRoot ?? undefined, Boolean(projectRoot));
  const snapshot = useStageSnapshot(projectRoot, branch);

  // Publish the failing-checks signal for the code rail's badge (design §6):
  // the header already holds the stage snapshot, so the rail never re-fetches
  // the PR bridge. publishStageChecks records state for LATE-MOUNTING
  // listeners (a rail opened after checks went red — cave-r0gt) and
  // broadcasts for live ones; the CLEAR fires only on unmount / root change
  // (separate effect) so listeners never see a transient false between
  // consecutive true states.
  const failing = Boolean(snapshot?.pr && snapshot.pr.checkStatus === "failing");
  useEffect(() => {
    if (!projectRoot) return;
    publishStageChecks(projectRoot, failing);
  }, [projectRoot, failing]);
  useEffect(() => {
    if (!projectRoot) return;
    return () => {
      publishStageChecks(projectRoot, false);
    };
  }, [projectRoot]);

  if (!snapshot) return null;

  const open = (url: string | undefined) => {
    if (!url) return;
    if (onOpenUrl) onOpenUrl(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      className="cave-stage-header flex items-center gap-1 overflow-x-auto border-b border-[var(--border-hairline)] px-4 py-1 text-[11px] text-[var(--text-secondary)]"
      role="group"
      aria-label={`Work stage for ${snapshot.branch}`}
    >
      <span aria-hidden className="mr-1 inline-flex shrink-0">
        <Icon name="ph:git-branch" width={11} />
      </span>
      {snapshot.steps.map((step, i) => {
        const v = stepVisual(step);
        const inner = (
          <>
            <span aria-hidden className={v.cls}>{v.glyph}</span>
            <span className="whitespace-nowrap">{step.label}</span>
          </>
        );
        return (
          <span key={step.key} className="flex shrink-0 items-center gap-1">
            {i > 0 ? <span aria-hidden className="mx-0.5 text-[var(--border-strong)]">→</span> : null}
            {step.url ? (
              <button
                type="button"
                className="focus-ring flex items-center gap-1 rounded px-0.5 transition-colors hover:text-[var(--text-primary)]"
                title={step.detail}
                aria-label={step.detail}
                onClick={() => open(step.url)}
              >
                {inner}
              </button>
            ) : (
              <span className="flex items-center gap-1" title={step.detail} aria-label={step.detail}>
                {inner}
              </span>
            )}
          </span>
        );
      })}
      {snapshot.lane ? (
        <span className="ml-auto shrink-0 whitespace-nowrap pl-3 text-[10px] uppercase tracking-wide">
          {snapshot.lane === "merged" ? "merged" : snapshot.lane.replace(/-/g, " ")}
        </span>
      ) : null}
    </div>
  );
}
