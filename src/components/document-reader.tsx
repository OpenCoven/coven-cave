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
import {
  READER_TEXT_SCALE_DEFAULT_INDEX,
  READER_TEXT_SCALE_STEPS,
  clampScaleIndex,
  loadScaleIndex,
  saveScaleIndex,
  scaleForIndex,
  scaleLabel,
} from "@/lib/reader-text-scale";

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
};

type DocumentReaderProps<TBlock, TLede> = {
  document: DocumentReaderDocument<TBlock, TLede>;
  navigation?: "compact" | "rail" | "none";
  kicker?: ReactNode;
  empty?: ReactNode;
  tocMeta?: ReactNode;
  className?: string;
  apiRef?: MutableRefObject<DocumentReaderApi | null>;
  onScrollProgress?: (progress: number) => void;
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
  empty,
  tocMeta,
  className,
  apiRef,
  onScrollProgress,
  renderLede,
  renderBlock,
}: DocumentReaderProps<TBlock, TLede>) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const contentsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(
    document.sections.find((section) => section.heading)?.id ?? null,
  );
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(document.sections.map((section) => section.id)),
  );

  // Text size starts at the default and adopts the stored value after mount.
  // Reading localStorage in the initializer would render different HTML on the
  // server than on the client and trip hydration, so the first paint is always
  // the default size and the effect below corrects it.
  const [scaleIndex, setScaleIndex] = useState(READER_TEXT_SCALE_DEFAULT_INDEX);

  useEffect(() => {
    setScaleIndex(loadScaleIndex());
  }, []);

  const stepScale = useCallback((delta: number) => {
    setScaleIndex((current) => {
      const next = clampScaleIndex(current + delta);
      if (next !== current) saveScaleIndex(next);
      return next;
    });
  }, []);

  const atSmallest = scaleIndex <= 0;
  const atLargest = scaleIndex >= READER_TEXT_SCALE_STEPS.length - 1;

  const namedSections = useMemo(
    () => document.sections.filter((section) => section.heading),
    [document.sections],
  );

  useEffect(() => {
    setOpenSections(new Set(document.sections.map((section) => section.id)));
    setActiveSection(namedSections[0]?.id ?? null);
  }, [document.sections, namedSections]);

  const scrollToSection = useCallback((id: string) => {
    const scroller = scrollerRef.current;
    const target = scroller?.querySelector<HTMLElement>(
      `[data-document-section="${CSS.escape(id)}"]`,
    );
    if (!scroller || !target) return;
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
    setActiveSection(id);
    setContentsOpen(false);
  }, []);

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = { scrollToSection };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, scrollToSection]);

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
    if (current) setActiveSection(current);
  };

  const toggleSection = (id: string) => {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const contents = (
    <>
      {namedSections.map((section) => (
        <button
          key={section.id}
          type="button"
          className="document-reader__toc-link rr-toclink focus-ring"
          data-active={activeSection === section.id}
          onClick={() => scrollToSection(section.id)}
        >
          {section.heading}
        </button>
      ))}
    </>
  );

  const hasBody =
    document.title !== null ||
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
      {navigation === "rail" && namedSections.length > 0 ? (
        <nav
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
          <div className="document-reader__textsize" role="group" aria-label="Text size">
            <button
              type="button"
              className="document-reader__textsize-btn focus-ring"
              onClick={() => stepScale(-1)}
              disabled={atSmallest}
              aria-label={`Decrease text size (currently ${scaleLabel(scaleIndex)})`}
              title="Decrease text size"
            >
              <span aria-hidden className="document-reader__textsize-glyph--small">A</span>
            </button>
            <button
              type="button"
              className="document-reader__textsize-btn focus-ring"
              onClick={() => stepScale(1)}
              disabled={atLargest}
              aria-label={`Increase text size (currently ${scaleLabel(scaleIndex)})`}
              title="Increase text size"
            >
              <span aria-hidden className="document-reader__textsize-glyph--large">A</span>
            </button>
          </div>

          {navigation === "compact" && namedSections.length >= 2 ? (
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

        <div className="document-reader__column rr-doc__column">
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
                      </button>,
                    )}
                    {open ? (
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
  );
}
