"use client";

// SHIPPED — the day's merged pull requests as an always-visible trigger strip
// plus an index panel that opens UPWARD (the strip sits at the bottom of the
// report).
//
// The parent owns `open` and the positioning context (a `position: relative`
// box); it also implements Escape / click-away against the
// `data-panel-trigger="shipped"` / `data-panel="shipped"` attributes below.
//
// Every number comes from `DayModel.shipped`. A PR whose line counts were never
// carried by a session renders a muted "—" — never a fabricated "+0 −0", which
// would misreport the day. The report hands off to GitHub for PR detail rather
// than restating it.

import { useMemo, useState, type JSX } from "react";

import type { DayModel, ShippedRow } from "@/lib/daily-report-day";
import { filterShippedRows } from "@/lib/shipped-table";
import { Icon } from "@/lib/icon";

import "@/styles/daily-report-shipped.css";

const PANEL_ID = "drd-ship-panel";

/** Rows drawn in the left table; everything past this falls to the index. */
const TABLE_ROWS = 12;
/** Index entries revealed before the "SHOW N MORE" button. */
const INDEX_PREVIEW = 6;
/** Repo chips the trigger shows before collapsing the tail into "+N". */
const TRIGGER_CHIPS = 4;

const ALL = "all";

function num(n: number): string {
  return n.toLocaleString();
}

function Lines({ row }: { row: ShippedRow }) {
  if (row.additions == null || row.deletions == null) {
    return (
      <span
        className="drd-ship-lines drd-ship-lines--absent"
        title="No session carried line counts for this pull request"
      >
        —
      </span>
    );
  }
  return (
    <span className="drd-ship-lines">
      <span className="drd-ship-add">+{num(row.additions)}</span>{" "}
      <span className="drd-ship-del">−{num(row.deletions)}</span>
    </span>
  );
}

