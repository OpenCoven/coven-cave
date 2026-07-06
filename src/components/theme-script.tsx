/**
 * ThemeScript — flash-free theme + mode + font restoration.
 *
 * Rendered as a <script> tag inside <head> via layout.tsx.
 * Runs before the first paint so there's no theme flash.
 *
 * Strategy:
 *  1. Read localStorage["coven-theme"] (id or "custom"), default "coven".
 *  2. Read localStorage["coven-mode"] ("light" | "dark"), default "dark".
 *  3. One-shot rename: mood-c → coven, sky → tide, orchid → dusk, midnight → slate.
 *  4. Always set BOTH `data-theme` and `data-mode` on <html>.
 *  5. If theme === "custom", apply `cssVars.theme` (mode-agnostic) +
 *     `cssVars[mode]` (mode-specific) from localStorage["coven-custom-theme"].
 *  6. Read localStorage["cave:font:sans"] / localStorage["cave:font:mono"],
 *     accept only approved font pairs, and apply --font-sans / --font-mono CSS
 *     vars for non-default selections.
 *
 * NOTE: The storage key strings ("coven-theme", "coven-mode",
 * "coven-custom-theme") and the legacy rename map are duplicated in
 * /public/scripts/theme-init.js from src/lib/theme-storage.ts.
 * Keep both in sync when adding new keys or renames.
 *
 * NOTE: The font keys ("cave:font:sans", "cave:font:mono"), default ids
 * ("geist", "jetbrains-mono"), approved pairs, and the SANS_FALLBACK /
 * MONO_FALLBACK strings are duplicated in /public/scripts/theme-init.js from
 * src/lib/font-catalog.ts and src/lib/font-storage.ts. Keep in sync when
 * adding new fonts, changing fallback chains, or editing pair choices.
 */

/**
 * External boot script that runs synchronously before hydration.
 * Must be placed in <head>.
 *
 * Rendered as a plain <script src> from the server-component RootLayout: it
 * lands in the initial SSR <head> before first paint, without a client-rendered
 * script wrapper.
 */
export function ThemeScript() {
  return <script id="theme-init" src="/scripts/theme-init.js" />;
}
