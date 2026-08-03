"use client";

/**
 * MessageReader — the Expand reader, Reader.dc.html frame 3a.
 *
 * The design brief calls this "the reader as it ships": the plain sheet the
 * Expand action used to open (frame 1a — 1100px cap, 72ch measure, a Copy
 * button and nothing else) grown into a surface you can actually work in.
 *
 *   • a read-progress hairline across the top
 *   • a contents rail built from the answer's own headings, with scroll-spy
 *   • the familiar's sigil in the head, beside export and copy
 *   • select any passage and ask about it without losing your place
 *   • a "How this was made" footer that opens onto the turn's real sources,
 *     tool batches and skills
 *
 * Everything in the footer is derived from data the turn already carries —
 * `parseCitations` over the answer, `toolBatches`/`turnSkills` over the same
 * ToolEvent[] the transcript renders. A tab with nothing behind it is not
 * shown, and with nothing behind any of them the footer itself is absent: an
 * empty provenance panel claims more than a missing one.
 *
 * The answer body is passed in as `children` rather than rendered here, so the
 * reader never imports the markdown pipeline that renders it (message-bubble
 * owns that, and would otherwise import this file back).
 */

// The reader's own sheet, imported HERE rather than from the cave-chat.css
// facade: the facade is loaded by every chat surface and therefore by the /
// route's first paint, so a sheet for a modal most sessions never open was
// being paid for on every visit (bundle-budget: initial / route CSS). Owned by
// the component, it rides the lazy chunk that only loads when Expand is
// clicked. Same reasoning as the cave-md.css note in message-bubble.tsx.
import "@/styles/cave-chat/reader.css";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { Icon } from "@/lib/icon";
import { copyText } from "@/lib/clipboard";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useAnnouncer } from "@/components/ui/live-region";
import { Segmented } from "@/components/ui/settings-controls";
import { citationSourcePresentation, parseCitations, type Citation } from "@/lib/citations";
import {
  formatBatchDuration,
  toolBatches,
  turnSkills,
  type BatchTool,
} from "@/lib/chat-tool-batches";
import { outlineBaseLevel, readerOutline, readingStats } from "@/lib/reader-outline";
import { skillGroups, toolRollups, toolSteps } from "@/lib/reader-provenance";

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

/** How far down the viewport a heading must sit before it stops counting as
 *  "the section you are in" — without it the rail flips to the next heading
 *  the instant its first pixel appears. */
const SPY_OFFSET_PX = 96;

export type MessageReaderProps = {
  /** The raw answer markdown — indexed for the rail, exported by Export. */
  text: string;
  /** The familiar's display name, shown in the head. */
  label: string;
  onClose: () => void;
  /** The rendered answer. Supplied by the caller so this file stays free of
   *  the markdown pipeline. */
  children: ReactNode;
  /** The turn's tool events. Absent (or empty) hides the Tools/Skills tabs
   *  rather than rendering a panel with nothing in it. */
  tools?: readonly BatchTool[];
  /** Wall time for the whole turn, shown in the footer receipt. */
  durationMs?: number;
  /** Ask a follow-up about the selected passage. Without it, selecting text in
   *  the reader does nothing special — the ask-bar is not rendered. */
  onAsk?: (quote: string) => void;
};

type FootTab = "sources" | "tools" | "skills";
/** The Tools tab's three readings of the same calls, and the Skills tab's two. */
type ToolsView = "batches" | "tools" | "timeline";
type SkillsView = "cards" | "types";

const TOOLS_VIEWS = ["batches", "tools", "timeline"] as const satisfies readonly ToolsView[];
const SKILLS_VIEWS = ["cards", "types"] as const satisfies readonly SkillsView[];
const VIEW_LABELS: Record<ToolsView | SkillsView, string> = {
  batches: "Batches",
  tools: "By tool",
  timeline: "Timeline",
  cards: "Cards",
  types: "By type",
};
const viewLabel = (view: ToolsView | SkillsView) => VIEW_LABELS[view];

