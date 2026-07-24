"use client";

/**
 * Research Reader — typeset findings deliverable viewer.
 *
 * Recreates the Claude Design handoff "Research Reader.dc.html": a rich reader
 * that replaces the raw-markdown <pre> dump for a mission's Findings (and the
 * other prose deliverables). The document body is the mission's real
 * findings.md, typeset into a serif title, an italic lede, collapsible sections
 * with an accent tick, a Key Results table (with a focus overlay), and inline
 * S#/C# source-ref chips. The evidence rail is built from the mission's real
 * ledger sources — hovering a chip and its card cross-highlight, and a card's
 * "Supports" links are derived from the sections that actually cite it.
 *
 * Everything is derived from real data; nothing is invented. When the findings
 * file has not been written yet the reader shows an honest empty state.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAnnouncer } from "@/components/ui/live-region";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { copyText } from "@/lib/clipboard";
import { relativeTime } from "@/lib/relative-time";
import {
  parseFindingsDoc,
  sectionsSupportingRef,
  type FindingsBlock,
  type FindingsSpan,
  type FindingsRefTone,
} from "@/lib/research-findings-doc";
import type {
  ResearchArtifactRef,
  ResearchMission,
  ResearchSourceRef,
} from "@/lib/research-missions";
import "@/styles/research-reader.css";

const RAIL_MIN = 240;
const RAIL_MAX = 520;
const COLLAPSE_AT = 200; // drag narrower than this releases into collapsed

type ResearchReaderProps = {
  mission: ResearchMission;
  artifact: ResearchArtifactRef;
  /** findings.md content; null when the file has not been written yet. */
  markdown: string | null;
  onClose: () => void;
  onOpenUrl?: (url: string) => void;
  /** Publish this artifact to the Grimoire (offered only for a working,
   *  unpublished copy on a settled mission). */
  onPublish?: () => void;
};

// ── inline icons (verbatim from the design) ────────────────────────────────
const CaretDown = ({ size = 13 }: { size?: number }) => (
  <svg className="rr-sec-caret" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m6 9 6 6 6-6" /></svg>
);

// ── source card view model ──────────────────────────────────────────────────
type CardModel = {
  source: ResearchSourceRef;
  variant: string;
  refTone: FindingsRefTone;
  statusLabel: string;
  statusTone: "ok" | "warn" | "muted";
  meta: string;
  supports: Array<{ id: string; heading: string }>;
  citeCount: number;
};

function statusView(status: ResearchSourceRef["status"]): { label: string; tone: "ok" | "warn" | "muted"; refTone: FindingsRefTone } {
  if (status === "used") return { label: "Verified", tone: "ok", refTone: "accent" };
  if (status === "conflicting") return { label: "Conflicts", tone: "warn", refTone: "warn" };
  if (status === "rejected") return { label: "Rejected", tone: "muted", refTone: "muted" };
  return { label: "Candidate", tone: "muted", refTone: "accent" };
}

function sourceMeta(source: ResearchSourceRef): string {
  const parts = [source.publisher || source.sourceType];
  if (source.publishedAt) parts.push(source.publishedAt);
  if (source.url) parts.push("fetched");
  else if (source.localPath) parts.push("local");
  return parts.filter(Boolean).join(" · ");
}

function titleCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function citationText(source: ResearchSourceRef): string {
  const bits = [source.title];
  if (source.publisher) bits.push(source.publisher);
  if (source.publishedAt) bits.push(source.publishedAt);
  if (source.url) bits.push(source.url);
  return bits.join(" · ");
}

const CONFIDENCE_RE = /^(high|medium|low)$/i;

