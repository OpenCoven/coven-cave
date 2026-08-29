"use client";

import {
  Fragment,
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { Icon } from "@/lib/icon";
import {
  Popover,
  PopoverBody,
  PopoverItem,
  PopoverLabel,
} from "@/components/ui/popover";
import { useAppPreferences } from "@/lib/app-preferences";
import {
  READER_TEXT_SCALE_DEFAULT_INDEX,
  READER_TEXT_SCALE_STEPS,
  applyReadingSize,
  clampScaleIndex,
  saveScaleIndex,
  scaleForIndex,
  scaleLabel,
} from "@/lib/reader-text-scale";
import {
  DEFAULT_READING_ALIGN,
  READING_ALIGN_OPTIONS,
  applyReadingAlign,
  type ReadingAlign,
} from "@/lib/reading-align";
import {
  DEFAULT_READING_HYPHENS,
  READING_HYPHENS_OPTIONS,
  applyReadingHyphens,
  type ReadingHyphens,
} from "@/lib/reading-hyphens";
import {
  DEFAULT_READING_LEADING,
  READING_LEADING_OPTIONS,
  applyReadingLeading,
  type ReadingLeading,
} from "@/lib/reading-leading";
import {
  DEFAULT_READING_TRACKING,
  READING_TRACKING_OPTIONS,
  applyReadingTracking,
  type ReadingTracking,
} from "@/lib/reading-tracking";
import {
  DEFAULT_READING_WEIGHT,
  READING_WEIGHT_OPTIONS,
  applyReadingWeight,
  type ReadingWeight,
} from "@/lib/reading-weight";
import {
  DEFAULT_READING_WIDTH,
  READING_WIDTH_OPTIONS,
  applyReadingWidth,
  type ReadingWidth,
} from "@/lib/reading-width";

const READING_LABELS = {
  leading: {
    compact: "Compact",
    normal: "Normal",
    relaxed: "Relaxed",
  } satisfies Record<ReadingLeading, string>,
  tracking: {
    normal: "Normal",
    wide: "Wide",
    wider: "Wider",
  } satisfies Record<ReadingTracking, string>,
  align: {
    left: "Left",
    justify: "Justify",
  } satisfies Record<ReadingAlign, string>,
  width: {
    full: "Balanced",
    medium: "Focused",
    narrow: "Narrow",
  } satisfies Record<ReadingWidth, string>,
  weight: {
    light: "Light",
    normal: "Normal",
    medium: "Medium",
  } satisfies Record<ReadingWeight, string>,
  hyphens: {
    off: "Off",
    on: "On",
  } satisfies Record<ReadingHyphens, string>,
};

export type DocumentReaderSection<TBlock> = {
  id: string;
  heading: string;
  level?: number;
  blocks: TBlock[];
};

export type DocumentReaderDocument<TBlock, TLede = TBlock> = {
  title: string | null;
  lede: TLede | null;
  sections: DocumentReaderSection<TBlock>[];
};

export type DocumentReaderApi = {
  scrollToSection: (id: string) => void;
  scrollToTarget: (id: string, focus?: boolean) => void;
};

type DocumentReaderProps<TBlock, TLede> = {
  document: DocumentReaderDocument<TBlock, TLede>;
  navigation?: "compact" | "rail" | "none";
  kicker?: ReactNode;
  context?: ReactNode;
  collapsibleSections?: boolean;
  empty?: ReactNode;
  tocMeta?: ReactNode;
  contentsId?: string;
  className?: string;
  apiRef?: MutableRefObject<DocumentReaderApi | null>;
  onScrollProgress?: (progress: number) => void;
  onActiveSectionChange?: (section: { id: string; heading: string } | null) => void;
  renderLede: (lede: TLede) => ReactNode;
  renderBlock: (block: TBlock, key: string) => ReactNode;
};

function headingTag(level: number | undefined): "h2" | "h3" | "h4" | "h5" | "h6" {
  if (level === 3) return "h3";
  if (level === 4) return "h4";
  if (level === 5) return "h5";
  if (level === 6) return "h6";
  return "h2";
}

export function DocumentReader<TBlock, TLede = TBlock>({
  document,
  navigation = "none",
  kicker,
  context,
  collapsibleSections = true,
  empty,
  tocMeta,
  contentsId,
  className,
  apiRef,
  onScrollProgress,
  onActiveSectionChange,
  renderLede,
  renderBlock,
}: DocumentReaderProps<TBlock, TLede>) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const contentsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const preferencesTriggerRef = useRef<HTMLButtonElement | null>(null);
  const tocLinkRefs = useRef(new Map<string, HTMLButtonElement>());
  const [contentsOpen, setContentsOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(
    document.sections.find((section) => section.heading)?.id ?? null,
  );
  const activeSectionRef = useRef(activeSection);
  const onActiveSectionChangeRef = useRef(onActiveSectionChange);
  onActiveSectionChangeRef.current = onActiveSectionChange;
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(document.sections.map((section) => section.id)),
  );

  const reading = useAppPreferences().appearance.reading;
  const [scaleIndex, setScaleIndex] = useState(
    READER_TEXT_SCALE_DEFAULT_INDEX,
  );

  useEffect(() => {
    setScaleIndex(
      clampScaleIndex(reading.size ?? READER_TEXT_SCALE_DEFAULT_INDEX),
    );
  }, [reading.size]);

  const stepScale = useCallback((delta: number) => {
    const next = clampScaleIndex(scaleIndex + delta);
    if (next !== scaleIndex) {
      setScaleIndex(next);
      saveScaleIndex(next);
      applyReadingSize(next);
    }
  }, [scaleIndex]);

  const atSmallest = scaleIndex <= 0;
  const atLargest = scaleIndex >= READER_TEXT_SCALE_STEPS.length - 1;

  const namedSections = useMemo(
    () => document.sections.filter((section) => section.heading),
    [document.sections],
  );

  const activeSectionForId = useCallback(
    (id: string | null) => {
      const section = namedSections.find((candidate) => candidate.id === id);
      return section ? { id: section.id, heading: section.heading } : null;
    },
    [namedSections],
  );

  const activateSection = useCallback(
    (id: string | null) => {
      if (activeSectionRef.current === id) return;
      activeSectionRef.current = id;
      setActiveSection(id);
      onActiveSectionChangeRef.current?.(activeSectionForId(id));
    },
    [activeSectionForId],
  );

  useEffect(() => {
    const resetActiveSection = namedSections[0]?.id ?? null;
    setOpenSections(new Set(document.sections.map((section) => section.id)));
    activeSectionRef.current = resetActiveSection;
    setActiveSection(resetActiveSection);
    onActiveSectionChangeRef.current?.(activeSectionForId(resetActiveSection));
  }, [activeSectionForId, document.sections, namedSections]);

  const scrollToElement = useCallback((target: HTMLElement) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const top =
      target.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    const behavior = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches
      ? "auto"
      : "smooth";
    scroller.scrollTo({ top, behavior });
  }, []);

  const scrollToSection = useCallback((id: string) => {
    const scroller = scrollerRef.current;
    const target = scroller?.querySelector<HTMLElement>(
      `[data-document-section="${CSS.escape(id)}"]`,
    );
    if (!target) return;
    scrollToElement(target);
    activateSection(id);
    setContentsOpen(false);
  }, [activateSection, scrollToElement]);

  const scrollToTarget = useCallback((id: string, focus?: boolean) => {
    const scroller = scrollerRef.current;
    const target = scroller?.querySelector<HTMLElement>(
      `[data-document-target="${CSS.escape(id)}"]`,
    );
    if (!target) return;
    scrollToElement(target);
    if (focus) {
      window.requestAnimationFrame(() => target.focus());
    }
  }, [scrollToElement]);

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = { scrollToSection, scrollToTarget };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, scrollToSection, scrollToTarget]);

  const onScroll = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const max = scroller.scrollHeight - scroller.clientHeight;
    onScrollProgress?.(
      max > 0 ? Math.min(1, scroller.scrollTop / max) : 0,
    );
    const top = scroller.getBoundingClientRect().top;
    let current: string | null = null;
    for (const section of namedSections) {
      const target = scroller.querySelector<HTMLElement>(
        `[data-document-section="${CSS.escape(section.id)}"]`,
      );
      if (target && target.getBoundingClientRect().top - top <= 60) {
        current = section.id;
      }
    }
    if (current) activateSection(current);
  };

  const toggleSection = (id: string) => {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onTocKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    id: string,
  ) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = namedSections.findIndex((section) => section.id === id);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? namedSections.length - 1
          : event.key === "ArrowDown"
            ? (currentIndex + 1) % namedSections.length
            : currentIndex <= 0
              ? namedSections.length - 1
              : currentIndex - 1;
    tocLinkRefs.current.get(namedSections[nextIndex]?.id)?.focus();
  };

  const resetReadingPreferences = () => {
    setScaleIndex(READER_TEXT_SCALE_DEFAULT_INDEX);
    saveScaleIndex(READER_TEXT_SCALE_DEFAULT_INDEX);
    applyReadingSize(READER_TEXT_SCALE_DEFAULT_INDEX);
    applyReadingWidth(DEFAULT_READING_WIDTH);
    applyReadingLeading(DEFAULT_READING_LEADING);
    applyReadingTracking(DEFAULT_READING_TRACKING);
    applyReadingAlign(DEFAULT_READING_ALIGN);
    applyReadingWeight(DEFAULT_READING_WEIGHT);
    applyReadingHyphens(DEFAULT_READING_HYPHENS);
  };

  const preferenceGroup = <T extends string>(
    label: string,
    options: readonly T[],
    value: T,
    labels: Record<T, string>,
    apply: (next: T) => void,
  ) => (
    <div className="document-reader__preference-group" role="group" aria-label={label}>
      <span className="document-reader__preference-label">{label}</span>
      <div className="document-reader__preference-options">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className="document-reader__preference-option focus-ring"
            aria-pressed={value === option}
            onClick={() => apply(option)}
          >
            {labels[option]}
          </button>
        ))}
      </div>
    </div>
  );

  const contents = (
    <>
      {namedSections.map((section) => (
        <button
          key={section.id}
          type="button"
          className="document-reader__toc-link rr-toclink focus-ring"
          data-active={activeSection === section.id}
          aria-current={activeSection === section.id ? "location" : undefined}
          tabIndex={activeSection === section.id ? 0 : -1}
          ref={(node) => {
            if (node) tocLinkRefs.current.set(section.id, node);
            else tocLinkRefs.current.delete(section.id);
          }}
          onClick={() => scrollToSection(section.id)}
          onKeyDown={(event) => onTocKeyDown(event, section.id)}
        >
          {section.heading}
        </button>
      ))}
    </>
  );

  const hasBody =
    document.title !== null ||
    (context !== null && context !== undefined) ||
    document.lede !== null ||
    document.sections.length > 0;

  return (
    <div
      className={[
        "document-reader",
        `document-reader--${navigation}`,
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        { "--reader-text-scale": scaleForIndex(scaleIndex) } as CSSProperties
      }
    >
      <div className="document-reader__layout">
      {navigation === "rail" && namedSections.length > 0 ? (
        <nav
          id={contentsId}
          className="document-reader__toc rr-col rr-toc"
          aria-label="Contents"
        >
          <div className="document-reader__toc-label rr-toc__label">
            Contents
          </div>
          <div className="document-reader__toc-links rr-toc__links">
            {contents}
          </div>
          {tocMeta ? (
            <div className="document-reader__toc-meta rr-toc__meta">
              {tocMeta}
            </div>
          ) : null}
        </nav>
      ) : null}

      <div
        ref={scrollerRef}
        className="document-reader__scroll rr-col rr-doc"
        onScroll={onScroll}
      >
        {/* One sticky control row. It renders in every navigation mode,
            because text size is not a navigation affordance — a reader with
            no table of contents still needs it. The Contents trigger keeps its
            own class so the existing compact-nav styling is unchanged. */}
        <div className="document-reader__toolbar">
          <div className="document-reader__preferences">
            <button
              ref={preferencesTriggerRef}
              type="button"
              className="document-reader__preferences-trigger focus-ring"
              title="Reading preferences"
              aria-label="Reading preferences"
              aria-haspopup="dialog"
              aria-expanded={preferencesOpen}
              onClick={() => setPreferencesOpen((current) => !current)}
            >
              <span aria-hidden>Aa</span>
            </button>
            <Popover
              open={preferencesOpen}
              onOpenChange={setPreferencesOpen}
              anchorRef={preferencesTriggerRef}
              placement="bottom-start"
              minWidth={280}
              ariaLabel="Reading preferences"
            >
              <PopoverBody>
                <PopoverLabel>Reading preferences</PopoverLabel>
                <div className="document-reader__size-row" role="group" aria-label="Reader size">
                  <button
                    type="button"
                    className="document-reader__size-step focus-ring"
                    onClick={() => stepScale(-1)}
                    disabled={atSmallest}
                    aria-label={`Decrease reader size (currently ${scaleLabel(scaleIndex)})`}
                  >
                    A−
                  </button>
                  <span aria-live="polite">{scaleLabel(scaleIndex)}</span>
                  <button
                    type="button"
                    className="document-reader__size-step focus-ring"
                    onClick={() => stepScale(1)}
                    disabled={atLargest}
                    aria-label={`Increase reader size (currently ${scaleLabel(scaleIndex)})`}
                  >
                    A+
                  </button>
                </div>
                {preferenceGroup("Width", READING_WIDTH_OPTIONS, reading.width, READING_LABELS.width, applyReadingWidth)}
                {preferenceGroup("Line spacing", READING_LEADING_OPTIONS, reading.leading, READING_LABELS.leading, applyReadingLeading)}
                {preferenceGroup("Letter spacing", READING_TRACKING_OPTIONS, reading.tracking, READING_LABELS.tracking, applyReadingTracking)}
                {preferenceGroup("Alignment", READING_ALIGN_OPTIONS, reading.align, READING_LABELS.align, applyReadingAlign)}
                {preferenceGroup("Weight", READING_WEIGHT_OPTIONS, reading.weight, READING_LABELS.weight, applyReadingWeight)}
                {preferenceGroup("Hyphenation", READING_HYPHENS_OPTIONS, reading.hyphens, READING_LABELS.hyphens, applyReadingHyphens)}
                <button
                  type="button"
                  className="document-reader__reset focus-ring"
                  onClick={resetReadingPreferences}
                >
                  Reset reading preferences
                </button>
              </PopoverBody>
            </Popover>
          </div>

          {navigation !== "none" && namedSections.length >= 2 ? (
          <div className="document-reader__compact-nav">
            <button
              ref={contentsTriggerRef}
              type="button"
              className="document-reader__contents-trigger focus-ring"
              aria-haspopup="dialog"
              aria-expanded={contentsOpen}
              onClick={() => setContentsOpen((current) => !current)}
            >
              <Icon name="ph:list-bullets" width={13} aria-hidden />
              Contents
            </button>
            <Popover
              open={contentsOpen}
              onOpenChange={setContentsOpen}
              anchorRef={contentsTriggerRef}
              placement="bottom-end"
              minWidth={220}
              ariaLabel="Document contents"
            >
              <PopoverBody>
                <PopoverLabel>Contents</PopoverLabel>
                {namedSections.map((section) => (
                  <PopoverItem
                    key={section.id}
                    semantic="button"
                    active={activeSection === section.id}
                    onSelect={() => scrollToSection(section.id)}
                  >
                    {section.heading}
                  </PopoverItem>
                ))}
              </PopoverBody>
            </Popover>
          </div>
          ) : null}
        </div>

        <div className="document-reader__column document-reader__prose rr-doc__column">
          {hasBody ? (
            <>
              {kicker ? (
                <div className="document-reader__kicker rr-doc__kicker">
                  {kicker}
                </div>
              ) : null}
              {document.title ? (
                <h1 className="document-reader__title">{document.title}</h1>
              ) : null}
              {context !== null && context !== undefined ? (
                <div className="document-reader__context">{context}</div>
              ) : null}
              {document.lede ? (
                <div className="document-reader__lede rr-lede">
                  {renderLede(document.lede)}
                </div>
              ) : null}
              {document.sections.map((section) => {
                if (!section.heading) {
                  return (
                    <div
                      key={section.id}
                      className="document-reader__overview"
                    >
                      {section.blocks.map((block, index) =>
                        <Fragment key={`${section.id}:block:${index}`}>
                          {renderBlock(block, `${section.id}:block:${index}`)}
                        </Fragment>,
                      )}
                    </div>
                  );
                }
                const open = openSections.has(section.id);
                const tag = headingTag(section.level);
                return (
                  <section
                    key={section.id}
                    className="document-reader__section"
                  >
                    {createElement(
                      tag,
                      {
                        className: "document-reader__heading",
                        "data-document-section": section.id,
                        id: section.id,
                      },
                      collapsibleSections ? (
                        <button
                          type="button"
                          className="document-reader__section-toggle rr-h2-btn focus-ring"
                          data-open={open}
                          aria-expanded={open}
                          onClick={() => toggleSection(section.id)}
                        >
                          <span>{section.heading}</span>
                          <Icon
                            name="ph:caret-down"
                            width={13}
                            className="document-reader__section-caret rr-sec-caret"
                            aria-hidden
                          />
                        </button>
                      ) : (
                        section.heading
                      ),
                    )}
                    {!collapsibleSections || open ? (
                      <div className="document-reader__section-body rr-doc__section-body">
                        {section.blocks.map((block, index) =>
                          <Fragment key={`${section.id}:block:${index}`}>
                            {renderBlock(
                              block,
                              `${section.id}:block:${index}`,
                            )}
                          </Fragment>,
                        )}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </>
          ) : (
            empty ?? null
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
