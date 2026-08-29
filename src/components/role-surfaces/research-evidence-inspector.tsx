"use client";

import { Icon } from "@/lib/icon";
import type { FindingsSupportTarget } from "@/lib/research-findings-doc";
import type { ResearchSourceRef } from "@/lib/research-missions";

export type ResearchEvidenceInspectorProps = {
  sources: ResearchSourceRef[];
  integrityLabel: string;
  selectedId: string | null;
  openIds: ReadonlySet<string>;
  targetsBySource: ReadonlyMap<string, readonly FindingsSupportTarget[]>;
  onToggle: (id: string) => void;
  onOpenUrl: (url: string) => void;
  onCite: (source: ResearchSourceRef) => void;
  onSupport: (target: FindingsSupportTarget) => void;
  onClose: () => void;
};

type SourceStatusView = {
  groupLabel: string;
  label: string;
  tone: "ok" | "warn" | "muted" | "rejected";
  refTone: "accent" | "warn" | "muted";
};

const STATUS_PRIORITY: ResearchSourceRef["status"][] = [
  "used",
  "candidate",
  "conflicting",
  "rejected",
];

const STATUS_VIEW: Record<ResearchSourceRef["status"], SourceStatusView> = {
  used: {
    groupLabel: "Used",
    label: "Verified",
    tone: "ok",
    refTone: "accent",
  },
  candidate: {
    groupLabel: "Candidate",
    label: "Candidate",
    tone: "muted",
    refTone: "accent",
  },
  conflicting: {
    groupLabel: "Conflicting",
    label: "Conflicts",
    tone: "warn",
    refTone: "warn",
  },
  rejected: {
    groupLabel: "Rejected",
    label: "Rejected",
    tone: "rejected",
    refTone: "muted",
  },
};

function sourceMeta(source: ResearchSourceRef): string {
  const parts = [source.publisher || source.sourceType];
  if (source.publishedAt) parts.push(source.publishedAt);
  if (source.url) parts.push("fetched");
  else if (source.localPath) parts.push("local");
  return parts.filter(Boolean).join(" · ");
}

function sourceVariant(source: ResearchSourceRef): string {
  if (source.status === "conflicting") return " rr-src--warn";
  if (source.status === "rejected") return " rr-src--rejected";
  return "";
}

