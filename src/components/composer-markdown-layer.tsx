"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";

import {
  decorateComposerMarkdown,
  type ComposerDecoration,
} from "@/lib/composer-markdown-decorations";
import {
  METRIC_PROBE_SAMPLE,
  MIRRORED_LAYER_STYLE_PROPERTIES,
  composerLayerAligned,
  emphasisIsMetricSafe,
} from "@/lib/composer-markdown-layer";

export type ComposerMarkdownLayerProps = {
  /** The composer draft — the exact string the textarea holds. */
  value: string;
  /** The textarea this layer paints behind. */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /**
   * Raised with `true` only once the layer both has something to show and has
   * been measured to line up. The composer hides the textarea's own glyphs on
   * exactly that signal, so a `false` here is the fail-open path back to an
   * ordinary, fully readable plain-text composer.
   */
  onDecoratedChange?: (decorated: boolean) => void;
};

function tokenClassName(decoration: ComposerDecoration): string {
  const inline = `cave-md-tok cave-md-tok--${decoration.kind}`;
  return decoration.block ? `${inline} cave-md-blk--${decoration.block}` : inline;
}

/**
 * The live markdown decoration painted behind the chat composer's caret
 * (cave-7ncq).
 *
 * It re-renders the draft's characters with syntax roles applied and sits
 * exactly under the textarea, which is made transparent while the two line up.
 * `src/lib/composer-markdown-layer.ts` carries the geometry contract and the
 * reasoning behind every constraint here; the short version is that this
 * element may change how text is *inked* but never how it is *laid out*.
 *
 * It is `aria-hidden` and `pointer-events: none`: the textarea remains the only
 * accessible, focusable, selectable thing in the composer, so screen readers,
 * caret browsing, and text selection are untouched by its presence.
 */
export function ComposerMarkdownLayer({
  value,
  textareaRef,
  onDecoratedChange,
}: ComposerMarkdownLayerProps) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [aligned, setAligned] = useState(false);
  const [metricSafe, setMetricSafe] = useState(false);

  const decorations = useMemo(() => decorateComposerMarkdown(value), [value]);
  const hasMarkdown = useMemo(
    () => decorations.some((d) => d.kind !== "text" || d.block !== undefined),
    [decorations],
  );

  /** Copy the textarea's resolved text metrics onto the layer. */
  const mirrorStyles = useCallback(() => {
    const textarea = textareaRef.current;
    const layer = layerRef.current;
    if (!textarea || !layer || typeof window === "undefined") return;
    const computed = window.getComputedStyle(textarea);
    for (const property of MIRRORED_LAYER_STYLE_PROPERTIES) {
      const resolved = computed[property as keyof CSSStyleDeclaration];
      if (typeof resolved === "string" && resolved) {
        layer.style[property as never] = resolved as never;
      }
    }
  }, [textareaRef]);

  /**
   * Measure whether slanting emphasis preserves advance widths in whatever font
   * the user has actually selected. Two probe spans, same sample, one slanted;
   * equal widths mean the oblique is synthesized from the regular face.
   */
  const probeMetricSafety = useCallback(() => {
    const layer = layerRef.current;
    if (!layer || typeof document === "undefined") return;
    const probe = document.createElement("div");
    probe.className = "cave-composer-md-probe";
    probe.setAttribute("aria-hidden", "true");
    const plain = document.createElement("span");
    plain.textContent = METRIC_PROBE_SAMPLE;
    const slanted = document.createElement("span");
    slanted.className = "cave-composer-md-probe__slanted";
    slanted.textContent = METRIC_PROBE_SAMPLE;
    probe.append(plain, slanted);
    layer.append(probe);
    const safe = emphasisIsMetricSafe(
      plain.getBoundingClientRect().width,
      slanted.getBoundingClientRect().width,
    );
    probe.remove();
    setMetricSafe(safe);
  }, []);

  /**
   * Bind the layer's box to the textarea's, then re-check alignment.
   *
   * The height is taken from the textarea rather than from a CSS `inset: 0`,
   * because the textarea is inline-block: it sits on its wrapper's baseline, so
   * the wrapper is a descender taller than the textarea itself (measured at 5px
   * in Chromium). A layer stretched to the wrapper is that much taller than the
   * text it paints, and the alignment check refuses to activate — correctly,
   * but for a reason that has nothing to do with text metrics.
   */
  const syncGeometry = useCallback(() => {
    const textarea = textareaRef.current;
    const layer = layerRef.current;
    if (!textarea || !layer) {
      setAligned(false);
      return;
    }
    layer.style.height = `${textarea.offsetHeight}px`;
    layer.scrollTop = textarea.scrollTop;
    layer.scrollLeft = textarea.scrollLeft;
    setAligned(composerLayerAligned(textarea.scrollHeight, layer.scrollHeight));
  }, [textareaRef]);

  // Mirror on mount, and again whenever the thing being mirrored can change:
  // a webfont swapping in, the root screen-scale steps, or a resize that moves
  // the composer between the mobile and desktop type rules.
  useEffect(() => {
    mirrorStyles();
    probeMetricSafety();
    if (typeof window === "undefined") return;

    const remeasure = () => {
      mirrorStyles();
      probeMetricSafety();
    };
    window.addEventListener("resize", remeasure);
    // `document.fonts` is absent in some embedded webviews; its absence just
    // means we keep the metrics measured at mount.
    void document.fonts?.ready.then(remeasure).catch(() => {});

    // The autogrow hook resizes the textarea from ChatView, whose effects run
    // *after* this child's. Observing the box rather than the draft makes the
    // re-measure independent of that ordering: whatever changes the textarea's
    // height, the layer follows it in the same frame.
    const textarea = textareaRef.current;
    const observer =
      typeof ResizeObserver === "function" && textarea
        ? new ResizeObserver(() => {
            mirrorStyles();
            syncGeometry();
          })
        : null;
    if (textarea && observer) observer.observe(textarea);

    return () => {
      window.removeEventListener("resize", remeasure);
      observer?.disconnect();
    };
  }, [mirrorStyles, probeMetricSafety, syncGeometry, textareaRef]);

  // Alignment is re-checked against the draft that is actually on screen: a
  // font that wraps differently only reveals itself once there is enough text
  // to wrap.
  useLayoutEffect(() => {
    syncGeometry();
  }, [value, metricSafe, syncGeometry]);

  // The textarea scrolls once the draft passes the composer's height cap; the
  // layer has to follow it or the decoration detaches from the visible lines.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const sync = () => {
      const layer = layerRef.current;
      if (!layer) return;
      layer.scrollTop = textarea.scrollTop;
      layer.scrollLeft = textarea.scrollLeft;
    };
    textarea.addEventListener("scroll", sync, { passive: true });
    return () => textarea.removeEventListener("scroll", sync);
  }, [textareaRef]);

  const decorated = hasMarkdown && aligned;
  useEffect(() => {
    onDecoratedChange?.(decorated);
  }, [decorated, onDecoratedChange]);

  return (
    <div
      ref={layerRef}
      className="cave-composer-md-layer"
      data-active={decorated ? "true" : "false"}
      data-metric-safe={metricSafe ? "true" : "false"}
      aria-hidden="true"
    >
      {decorations.map((decoration, index) => (
        <span key={index} className={tokenClassName(decoration)}>
          {decoration.text}
        </span>
      ))}
      {/* A trailing newline gives the draft's final empty line a line box, the
          way a textarea already reserves one. Without it the layer is one line
          short the moment the user presses Enter, and the whole thing reads as
          misaligned. */}
      {"\n"}
    </div>
  );
}