/** A filename the OS will accept, derived from the familiar's name. */
function exportFilename(label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug || "answer"}.md`;
}

export function MessageReader({
  text,
  label,
  onClose,
  children,
  tools,
  durationMs,
  onAsk,
}: MessageReaderProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const docRef = useRef<HTMLDivElement | null>(null);
  const headingsRef = useRef<HTMLElement[]>([]);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { announce } = useAnnouncer();

  const outline = useMemo(() => readerOutline(text), [text]);
  const stats = useMemo(() => readingStats(text), [text]);
  const baseLevel = useMemo(() => outlineBaseLevel(outline), [outline]);

  const citations = useMemo(() => parseCitations(text).citations, [text]);
  const batches = useMemo(() => (tools?.length ? toolBatches(tools) : []), [tools]);
  const skills = useMemo(() => (tools?.length ? turnSkills(tools) : []), [tools]);
  const errorCount = useMemo(
    () => (tools ?? []).filter((t) => t.status === "error").length,
    [tools],
  );

  const rollups = useMemo(() => (tools?.length ? toolRollups(tools) : []), [tools]);
  const steps = useMemo(() => (tools?.length ? toolSteps(tools) : []), [tools]);
  const groups = useMemo(() => skillGroups(skills), [skills]);

  const tabs = useMemo(() => {
    const available: FootTab[] = [];
    if (citations.length) available.push("sources");
    if (batches.length) available.push("tools");
    if (skills.length) available.push("skills");
    return available;
  }, [citations.length, batches.length, skills.length]);

  const [navOpen, setNavOpen] = useState(() => outline.length > 0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [copied, setCopied] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [footOpen, setFootOpen] = useState(false);
  const [footTab, setFootTab] = useState<FootTab>("sources");
  const [toolsView, setToolsView] = useState<ToolsView>("batches");
  const [skillsView, setSkillsView] = useState<SkillsView>("cards");
  const [selection, setSelection] = useState<string | null>(null);
  const [viewer, setViewer] = useState<Citation | null>(null);

  // The first available tab owns the panel — Sources is the default only when
  // the answer actually cites something.
  useEffect(() => {
    if (tabs.length && !tabs.includes(footTab)) setFootTab(tabs[0]);
  }, [tabs, footTab]);

  // Escape unwinds one layer at a time: the source viewer, then the export
  // menu, then the reader. Closing everything on one keypress loses the
  // reader's scroll position for what was meant to dismiss a popover.
  const escape = useCallback(() => {
    if (viewer) {
      setViewer(null);
      return;
    }
    if (exportOpen) {
      setExportOpen(false);
      return;
    }
    onClose();
  }, [viewer, exportOpen, onClose]);

  useFocusTrap(true, dialogRef, { onEscape: escape });

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  // Anchor the rail to the rendered document. The outline and the DOM come
  // from the same markdown in the same order, so the nth heading element takes
  // the nth outline id. The observer re-runs it because the markdown pipeline
  // renders asynchronously (Shiki) — without it the rail would anchor to an
  // empty document on first paint and never recover.
  useLayoutEffect(() => {
    const doc = docRef.current;
    if (!doc) return;

    const anchor = () => {
      const found = Array.from(doc.querySelectorAll<HTMLElement>(HEADING_SELECTOR));
      found.forEach((el, i) => {
        const entry = outline[i];
        if (entry && el.id !== entry.id) el.id = entry.id;
      });
      headingsRef.current = found;
    };

    anchor();
    const observer = new MutationObserver(anchor);
    observer.observe(doc, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [outline]);

  // Until the reader is scrolled there is no scroll event to derive position
  // from, and a rail with nothing marked reads as "you are nowhere".
  useEffect(() => {
    setActiveId(outline[0]?.id ?? null);
  }, [outline]);

  const onScroll = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;

    const scrollable = doc.scrollHeight - doc.clientHeight;
    setProgress(scrollable > 0 ? Math.min(1, Math.max(0, doc.scrollTop / scrollable)) : 0);

    // The section you are in is the last heading that has passed the offset.
    const top = doc.getBoundingClientRect().top + SPY_OFFSET_PX;
    let current: string | null = null;
    for (const el of headingsRef.current) {
      if (el.getBoundingClientRect().top <= top && el.id) current = el.id;
      else break;
    }
    setActiveId(current ?? outline[0]?.id ?? null);
  }, [outline]);

  const goTo = useCallback((id: string) => {
    const target = docRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveId(id);
  }, []);

  const copy = useCallback(async () => {
    if (!(await copyText(text))) return;
    setCopied(true);
    announce("Answer copied");
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2000);
  }, [text, announce]);

  const exportMarkdown = useCallback(() => {
    setExportOpen(false);
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exportFilename(label);
    link.click();
    // Revoking on the next frame rather than immediately: Safari cancels an
    // in-flight download when the object URL disappears from under it.
    requestAnimationFrame(() => URL.revokeObjectURL(url));
    announce("Answer exported as Markdown");
  }, [text, label, announce]);

  const exportPdf = useCallback(() => {
    setExportOpen(false);
    window.print();
  }, []);

  // A selection only becomes an ask-bar when there is somewhere to ask. The
  // guard also keeps a stray click (a collapsed range) from raising the bar.
  const onSelect = useCallback(() => {
    if (!onAsk) return;
    const picked = window.getSelection()?.toString().trim() ?? "";
    setSelection(picked.length > 1 ? picked : null);
  }, [onAsk]);

  const ask = useCallback(() => {
    if (!onAsk || !selection) return;
    onAsk(selection);
    setSelection(null);
    onClose();
  }, [onAsk, selection, onClose]);

  const railId = "cave-reader-rail";

  return createPortal(
    <div className="cave-reader-backdrop" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className="cave-reader"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Expanded ${label}`}
        tabIndex={-1}
      >
        <div className="cave-reader-progress" aria-hidden>
          <div
            className="cave-reader-progress__bar"
            style={{ transform: `scaleX(${progress})` }}
          />
        </div>

        <div className="cave-reader-head">
          {outline.length ? (
            <button
              type="button"
              className="cave-reader-iconbtn cave-reader-iconbtn--ghost focus-ring"
              onClick={() => setNavOpen((v) => !v)}
              aria-label="Toggle contents"
              aria-expanded={navOpen}
              aria-controls={railId}
            >
              <Icon name="ph:sidebar-simple" width={13} aria-hidden />
            </button>
          ) : null}
          <span className="cave-reader-sigil" aria-hidden>
            <Icon name="ph:book-open" width={13} />
          </span>
          <span className="cave-reader-head__title">{label}</span>

          <div className="cave-reader-head__actions">
            <span className="cave-reader-menu-anchor">
              <button
                type="button"
                className="cave-reader-iconbtn focus-ring"
                onClick={() => setExportOpen((v) => !v)}
                aria-label="Export answer"
                aria-expanded={exportOpen}
                aria-haspopup="menu"
              >
                <Icon name="ph:download-simple" width={12} aria-hidden />
              </button>
              {exportOpen ? (
                <span className="cave-reader-menu" role="menu">
                  <span className="cave-reader-menu__head">Export this answer</span>
                  <button
                    type="button"
                    role="menuitem"
                    className="cave-reader-menu__item focus-ring"
                    onClick={exportMarkdown}
                  >
                    <Icon name="ph:file-md" width={12} aria-hidden />
                    Markdown
                    <span className="cave-reader-menu__ext">.md</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="cave-reader-menu__item focus-ring"
                    onClick={exportPdf}
                  >
                    <Icon name="ph:printer" width={12} aria-hidden />
                    PDF
                    <span className="cave-reader-menu__ext">print</span>
                  </button>
                  <span className="cave-reader-menu__foot">exports the answer as written</span>
                </span>
              ) : null}
            </span>

            <button
              type="button"
              className="cave-reader-iconbtn focus-ring"
              onClick={() => void copy()}
              aria-label={copied ? "Answer copied" : "Copy answer"}
            >
              {copied ? <span className="cave-reader-copyfill" aria-hidden /> : null}
              <Icon
                name={copied ? "ph:check" : "ph:copy"}
                width={12}
                className={`cave-reader-copybtn__glyph${copied ? " cave-reader-copybtn__glyph--done" : ""}`}
                aria-hidden
              />
            </button>

            <span className="cave-reader-head__divider" aria-hidden />

            <button
              type="button"
              className="cave-reader-iconbtn cave-reader-iconbtn--close focus-ring"
              onClick={onClose}
              aria-label="Close expanded view"
            >
              <Icon name="ph:x-bold" width={11} aria-hidden />
            </button>
          </div>
        </div>

        <div className="cave-reader-body">
          {navOpen && outline.length ? (
            <nav className="cave-reader-rail" id={railId} aria-label="Contents">
              <span className="cave-reader-eyebrow cave-reader-rail__eyebrow">Contents</span>
              <div className="cave-reader-rail__list">
                {outline.map((heading) => (
                  <button
                    key={heading.id}
                    type="button"
                    className="cave-reader-rail__link focus-ring"
                    aria-current={activeId === heading.id ? "true" : undefined}
                    style={{ "--reader-depth": heading.level - baseLevel } as CSSProperties}
                    onClick={() => goTo(heading.id)}
                  >
                    {heading.text}
                  </button>
                ))}
              </div>
              <div className="cave-reader-rail__foot">
                <span className="cave-reader-eyebrow">Reading</span>
                <span className="cave-reader-rail__meta">
                  <span>
                    {stats.words.toLocaleString()} words · {stats.minutes} min read
                  </span>
                </span>
              </div>
            </nav>
          ) : null}

          <div className="cave-reader-main">
            <div
              ref={docRef}
              className="cave-reader-doc"
              onScroll={onScroll}
              onMouseUp={onSelect}
            >
              <div className="cave-reader-measure">
                {skills.length ? (
                  <div className="cave-reader-turnmeta">
                    <span className="cave-reader-eyebrow">Skills</span>
                    {skills.map((skill) => (
                      <span key={skill.id} className="cave-reader-chip">
                        <Icon
                          name={skill.source === "mcp" ? "ph:plug" : "ph:flask"}
                          width={10}
                          aria-hidden
                        />
                        {skill.name}
                        <span className="cave-reader-chip__count">
                          {skill.calls} call{skill.calls === 1 ? "" : "s"}
                        </span>
                      </span>
                    ))}
                  </div>
                ) : null}

                {children}

                <div className="cave-reader-rule" aria-hidden>
                  <span className="cave-reader-rule__line" />
                  <Icon name="ph:sparkle" width={11} />
                  <span className="cave-reader-rule__line cave-reader-rule__line--right" />
                </div>
              </div>
            </div>

            {selection && onAsk ? (
              <div className="cave-reader-selbar">
                <span className="cave-reader-eyebrow">Selected</span>
                <span className="cave-reader-selbar__text">{selection}</span>
                <button type="button" className="ui-btn ui-btn--primary ui-btn--sm focus-ring" onClick={ask}>
                  Ask about this
                </button>
                <button
                  type="button"
                  className="cave-reader-iconbtn cave-reader-iconbtn--close focus-ring"
                  onClick={() => setSelection(null)}
                  aria-label="Dismiss selection"
                >
                  <Icon name="ph:x-bold" width={10} aria-hidden />
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {tabs.length ? (
          <div className="cave-reader-foot">
            {footOpen ? (
              <div className="cave-reader-panel">
                <div className="cave-reader-panel__tabs">
                  <div className="cave-reader-tablist" role="tablist" aria-label="Provenance">
                    {tabs.map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        role="tab"
                        className="cave-reader-tab focus-ring"
                        aria-selected={footTab === tab}
                        onClick={() => setFootTab(tab)}
                      >
                        {tab === "sources" ? `Sources · ${citations.length}` : null}
                        {tab === "tools" ? `Tools · ${tools?.length ?? 0}` : null}
                        {tab === "skills" ? `Skills · ${skills.length}` : null}
                      </button>
                    ))}
                  </div>
                  {footTab === "tools" ? (
                    <Segmented
                      options={TOOLS_VIEWS}
                      value={toolsView}
                      onChange={setToolsView}
                      getLabel={viewLabel}
                      ariaLabel="Tool view"
                    />
                  ) : null}
                  {/* One group is not a split — the switch appears only when
                      "By type" would actually say something the cards do not. */}
                  {footTab === "skills" && groups.length > 1 ? (
                    <Segmented
                      options={SKILLS_VIEWS}
                      value={skillsView}
                      onChange={setSkillsView}
                      getLabel={viewLabel}
                      ariaLabel="Skill view"
                    />
                  ) : null}
                </div>

                <div className="cave-reader-panel__scroll">
                  {footTab === "sources"
                    ? citations.map((citation) => {
                        const presented = citationSourcePresentation(citation);
                        return (
                          <button
                            key={citation.id}
                            type="button"
                            className="cave-reader-row cave-reader-row--source focus-ring"
                            onClick={() => setViewer(citation)}
                          >
                            <span className="cave-reader-row__mark">S{citation.n}</span>
                            <span className="cave-reader-row__title">{citation.title}</span>
                            <span className="cave-reader-row__sub">
                              {citation.domain ?? presented.provider}
                            </span>
                            <span className="cave-reader-row__trail">{presented.kind}</span>
                          </button>
                        );
                      })
                    : null}

                  {footTab === "tools" && toolsView === "batches"
                    ? batches.map((batch) => (
                        <div
                          key={batch.headToolId}
                          className="cave-reader-row cave-reader-row--batch"
                          data-tool-category={batch.category}
                        >
                          <span className="cave-reader-row__batchdot" aria-hidden />
                          <span className="cave-reader-row__batchno">batch {batch.index}</span>
                          <span className="cave-reader-row__batchlabel">{batch.label}</span>
                          <span className="cave-reader-row__trail">{batch.mode}</span>
                          <span className="cave-reader-row__trail">
                            {formatBatchDuration(batch.durationMs)}
                          </span>
                        </div>
                      ))
                    : null}

                  {footTab === "tools" && toolsView === "tools"
                    ? rollups.map((rollup) => (
                        <div
                          key={rollup.name}
                          className={`cave-reader-row cave-reader-row--batch${rollup.errors ? " cave-reader-row--error" : ""}`}
                          data-tool-category={rollup.category}
                        >
                          <span className="cave-reader-row__toolname">{rollup.name}</span>
                          <span className="cave-reader-row__batchlabel">
                            {rollup.errors
                              ? `${rollup.errors} of ${rollup.calls} failed`
                              : `${rollup.calls} call${rollup.calls === 1 ? "" : "s"}`}
                          </span>
                          <span
                            className="cave-reader-share"
                            role="img"
                            aria-label={`${Math.round(rollup.share * 100)}% of the turn's measured time`}
                          >
                            <span
                              className="cave-reader-share__fill"
                              style={{ width: `${rollup.share * 100}%` }}
                            />
                          </span>
                          <span className="cave-reader-row__trail">
                            {formatBatchDuration(rollup.durationMs)}
                          </span>
                        </div>
                      ))
                    : null}

                  {footTab === "tools" && toolsView === "timeline"
                    ? steps.map((step) => (
                        <div
                          key={step.id}
                          className="cave-reader-step cave-reader-row--batch"
                          data-tool-category={step.category}
                          data-status={step.status}
                        >
                          <span className="cave-reader-step__n">{step.n}</span>
                          <span className="cave-reader-step__dot" aria-hidden />
                          <span className="cave-reader-step__tool">{step.name}</span>
                          <span className="cave-reader-step__target">{step.target}</span>
                          <span className="cave-reader-step__status">
                            {step.status === "ok" ? "ok" : step.status}
                          </span>
                          <span className="cave-reader-row__trail">
                            {formatBatchDuration(step.durationMs)}
                          </span>
                        </div>
                      ))
                    : null}

                  {footTab === "skills" && skillsView === "types"
                    ? groups.map((group) => (
                        <div key={group.source} className="cave-reader-group">
                          <span className="cave-reader-eyebrow cave-reader-group__head">
                            {group.label} · {group.skills.length}
                          </span>
                          {group.skills.map((skill) => (
                            <div key={skill.id} className="cave-reader-row">
                              <span className="cave-reader-skillcard__mark" aria-hidden>
                                <Icon
                                  name={skill.source === "mcp" ? "ph:plug" : "ph:flask"}
                                  width={12}
                                />
                              </span>
                              <span className="cave-reader-row__title">{skill.name}</span>
                              <span className="cave-reader-row__sub" />
                              <span className="cave-reader-row__trail">
                                {skill.calls} call{skill.calls === 1 ? "" : "s"}
                              </span>
                            </div>
                          ))}
                        </div>
                      ))
                    : null}

                  {footTab === "skills" && skillsView === "cards" ? (
                    <div className="cave-reader-skillgrid">
                      {skills.map((skill) => (
                        <div key={skill.id} className="cave-reader-skillcard">
                          <div className="cave-reader-skillcard__head">
                            <span className="cave-reader-skillcard__mark" aria-hidden>
                              <Icon
                                name={skill.source === "mcp" ? "ph:plug" : "ph:flask"}
                                width={12}
                              />
                            </span>
                            <span className="cave-reader-skillcard__name">{skill.name}</span>
                            <span className="cave-reader-badge">
                              {skill.source === "mcp" ? "MCP" : "SKILL"}
                            </span>
                          </div>
                          <span className="cave-reader-skillcard__calls">
                            {skill.calls} call{skill.calls === 1 ? "" : "s"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <button
              type="button"
              className="cave-reader-foot__toggle focus-ring"
              onClick={() => setFootOpen((v) => !v)}
              aria-expanded={footOpen}
            >
              <span className="cave-reader-eyebrow cave-reader-foot__label">
                <Icon name="ph:sparkle" width={11} aria-hidden />
                How this was made
              </span>
              <span className="cave-reader-foot__summary">
                {citations.length ? (
                  <span className="cave-reader-stat cave-reader-stat--sources">
                    <span className="cave-reader-stat__dot" aria-hidden />
                    {citations.length} source{citations.length === 1 ? "" : "s"}
                  </span>
                ) : null}
                {tools?.length ? (
                  <span className="cave-reader-stat cave-reader-stat--steps">
                    <span className="cave-reader-stat__dot" aria-hidden />
                    {tools.length} step{tools.length === 1 ? "" : "s"} · {batches.length} batch
                    {batches.length === 1 ? "" : "es"}
                  </span>
                ) : null}
                {skills.length ? (
                  <span className="cave-reader-stat cave-reader-stat--skills">
                    <span className="cave-reader-stat__dot" aria-hidden />
                    {skills.length} skill{skills.length === 1 ? "" : "s"}
                  </span>
                ) : null}
                {durationMs ? <span>{formatBatchDuration(durationMs)}</span> : null}
                {errorCount ? (
                  <span className="cave-reader-stat cave-reader-stat--errors">
                    {errorCount} error{errorCount === 1 ? "" : "s"}
                  </span>
                ) : null}
                <Icon name="ph:caret-up" width={11} className="cave-reader-foot__chev" aria-hidden />
              </span>
            </button>
          </div>
        ) : null}

        {viewer ? <SourceViewer citation={viewer} onClose={() => setViewer(null)} /> : null}
      </div>
    </div>,
    document.body,
  );
}

/** One source, opened over the reader rather than navigated to — checking a
 *  citation should never cost you your place in the answer. */
function SourceViewer({ citation, onClose }: { citation: Citation; onClose: () => void }) {
  const presented = citationSourcePresentation(citation);
  return (
    <div className="cave-reader-viewer" onClick={onClose} role="presentation">
      <div
        className="cave-reader-viewer__card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={citation.title}
      >
        <div className="cave-reader-viewer__head">
          <Icon name="ph:link-simple" width={13} aria-hidden />
          <span className="cave-reader-viewer__title">{citation.title}</span>
          {citation.url ? (
            <a
              className="ui-btn ui-btn--ghost ui-btn--sm focus-ring"
              href={citation.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open link
              <Icon name="ph:arrow-square-out" width={9} aria-hidden />
            </a>
          ) : null}
          <button
            type="button"
            className="cave-reader-iconbtn cave-reader-iconbtn--close focus-ring"
            onClick={onClose}
            aria-label="Close source"
          >
            <Icon name="ph:x-bold" width={10} aria-hidden />
          </button>
        </div>

        <div className="cave-reader-viewer__body">
          <p className="cave-reader-viewer__summary">{presented.summary}</p>
          {citation.snippet ? (
            <div className="cave-reader-viewer__field">
              <span className="cave-reader-eyebrow">Excerpt used</span>
              <p className="cave-reader-viewer__excerpt">“{citation.snippet}”</p>
            </div>
          ) : null}
        </div>

        <div className="cave-reader-viewer__foot">
          <span>{presented.provider}</span>
          <span>·</span>
          <span>{presented.context}</span>
          <span className="cave-reader-viewer__hint">Esc or click outside to return</span>
        </div>
      </div>
    </div>
  );
}
