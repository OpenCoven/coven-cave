"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { Tabs } from "@/components/ui/tabs";
import { Icon } from "@/lib/icon";
import { openGrimoireDoc } from "@/lib/grimoire-link";
import {
  researchSourceStatusCounts,
  type ResearchMission,
  type ResearchMissionActionInput,
  type ResearchSourceRef,
} from "@/lib/research-missions";
import { relativeTime } from "@/lib/relative-time";

type Props = {
  mission: ResearchMission;
  onAction(input: ResearchMissionActionInput): Promise<{ ok: boolean; error?: string }>;
  onOpenUrl(url: string): void;
};

const SOURCE_STATUSES: ResearchSourceRef["status"][] = [
  "candidate",
  "used",
  "conflicting",
  "rejected",
];

export function ResearchEvidenceLedger({ mission, onAction, onOpenUrl }: Props) {
  const { announce } = useAnnouncer();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [rejection, setRejection] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputTab, setOutputTab] = useState<"artifacts" | "sources">("artifacts");
  const [sourceFilter, setSourceFilter] = useState<"all" | ResearchSourceRef["status"]>("all");

  useEffect(() => {
    setSourceFilter("all");
  }, [mission.id]);

  const sourceCounts = researchSourceStatusCounts(mission.sources);
  const visibleSources = sourceFilter === "all"
    ? mission.sources
    : mission.sources.filter((source) => source.status === sourceFilter);

  const act = async (input: ResearchMissionActionInput) => {
    setBusy(true);
    setError(null);
    try {
      const result = await onAction(input);
      if (!result.ok) {
        const message = result.error ?? "Evidence could not be updated";
        setError(message);
        announce(message);
      }
      return result.ok;
    } finally {
      setBusy(false);
    }
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
    <aside className="research-output-shelf" aria-label="Research outputs">
      <Tabs<"artifacts" | "sources">
        className="research-output-tabs"
        idPrefix="research-output"
        ariaLabel="Research output type"
        size="sm"
        fill
        value={outputTab}
        onChange={setOutputTab}
        items={[
          { id: "artifacts", label: "Artifacts", count: mission.artifacts.length },
          { id: "sources", label: "Sources", count: mission.sources.length },
        ]}
      />
      {error ? <p className="research-mission-error" role="alert">{error}</p> : null}
      <section
        id="research-output-panel-artifacts"
        role="tabpanel"
        aria-labelledby="research-output-tab-artifacts"
        hidden={outputTab !== "artifacts"}
      >
        <h3>Artifacts</h3>
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
                {artifact.knowledgeId ? (
                  <button
                    type="button"
                    onClick={() => openGrimoireDoc("knowledge", artifact.knowledgeId!)}
                  >
                    Open in Grimoire
                    <Icon name="ph:arrow-square-out" width={12} height={12} aria-hidden />
                  </button>
                ) : null}
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
        role="tabpanel"
        aria-labelledby="research-output-tab-sources"
        hidden={outputTab !== "sources"}
      >
        <h3>Sources</h3>
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
          <ul>
            {visibleSources.map((source) => (
              <li key={source.id} className="research-source-card">
                <span className={`research-source-status research-source-status--${source.status}`}>
                  <i aria-hidden />{source.status}
                </span>
                {source.url ? (
                  <button
                    type="button"
                    className="research-source-card__title"
                    onClick={() => onOpenUrl(source.url!)}
                  >
                    <strong>{source.title}</strong>
                    <Icon name="ph:arrow-square-out" width={11} height={11} aria-hidden />
                    <span className="sr-only"> — opens the source</span>
                  </button>
                ) : (
                  <strong>{source.title}</strong>
                )}
                {source.claim ? <p>{source.claim}</p> : null}
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
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
