"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import {
  researchSourceStatusCounts,
  type ResearchMission,
  type ResearchMissionActionInput,
  type ResearchSourceRef,
} from "@/lib/research-missions";
import { relativeTime } from "@/lib/relative-time";
import { ResearchArtifactActions } from "./research-artifact-actions";
import { ResearchSourceRows } from "./research-source-rows";

export type ResearchOutputTab = "artifacts" | "sources";

type Props = {
  mission: ResearchMission;
  onAction(input: ResearchMissionActionInput): Promise<{ ok: boolean; error?: string }>;
  onOpenUrl(url: string): void;
  /**
   * Which pane to show. The tablist lives in the caller (the desk rail owns the
   * Artifacts/Sources toggle), so the ledger renders one pane's worth of
   * content and never its own tabs.
   */
  tab: ResearchOutputTab;
  /** One line of run context above the visible pane (pass state, bound progress). */
  hint?: ReactNode;
  /**
   * Checkpoint triage: offer Keep / Reject / Verify next pass on the sources
   * still awaiting a verdict, alongside the always-available status control.
   */
  triage?: boolean;
  /** Live runs mark the most recently arrived source so streaming reads. */
  highlightLatest?: boolean;
};

const SOURCE_STATUSES: ResearchSourceRef["status"][] = [
  "candidate",
  "used",
  "conflicting",
  "rejected",
];

/** Appended to a source note so "verify next pass" survives into the next run. */
export const VERIFY_NOTE = "Verify next pass";