export function ShippedPanel({
  model,
  open,
  onToggle,
}: {
  model: DayModel;
  open: boolean;
  onToggle: () => void;
}): JSX.Element {
  const [repo, setRepo] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [indexExpanded, setIndexExpanded] = useState(false);

  const shipped = model.shipped;
  const q = query.trim().toLowerCase();

  // A search HIDES what it excludes — dimming thirty rows to find one is not
  // usable. A repo filter only dims, which is what the design asks for: the
  // day's shape stays visible while one project is picked out of it.
  const visible = useMemo(() => filterShippedRows(shipped.rows, q), [shipped.rows, q]);
  const matchCount = useMemo(
    () => visible.filter((row) => repo === ALL || row.repoLabel === repo).length,
    [visible, repo],
  );

  const table = visible.slice(0, TABLE_ROWS);
  const rest = visible.slice(TABLE_ROWS);
  const indexShown = indexExpanded ? rest : rest.slice(0, INDEX_PREVIEW);
  const moreCount = rest.length - indexShown.length;

  const dimmed = (row: ShippedRow) => (repo !== ALL && row.repoLabel !== repo ? "true" : undefined);

  if (shipped.total === 0) {
    return (
      <div className="drd-ship-trigger drd-ship-trigger--empty" data-panel-trigger="shipped">
        <span className="drd-ship-glyph drd-ship-glyph--quiet">
          <Icon name="ph:git-merge" aria-hidden />
        </span>
        <span className="drd-ship-kicker">SHIPPED</span>
        <span className="drd-ship-quiet">Nothing shipped — no pull requests merged on this day.</span>
      </div>
    );
  }

  const spanLabel =
    shipped.firstTime && shipped.lastTime ? `${shipped.firstTime} — ${shipped.lastTime}` : null;
  const chips = shipped.repos.slice(0, TRIGGER_CHIPS);
  const chipOverflow = shipped.repos.length - chips.length;

  return (
    <>
      <button
        type="button"
        className="drd-ship-trigger"
        data-panel-trigger="shipped"
        aria-expanded={open}
        aria-controls={PANEL_ID}
        onClick={onToggle}
      >
        <span className="drd-ship-glyph">
          <Icon name="ph:git-pull-request" aria-hidden />
        </span>
        <span className="drd-ship-kicker">SHIPPED</span>
        <span className="drd-ship-total">{num(shipped.total)}</span>
        <span className="drd-ship-summary">
          merges · {num(model.projectCount)} {model.projectCount === 1 ? "project" : "projects"} ·{" "}
          <span className="drd-ship-add">+{num(model.additions)}</span>{" "}
          <span className="drd-ship-del">−{num(model.deletions)}</span>
          {spanLabel ? <> · {spanLabel}</> : null}
        </span>
        <span className="drd-ship-chips">
          {chips.map((facet) => (
            <span key={facet.key} className="drd-ship-chip">
              {facet.label} {num(facet.count)}
            </span>
          ))}
          {chipOverflow > 0 ? <span className="drd-ship-chip">+{num(chipOverflow)}</span> : null}
        </span>
        <span className="drd-ship-affordance">
          {open ? "COLLAPSE" : "EXPAND"}
          <Icon name={open ? "ph:caret-up" : "ph:caret-down"} aria-hidden />
        </span>
      </button>

      {open ? (
        <div className="drd-ship-panel" data-panel="shipped" id={PANEL_ID}>
          <div className="drd-ship-controls">
            <span className="drd-ship-kicker">FILTER</span>
            <div className="drd-ship-facets" role="group" aria-label="Filter by project">
              <button
                type="button"
                className="drd-ship-facet"
                aria-pressed={repo === ALL}
                onClick={() => setRepo(ALL)}
              >
                ALL {num(shipped.total)}
              </button>
              {shipped.repos.map((facet) => (
                <button
                  key={facet.key}
                  type="button"
                  className="drd-ship-facet"
                  aria-pressed={repo === facet.label}
                  onClick={() => setRepo(facet.label)}
                >
                  {facet.label} {num(facet.count)}
                </button>
              ))}
            </div>
            <label className="drd-ship-search">
              <span className="drd-ship-sr">Filter shipped work</span>
              <span className="drd-ship-search-glyph">
                <Icon name="ph:magnifying-glass" aria-hidden />
              </span>
              <input
                type="search"
                className="drd-ship-search-input"
                value={query}
                placeholder="Filter shipped work…"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>

          <p className="drd-ship-live" role="status" aria-live="polite">
            {num(matchCount)} of {num(shipped.total)} shown
          </p>

          <div className="drd-ship-body" data-index={rest.length > 0 ? "on" : "off"}>
            {table.length === 0 ? (
              <p className="drd-ship-none">Nothing matches that filter.</p>
            ) : (
              <div className="drd-ship-table" role="table" aria-label="Merged pull requests">
                <div className="drd-ship-head" role="row">
                  <span role="columnheader">PR</span>
                  <span role="columnheader">TITLE</span>
                  <span role="columnheader">LINES</span>
                  <span role="columnheader" className="drd-ship-right">
                    MERGED
                  </span>
                </div>
                {table.map((row) => (
                  <div key={row.key} className="drd-ship-row" role="row" data-dim={dimmed(row)}>
                    <span className="drd-ship-num" role="cell">
                      #{row.number}
                    </span>
                    <span className="drd-ship-title" role="cell">
                      <a
                        className="drd-ship-link"
                        href={row.url}
                        target="_blank"
                        rel="noreferrer"
                        title={`${row.repoLabel}#${row.number} — ${row.title}`}
                      >
                        {row.title}
                      </a>
                      <span className="drd-ship-out">
                        <Icon name="ph:arrow-square-out" aria-hidden />
                      </span>
                    </span>
                    <span role="cell">
                      <Lines row={row} />
                    </span>
                    <span className="drd-ship-time drd-ship-right" role="cell">
                      {row.time}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {rest.length > 0 ? (
              <div className="drd-ship-index">
                <div className="drd-ship-kicker drd-ship-index-head">THE REST OF THE INDEX</div>
                <div className="drd-ship-index-cols">
                  {indexShown.map((row) => (
                    <a
                      key={row.key}
                      className="drd-ship-index-item"
                      data-dim={dimmed(row)}
                      href={row.url}
                      target="_blank"
                      rel="noreferrer"
                      title={`${row.repoLabel}#${row.number} — ${row.title}`}
                    >
                      <span className="drd-ship-num">{row.number}</span> {row.title}
                    </a>
                  ))}
                </div>
                {moreCount > 0 ? (
                  <button
                    type="button"
                    className="drd-ship-more"
                    onClick={() => setIndexExpanded(true)}
                  >
                    SHOW {num(moreCount)} MORE
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
