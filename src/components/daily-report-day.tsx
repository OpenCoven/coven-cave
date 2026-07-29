"use client";

// The redesigned daily report — the "chaptered day".
//
// Chrome (week strip + refresh/share) → stat band → the day carousel →
// chapters rail | the written page + spine | the cast → shipped.
// Everything renders from the derived DayModel; this component owns only
// selection state (which chapter, which panel, which modal).

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "@/lib/icon";
import { clockLabel, type Chapter, type DayModel, type DayTone } from "@/lib/daily-report-day";
import { DayCarousel } from "@/components/daily-report-carousel";
import { ShippedPanel } from "@/components/daily-report-shipped";
import { DayModals, type ReportModal } from "@/components/daily-report-modals";
import { DailyReportPrModal, type PrTarget } from "@/components/daily-report-pr-modal";
import "@/styles/daily-report-day.css";

export type WeekCell = {
  slug: string;
  /** Single-letter weekday initial. */
  letter: string;
  /** Day-of-month, unpadded. */
  num: string;
  /** Activity level 0–1 — paints the cell's bar. */
  level: number;
  selected: boolean;
  hasReport: boolean;
  /** After today — there is nothing to report yet, so it is not navigable. */
  isFuture: boolean;
  title: string;
};

type Props = {
  model: DayModel;
  /** "Monday, July 27" */
  dateLabel: string;
  /** The stat band's kicker — "DAILY REPORT · JUL 27". */
  kicker: string;
  /** The stat band's headline sentence. */
  headline: string;
  week: WeekCell[];
  /** "JUL 21 — JUL 27" */
  weekLabel: string;
  prevWeekSlug: string;
  nextWeekSlug: string;
  /** False once the strip has reached the current week — the cave cannot
   *  report on a day that has not happened, so forward paging stops here. */
  canGoForward: boolean;
  isToday: boolean;
  /** The familiar-written narrative, next-paths already stripped. */
  narrative: string | null;
  narrativeByline: string | null;
  shareImageUrl: string | null;
  /** The frozen summary body — the pre-narrative fallback. */
  summaryBody: string | null;
};

const TONE_VAR: Record<DayTone, string> = {
  accent: "var(--accent-presence)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)",
  muted: "var(--fg-muted)",
};

/** -1 = "the whole day"; otherwise a chapter index. */
const WHOLE_DAY = -1;

/** A chapter names its evidence, it doesn't reprint the changelog — the
 *  shipped panel below is where the full list lives. */
const CHAPTER_EVIDENCE_LIMIT = 10;

function toneStyle(tone: DayTone): React.CSSProperties {
  return { ["--drd-tone" as string]: TONE_VAR[tone] };
}

function signed(n: number): string {
  return n > 0 ? `+${n.toLocaleString()}` : n.toLocaleString();
}