export function ResearchReader({ mission, artifact, markdown, onClose, onOpenUrl, onPublish }: ResearchReaderProps) {
  const { announce } = useAnnouncer();
  const readerRef = useRef<HTMLDivElement | null>(null);
  const docRef = useRef<HTMLDivElement | null>(null);
  const pbarRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLButtonElement | null>(null);

  const doc = useMemo(
    () => parseFindingsDoc(markdown ?? "", mission.sources),
    [markdown, mission.sources],
  );

  const [expanded, setExpanded] = useState(false);
  const [tocOn, setTocOn] = useState(true);
  const [railOn, setRailOn] = useState(true);
  const [railWidth, setRailWidth] = useState(300);
  const [copied, setCopied] = useState(false);
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(doc.sections.map((section) => section.id)),
  );
  const [openCards, setOpenCards] = useState<Set<string>>(() => new Set());
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string | null>(doc.sections[0]?.id ?? null);
  const [focusTable, setFocusTable] = useState<Extract<FindingsBlock, { kind: "table" }> | null>(null);
  const [tip, setTip] = useState<{ id: string; title: string; meta: string; label: string; tone: "ok" | "warn" | "muted"; left: number; top: number } | null>(null);

  const closeFocusOrReader = () => {
    if (focusTable) setFocusTable(null);
    else onClose();
  };
  useFocusTrap(true, readerRef, { onEscape: closeFocusOrReader });

  // Reader data-attrs and the resizable rail width are set imperatively so the
  // panel carries no static inline style.
  useEffect(() => {
    readerRef.current?.style.setProperty("--rail-w", `${railWidth}px`);
  }, [railWidth]);

  useEffect(() => {
    if (tip && tipRef.current) {
      tipRef.current.style.left = `${tip.left}px`;
      tipRef.current.style.top = `${tip.top}px`;
    }
  }, [tip]);

  // ── evidence rail model ──────────────────────────────────────────────────
  const { fullCards, miniSources, usedCount } = useMemo(() => {
    const cards: CardModel[] = [];
    const mini: ResearchSourceRef[] = [];
    let used = 0;
    for (const source of mission.sources) {
      if (source.status === "used") used += 1;
      const view = statusView(source.status);
      const supports = sectionsSupportingRef(doc, source.id);
      const isFull =
        source.status === "conflicting" ||
        source.status === "rejected" ||
        Boolean(source.claim) ||
        Boolean(source.note);
      if (!isFull) {
        mini.push(source);
        continue;
      }
      cards.push({
        source,
        variant: "",
        refTone: view.refTone,
        statusLabel: view.label,
        statusTone: view.tone,
        meta: sourceMeta(source),
        supports,
        citeCount: supports.length,
      });
    }
    // Order: most-cited verified source first (accent), conflicts next,
    // rejected last — the design's visual priority, from real citation counts.
    const rank = (card: CardModel) => (card.source.status === "rejected" ? 2 : card.source.status === "conflicting" ? 1 : 0);
    cards.sort((a, b) => rank(a) - rank(b) || b.citeCount - a.citeCount);
    const topCited = cards.find((card) => rank(card) === 0 && card.citeCount > 0);
    for (const card of cards) {
      card.variant =
        card.source.status === "rejected"
          ? "rr-src--rejected"
          : card.source.status === "conflicting"
            ? "rr-src--warn"
            : card === topCited
              ? "rr-src--accent"
              : "";
    }
    return { fullCards: cards, miniSources: mini, usedCount: used };
  }, [mission.sources, doc]);

  const hasBody = doc.title !== null || doc.lede !== null || doc.sections.length > 0;

  // ── header meta ──────────────────────────────────────────────────────────
  const passes = mission.iterations.length;
  const rel = relativeTime(artifact.updatedAt);
  const metaLine = [
    titleCase(artifact.kind),
    `v${artifact.iteration}`,
    mission.mode,
    passes > 0 ? `${passes} pass${passes === 1 ? "" : "es"}` : null,
    `${mission.sources.length} source${mission.sources.length === 1 ? "" : "s"}`,
    rel ? `updated ${rel}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const published = Boolean(artifact.knowledgeId) || artifact.state === "published";
  const rejected = artifact.state === "rejected";
  const statusLabel = rejected ? "Rejected" : published ? "Published" : "Working draft";
  const showPublish = Boolean(onPublish) && artifact.state === "working" && !artifact.knowledgeId;

  // ── actions ──────────────────────────────────────────────────────────────
  const copy = async () => {
    if (!markdown) return;
    const ok = await copyText(markdown);
    if (!ok) {
      announce("Findings could not be copied.");
      return;
    }
    setCopied(true);
    announce("Findings copied as markdown.");
    window.setTimeout(() => setCopied(false), 1400);
  };
  const exportPdf = () => {
    if (typeof window !== "undefined") window.print();
  };
  const openUrl = (url: string | undefined) => {
    if (!url) return;
    if (onOpenUrl) onOpenUrl(url);
    else window.open(url, "_blank", "noreferrer");
  };
  const cite = async (source: ResearchSourceRef) => {
    const ok = await copyText(citationText(source));
    announce(ok ? "Citation copied." : "Citation could not be copied.");
  };

  const toggleSection = (id: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleCard = (id: string) =>
    setOpenCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const scrollToSection = (id: string) => {
    const target = document.getElementById(id);
    const scroller = docRef.current;
    if (!target || !scroller) return;
    const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12;
    const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    scroller.scrollTo({ top, behavior });
    setActiveSection(id);
  };

  // Chip click opens the matching evidence card (and reveals the rail).
  const onRefClick = (id: string) => {
    if (mission.sources.some((source) => source.id === id)) {
      if (!railOn) setRailOn(true);
      setOpenCards((prev) => new Set(prev).add(id));
    }
  };
  const onRefEnter = (event: { currentTarget: Element }, id: string) => {
    setHoverKey(id);
    const source = mission.sources.find((item) => item.id === id);
    const view = source ? statusView(source.status) : { label: "Conflict", tone: "warn" as const, refTone: "warn" as const };
    const rect = event.currentTarget.getBoundingClientRect();
    setTip({
      id,
      title: source?.title ?? "Open conflict",
      meta: source ? sourceMeta(source) : "flagged for the next pass",
      label: view.label,
      tone: view.tone,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 272)),
      top: rect.top - 8,
    });
  };
  const clearHover = () => {
    setHoverKey(null);
    setTip(null);
  };

  // ── document scroll: progress bar + scroll-spy ───────────────────────────
  const onDocScroll = () => {
    const scroller = docRef.current;
    if (!scroller) return;
    if (pbarRef.current) {
      const max = scroller.scrollHeight - scroller.clientHeight;
      pbarRef.current.style.width = `${max > 0 ? Math.min(100, (scroller.scrollTop / max) * 100) : 0}%`;
    }
    const sTop = scroller.getBoundingClientRect().top;
    let current: string | null = null;
    for (const section of doc.sections) {
      const el = document.getElementById(section.id);
      if (el && el.getBoundingClientRect().top - sTop <= 60) current = section.id;
    }
    if (current) setActiveSection(current);
  };

  // ── rail resize (pointer drag on the handle) ─────────────────────────────
  const draggingRail = useRef(false);
  const onHandleDown = (event: React.PointerEvent) => {
    draggingRail.current = true;
    (event.currentTarget as HTMLElement).setAttribute("data-drag", "true");
    document.body.style.userSelect = "none";
    event.preventDefault();
  };
  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!draggingRail.current || !readerRef.current) return;
      const rect = readerRef.current.getBoundingClientRect();
      let w = rect.right - event.clientX - 1;
      if (w < COLLAPSE_AT) w = RAIL_MIN; // preview only; release decides collapse
      setRailWidth(Math.max(RAIL_MIN, Math.min(RAIL_MAX, w)));
    };
    const up = (event: PointerEvent) => {
      if (!draggingRail.current || !readerRef.current) return;
      const rect = readerRef.current.getBoundingClientRect();
      if (rect.right - event.clientX - 1 < COLLAPSE_AT) setRailOn(false);
      draggingRail.current = false;
      readerRef.current.querySelector(".rr-railhandle")?.removeAttribute("data-drag");
      document.body.style.userSelect = "";
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
  }, []);

  // ── "more sources" strip: reflect + drag the scroll thumb ────────────────
  const updateThumb = () => {
    const strip = stripRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!strip || !track || !thumb) return;
    const max = strip.scrollWidth - strip.clientWidth;
    if (max <= 1) {
      track.hidden = true;
      return;
    }
    track.hidden = false;
    const tw = track.clientWidth;
    const thw = Math.max(28, tw * (strip.clientWidth / strip.scrollWidth));
    thumb.style.width = `${thw}px`;
    thumb.style.left = `${(strip.scrollLeft / max) * (tw - thw)}px`;
  };
  useEffect(() => {
    updateThumb();
    window.addEventListener("resize", updateThumb);
    return () => window.removeEventListener("resize", updateThumb);
  }, [miniSources.length, railOn, railWidth]);

  const thumbDrag = useRef<{ x: number; left: number } | null>(null);
  const stripDrag = useRef<{ x: number; sl: number } | null>(null);
  const onThumbDown = (event: React.PointerEvent) => {
    thumbDrag.current = { x: event.clientX, left: parseFloat(thumbRef.current?.style.left || "0") || 0 };
    thumbRef.current?.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };
  const onStripDown = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest(".rr-srcthumb")) return;
    stripDrag.current = { x: event.clientX, sl: stripRef.current?.scrollLeft ?? 0 };
  };
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const strip = stripRef.current;
      const track = trackRef.current;
      const thumb = thumbRef.current;
      if (thumbDrag.current && strip && track && thumb) {
        const tw = track.clientWidth;
        const thw = thumb.offsetWidth;
        const nl = Math.max(0, Math.min(tw - thw, thumbDrag.current.left + (event.clientX - thumbDrag.current.x)));
        strip.scrollLeft = tw - thw > 0 ? (nl / (tw - thw)) * (strip.scrollWidth - strip.clientWidth) : 0;
      } else if (stripDrag.current && strip) {
        const dx = event.clientX - stripDrag.current.x;
        if (Math.abs(dx) > 3) strip.classList.add("is-dragging");
        strip.scrollLeft = stripDrag.current.sl - dx;
      }
    };
    const up = () => {
      thumbDrag.current = null;
      if (stripDrag.current) {
        stripDrag.current = null;
        stripRef.current?.classList.remove("is-dragging");
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  // ── span / block rendering ───────────────────────────────────────────────
  const renderSpans = (spans: FindingsSpan[], keyPrefix: string): ReactNode[] =>
    spans.map((span, i) => {
      const key = `${keyPrefix}-${i}`;
      if (span.kind === "ref") {
        const toneClass = span.tone === "warn" ? " rr-sref--warn" : span.tone === "muted" ? " rr-sref--muted" : "";
        return (
          <button
            key={key}
            type="button"
            className={`rr-sref${toneClass}${hoverKey === span.id ? " is-match" : ""}`}
            onMouseEnter={(event) => onRefEnter(event, span.id)}
            onMouseLeave={clearHover}
            onFocus={(event) => onRefEnter(event, span.id)}
            onBlur={clearHover}
            onClick={() => onRefClick(span.id)}
          >
            {span.id}
          </button>
        );
      }
      if (span.kind === "link") {
        return (
          <a key={key} href={span.href} target="_blank" rel="noreferrer">
            {span.text}
          </a>
        );
      }
      if (span.bold) return <b key={key}>{span.text}</b>;
      if (span.italic) return <em key={key}>{span.text}</em>;
      return <span key={key}>{span.text}</span>;
    });

  const renderCell = (cell: FindingsSpan[], key: string): ReactNode => {
    if (cell.length === 1 && cell[0].kind === "text" && CONFIDENCE_RE.test(cell[0].text.trim())) {
      const level = cell[0].text.trim().toLowerCase();
      const tone = level === "high" ? "rr-cf--high" : level === "medium" ? "rr-cf--med" : "rr-cf--low";
      return <span className={`rr-cf ${tone}`}>{cell[0].text.trim()}</span>;
    }
    return renderSpans(cell, key);
  };

  const renderTable = (table: Extract<FindingsBlock, { kind: "table" }>): ReactNode => (
    <table className="rr-table">
      <thead>
        <tr>{table.header.map((cell, i) => <th key={i}>{renderSpans(cell, `th-${i}`)}</th>)}</tr>
      </thead>
      <tbody>
        {table.rows.map((row, r) => (
          <tr key={r}>{row.map((cell, c) => <td key={c}>{renderCell(cell, `td-${r}-${c}`)}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );

  const renderBlock = (block: FindingsBlock, key: string): ReactNode => {
    if (block.kind === "p") return <p key={key}>{renderSpans(block.spans, key)}</p>;
    if (block.kind === "ul") {
      return (
        <ul key={key}>
          {block.items.map((item, i) => <li key={i}>{renderSpans(item, `${key}-li-${i}`)}</li>)}
        </ul>
      );
    }
    return (
      <div className="rr-krblock" key={key}>
        <button className="rr-krfocus focus-ring" type="button" onClick={() => setFocusTable(block)} aria-label="Focus table">
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M15 3h6v6m0-6-7 7M9 21H3v-6m0 6 7-7" /></svg>
        </button>
        <div className="rr-krframe">{renderTable(block)}</div>
      </div>
    );
  };

  const renderCard = (card: CardModel): ReactNode => {
    const { source } = card;
    const open = openCards.has(source.id);
    const refTone = card.refTone === "warn" ? " rr-sref--warn" : card.refTone === "muted" ? " rr-sref--muted" : "";
    return (
      <div
        key={source.id}
        className={`rr-src ${card.variant}${hoverKey === source.id ? " is-match" : ""}`}
        data-open={open}
        onMouseEnter={() => setHoverKey(source.id)}
        onMouseLeave={() => setHoverKey(null)}
      >
        <button className="rr-src__toggle" type="button" aria-expanded={open} onClick={() => toggleCard(source.id)}>
          <div className="rr-src__head">
            <span className={`rr-sref${refTone}`}>{source.id}</span>
            <span className={`rr-srcstat rr-srcstat--${card.statusTone}`}>
              <i className="rr-srcstat__dot" aria-hidden />
              {card.statusLabel}
            </span>
            <CaretDown />
          </div>
          <div className="rr-src__title">{source.title}</div>
          <div className="rr-src__meta">{card.meta}</div>
        </button>
        {open ? (
          <div className="rr-srcdetail">
            {source.claim ? <div className="rr-sd-quote">“{source.claim}”</div> : null}
            {source.publisher || source.publishedAt ? (
              <div className="rr-sd-row">
                <span className="rr-sd-k">Source</span>
                <span className="rr-sd-v">{[source.publisher, source.publishedAt].filter(Boolean).join(" · ")}</span>
              </div>
            ) : null}
            <div className="rr-sd-row">
              <span className="rr-sd-k">Type</span>
              <span className="rr-sd-v">{source.sourceType}</span>
            </div>
            {source.note ? (
              <div className="rr-sd-row">
                <span className="rr-sd-k">{source.status === "rejected" ? "Rejected" : "Note"}</span>
                <span className="rr-sd-v">{source.note}</span>
              </div>
            ) : null}
            {source.confidence !== undefined ? (
              <div className="rr-sd-row">
                <span className="rr-sd-k">Confidence</span>
                <span className="rr-sd-v">{Math.round(source.confidence * 100)}%</span>
              </div>
            ) : null}
            {card.supports.length ? (
              <div className="rr-sd-supports">
                <span className="rr-sd-supports__label">Supports</span>
                {card.supports.map((section) => (
                  <button key={section.id} type="button" className="rr-sd-supportlink focus-ring" onClick={() => scrollToSection(section.id)}>
                    {section.heading}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="rr-sd-actions">
              <button className="rr-sd-btn rr-sd-btn--accent" type="button" disabled={!source.url} onClick={() => openUrl(source.url)}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M7 17 17 7M7 7h10v10" /></svg>
                Open source
              </button>
              <button className="rr-sd-btn" type="button" onClick={() => cite(source)}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
                Cite
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  const tocSections = doc.sections.filter((section) => section.heading);

  return createPortal(
    <>
      <div className="research-reader-overlay" role="presentation" onClick={onClose}>
        <div
          ref={readerRef}
          className="research-reader focus-ring"
          role="dialog"
          aria-modal="true"
          aria-label={`${artifact.title} — research reader`}
          data-expanded={expanded}
          data-toc={tocOn}
          data-rail={railOn}
          data-copied={copied}
          tabIndex={-1}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="rr-pbar"><div className="rr-pbar__fill" ref={pbarRef} /></div>

          <div className="rr-head">
            <span className={`rr-status${published && !rejected ? "" : " rr-status--muted"}`}>
              <i className="rr-status__dot" aria-hidden />
              {statusLabel}
            </span>
            <span className="rr-meta">{metaLine}</span>
            <div className="rr-head__actions">
              <button className="rr-btn focus-ring" type="button" onClick={copy} disabled={!markdown} aria-label="Copy findings as markdown">
                {copied ? (
                  <svg className="rr-ic-copied" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth={2}><path d="M20 6 9 17l-5-5" /></svg>
                ) : (
                  <svg className="rr-ic-clip" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
                )}
                <span>{copied ? "Copied" : "Copy"}</span>
              </button>
              <span className="rr-tb-extra">
                <button className="rr-btn focus-ring" type="button" onClick={exportPdf}>
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M12 3v12m0 0 4-4m-4 4-4-4" /></svg>
                  Export PDF
                </button>
                {showPublish ? (
                  <button className="rr-btn rr-btn--accent focus-ring" type="button" onClick={onPublish}>
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></svg>
                    Publish
                  </button>
                ) : null}
              </span>
              <span className="rr-head__sep" aria-hidden />
              <button
                className="rr-iconbtn rr-tgl-toc focus-ring"
                type="button"
                aria-pressed={tocOn}
                title="Toggle contents"
                aria-label="Toggle contents"
                onClick={() => setTocOn((v) => !v)}
              >
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>
              </button>
              <button
                className="rr-iconbtn focus-ring"
                type="button"
                aria-pressed={railOn}
                title="Toggle evidence"
                aria-label="Toggle evidence"
                onClick={() => setRailOn((v) => !v)}
              >
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></svg>
              </button>
              <button
                className="rr-iconbtn focus-ring"
                type="button"
                title={expanded ? "Collapse" : "Expand"}
                aria-label={expanded ? "Collapse" : "Expand"}
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? (
                  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M9 9 4 4m0 0v4m0-4h4m6 5 5-5m0 0v4m0-4h-4M9 15l-5 5m0 0v-4m0 4h4m6-5 5 5m0 0v-4m0 4h-4" /></svg>
                ) : (
                  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M15 3h6v6m0-6-7 7M9 21H3v-6m0 6 7-7" /></svg>
                )}
              </button>
              <button className="rr-iconbtn focus-ring" type="button" title="Close" aria-label="Close" onClick={onClose}>
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </div>
          </div>

          <div className="research-reader__grid">
            <nav className="rr-col rr-toc" aria-label="Contents">
              <div className="rr-toc__label">Contents</div>
              <div className="rr-toc__links">
                {tocSections.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    className="rr-toclink focus-ring"
                    data-active={activeSection === section.id}
                    onClick={() => scrollToSection(section.id)}
                  >
                    {section.heading}
                  </button>
                ))}
              </div>
              <div className="rr-toc__meta">
                <span>{mission.sources.length} sources · {usedCount} used</span>
                <span>{passes} pass{passes === 1 ? "" : "es"} · {mission.mode}</span>
              </div>
            </nav>

            <div className="rr-col rr-doc" ref={docRef} onScroll={onDocScroll}>
              <div className="rr-doc__column">
                {hasBody ? (
                  <>
                    <div className="rr-doc__kicker">{titleCase(artifact.kind)}</div>
                    {doc.title ? <h1>{doc.title}</h1> : null}
                    {doc.lede ? <p className="rr-lede">{renderSpans(doc.lede, "lede")}</p> : null}
                    {doc.sections.map((section) => {
                      if (!section.heading) {
                        return (
                          <div key={section.id}>
                            {section.blocks.map((block, i) => renderBlock(block, `${section.id}-b-${i}`))}
                          </div>
                        );
                      }
                      const open = openSections.has(section.id);
                      return (
                        <div key={section.id}>
                          <h2 id={section.id}>
                            <button
                              type="button"
                              className="rr-h2-btn"
                              data-open={open}
                              aria-expanded={open}
                              onClick={() => toggleSection(section.id)}
                            >
                              {section.heading}
                              <CaretDown />
                            </button>
                          </h2>
                          {open ? (
                            <div className="rr-doc__section-body">
                              {section.blocks.map((block, i) => renderBlock(block, `${section.id}-b-${i}`))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </>
                ) : (
                  <div className="rr-empty">This {artifact.title.toLowerCase()} deliverable has not been written yet.</div>
                )}
              </div>
            </div>

            <div className="rr-railhandle" onPointerDown={onHandleDown} aria-hidden>
              <div className="rr-railgrip" />
            </div>

            <aside className="rr-col rr-rail" aria-label="Evidence">
              <button className="rr-railhead focus-ring" type="button" title="Collapse evidence" onClick={() => setRailOn(false)}>
                <span className="rr-railhead__label">Evidence · {usedCount} used</span>
              </button>
              <div className="rr-rail__list">
                {fullCards.length === 0 && miniSources.length === 0 ? (
                  <p className="rr-src__meta">No sources in the ledger yet.</p>
                ) : null}
                {fullCards.map(renderCard)}
                {miniSources.length ? (
                  <div className="rr-more">
                    <div className="rr-more__label">More sources · {miniSources.length}</div>
                    <div className="rr-srcscroll" ref={stripRef} onScroll={updateThumb} onPointerDown={onStripDown}>
                      {miniSources.map((source) => {
                        const view = statusView(source.status);
                        const toneClass = view.refTone === "warn" ? " rr-sref--warn" : view.refTone === "muted" ? " rr-sref--muted" : "";
                        return (
                          <button
                            key={source.id}
                            type="button"
                            className={`rr-srcmini${source.status === "rejected" ? " rr-srcmini--rejected" : ""}`}
                            onMouseEnter={() => setHoverKey(source.id)}
                            onMouseLeave={() => setHoverKey(null)}
                            onClick={() => openUrl(source.url)}
                          >
                            <span className={`rr-sref${toneClass}`}>{source.id}</span>
                            <div className="rr-srcmini__title">{source.title}</div>
                            <div className="rr-srcmini__meta">{sourceMeta(source)}</div>
                          </button>
                        );
                      })}
                    </div>
                    <div className="rr-srctrack" ref={trackRef}>
                      <button className="rr-srcthumb" ref={thumbRef} type="button" aria-label="Scroll sources" onPointerDown={onThumbDown} />
                    </div>
                  </div>
                ) : null}
              </div>
            </aside>
          </div>
        </div>
      </div>

      <div className="rr-tip" ref={tipRef} data-show={tip ? "true" : "false"} aria-hidden>
        {tip ? (
          <>
            <div className="rr-tip__head">
              <span className="rr-tip__id">{tip.id}</span>
              <span className={`rr-tip__status rr-srcstat--${tip.tone}`}>
                <i className="rr-srcstat__dot" aria-hidden />
                {tip.label}
              </span>
            </div>
            <div className="rr-tip__title">{tip.title}</div>
            <div className="rr-tip__meta">{tip.meta}</div>
          </>
        ) : null}
      </div>

      {focusTable ? (
        <div className="rr-kroverlay" role="presentation" onClick={() => setFocusTable(null)}>
          <div className="rr-kroverlay-card" role="dialog" aria-label="Key results" onClick={(event) => event.stopPropagation()}>
            <div className="rr-kroverlay__head">
              <div>
                <div className="rr-kroverlay__title">Key results</div>
                <div className="rr-kroverlay__sub">{focusTable.rows.length} findings · reference table</div>
              </div>
              <button className="rr-iconbtn focus-ring" type="button" aria-label="Close" onClick={() => setFocusTable(null)}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </div>
            {renderTable(focusTable)}
          </div>
        </div>
      ) : null}
    </>,
    document.body,
  );
}
