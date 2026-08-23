/**
 * Geometry contract for the composer's markdown decoration layer (cave-7ncq).
 *
 * ## Why a layer at all
 *
 * The composer stays a real `<textarea>`. A `contenteditable` would have to
 * re-home every behaviour that textarea's keydown handler already owns — the
 * slash and `@`-mention menus, `{{placeholder}}` Tab cycling, ↑↓ input history,
 * the recommended-next-path Tab accept, IME-safe Enter, Escape-to-cancel — and
 * `contenteditable` is precisely the class of surface that diverges between
 * headless Chromium and the WKWebView the desktop shell actually runs. So the
 * decoration is painted by a second element behind the caret instead.
 *
 * ## The constraint that shapes everything
 *
 * The layer re-lays out the *same characters* as the textarea and must produce
 * the *same line boxes*, or the painted decoration slides away from the glyph
 * it belongs to. That rules out every property which changes text metrics:
 *
 *   font-family · font-size · font-weight · letter-spacing · word-spacing ·
 *   line-height · text-transform · font-stretch · inline padding/margin
 *
 * This is not a style preference — it is why the layer renders bold as a
 * `-webkit-text-stroke` thickening rather than `font-weight: 700`, and why a
 * heading is not larger than body text. Stroke widens the ink inside the glyph
 * box; weight widens the box. `composer-markdown-layer.test.ts` asserts the
 * stylesheet never reaches for a metric-affecting property outside the guarded
 * selector below.
 *
 * ## The one probed exception
 *
 * `font-style: italic` is metric-safe *only* when the family has no real
 * italic face, because the browser then synthesizes an oblique by skewing the
 * regular face and every advance width is preserved. Inter — the default UI
 * font — loads `normal` only (`src/app/fonts.ts`), so synthesis is what
 * happens. But the UI font is user-selectable and two catalog families
 * (EB Garamond, Instrument Serif) *do* load a real italic, whose advances
 * differ. So the layer measures instead of assuming: it renders a probe pair
 * and only enables slant when the two widths agree. Everything under
 * `[data-metric-safe="true"]` is gated on that measurement.
 *
 * ## Failing open
 *
 * The layer only blanks the textarea's own glyphs once its box geometry has
 * been confirmed to match. Until then — and forever, if a platform we cannot
 * test disagrees — the plain textarea stays visible and the layer stays
 * hidden. A composer that renders undecorated text is a missing feature; a
 * composer whose text is invisible is a broken product, and only one of those
 * is an acceptable thing to ship to a shell we cannot exercise from CI.
 */

/**
 * Computed-style properties copied from the textarea onto the layer.
 *
 * Mirroring the *computed* values (rather than restating them in CSS) is what
 * makes the layer survive the surfaces that change composer typography without
 * knowing this file exists: the user-selectable font catalog, the
 * `data-screen-scale` root steps, and the mobile type overrides. A hand-copied
 * stylesheet would silently drift from all three.
 */
export const MIRRORED_LAYER_STYLE_PROPERTIES = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontVariant",
  "fontStretch",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "textIndent",
  "textTransform",
  "tabSize",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "boxSizing",
] as const;

/** Line-box drift we tolerate before disabling the layer, in CSS pixels. */
export const LAYER_ALIGNMENT_TOLERANCE_PX = 1;

/** Advance-width drift we tolerate on the italic probe, in CSS pixels. */
export const METRIC_PROBE_TOLERANCE_PX = 0.5;

/** Sample used by the italic probe. Mixed case and width so a skew that
 *  changes advances shows up rather than cancelling out. */
export const METRIC_PROBE_SAMPLE = "Wgil MMiii 0189 — the quick brown fox";

/**
 * Whether the layer's line boxes match the textarea's closely enough to hide
 * the textarea's glyphs behind it.
 *
 * Both heights are `scrollHeight`, which for wrapped text is the honest signal:
 * a font, size, letter-spacing, or padding mismatch changes where lines wrap,
 * and a changed wrap count changes the height by a whole line rather than a
 * sub-pixel.
 *
 * An unmeasured element (height 0) is *not* aligned. That matters more than it
 * looks: a `> 0` guard written the other way round would read "nothing has
 * rendered yet" as "perfectly aligned" and blank the textarea before the layer
 * had any content to replace it with.
 */
export function composerLayerAligned(
  textareaScrollHeight: number,
  layerScrollHeight: number,
  tolerancePx: number = LAYER_ALIGNMENT_TOLERANCE_PX,
): boolean {
  if (!Number.isFinite(textareaScrollHeight) || !Number.isFinite(layerScrollHeight)) {
    return false;
  }
  if (textareaScrollHeight <= 0 || layerScrollHeight <= 0) return false;
  return Math.abs(textareaScrollHeight - layerScrollHeight) <= tolerancePx;
}

/**
 * Whether slanting emphasis leaves advance widths untouched.
 *
 * `plainWidth` and `styledWidth` are the measured widths of the same sample
 * rendered without and with `font-style: italic` in the composer's own font.
 * Equal widths mean the browser synthesized the oblique; different widths mean
 * a real italic face is loaded and slanting would drift the line.
 */
export function emphasisIsMetricSafe(
  plainWidth: number,
  styledWidth: number,
  tolerancePx: number = METRIC_PROBE_TOLERANCE_PX,
): boolean {
  if (!Number.isFinite(plainWidth) || !Number.isFinite(styledWidth)) return false;
  if (plainWidth <= 0 || styledWidth <= 0) return false;
  return Math.abs(plainWidth - styledWidth) <= tolerancePx;
}

/**
 * CSS properties the layer may never set, because each one changes where text
 * wraps. Exported so the stylesheet contract test and this documentation
 * cannot drift apart.
 */
export const METRIC_AFFECTING_PROPERTIES = [
  "font-family",
  "font-size",
  "font-weight",
  "font-stretch",
  "letter-spacing",
  "word-spacing",
  "line-height",
  "text-transform",
] as const;
