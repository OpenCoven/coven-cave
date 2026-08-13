"use client";

/**
 * The source ledger as scannable ROWS rather than stacked cards.
 *
 * A card per source stacks status, title, claim and controls vertically, so
 * comparing ten sources means reading ten little paragraphs and nothing lines
 * up. A ledger is a table by nature: the questions asked of it are "which of
 * these are still unverified", "which publisher said this", "when" — all
 * column comparisons.
 *
 * This is a real <table>, not a grid of divs, because the content IS tabular:
 * screen readers then announce row/column position and header association for
 * free, which a div grid has to reconstruct with ARIA and usually gets wrong.
 * Cells that can be empty always render, so columns stay aligned across rows.
 */

import type { ReactNode } from "react";
import { Icon } from "@/lib/icon";
import type { ResearchSourceRef } from "@/lib/research-missions";

export type ResearchSourceRowsProps = {
  sources: ResearchSourceRef[];
  /** Opens a source's URL through the caller's navigation policy. */
  onOpenUrl(url: string): void;
  /** Marked so a streaming run shows where the newest evidence landed. */
  latestSourceId?: string | null;
  /** Per-row controls (triage verdicts, status select) supplied by the caller. */
  renderActions?(source: ResearchSourceRef): ReactNode;
  caption?: string;
};

/** Publisher · date, collapsed to whichever parts exist. */
export function sourceProvenance(source: ResearchSourceRef): string {
  const published = source.publishedAt?.trim();
  // Dates arrive as ISO or as free text from the harness; show the date part of
  // an ISO value and pass anything else through untouched rather than risking
  // Date parsing turning "2024" into a wrong day.
  const date = published && /^\d{4}-\d{2}-\d{2}/.test(published)
    ? published.slice(0, 10)
    : published;
  return [source.publisher?.trim(), date].filter(Boolean).join(" · ");
}

export function ResearchSourceRows({
  sources,
  onOpenUrl,
  latestSourceId,
  renderActions,
  caption = "Source ledger",
}: ResearchSourceRowsProps) {
  return (
    <div className="research-source-rows">
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Status</th>
            <th scope="col">Source</th>
            <th scope="col">Publisher</th>
            <th scope="col">Claim</th>
            {renderActions ? <th scope="col"><span className="sr-only">Actions</span></th> : null}
          </tr>
        </thead>
        <tbody>
          {sources.map((source) => {
            const provenance = sourceProvenance(source);
            const isLatest = Boolean(latestSourceId) && source.id === latestSourceId;
            return (
              <tr
                key={source.id}
                className={isLatest ? "is-latest" : undefined}
                // The newest row is announced rather than only tinted, so the
                // highlight is not colour-only information.
                aria-current={isLatest ? "true" : undefined}
              >
                <td>
                  <span className={`research-source-status research-source-status--${source.status}`}>
                    <i aria-hidden />{source.status}
                  </span>
                </td>
                <th scope="row" className="research-source-rows__title">
                  {source.url ? (
                    <button type="button" onClick={() => onOpenUrl(source.url!)}>
                      <span>{source.title}</span>
                      <Icon name="ph:arrow-square-out" width={11} height={11} aria-hidden />
                      <span className="sr-only"> — opens the source</span>
                    </button>
                  ) : (
                    <span>{source.title}</span>
                  )}
                  {isLatest ? <span className="sr-only">Most recently added</span> : null}
                </th>
                {/* Rendered even when empty so the columns stay aligned; an
                    em dash reads as "nothing recorded" rather than as a gap. */}
                <td className="research-source-rows__meta">{provenance || "—"}</td>
                <td className="research-source-rows__claim">{source.claim?.trim() || "—"}</td>
                {renderActions ? (
                  <td className="research-source-rows__actions">{renderActions(source)}</td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