export function ResearchEvidenceLedger({
  mission,
  onAction,
  onOpenUrl,
  tab,
  hint,
  triage = false,
  highlightLatest = false,
}: Props) {
  const { announce } = useAnnouncer();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [rejection, setRejection] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<"all" | ResearchSourceRef["status"]>("all");
  // Tracks the mission currently on screen so an act that settles after the
  // user switched missions is discarded instead of planting its error/busy
  // state on the wrong mission's ledger.
  const missionIdRef = useRef(mission.id);

  // A mission switch resets every piece of local UI state — error banner,
  // in-flight busy, draft attach fields, per-artifact rejection drafts — so
  // nothing bleeds into the next mission's ledger (artifact/source keys can
  // collide across missions). In-flight acts check missionIdRef and discard.
  useEffect(() => {
    missionIdRef.current = mission.id;
    setTitle("");
    setUrl("");
    setRejection({});
    setBusy(false);
    setError(null);
    setSourceFilter("all");
  }, [mission.id]);

  const sourceCounts = researchSourceStatusCounts(mission.sources);
  const visibleSources = sourceFilter === "all"
    ? mission.sources
    : mission.sources.filter((source) => source.status === sourceFilter);
  // Live runs mark the newest source so a streaming ledger reads as moving.
  // The ledger is append-ordered, so "newest" is the last entry — no invented
  // timestamps.
  const latestSourceId = highlightLatest && mission.sources.length > 0
    ? mission.sources[mission.sources.length - 1].id
    : null;
  // Publishing is offered on settled missions only — a cancelled/archived run
  // should not gain a fresh Grimoire entry after the fact.
  const settled = ["checkpoint", "completed", "failed"].includes(mission.status);

  /** Failures arrive as { ok: false } from the hook; the catch is transport
   *  defense only — a throw skips the ok branch, so a failure is never
   *  reported twice. State from an act that settles after a mission switch
   *  is discarded, and busy always clears for the mission that set it. */
  const act = async (input: ResearchMissionActionInput) => {
    const startedFor = mission.id;
    const stillCurrent = () => missionIdRef.current === startedFor;
    setBusy(true);
    setError(null);
    try {
      const result = await onAction(input);
      if (!result.ok && stillCurrent()) {
        const message = result.error ?? "Evidence could not be updated";
        setError(message);
        announce(message);
      }
      return result.ok && stillCurrent();
    } catch (cause) {
      if (stillCurrent()) {
        const message = cause instanceof Error ? cause.message : "Evidence could not be updated";
        setError(message);
        announce(message);
      }
      return false;
    } finally {
      if (stillCurrent()) setBusy(false);
    }
  };

  const publishArtifact = async (artifactKey: string) => {
    const ok = await act({ action: "publish-artifact", artifactKey });
    if (ok) announce("Artifact published to the Grimoire.");
  };

  const attach = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !url.trim()) return;
    const ok = await act({
      action: "attach-source",
      source: {
        id: `manual-${Date.now().toString(36)}`,
        title: title.trim(),
        url: url.trim(),
        sourceType: "web",
        status: "candidate",
      },
    });
    if (ok) {
      setTitle("");
      setUrl("");
      announce("Source attached.");
    }
  };

  return (
    <div className="research-output-shelf">
      {/* Panels below are keyed by mission so uncontrolled disclosure state
          (reject editors, the attach form) can never survive a mission switch —
          colliding per-mission artifact/source key shapes would otherwise let
          DOM reuse attach open state to the wrong mission's rows. */}
      {error ? <p className="research-mission-error" role="alert">{error}</p> : null}
      {hint ? <p className="research-desk-rail__hint">{hint}</p> : null}
      <section
        id="research-output-panel-artifacts"
        key={`artifacts-${mission.id}`}
        role="tabpanel"
        aria-labelledby="research-output-tab-artifacts"
        hidden={tab !== "artifacts"}
      >
        {/* The rail's toggle is the visible label for this pane; the heading
            stays for screen readers so the tabpanel keeps a name. */}
        <h3 className="sr-only">Artifacts</h3>
        {mission.artifacts.length === 0 ? (
          <p className="research-output-empty">Working artifacts appear here.</p>
        ) : (
          <ul>
            {mission.artifacts.map((artifact) => (
              <li key={artifact.key} className="research-artifact-card">
                <span className="research-artifact-card__kind">{artifact.kind}</span>
                <strong>{artifact.title}</strong>
                <span>
                  {artifact.state} · iteration {artifact.iteration} ·{" "}
                  <time dateTime={artifact.updatedAt}>{relativeTime(artifact.updatedAt) || "just now"}</time>
                </span>
                {artifact.rejectionReason ? <p>{artifact.rejectionReason}</p> : null}
                <ResearchArtifactActions
                  mission={mission}
                  artifact={artifact}
                  busy={busy}
                  onPublish={settled ? publishArtifact : undefined}
                />
                {artifact.state !== "rejected" ? (
                  <details className="research-artifact-reject">
                    <summary>Reject artifact</summary>
                    <input
                      value={rejection[artifact.key] ?? ""}
                      onChange={(event) => setRejection((current) => ({
                        ...current,
                        [artifact.key]: event.target.value,
                      }))}
                      placeholder="Why should this be revised?"
                      aria-label={`Rejection reason for ${artifact.title}`}
                    />
                    <Button
                      size="xs"
                      variant="danger-ghost"
                      disabled={busy || !(rejection[artifact.key] ?? "").trim()}
                      onClick={() => void act({
                        action: "reject-artifact",
                        artifactKey: artifact.key,
                        reason: rejection[artifact.key] ?? "",
                      })}
                    >
                      Reject artifact
                    </Button>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        id="research-output-panel-sources"
        key={`sources-${mission.id}`}
        role="tabpanel"
        aria-labelledby="research-output-tab-sources"
        hidden={tab !== "sources"}
      >
        <h3 className="sr-only">Sources</h3>
        <details className="research-source-attach-disclosure">
          <summary>Attach source</summary>
          <form className="research-source-attach" onSubmit={attach}>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Source title"
              aria-label="Source title"
            />
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://…"
              aria-label="Source URL"
            />
            <Button type="submit" size="xs" variant="ghost" disabled={busy || !title.trim() || !url.trim()}>
              Attach
            </Button>
          </form>
        </details>
        {mission.sources.length > 0 ? (
          <div className="research-source-filters" role="group" aria-label="Filter sources by status">
            <button
              type="button"
              aria-pressed={sourceFilter === "all"}
              onClick={() => setSourceFilter("all")}
            >
              all <span>{mission.sources.length}</span>
            </button>
            {SOURCE_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                aria-pressed={sourceFilter === status}
                disabled={sourceCounts[status] === 0}
                onClick={() => setSourceFilter(status)}
              >
                {status} <span>{sourceCounts[status]}</span>
              </button>
            ))}
          </div>
        ) : null}
        {mission.sources.length === 0 ? (
          <p className="research-output-empty">The familiar’s source ledger is still empty.</p>
        ) : visibleSources.length === 0 ? (
          <p className="research-output-empty">No {sourceFilter} sources.</p>
        ) : (
          <ResearchSourceRows
            sources={visibleSources}
            onOpenUrl={onOpenUrl}
            latestSourceId={latestSourceId}
            renderActions={(source) => (
              <>
                {/* Checkpoint triage: the verdicts the pass is actually waiting
                    on, as one-tap buttons. The status control stays for
                    revisiting any source at any time. */}
                {triage && (source.status === "candidate" || source.status === "conflicting") ? (
                  <div className="research-desk-delta__actions">
                    <Button
                      size="xs"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void act({
                        action: "update-source",
                        sourceId: source.id,
                        patch: { status: "used" },
                      })}
                    >
                      Keep
                    </Button>
                    <Button
                      size="xs"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void act({
                        action: "update-source",
                        sourceId: source.id,
                        patch: { status: "rejected" },
                      })}
                    >
                      Reject
                    </Button>
                    {source.status === "conflicting" ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={busy || (source.note ?? "").includes(VERIFY_NOTE)}
                        onClick={() => void act({
                          action: "update-source",
                          sourceId: source.id,
                          patch: {
                            status: "conflicting",
                            note: source.note ? `${source.note}\n${VERIFY_NOTE}` : VERIFY_NOTE,
                          },
                        })}
                      >
                        Verify next pass
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                <label className="research-source-revise">
                  <span className="sr-only">Status of {source.title}</span>
                  <select
                    value={source.status}
                    disabled={busy}
                    onChange={(event) => void act({
                      action: "update-source",
                      sourceId: source.id,
                      patch: { status: event.target.value as ResearchSourceRef["status"] },
                    })}
                  >
                    {SOURCE_STATUSES.map((status) => <option key={status}>{status}</option>)}
                  </select>
                </label>
                {!source.url && source.localPath ? <span>{source.localPath}</span> : null}
              </>
            )}
          />
        )}
      </section>
    </div>
  );
}
