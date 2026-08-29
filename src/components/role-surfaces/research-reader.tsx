"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  DocumentReader,
  type DocumentReaderApi,
} from "@/components/document-reader";
import { MarkdownBlock } from "@/components/message-bubble";
import { useAnnouncer } from "@/components/ui/live-region";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { PopoverItem } from "@/components/ui/popover";
import { copyText } from "@/lib/clipboard";
import { relativeTime } from "@/lib/relative-time";
import {
  parseFindingsDoc,
  targetsSupportingRef,
  type FindingsBlock,
  type FindingsSpan,
  type FindingsSupportTarget,
} from "@/lib/research-findings-doc";
import { deriveResearchFindingsIntegrity } from "@/lib/research-findings-integrity";
import type {
  ResearchArtifactRef,
  ResearchMission,
  ResearchSourceRef,
} from "@/lib/research-missions";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { ResearchEvidenceInspector } from "./research-evidence-inspector";
import {
  ResearchProvenanceEdge,
  type ResearchProvenanceTone,
} from "./research-provenance-edge";
import "@/styles/research-reader.css";

const RAIL_MIN = 240;
const RAIL_MAX = 520;
const COLLAPSE_AT = 200;
const CONFIDENCE_RE = /^(high|medium|low)$/i;
const CONFLICT_ID_RE = /^C\d+$/;

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

type EvidenceTip = {
  id: string;
  title: string;
  meta: string;
  label: string;
  tone: "ok" | "warn" | "muted";
  left: number;
  top: number;
};

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

function sourceMeta(source: ResearchSourceRef): string {
  const parts = [source.publisher || source.sourceType];
  if (source.publishedAt) parts.push(source.publishedAt);
  if (source.url) parts.push("fetched");
  else if (source.localPath) parts.push("local");
  return parts.filter(Boolean).join(" · ");
}

function statusView(status: ResearchSourceRef["status"]): {
  label: string;
  tone: EvidenceTip["tone"];
} {
  if (status === "used") return { label: "Verified", tone: "ok" };
  if (status === "conflicting") return { label: "Conflicts", tone: "warn" };
  if (status === "rejected") return { label: "Rejected", tone: "muted" };
  return { label: "Candidate", tone: "muted" };
}

function refIdsForSpans(spans: FindingsSpan[]): string[] {
  const ids: string[] = [];
  for (const span of spans) {
    if (span.kind === "ref" && !ids.includes(span.id)) ids.push(span.id);
  }
  return ids;
}