export function ResearchEvidenceInspector({
  sources,
  integrityLabel,
  selectedId,
  openIds,
  targetsBySource,
  onToggle,
  onOpenUrl,
  onCite,
  onSupport,
  onClose,
}: ResearchEvidenceInspectorProps) {
  const sourceCountLabel = `${sources.length} source${sources.length === 1 ? "" : "s"}`;

  return (
    <aside
      className="research-evidence-inspector"
      aria-label="Evidence inspector"
      data-selected-source={selectedId ?? undefined}
    >
      <header className="research-evidence-inspector__header">
        <div className="research-evidence-inspector__heading">
          <h2>Evidence</h2>
          <span className="research-evidence-inspector__count">
            {sourceCountLabel}
          </span>
        </div>
        <p className="research-evidence-inspector__integrity">
          {integrityLabel}
        </p>
        <button
          className="research-evidence-inspector__close focus-ring"
          type="button"
          title="Close evidence inspector"
          aria-label="Close evidence inspector"
          onClick={onClose}
        >
          <Icon name="ph:x" width={13} height={13} aria-hidden />
        </button>
      </header>

      <div className="research-evidence-inspector__list">
        {STATUS_PRIORITY.map((status) => {
          const statusSources = sources.filter(
            (source) => source.status === status,
          );
          if (statusSources.length === 0) return null;

          const view = STATUS_VIEW[status];
          const headingId = `research-evidence-group-${status}`;
          return (
            <section
              key={status}
              className={`research-evidence-inspector__group research-evidence-inspector__group--${status}`}
              aria-labelledby={headingId}
              data-source-status={status}
            >
              <h3
                id={headingId}
                className="research-evidence-inspector__group-label"
              >
                {view.groupLabel}
              </h3>
              {statusSources.map((source) => {
                const open = openIds.has(source.id);
                const selected = selectedId === source.id;
                const targets = targetsBySource.get(source.id) ?? [];
                const detailId = `research-evidence-source-${source.id}`;
                const refToneClass =
                  view.refTone === "warn"
                    ? " rr-sref--warn"
                    : view.refTone === "muted"
                      ? " rr-sref--muted"
                      : "";

                return (
                  <article
                    key={source.id}
                    className={`research-evidence-card rr-src${sourceVariant(source)}${selected ? " is-selected is-match" : ""}`}
                    aria-current={selected ? "true" : undefined}
                    data-open={open ? "true" : "false"}
                    data-selected={selected ? "true" : "false"}
                    data-source-id={source.id}
                    data-source-status={source.status}
                  >
                    <button
                      className="research-evidence-card__toggle rr-src__toggle focus-ring"
                      type="button"
                      aria-expanded={open}
                      aria-controls={detailId}
                      onClick={() => onToggle(source.id)}
                    >
                      <span className="rr-src__head">
                        <span className={`rr-sref${refToneClass}`}>
                          {source.id}
                        </span>
                        <span
                          className={`rr-srcstat rr-srcstat--${view.tone}`}
                        >
                          <i className="rr-srcstat__dot" aria-hidden />
                          {view.label}
                        </span>
                        <Icon
                          name="ph:caret-down"
                          width={13}
                          height={13}
                          className="rr-srccaret"
                          aria-hidden
                        />
                      </span>
                      <span className="rr-src__title">{source.title}</span>
                      <span className="rr-src__meta">
                        {sourceMeta(source)}
                      </span>
                    </button>

                    <div
                      id={detailId}
                      className="research-evidence-card__detail rr-srcdetail"
                      hidden={!open}
                    >
                      {source.claim ? (
                        <div className="rr-sd-quote">“{source.claim}”</div>
                      ) : null}
                      {source.publisher || source.publishedAt ? (
                        <div className="rr-sd-row">
                          <span className="rr-sd-k">Source</span>
                          <span className="rr-sd-v">
                            {[source.publisher, source.publishedAt]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </div>
                      ) : null}
                      <div className="rr-sd-row">
                        <span className="rr-sd-k">Type</span>
                        <span className="rr-sd-v">{source.sourceType}</span>
                      </div>
                      {source.note ? (
                        <div className="rr-sd-row">
                          <span className="rr-sd-k">
                            {source.status === "rejected" ? "Rejected" : "Note"}
                          </span>
                          <span className="rr-sd-v">{source.note}</span>
                        </div>
                      ) : null}
                      {source.confidence !== undefined ? (
                        <div className="rr-sd-row">
                          <span className="rr-sd-k">Confidence</span>
                          <span className="rr-sd-v">
                            {Math.round(source.confidence * 100)}%
                          </span>
                        </div>
                      ) : null}
                      {targets.length > 0 ? (
                        <div className="rr-sd-supports">
                          <span className="rr-sd-supports__label">
                            Supports
                          </span>
                          {targets.map((target) => (
                            <button
                              key={target.id}
                              className="rr-sd-supportlink focus-ring"
                              type="button"
                              onClick={() => onSupport(target)}
                            >
                              {target.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <div className="rr-sd-actions">
                        <button
                          className="rr-sd-btn rr-sd-btn--accent focus-ring"
                          type="button"
                          disabled={!source.url}
                          onClick={() => {
                            if (source.url) onOpenUrl(source.url);
                          }}
                        >
                          <Icon
                            name="ph:arrow-square-out"
                            width={13}
                            height={13}
                            aria-hidden
                          />
                          Open source
                        </button>
                        <button
                          className="rr-sd-btn focus-ring"
                          type="button"
                          onClick={() => onCite(source)}
                        >
                          <Icon
                            name="ph:copy"
                            width={13}
                            height={13}
                            aria-hidden
                          />
                          Cite
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
