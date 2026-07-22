"use client";

import "@/styles/bento-dashboard.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildDashboardModel, type DashboardModel } from "@/lib/dashboard-model";
import type { Card } from "@/lib/cave-board-types";
import type { Familiar, SessionRow } from "@/lib/types";
import type { GitHubItem } from "@/lib/github-tasks";
import type { InboxItem } from "@/lib/cave-inbox";
import { covenStreak } from "@/lib/familiar-renown";
import { relativeTime } from "@/lib/relative-time";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { useMinuteTick } from "@/lib/use-minute-tick";
import { useUserProfile, userAvatarUrl, userDisplayName } from "@/lib/user-profile";
import { useFamiliarContracts } from "@/lib/use-familiar-contracts";
import { buildFamiliarCardStats, type CovenMemoryEntry } from "@/components/familiars-view-stats";
import { AuthedImage } from "@/components/ui/authed-image";
import { useHeatTip } from "@/components/ui/heat-tip";
import { formatHeatTip } from "@/lib/heat-tip";
import { openExternalUrl } from "@/lib/open-external";
import {
  MATRIX_COLUMNS,
  activityFeed,
  boardBuckets,
  carouselDayLabel,
  carouselSlides,
  ciSummary,
  feedTime,
  githubByRepo,
  heatmapCells,
  longestStreak,
  matrixRows,
  sessionTotals,
  sparkPath,
  sparkY,
  streakPips,
  topCollaborators,
  type BoardEntry,
} from "@/lib/bento-dashboard";

// ─── Client-fetched data (same source APIs as the rest of the cave) ───────────

type BentoData = {
  cards: Card[];
  familiars: Familiar[];
  github: GitHubItem[];
  inbox: InboxItem[];
  sessions: SessionRow[];
  memory: CovenMemoryEntry[];
  projects: number | null;
};

