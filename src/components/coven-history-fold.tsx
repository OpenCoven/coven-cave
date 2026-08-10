"use client";

/**
 * The earlier-runs fold above the transcript (design proposal §6).
 *
 * A conversation accumulates runs; older ones are context, not the thing being
 * read. This folds them into a labelled divider plus one collapsed card for the
 * most recent of them, expandable to its turns — so scrolling back through
 * yesterday's work is a choice rather than the default.
 */

import { useId, useState } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import { COVEN_RUN_STATUS, type CovenHistoryFold } from "@/lib/coven-run";

export function CovenHistoryFoldView({
  fold,
  byId,
  formatTime,
}: {
  fold: CovenHistoryFold;
  byId: Map<string, ResolvedFamiliar>;
  formatTime: (iso: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const turnsId = useId();
  return (
    <div className="coven-history">
      <div className="coven-history__divider">
        <span className="coven-history__rule" aria-hidden />
        {fold.label}
        <span className="coven-history__rule" aria-hidden />
      </div>
      <div className="coven-history__card">
        <div className="coven-history__head">
          <Icon
            name={fold.icon}
            width={12}
            height={12}
            className="coven-history__glyph"
            data-tone={fold.tone}
            aria-hidden
          />
          <span className="coven-history__title" title={fold.title}>
            {fold.title}
          </span>
          <span className="coven-history__meta">{fold.meta}</span>
          <button
            type="button"
            className="coven-history__toggle focus-ring"
            aria-expanded={open}
            aria-controls={turnsId}
            aria-label={`${open ? "Collapse" : "Expand"} ${fold.title}`}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Collapse" : "Expand"}
          </button>
        </div>
        {open ? (
          <div className="coven-history__turns" id={turnsId}>
            {fold.turns.map((turn) => {
              const familiar = byId.get(turn.familiarId);
              const meta = COVEN_RUN_STATUS[turn.status];
              const name = familiar?.display_name ?? turn.familiarId;
              return (
                <div key={turn.replyId} className="coven-history__turn">
                  {familiar ? (
                    <FamiliarAvatar familiar={familiar} size="sm" className="coven-history__avatar" />
                  ) : (
                    <span className="coven-history__avatar" aria-hidden />
                  )}
                  <div className="coven-history__body">
                    <div className="coven-history__byline">
                      <span className="coven-history__name">{name}</span>
                      {/* Each row carries its OWN status: the frame hardcodes
                          "Complete" on every history row, and a real failure
                          must not be laundered into a success by folding it. */}
                      <span className="coven-history__status" data-tone={meta.tone}>
                        <Icon name={meta.icon} width={9} height={9} aria-hidden />
                        {meta.label}
                      </span>
                      <time className="coven-history__time" dateTime={turn.createdAt}>
                        {formatTime(turn.createdAt)}
                      </time>
                    </div>
                    <p className="coven-history__text">{turn.text}</p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default CovenHistoryFoldView;