export function DailyReportDay({
  model,
  dateLabel,
  kicker,
  headline,
  week,
  weekLabel,
  prevWeekSlug,
  nextWeekSlug,
  canGoForward,
  isToday,
  narrative,
  narrativeByline,
  shareImageUrl,
  summaryBody,
}: Props): JSX.Element {
  const router = useRouter();

  const [chapter, setChapter] = useState<number>(WHOLE_DAY);
  const [more, setMore] = useState(false);
  const [carouselOpen, setCarouselOpen] = useState(false);
  const [shipOpen, setShipOpen] = useState(false);
  const [castOpen, setCastOpen] = useState(true);
  const [modal, setModal] = useState<ReportModal>(null);
  const [pr, setPr] = useState<PrTarget | null>(null);
  const [refresh, setRefresh] = useState<"idle" | "busy" | "done">("idle");
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Escape closes the top-most layer; click-away collapses the inline panels.
  // Clicks inside a panel or on its trigger are ignored — otherwise the panel
  // would unmount on mousedown and swallow the row's own click.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Unwind the layer stack top-down: the PR card sits above the dialogs,
      // which sit above the inline panels.
      setPr((current) => {
        if (current) return null;
        setModal((m) => {
          if (m) return null;
          setCarouselOpen(false);
          setShipOpen(false);
          return m;
        });
        return current;
      });
    };
    const onAway = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest) return;
      if (target.closest("[data-panel]") || target.closest("[data-panel-trigger]")) return;
      setCarouselOpen(false);
      setShipOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onAway, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onAway, true);
    };
  }, []);

  useEffect(() => () => {
    if (doneTimer.current) clearTimeout(doneTimer.current);
  }, []);

  // Re-reads the persisted inbox and the frozen facts on the server. The
  // POST path that rebuilds the facts needs the live session list, which this
  // standalone route does not hold — posting an empty one would regress them.
  const onRefresh = useCallback(() => {
    setRefresh("busy");
    router.refresh();
    if (doneTimer.current) clearTimeout(doneTimer.current);
    doneTimer.current = setTimeout(() => {
      setRefresh("done");
      doneTimer.current = setTimeout(() => setRefresh("idle"), 2200);
    }, 550);
  }, [router]);

  const active: Chapter | null =
    chapter >= 0 && chapter < model.chapters.length ? model.chapters[chapter] : null;

  // The whole-day view leads with the familiar's narrative; a chapter view
  // rewrites the page with that chapter's own derived prose.
  const paragraphs = useMemo(
    () =>
      (narrative ?? summaryBody ?? "")
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean),
    [narrative, summaryBody],
  );

  const activeChapterIndex = active ? active.index : null;

  const readingMinutes = useMemo(() => {
    const words = (narrative ?? summaryBody ?? "").split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 200));
  }, [narrative, summaryBody]);

  return (
    <div className="drd">
      {/* ── chrome ───────────────────────────────────────────────────── */}
      <header className="drd-chrome" data-tauri-drag-region="deep">
        <nav className="drd-crumbs" aria-label="Breadcrumb">
          <a className="drd-crumb" href="/dashboard">
            <Icon name="ph:arrow-left" aria-hidden />
            Dashboard
          </a>
          <span className="drd-crumb__sep" aria-hidden>
            /
          </span>
          <span className="drd-crumb__here">{dateLabel}</span>
        </nav>

        <div className="drd-chrome__actions">
          <div className="drd-week" role="group" aria-label="Pick a day">
            <a className="drd-week__step" href={`/daily-report/${prevWeekSlug}`} aria-label="Previous week">
              <Icon name="ph:caret-left" aria-hidden />
            </a>
            {week.map((day) => {
              const cell = (
                <>
                  <span className="drd-week__letter">{day.letter}</span>
                  <span className="drd-week__num">{day.num}</span>
                  <span className="drd-week__bar" aria-hidden />
                </>
              );
              const shared = {
                className: "drd-week__day",
                title: day.title,
                "data-selected": day.selected || undefined,
                "data-empty": !day.hasReport || undefined,
                style: { ["--drd-level" as string]: `${Math.round(day.level * 100)}%` },
              };
              // A future day has nothing to report — render it as a dead cell
              // rather than a link into an empty "not found" page.
              return day.isFuture ? (
                <span key={day.slug} {...shared} data-future aria-disabled="true">
                  {cell}
                </span>
              ) : (
                <a
                  key={day.slug}
                  {...shared}
                  href={`/daily-report/${day.slug}`}
                  aria-current={day.selected ? "date" : undefined}
                >
                  {cell}
                </a>
              );
            })}
            {canGoForward ? (
              <a className="drd-week__step" href={`/daily-report/${nextWeekSlug}`} aria-label="Next week">
                <Icon name="ph:caret-right" aria-hidden />
              </a>
            ) : (
              <span
                className="drd-week__step"
                data-disabled
                aria-disabled="true"
                title="This is the current week"
              >
                <Icon name="ph:caret-right" aria-hidden />
              </span>
            )}
          </div>

          <span className="drd-week__label">{weekLabel}</span>

          <button type="button" className="drd-btn" onClick={onRefresh} data-state={refresh}>
            {refresh === "idle" && (
              <>
                <Icon name="ph:arrows-clockwise" aria-hidden />
                Refresh
              </>
            )}
            {refresh === "busy" && (
              <>
                <Icon name="ph:circle-notch-bold" aria-hidden />
                Refreshing…
              </>
            )}
            {refresh === "done" && (
              <>
                <Icon name="ph:check-circle" aria-hidden />
                Up to date
              </>
            )}
          </button>

          <button type="button" className="drd-btn drd-btn--accent" onClick={() => setModal("share")}>
            <Icon name="ph:share-network" aria-hidden />
            Share
          </button>
        </div>
        {refresh === "busy" && <span className="drd-chrome__sweep" aria-hidden />}
      </header>

      {/* ── stat band ────────────────────────────────────────────────── */}
      <section className="drd-band" aria-label="The day at a glance">
        <div className="drd-band__lede">
          <div className="drd-band__text">
            <div className="drd-band__kicker">{kicker}</div>
            <div className="drd-band__headline">{headline}</div>
          </div>
          <span className="drd-seal" data-live={isToday || undefined}>
            <span className="drd-seal__dot" aria-hidden />
            {isToday ? "Live" : "Sealed"}
          </span>
        </div>

        <div className="drd-stat">
          <div className="drd-stat__label">SESSIONS</div>
          <div className="drd-stat__row">
            <span className="drd-stat__value">{model.stats.sessions}</span>
            {model.deltas.sessions && (
              <span className="drd-stat__delta" style={toneStyle(model.deltas.sessions.tone)}>
                {model.deltas.sessions.label}
              </span>
            )}
          </div>
        </div>

        <div className="drd-stat">
          <div className="drd-stat__label">PRS MERGED</div>
          <div className="drd-stat__row">
            <span className="drd-stat__value">{model.shipped.total}</span>
            {model.deltas.prsMerged && (
              <span className="drd-stat__delta" style={toneStyle(model.deltas.prsMerged.tone)}>
                {model.deltas.prsMerged.label}
              </span>
            )}
          </div>
        </div>

        <div className="drd-stat">
          <div className="drd-stat__label">
            {model.projectCount} {model.projectCount === 1 ? "PROJECT" : "PROJECTS"}
          </div>
          <div className="drd-stat__row drd-stat__row--diff">
            <span className="drd-stat__add">{signed(model.additions)}</span>
            <span className="drd-stat__del">−{model.deletions.toLocaleString()}</span>
          </div>
        </div>

        <div className="drd-stat drd-stat--streak">
          <div className="drd-stat__row">
            <span className="drd-stat__label">STREAK</span>
            <span className="drd-stat__value">{model.streak.current}</span>
          </div>
          <div className="drd-streak">
            {model.streak.days.map((lit, i) => (
              <span key={i} className="drd-streak__pip" data-lit={lit || undefined} aria-hidden />
            ))}
            <span className="drd-streak__best">BEST {model.streak.best}</span>
          </div>
        </div>
      </section>

      {/* ── the day, three ways ──────────────────────────────────────── */}
      <div className="drd-panelhost">
        <DayCarousel
          model={model}
          open={carouselOpen}
          onToggle={() =>
            setCarouselOpen((v) => {
              if (!v) setShipOpen(false);
              return !v;
            })
          }
        />
      </div>

      {/* ── chapters | page | cast ───────────────────────────────────── */}
      <div className="drd-body" data-cast={castOpen ? "open" : "closed"}>
        <nav className="drd-rail" aria-label="Chapters">
          <span className="drd-rail__label">CHAPTERS</span>
          <button
            type="button"
            className="drd-rail__item"
            data-active={chapter === WHOLE_DAY || undefined}
            onClick={() => setChapter(WHOLE_DAY)}
          >
            <span className="drd-rail__title">The whole day</span>
            <span className="drd-rail__meta">
              {model.window.firstAt
                ? `${clockLabel(model.window.firstAt)} — ${clockLabel(model.window.lastAt)}`
                : "no activity"}
            </span>
          </button>
          {model.chapters.map((c) => (
            <button
              key={c.index}
              type="button"
              className="drd-rail__item"
              data-active={chapter === c.index || undefined}
              onClick={() => setChapter(c.index)}
            >
              <span className="drd-rail__title">
                {c.ordinal} · {c.title}
              </span>
              <span className="drd-rail__meta">{c.kicker}</span>
            </button>
          ))}

          {model.chapters.length > 0 && (
            <button type="button" className="drd-rail__all" onClick={() => setModal("chapters")}>
              <Icon name="ph:book-open" aria-hidden />
              READ ALL CHAPTERS
            </button>
          )}

          <p className="drd-rail__hint">Picking a chapter rewrites the page and dims the rest of the spine.</p>

          {model.chapters.length > 0 && (
            <div className="drd-rail__reading">
              <div className="drd-rail__label">READING TIME</div>
              <div className="drd-rail__readrow">
                <span className="drd-rail__readnum">{readingMinutes}</span>
                <span className="drd-rail__readunit">
                  min · {model.chapters.length} ch.
                </span>
              </div>
            </div>
          )}
        </nav>

        {/* ── the written page ──────────────────────────────────────── */}
        <article className="drd-page">
          {active ? (
            <>
              <h2 className="drd-page__title">{active.title}</h2>
              <p className="drd-page__lede">{active.summary}</p>
              {active.events.length > 0 && (
                <ul className="drd-page__events">
                  {active.events.slice(0, CHAPTER_EVIDENCE_LIMIT).map((e) => (
                    <li key={e.id} className="drd-page__event" style={toneStyle(e.tone)}>
                      {e.pr ? (
                        <button
                          type="button"
                          className="drd-page__eventopen"
                          onClick={() =>
                            setPr({
                              repo: e.pr!.repo,
                              number: e.pr!.number,
                              title: e.label,
                              time: clockLabel(e.at),
                            })
                          }
                        >
                          <span className="drd-page__eventat">{clockLabel(e.at)}</span>
                          {e.detail && <span className="drd-page__eventref">{e.detail}</span>}
                          <span className="drd-page__eventlabel">{e.label}</span>
                        </button>
                      ) : (
                        <>
                          <span className="drd-page__eventat">{clockLabel(e.at)}</span>
                          {e.detail && <span className="drd-page__eventref">{e.detail}</span>}
                          <span className="drd-page__eventlabel">{e.label}</span>
                        </>
                      )}
                    </li>
                  ))}
                  {active.events.length > CHAPTER_EVIDENCE_LIMIT && (
                    <li className="drd-page__event drd-page__event--rest">
                      +{active.events.length - CHAPTER_EVIDENCE_LIMIT} more in this chapter — the
                      full list is in Shipped below.
                    </li>
                  )}
                </ul>
              )}
              <button type="button" className="drd-more" onClick={() => setChapter(WHOLE_DAY)}>
                <Icon name="ph:caret-up" aria-hidden />
                BACK TO THE WHOLE DAY
              </button>
            </>
          ) : (
            <>
              <h2 className="drd-page__title">{dateLabel}</h2>
              {paragraphs.length > 0 ? (
                <>
                  <p className="drd-page__prose">{paragraphs[0]}</p>
                  {more &&
                    paragraphs.slice(1).map((p, i) => (
                      <p key={i} className="drd-page__prose">
                        {p}
                      </p>
                    ))}
                  {paragraphs.length > 1 && (
                    <button type="button" className="drd-more" onClick={() => setMore((v) => !v)}>
                      {more ? "SHOW LESS" : "SHOW MORE"}
                      <Icon name={more ? "ph:caret-up" : "ph:caret-down"} aria-hidden />
                    </button>
                  )}
                </>
              ) : (
                <p className="drd-page__prose drd-page__prose--empty">
                  No written summary for this day yet — the numbers above are the whole record.
                </p>
              )}
              {narrativeByline && (
                <p className="drd-page__byline">
                  <Icon name="ph:sparkle" aria-hidden />
                  {narrativeByline}
                </p>
              )}
            </>
          )}

          {/* ── the spine ───────────────────────────────────────────── */}
          {model.spine.length > 0 && (
            <>
              <div className="drd-spine__head">
                <span className="drd-rail__label">THE SPINE</span>
                <span className="drd-spine__rule" aria-hidden />
                <span className="drd-spine__window">
                  {clockLabel(model.window.firstAt)} — {clockLabel(model.window.lastAt)}
                </span>
              </div>
              <ol className="drd-spine">
                {model.spine.map((e) => {
                  const dimmed =
                    activeChapterIndex !== null && e.chapterIndex !== activeChapterIndex;
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        className="drd-spine__item"
                        data-dim={dimmed || undefined}
                        style={toneStyle(e.tone)}
                        onClick={() =>
                          e.pr
                            ? setPr({ repo: e.pr.repo, number: e.pr.number, title: e.label, time: clockLabel(e.at) })
                            : setChapter(e.chapterIndex)
                        }
                      >
                        <span className="drd-spine__at">{clockLabel(e.at)}</span>
                        <span className="drd-spine__dot" data-many={e.count > 1 || undefined} aria-hidden />
                        <span className="drd-spine__body">
                          <span className="drd-spine__label">{e.label}</span>
                          {e.detail && <span className="drd-spine__detail">{e.detail}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </article>

        {/* ── the cast ─────────────────────────────────────────────── */}
        {castOpen ? (
          <aside className="drd-cast" aria-label="The cast">
            <button type="button" className="drd-cast__toggle" onClick={() => setCastOpen(false)}>
              THE CAST · COLLAPSE
              <Icon name="ph:caret-right" aria-hidden />
            </button>

            <div className="drd-cast__body">
              {model.swimlanes.length > 0 ? (
                <ul className="drd-cast__list">
                  {model.swimlanes.map((lane) => (
                    <li key={lane.familiarId} className="drd-cast__member" style={toneStyle(lane.tone)}>
                      <span className="drd-cast__glyph" aria-hidden>
                        <Icon name="ph:paw-print-fill" aria-hidden />
                      </span>
                      <span className="drd-cast__who">
                        <span className="drd-cast__name">
                          {lane.name}
                          <span className="drd-cast__count">
                            {lane.sessionCount}·{lane.mergeCount}
                          </span>
                        </span>
                        <span className="drd-cast__diff">
                          {lane.additions || lane.deletions ? (
                            <>
                              <span className="drd-stat__add">{signed(lane.additions)}</span>{" "}
                              <span className="drd-stat__del">−{lane.deletions.toLocaleString()}</span>
                            </>
                          ) : (
                            "no line counts"
                          )}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="drd-cast__empty">No familiar activity recorded for this day.</p>
              )}

              {model.streak.current > 0 && model.streak.current >= model.streak.best && (
                <div className="drd-cast__record">
                  <div className="drd-cast__recordlabel">STREAK STANDS</div>
                  <div className="drd-cast__recordbody">
                    {model.streak.current} {model.streak.current === 1 ? "day" : "days"} of shipping without a
                    gap.
                  </div>
                </div>
              )}

              <div>
                <div className="drd-rail__label">CARRIES INTO TOMORROW</div>
                <div className="drd-cast__carries">
                  <button type="button" className="drd-cast__carry" onClick={() => setModal("sessions")}>
                    <Icon name="ph:code" aria-hidden />
                    {model.carries.openItems.length} still open
                    <Icon name="ph:arrow-square-out" aria-hidden />
                  </button>
                  {model.carries.nextReminder && (
                    <button type="button" className="drd-cast__carry" onClick={() => setModal("reminder")}>
                      <Icon name="ph:bell" aria-hidden />
                      {clockLabel(model.carries.nextReminder.fireAt)} ·{" "}
                      {model.carries.nextReminder.title}
                      <Icon name="ph:arrow-square-out" aria-hidden />
                    </button>
                  )}
                </div>
              </div>

              <button type="button" className="drd-cast__share" onClick={() => setModal("share")}>
                <span className="drd-cast__shareicon" aria-hidden>
                  <Icon name="ph:image-bold" aria-hidden />
                </span>
                <span className="drd-cast__sharetext">
                  <span className="drd-cast__sharetitle">Share card</span>
                  <span className="drd-cast__sharemeta">{dateLabel}</span>
                </span>
                <Icon name="ph:arrow-square-out" aria-hidden />
              </button>
            </div>
          </aside>
        ) : (
          <div className="drd-cast drd-cast--rail">
            <button
              type="button"
              className="drd-cast__toggle drd-cast__toggle--icon"
              onClick={() => setCastOpen(true)}
              aria-label="Expand the cast"
            >
              <Icon name="ph:caret-left" aria-hidden />
            </button>
          </div>
        )}
      </div>

      {/* ── shipped ──────────────────────────────────────────────────── */}
      <div className="drd-panelhost drd-panelhost--shipped">
        <ShippedPanel
          model={model}
          open={shipOpen}
          onOpenPr={(row) =>
            setPr({ repo: row.repo, number: row.number, title: row.title, time: row.time })
          }
          onToggle={() =>
            setShipOpen((v) => {
              if (!v) setCarouselOpen(false);
              return !v;
            })
          }
        />
      </div>

      <DailyReportPrModal target={pr} onClose={() => setPr(null)} />

      <DayModals
        modal={modal}
        onClose={() => setModal(null)}
        model={model}
        dateLabel={dateLabel}
        shareImageUrl={shareImageUrl}
        narrativeByline={narrativeByline}
      />
    </div>
  );
}