const EMPTY: BentoData = {
  cards: [],
  familiars: [],
  github: [],
  inbox: [],
  sessions: [],
  memory: [],
  projects: null,
};

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export function BentoDashboard({ model: initialModel }: { model: DashboardModel }) {
  useMinuteTick(); // keeps feed times and the footer freshness stamp honest
  const profile = useUserProfile();
  const [data, setData] = useState<BentoData>(EMPTY);
  const [ready, setReady] = useState<ReadonlySet<keyof BentoData>>(new Set());
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Keep setState off an unmounted tree: polled loads may resolve after unmount.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(() => {
    const put = <K extends keyof BentoData>(key: K, value: BentoData[K]) => {
      if (!aliveRef.current) return;
      setData((d) => ({ ...d, [key]: value }));
      setReady((r) => new Set(r).add(key));
      setLastUpdated(new Date());
    };
    void getJson<{ cards: Card[] }>("/api/board").then((r) => put("cards", r?.cards ?? []));
    void getJson<{ familiars: Familiar[] }>("/api/familiars").then((r) => put("familiars", r?.familiars ?? []));
    // Needs-attention derives from this list — keep the last known good copy
    // on a failed poll rather than flashing "all clear".
    void getJson<{ items: InboxItem[] }>("/api/inbox").then((r) => {
      if (r?.items) put("inbox", r.items);
    });
    void getJson<{ sessions: SessionRow[] }>("/api/sessions/list").then((r) => put("sessions", r?.sessions ?? []));
    void getJson<{ entries: CovenMemoryEntry[] }>("/api/coven-memory").then((r) => put("memory", r?.entries ?? []));
    void getJson<{ ok: boolean; projects: unknown[] }>("/api/projects").then((r) =>
      put("projects", Array.isArray(r?.projects) ? r.projects.length : null),
    );
    void Promise.all([
      getJson<{ items: GitHubItem[] }>("/api/github/activity"),
      getJson<{ items: GitHubItem[] }>("/api/github/assigned"),
    ]).then(([act, assigned]) => {
      const map = new Map<string, GitHubItem>();
      // Dedupe by URL, not id: /activity prefixes ids ("pr-42") while
      // /assigned uses raw numbers — the same PR arrives under two ids.
      for (const it of [...(act?.items ?? []), ...(assigned?.items ?? [])]) map.set(it.url || it.id, it);
      put("github", [...map.values()]);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  usePausablePoll(load, 30_000);

  // Server-rendered model is the first-paint seed; each poll rebuilds it from
  // the fresh inbox so needs-attention stays live.
  const inboxReady = ready.has("inbox");
  const model = useMemo(
    () => (inboxReady ? buildDashboardModel(data.inbox, new Date()) : initialModel),
    [inboxReady, data.inbox, initialModel],
  );
  const nowMs = model.date.getTime();

  // ── UI state (from the design's DCLogic) ──
  const [slide, setSlide] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [heatOpen, setHeatOpen] = useState(true);
  const [famOpen, setFamOpen] = useState(true);
  const [selFam, setSelFam] = useState<string | null>(null);

  // ── Derivations (pure helpers) ──
  const totals = useMemo(() => sessionTotals(data.sessions, nowMs), [data.sessions, nowMs]);
  const streak = useMemo(() => covenStreak(data.sessions, nowMs), [data.sessions, nowMs]);
  const bestStreak = useMemo(() => longestStreak(data.sessions), [data.sessions]);
  const pipsFilled = streakPips(streak, bestStreak);

  const heat = useMemo(() => heatmapCells(data.sessions, nowMs), [data.sessions, nowMs]);
  const heatTip = useHeatTip();

  const feed = useMemo(
    () =>
      activityFeed({
        sessions: data.sessions,
        cards: data.cards,
        github: data.github,
        inbox: data.inbox,
        familiars: data.familiars,
      }),
    [data.sessions, data.cards, data.github, data.inbox, data.familiars],
  );

  const board = useMemo(
    () => boardBuckets({ cards: data.cards, needsAttention: model.needsAttention, familiars: data.familiars }),
    [data.cards, model.needsAttention, data.familiars],
  );

  const famStats = useMemo(
    () => buildFamiliarCardStats({ familiars: data.familiars, sessions: data.sessions, covenEntries: data.memory, now: nowMs }),
    [data.familiars, data.sessions, data.memory, nowMs],
  );

  const carousel = useMemo(
    () => carouselSlides(data.sessions, data.familiars, nowMs),
    [data.sessions, data.familiars, nowMs],
  );
  const slideCount = carousel.slides.length;
  const activeSlide = carousel.slides[Math.min(slide, slideCount - 1)] ?? carousel.slides[0];

  // Auto-advance every 6s, paused while the panel is hovered or the tab
  // is hidden (poll-discipline: no work in hidden windows).
  useEffect(() => {
    if (paused || slideCount < 2) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      setSlide((s) => (s + 1) % slideCount);
      setHover(null);
    }, 6000);
    return () => clearInterval(id);
  }, [paused, slideCount]);

  const contracts = useFamiliarContracts(data.familiars);
  const matrix = useMemo(() => {
    const tops = carousel.slides
      .filter((s): s is typeof s & { familiarId: string } => s.familiarId !== null)
      .map((s) => ({ id: s.familiarId, name: s.name }));
    return matrixRows(tops, contracts.contracts?.threadReportsById ?? new Map());
  }, [carousel.slides, contracts.contracts]);

  const ghGroups = useMemo(() => githubByRepo(data.github), [data.github]);
  const ci = useMemo(() => ciSummary(data.github), [data.github]);

  const collaborators = useMemo(() => {
    const totalsById = new Map<string, number>();
    for (const f of data.familiars) totalsById.set(f.id, famStats.get(f.id)?.sessionsTotal ?? 0);
    return topCollaborators(data.familiars, totalsById);
  }, [data.familiars, famStats]);

  // ── Interactions ──
  const goSlide = (i: number) => {
    setSlide(((i % slideCount) + slideCount) % slideCount);
    setHover(null);
  };
  const selectFamiliar = (id: string) => {
    if (suppressClickRef.current) return;
    setSelFam((cur) => (cur === id ? null : id));
    const ci2 = carousel.slides.findIndex((s) => s.familiarId === id);
    if (ci2 > 0 && selFam !== id) goSlide(ci2);
  };

  // Grab-to-scroll on the familiar row; a real drag suppresses the click.
  const famRowRef = useRef<HTMLDivElement | null>(null);
  const suppressClickRef = useRef(false);
  const onFamDragStart = (e: React.MouseEvent) => {
    const el = famRowRef.current;
    if (!el) return;
    const start = { x: e.clientX, left: el.scrollLeft, moved: false };
    el.classList.add("bd-fam-row--grabbing");
    const mv = (ev: MouseEvent) => {
      const dx = ev.clientX - start.x;
      if (Math.abs(dx) > 4) start.moved = true;
      el.scrollLeft = start.left - dx;
    };
    const up = () => {
      window.removeEventListener("mousemove", mv);
      window.removeEventListener("mouseup", up);
      el.classList.remove("bd-fam-row--grabbing");
      if (start.moved) {
        suppressClickRef.current = true;
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
    };
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", up);
  };
  const famPage = (dir: -1 | 1) => {
    const el = famRowRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth, behavior: "smooth" });
  };

  // ── Render bits ──
  const displayName = userDisplayName(profile?.profile);
  const humanAvatar = userAvatarUrl(profile);
  const pronouns = profile?.profile.pronouns?.trim();

  const points = activeSlide.series.map((v, i) => ({ v, left: `${(i / (activeSlide.series.length - 1)) * 100}%` }));
  const hoverPoint = hover !== null ? points[hover] : null;

  const boardCard = (entry: BoardEntry, dim = false) => {
    const fam = entry.familiarId ? data.familiars.find((f) => f.id === entry.familiarId) : null;
    return (
      <a key={entry.id} className={`bd-board-card focus-ring-inset${dim ? " bd-board-card--dim" : ""}`} href={entry.href}>
        <span className="bd-board-card-title">{entry.title}</span>
        <span className="bd-board-card-sub">
          {fam ? <AuthedImage className="bd-avatar-14" src={fam.avatarUrl} alt="" fallback={null} /> : null}
          {entry.sub}
        </span>
      </a>
    );
  };

  return (
    <div className="bento-dash">
      <div className="bd-frame">
        {/* ── Stats row ── */}
        <div className="bd-stats">
          <div className="bd-cell bd-stat">
            <div className="bd-label">total sessions</div>
            <div className="bd-stat-value">{totals.total}</div>
          </div>
          <div className="bd-cell bd-stat">
            <div className="bd-label">sessions (30d)</div>
            <div className="bd-stat-value">{totals.last30d}</div>
          </div>
          <div className="bd-cell bd-streak">
            <div className="bd-label">activity streak</div>
            <div className="bd-streak-value">{streak}d</div>
            <div className="bd-pips">
              {Array.from({ length: 5 }, (_, i) => (
                <span key={i} className={`bd-pip${i < pipsFilled ? " bd-pip--filled" : ""}`} />
              ))}
              <span className="bd-pips-best">best {bestStreak}d</span>
            </div>
          </div>
          <div className="bd-cell bd-stat">
            <div className="bd-label">familiars</div>
            <div className="bd-stat-value">{data.familiars.length}</div>
          </div>
          <div className="bd-cell bd-stat">
            <div className="bd-label">projects</div>
            <div className="bd-stat-value">{data.projects ?? "—"}</div>
          </div>
        </div>

        {/* ── Middle band ── */}
        <div className="bd-mid">
          {/* Left: human + activity feed */}
          <div className="bd-col">
            <div className="bd-cell bd-human">
              <div className="bd-human-title">human</div>
              {humanAvatar ? (
                <img className="bd-human-avatar" src={humanAvatar} alt="" />
              ) : (
                <div className="bd-human-avatar-fallback" aria-hidden>
                  {displayName.slice(0, 1).toLowerCase()}
                </div>
              )}
              <div className="bd-human-row">
                <span className="bd-human-name">{displayName}</span>
                {pronouns ? <span className="bd-label">{pronouns}</span> : null}
              </div>
              <div className="bd-human-row">
                <span className="bd-label">coven sessions</span>
                <span className="bd-human-count">{totals.total}</span>
              </div>
            </div>
            <div className="bd-cell bd-feed">
              <div className="bd-label">activity</div>
              <div className="bd-feed-list">
                {feed.length === 0 ? <div className="bd-empty">quiet — no recent activity</div> : null}
                {feed.map((row) => (
                  <a key={row.id} className="bd-feed-row focus-ring-inset" href={row.href}>
                    <time className="bd-feed-time" dateTime={row.at}>
                      {feedTime(row.at, nowMs)}
                    </time>
                    <span className="bd-feed-text">{row.text}</span>
                  </a>
                ))}
              </div>
            </div>
          </div>

          {/* Center: heatmap + board + familiars */}
          <div className="bd-col">
            <div className="bd-cell bd-heat">
              <button
                type="button"
                className="bd-heat-head focus-ring-inset"
                aria-expanded={heatOpen}
                onClick={() => setHeatOpen((v) => !v)}
              >
                <span className="bd-label">
                  <span className="bd-heat-chevron" aria-hidden>
                    {heatOpen ? "▾" : "▸"}
                  </span>{" "}
                  coven session activity
                </span>
                <span className="bd-heat-legend" aria-hidden>
                  less
                  <span className="bd-heat-swatch bd-heat-l0" />
                  <span className="bd-heat-swatch bd-heat-l2" />
                  <span className="bd-heat-swatch bd-heat-l3" />
                  <span className="bd-heat-swatch bd-heat-l4" />
                  more
                </span>
              </button>
              {heatOpen ? (
                <>
                  <div className="bd-heat-grid" {...heatTip.gridProps}>
                    {heat.cells.map((c) => (
                      <div
                        key={c.date}
                        className={`bd-heat-cell${c.future ? " bd-heat-cell--future" : ` bd-heat-l${c.level}`}`}
                        data-tip={c.future ? undefined : formatHeatTip(c.date, c.count)}
                      />
                    ))}
                  </div>
                  {heatTip.tip}
                  <div className="bd-heat-months" aria-hidden>
                    {heat.monthLabels.map((m, i) => (
                      <span key={`${m}-${i}`}>{m}</span>
                    ))}
                  </div>
                </>
              ) : null}
            </div>

            <div className="bd-cell bd-board">
              <div className="bd-label">board</div>
              <div className="bd-board-grid">
                <div className="bd-board-col">
                  <div className="bd-board-col-title bd-board-col-title--accent">needs you ({board.needsYou.length})</div>
                  {board.needsYou.length === 0 ? <div className="bd-empty">all clear</div> : null}
                  {board.needsYou.map((e) => boardCard(e))}
                </div>
                <div className="bd-board-col">
                  <div className="bd-board-col-title">in flight ({board.inFlight.length})</div>
                  {board.inFlight.length === 0 ? <div className="bd-empty">nothing running</div> : null}
                  {board.inFlight.map((e) => boardCard(e))}
                </div>
                <div className="bd-board-col">
                  <div className="bd-board-col-title">done ({board.done.length})</div>
                  {board.done.length === 0 ? <div className="bd-empty">no wins yet</div> : null}
                  {board.done.map((e) => boardCard(e, true))}
                </div>
              </div>
            </div>

            <div className="bd-cell bd-fam">
              <div className="bd-fam-head">
                <button
                  type="button"
                  className="bd-label bd-fam-toggle focus-ring-inset"
                  aria-expanded={famOpen}
                  onClick={() => setFamOpen((v) => !v)}
                >
                  <span className="bd-heat-chevron" aria-hidden>
                    {famOpen ? "▾" : "▸"}
                  </span>{" "}
                  familiars ({data.familiars.length})
                </button>
                {famOpen && data.familiars.length > 4 ? (
                  <span className="bd-fam-pager">
                    <button type="button" className="bd-pager-btn focus-ring" aria-label="Previous familiars" onClick={() => famPage(-1)}>
                      ‹
                    </button>
                    <button type="button" className="bd-pager-btn focus-ring" aria-label="Next familiars" onClick={() => famPage(1)}>
                      ›
                    </button>
                  </span>
                ) : null}
              </div>
              {famOpen ? (
                <div className="bd-fam-row" ref={famRowRef} onMouseDown={onFamDragStart}>
                  {data.familiars.map((f) => {
                    const stats = famStats.get(f.id);
                    const name = f.display_name || f.name || f.id;
                    const active = (f.active_sessions ?? 0) > 0 || Boolean(stats?.hasActiveSession);
                    const last = stats?.lastSessionAt ? relativeTime(stats.lastSessionAt, nowMs, "bare") : "—";
                    return (
                      <button
                        key={f.id}
                        type="button"
                        className={`bd-fam-item focus-ring-inset${selFam === f.id ? " bd-fam-item--selected" : ""}`}
                        aria-pressed={selFam === f.id}
                        onClick={() => selectFamiliar(f.id)}
                      >
                        <AuthedImage
                          src={f.avatarUrl}
                          alt=""
                          fallback={<span className="bd-fam-letter" aria-hidden>{name.slice(0, 1).toLowerCase()}</span>}
                        />
                        <span className="bd-fam-meta">
                          <span className="bd-fam-name">{name}</span>
                          <span className="bd-fam-sub">
                            {stats?.sessionsTotal ?? 0} sessions · {last}
                          </span>
                        </span>
                        <span className={`bd-fam-dot${active ? " bd-fam-dot--active" : ""}`} aria-hidden />
                      </button>
                    );
                  })}
                  {data.familiars.length === 0 ? <div className="bd-empty">no familiars yet</div> : null}
                </div>
              ) : null}
            </div>
          </div>

          {/* Right: carousel + matrix + github */}
          <div className="bd-col">
            <div
              className="bd-cell bd-carousel"
              onMouseEnter={() => setPaused(true)}
              onMouseLeave={() => {
                setPaused(false);
                setHover(null);
              }}
            >
              <div className="bd-carousel-head">
                <span className="bd-label">activity over time · 14d</span>
                <span className="bd-carousel-nav">
                  <button type="button" className="bd-pager-btn focus-ring" aria-label="Previous familiar chart" onClick={() => goSlide(slide - 1)}>
                    ‹
                  </button>
                  <button type="button" className="bd-pager-btn focus-ring" aria-label="Next familiar chart" onClick={() => goSlide(slide + 1)}>
                    ›
                  </button>
                </span>
              </div>
              <div className="bd-carousel-stat">
                <span className="bd-carousel-total">{activeSlide.weekTotal}</span>
                <span className="bd-carousel-name">{activeSlide.name} · this week</span>
                <span className="bd-carousel-delta">
                  {activeSlide.weekDelta >= 0 ? "▲" : "▼"} {Math.abs(activeSlide.weekDelta)} wk
                </span>
              </div>
              <div className="bd-carousel-chart">
                <div className="bd-carousel-clip">
                  <div
                    className="bd-carousel-track"
                    style={{ width: `${slideCount * 100}%`, transform: `translateX(-${(slide * 100) / slideCount}%)` }}
                  >
                    {carousel.slides.map((s) => {
                      const path = sparkPath(s.series, carousel.max);
                      return (
                        <svg
                          key={s.familiarId ?? "all"}
                          width={`${100 / slideCount}%`}
                          height="56"
                          viewBox="0 0 240 56"
                          preserveAspectRatio="none"
                          aria-hidden
                        >
                          <path className="bd-spark-area" d={path.area} />
                          <path className="bd-spark-line" d={path.line} />
                        </svg>
                      );
                    })}
                  </div>
                </div>
                {points.map((p, i) => (
                  <span key={i} className="bd-carousel-hit" style={{ left: p.left }} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
                ))}
                {hoverPoint ? (
                  <>
                    <span
                      className="bd-carousel-dot"
                      style={{ left: hoverPoint.left, top: `${sparkY(hoverPoint.v, carousel.max).toFixed(0)}px` }}
                    />
                    <span className="bd-carousel-tip" style={{ left: hoverPoint.left }}>
                      {carouselDayLabel(hover ?? 0, nowMs, hoverPoint.v)}
                    </span>
                  </>
                ) : null}
              </div>
              <div className="bd-carousel-dots">
                {carousel.slides.map((s, i) => (
                  <button
                    key={s.familiarId ?? "all"}
                    type="button"
                    className="focus-ring"
                    aria-label={`Show ${s.name}`}
                    aria-current={i === slide}
                    onClick={() => goSlide(i)}
                  />
                ))}
              </div>
            </div>

            <div className="bd-cell bd-matrix">
              <a className="bd-label focus-ring-inset" href="/dashboard/familiars/growth">
                performance matrix
              </a>
              <div className="bd-matrix-grid">
                <span />
                {MATRIX_COLUMNS.map((c) => (
                  <span key={c.key} className="bd-matrix-col">
                    {c.label}
                  </span>
                ))}
                {matrix.map((row) => (
                  <MatrixRowCells key={row.familiarId} row={row} />
                ))}
                {matrix.length === 0 ? <div className="bd-empty">no familiars yet</div> : null}
              </div>
            </div>

            <div className="bd-cell bd-github">
              <div className="bd-label">github</div>
              <div className="bd-github-scroll">
                {ghGroups.length === 0 ? <div className="bd-empty">nothing assigned</div> : null}
                {ghGroups.map((group) => (
                  <div key={group.repo}>
                    <div className="bd-github-repo">{group.repo}</div>
                    <div className="bd-github-rows">
                      {group.items.map((g) => (
                        <a
                          key={g.id}
                          className={`bd-github-row focus-ring-inset${g.state === "open" ? " bd-github-row--open" : ""}`}
                          href={g.url}
                          onClick={(event) => {
                            event.preventDefault();
                            openExternalUrl(g.url);
                          }}
                        >
                          <span className={`bd-github-dot${g.state === "open" ? " bd-github-dot--open" : ""}`} aria-hidden />
                          <span className="bd-github-title">
                            {g.number ? `#${g.number} ` : ""}
                            {g.title}
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="bd-github-foot">
                <span>{ci ? `ci ${ci}` : "ci —"}</span>
                <span>{data.github.length} open items</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer rail ── */}
        <div className="bd-cell bd-footer">
          <span className="bd-label">top collaborators</span>
          <div className="bd-footer-avatars">
            {collaborators.map((f) => {
              const name = f.display_name || f.name || f.id;
              return (
                <a
                  key={f.id}
                  href={`/dashboard/familiars/${encodeURIComponent(f.id)}/profile`}
                  className="focus-ring"
                  title={name}
                  aria-label={`Open profile for ${name}`}
                >
                  <AuthedImage
                    src={f.avatarUrl}
                    alt=""
                    fallback={<span className="bd-footer-letter" aria-hidden>{name.slice(0, 1).toLowerCase()}</span>}
                  />
                </a>
              );
            })}
          </div>
          <span className="bd-footer-spacer" />
          <span className="bd-footer-stamp">
            COVEN CAVE · updated{" "}
            {lastUpdated ? (
              <time dateTime={lastUpdated.toISOString()}>{relativeTime(lastUpdated.toISOString(), Date.now(), "bare") || "just now"}</time>
            ) : (
              "…"
            )}
          </span>
          <span className="bd-footer-brand">✦ coven</span>
        </div>
      </div>
    </div>
  );
}

function MatrixRowCells({ row }: { row: ReturnType<typeof matrixRows>[number] }) {
  return (
    <>
      <span className="bd-matrix-name" title={row.name}>
        {row.name}
      </span>
      {row.cells.map((cell) => (
        <span key={cell.key} className={`bd-matrix-cell bd-heat-l${cell.level}`} title={cell.title} />
      ))}
    </>
  );
}