export function ResearchReader({
  mission,
  artifact,
  markdown,
  onClose,
  onOpenUrl,
  onPublish,
}: ResearchReaderProps) {
  const { announce } = useAnnouncer();
  const readerRef = useRef<HTMLDivElement | null>(null);
  const documentReaderApiRef = useRef<DocumentReaderApi | null>(null);
  const pbarRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const tableFocusReturnRef = useRef<HTMLButtonElement | null>(null);
  const focusedTableRef = useRef<HTMLDivElement | null>(null);
  const contentsToggleRef = useRef<HTMLButtonElement | null>(null);
  const evidenceToggleRef = useRef<HTMLButtonElement | null>(null);
  const draggingRail = useRef(false);

  const doc = useMemo(
    () => parseFindingsDoc(markdown ?? "", mission.sources),
    [markdown, mission.sources],
  );
  const integrity = useMemo(
    () => deriveResearchFindingsIntegrity(markdown ?? "", mission.sources),
    [markdown, mission.sources],
  );
  const sourceById = useMemo(
    () => new Map(mission.sources.map((source) => [source.id, source])),
    [mission.sources],
  );
  const targetsBySource = useMemo(
    () =>
      new Map<string, FindingsSupportTarget[]>(
        mission.sources.map((source) => [
          source.id,
          targetsSupportingRef(doc, source.id),
        ]),
      ),
    [doc, mission.sources],
  );

  const [tocOn, setTocOn] = useState(false);
  const [inspectorOn, setInspectorOn] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<{ id: string; heading: string } | null>(null);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const [railWidth, setRailWidth] = useState(300);
  const [copied, setCopied] = useState(false);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [focusTable, setFocusTable] = useState<Extract<FindingsBlock, { kind: "table" }> | null>(null);
  const [tip, setTip] = useState<EvidenceTip | null>(null);

  const closeTable = () => {
    setFocusTable(null);
    requestAnimationFrame(() => tableFocusReturnRef.current?.focus());
  };

  const closeFocusOrReader = () => {
    if (focusTable) {
      closeTable();
      return;
    }
    if (inspectorOn) {
      setInspectorOn(false);
      requestAnimationFrame(() => evidenceToggleRef.current?.focus());
      return;
    }
    if (tocOn) {
      setTocOn(false);
      requestAnimationFrame(() => contentsToggleRef.current?.focus());
      return;
    }
    onClose();
  };

  useFocusTrap(true, readerRef, { onEscape: closeFocusOrReader });

  useEffect(() => {
    readerRef.current?.style.setProperty("--rail-w", `${railWidth}px`);
  }, [railWidth]);

  useEffect(() => {
    if (tip && tipRef.current) {
      tipRef.current.style.left = `${tip.left}px`;
      tipRef.current.style.top = `${tip.top}px`;
    }
  }, [tip]);

  useEffect(() => {
    if (focusTable) focusedTableRef.current?.focus();
  }, [focusTable]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!draggingRail.current || !readerRef.current) return;
      const rect = readerRef.current.getBoundingClientRect();
      let width = rect.right - event.clientX - 1;
      if (width < COLLAPSE_AT) width = RAIL_MIN;
      setRailWidth(Math.max(RAIL_MIN, Math.min(RAIL_MAX, width)));
    };
    const up = (event: PointerEvent) => {
      if (!draggingRail.current || !readerRef.current) return;
      const rect = readerRef.current.getBoundingClientRect();
      if (rect.right - event.clientX - 1 < COLLAPSE_AT) {
        setInspectorOn(false);
      }
      draggingRail.current = false;
      readerRef.current
        .querySelector(".rr-railhandle")
        ?.removeAttribute("data-drag");
      document.body.style.userSelect = "";
    };

    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
  }, []);

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
  const published =
    Boolean(artifact.knowledgeId) || artifact.state === "published";
  const rejected = artifact.state === "rejected";
  const lifecycleLabel = rejected
    ? "Rejected"
    : published
      ? "Published"
      : "Working draft";
  const showPublish =
    Boolean(onPublish) &&
    artifact.state === "working" &&
    !artifact.knowledgeId;
  const compactTitle = doc.title ?? artifact.title;
  const chromeTitle = activeSection?.heading
    ? `${compactTitle} · ${activeSection.heading}`
    : compactTitle;
  const hasDocumentContent =
    doc.title !== null || doc.lede !== null || doc.sections.length > 0;

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
    else window.open(url, "_blank", "noopener,noreferrer");
  };

  const cite = async (source: ResearchSourceRef) => {
    const ok = await copyText(citationText(source));
    announce(ok ? "Citation copied." : "Citation could not be copied.");
  };

  const toggleSource = (id: string) => {
    setSelectedSourceId(id);
    setOpenIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onRefClick = (id: string) => {
    const source = sourceById.get(id);
    if (!source) {
      announce(
        `${CONFLICT_ID_RE.test(id) ? "Conflict" : "Evidence"} ${id} has no source record.`,
      );
      return;
    }

    setSelectedSourceId(id);
    setInspectorOn(true);
    setOpenIds((previous) => new Set(previous).add(id));
    announce(
      `${CONFLICT_ID_RE.test(id) ? "Opened conflict" : "Opened evidence"} ${id}.`,
    );
  };

  const clearPreview = () => {
    setHoverKey(null);
    setTip(null);
  };

  const onRefPreview = (id: string | null, element?: HTMLElement) => {
    if (!id || !element) {
      clearPreview();
      return;
    }

    setHoverKey(id);
    const source = sourceById.get(id);
    const view = source
      ? statusView(source.status)
      : CONFLICT_ID_RE.test(id)
        ? { label: "Conflict", tone: "warn" as const }
        : { label: "Unresolved", tone: "warn" as const };
    const rect = element.getBoundingClientRect();
    setTip({
      id,
      title:
        source?.title ??
        (CONFLICT_ID_RE.test(id) ? "Open conflict" : "Unresolved reference"),
      meta: source ? sourceMeta(source) : "No matching ledger record",
      label: view.label,
      tone: view.tone,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 272)),
      top: rect.top - 8,
    });
  };

  const toneForId = (id: string): ResearchProvenanceTone => {
    if (CONFLICT_ID_RE.test(id)) return "warn";
    if (integrity.unresolvedIds.includes(id)) return "unresolved";
    const source = sourceById.get(id);
    if (source?.status === "conflicting") return "warn";
    if (source?.status === "rejected") return "muted";
    return source ? "accent" : "unresolved";
  };

  const renderEdge = (ids: string[]) => (
    <ResearchProvenanceEdge
      ids={ids}
      selectedId={selectedSourceId}
      toneForId={toneForId}
      onPreview={onRefPreview}
      onSelect={onRefClick}
    />
  );

  const renderSpans = (
    spans: FindingsSpan[],
    keyPrefix: string,
  ): ReactNode[] =>
    spans.map((span, index) => {
      const key = `${keyPrefix}-${index}`;
      if (span.kind === "ref") {
        const toneClass =
          span.tone === "warn"
            ? " rr-sref--warn"
            : span.tone === "muted"
              ? " rr-sref--muted"
              : "";
        const matched =
          hoverKey === span.id || selectedSourceId === span.id;
        return (
          <button
            key={key}
            type="button"
            className={`rr-sref rr-inline-ref${toneClass}${matched ? " is-match" : ""}`}
            aria-label={`${CONFLICT_ID_RE.test(span.id) ? "Open conflict" : "Open evidence"} ${span.id}`}
            onMouseEnter={(event) =>
              onRefPreview(span.id, event.currentTarget)
            }
            onMouseLeave={clearPreview}
            onFocus={(event) => onRefPreview(span.id, event.currentTarget)}
            onBlur={clearPreview}
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

  const renderLede = (lede: FindingsSpan[]): ReactNode => (
    <div
      className="rr-block-row"
      data-document-target={doc.ledeId ?? undefined}
      tabIndex={doc.ledeId ? -1 : undefined}
    >
      <div>{renderSpans(lede, "lede")}</div>
      {renderEdge(refIdsForSpans(lede))}
    </div>
  );

  const renderCell = (cell: FindingsSpan[], key: string): ReactNode => {
    if (
      cell.length === 1 &&
      cell[0].kind === "text" &&
      CONFIDENCE_RE.test(cell[0].text.trim())
    ) {
      const level = cell[0].text.trim().toLowerCase();
      const tone =
        level === "high"
          ? "rr-cf--high"
          : level === "medium"
            ? "rr-cf--med"
            : "rr-cf--low";
      return <span className={`rr-cf ${tone}`}>{cell[0].text.trim()}</span>;
    }
    return renderSpans(cell, key);
  };

  const renderTable = (
    table: Extract<FindingsBlock, { kind: "table" }>,
    targetable = true,
  ): ReactNode => (
    <table className="rr-table">
      <thead>
        <tr>
          {table.header.map((cell, index) => (
            <th key={`header-${index}`} scope="col">
              {renderSpans(cell, `th-${index}`)}
            </th>
          ))}
          <th className="rr-table__evidence" scope="col">Evidence</th>
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row) => (
          <tr
            key={row.id}
            data-document-target={targetable ? row.id : undefined}
            tabIndex={targetable ? -1 : undefined}
          >
            {row.cells.map((cell, index) => (
              <td key={`${row.id}:cell:${index}`}>
                {renderCell(cell, `${row.id}:cell:${index}`)}
              </td>
            ))}
            <td className="rr-table__evidence">
              {renderEdge(row.refIds)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const renderBlock = (block: FindingsBlock, key: string): ReactNode => {
    if (block.kind === "p" || block.kind === "quote") {
      const content =
        block.kind === "quote" ? (
          <blockquote>{renderSpans(block.spans, key)}</blockquote>
        ) : (
          <p>{renderSpans(block.spans, key)}</p>
        );
      return (
        <div
          key={key}
          className="rr-block-row"
          data-document-target={block.id}
          tabIndex={-1}
        >
          {content}
          {renderEdge(block.refIds)}
        </div>
      );
    }

    if (block.kind === "ul" || block.kind === "ol") {
      const List = block.kind;
      return (
        <List key={key}>
          {block.items.map((item) => (
            <li
              key={item.id}
              className="rr-list-row"
              data-document-target={item.id}
              tabIndex={-1}
            >
              <span>{renderSpans(item.spans, `${key}:${item.id}`)}</span>
              {renderEdge(item.refIds)}
            </li>
          ))}
        </List>
      );
    }

    if (block.kind === "code") {
      const longestBacktickRun = Math.max(
        0,
        ...(block.code.match(/`+/g)?.map((run) => run.length) ?? []),
      );
      const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
      return (
        <div key={key} className="rr-codeblock document-reader__wide-block">
          <MarkdownBlock
            text={`${fence}${block.language}\n${block.code}\n${fence}`}
            onOpenUrl={openUrl}
          />
        </div>
      );
    }

    if (block.kind === "table") return (
      <div className="rr-krblock document-reader__wide-block" key={key}>
        <button
          className="rr-krfocus focus-ring"
          type="button"
          onClick={(event) => {
            tableFocusReturnRef.current = event.currentTarget;
            setFocusTable(block);
          }}
          aria-label="Focus table"
        >
          <svg
            width={13}
            height={13}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <path d="M15 3h6v6m0-6-7 7M9 21H3v-6m0 6 7-7" />
          </svg>
        </button>
        <div
          className="rr-krframe focus-ring"
          role="region"
          aria-label="Scrollable key results table"
          tabIndex={0}
        >
          {renderTable(block)}
        </div>
      </div>
    );

    return null;
  };

  const onHandleDown = (event: React.PointerEvent) => {
    draggingRail.current = true;
    event.currentTarget.setAttribute("data-drag", "true");
    document.body.style.userSelect = "none";
    event.preventDefault();
  };

  return createPortal(
    <>
      <div
        className="research-reader-overlay"
        role="presentation"
        onClick={onClose}
      >
        <div
          ref={readerRef}
          className="research-reader focus-ring"
          role="dialog"
          aria-modal="true"
          aria-label={`${artifact.title} — research reader`}
          data-toc={tocOn}
          data-rail={inspectorOn}
          data-copied={copied}
          tabIndex={-1}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="rr-pbar">
            <div className="rr-pbar__fill" ref={pbarRef} />
          </div>

          <div className="rr-head">
            <span
              className={`rr-status${published && !rejected ? "" : " rr-status--muted"}`}
            >
              <i className="rr-status__dot" aria-hidden />
              {lifecycleLabel}
            </span>
            <span
              className={`rr-integrity rr-integrity--${integrity.summary.kind}`}
            >
              {integrity.summary.label}
            </span>
            <span className="rr-meta" title={metaLine}>
              {chromeTitle}
            </span>
            <div className="rr-head__actions">
              {showPublish ? (
                <button
                  className="rr-btn rr-btn--accent focus-ring"
                  type="button"
                  onClick={onPublish}
                >
                  <svg
                    width={14}
                    height={14}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                  >
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
                  </svg>
                  Publish
                </button>
              ) : null}
              <button
                ref={contentsToggleRef}
                className="rr-iconbtn focus-ring"
                type="button"
                aria-pressed={tocOn}
                title={tocOn ? "Hide contents" : "Show contents"}
                aria-label={tocOn ? "Hide contents" : "Show contents"}
                onClick={() => setTocOn((value) => !value)}
              >
                <svg
                  width={15}
                  height={15}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                >
                  <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                </svg>
              </button>
              <button
                ref={evidenceToggleRef}
                className="rr-iconbtn focus-ring"
                type="button"
                aria-pressed={inspectorOn}
                title={inspectorOn ? "Hide evidence" : "Show evidence"}
                aria-label={inspectorOn ? "Hide evidence" : "Show evidence"}
                onClick={() => setInspectorOn((value) => !value)}
              >
                <svg
                  width={15}
                  height={15}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                >
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path d="M15 4v16" />
                </svg>
              </button>
              <OverflowMenu ariaLabel="More research reader actions">
                <PopoverItem onSelect={() => void copy()} disabled={!markdown}>
                  {copied ? "Copied findings" : "Copy findings"}
                </PopoverItem>
                <PopoverItem onSelect={exportPdf}>Export PDF</PopoverItem>
              </OverflowMenu>
              <button
                className="rr-iconbtn focus-ring"
                type="button"
                title="Close"
                aria-label="Close"
                onClick={onClose}
              >
                <svg
                  width={15}
                  height={15}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.9}
                >
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
          </div>

          <div className="research-reader__grid">
            <DocumentReader
              document={doc}
              navigation={tocOn ? "rail" : "compact"}
              kicker={titleCase(artifact.kind)}
              context={
                hasDocumentContent ? (
                  <p title={mission.intent}>{mission.intent}</p>
                ) : undefined
              }
              collapsibleSections={false}
              apiRef={documentReaderApiRef}
              onActiveSectionChange={setActiveSection}
              onScrollProgress={(progress) => {
                if (pbarRef.current) {
                  pbarRef.current.style.width = `${progress * 100}%`;
                }
              }}
              tocMeta={
                <>
                  <span>
                    {mission.sources.length} sources · {integrity.counts.used} used
                  </span>
                  <span>
                    {passes} pass{passes === 1 ? "" : "es"} · {mission.mode}
                  </span>
                </>
              }
              empty={
                <div className="rr-empty">
                  This {artifact.title.toLowerCase()} deliverable has not been
                  written yet.
                </div>
              }
              renderLede={renderLede}
              renderBlock={renderBlock}
            />

            <div
              className="rr-railhandle"
              onPointerDown={onHandleDown}
              aria-hidden
            >
              <div className="rr-railgrip" />
            </div>

            <aside className="rr-col rr-rail" aria-label="Evidence">
              <ResearchEvidenceInspector
                sources={mission.sources}
                integrityLabel={integrity.summary.label}
                selectedId={selectedSourceId}
                openIds={openIds}
                targetsBySource={targetsBySource}
                onToggle={toggleSource}
                onOpenUrl={openUrl}
                onCite={(source) => void cite(source)}
                onSupport={(target) => {
                  setInspectorOn(false);
                  requestAnimationFrame(() =>
                    documentReaderApiRef.current?.scrollToTarget(target.id, true)
                  );
                }}
                onClose={() => {
                  setInspectorOn(false);
                  requestAnimationFrame(() =>
                    evidenceToggleRef.current?.focus(),
                  );
                }}
              />
            </aside>
          </div>
        </div>
      </div>

      <div
        className="rr-tip"
        ref={tipRef}
        data-show={tip ? "true" : "false"}
        aria-hidden
      >
        {tip ? (
          <>
            <div className="rr-tip__head">
              <span className="rr-tip__id">{tip.id}</span>
              <span
                className={`rr-tip__status rr-srcstat--${tip.tone}`}
              >
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
        <div
          className="rr-kroverlay"
          role="presentation"
          onClick={closeTable}
        >
          <div
            ref={focusedTableRef}
            className="rr-kroverlay-card"
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            aria-label="Key results"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="rr-kroverlay__head">
              <div>
                <div className="rr-kroverlay__title">Key results</div>
                <div className="rr-kroverlay__sub">
                  {focusTable.rows.length} findings · reference table
                </div>
              </div>
              <button
                className="rr-iconbtn focus-ring"
                type="button"
                aria-label="Close"
                onClick={closeTable}
              >
                <svg
                  width={16}
                  height={16}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.9}
                >
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            {renderTable(focusTable, false)}
          </div>
        </div>
      ) : null}
    </>,
    document.body,
  );
}
