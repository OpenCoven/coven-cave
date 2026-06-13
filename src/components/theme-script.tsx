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
 *  6. Read localStorage["cave:font:sans"] / localStorage["cave:font:mono"] and
 *     apply --font-sans / --font-mono CSS vars for non-default selections.
 *
 * NOTE: The storage key strings ("coven-theme", "coven-mode",
 * "coven-custom-theme") and the legacy rename map are duplicated from
 * src/lib/theme-storage.ts. They cannot be imported here because the
 * script body is a string literal that runs in the browser before any
 * module code resolves. Keep both in sync when adding new keys or
 * renames.
 *
 * NOTE: The font keys ("cave:font:sans", "cave:font:mono"), default ids
 * ("geist", "jetbrains-mono"), and the SANS_FALLBACK / MONO_FALLBACK strings
 * are duplicated from src/lib/font-catalog.ts and src/lib/font-storage.ts.
 * Keep in sync when adding new fonts or changing fallback chains.
 */

const THEME_SCRIPT = `
(function () {
  try {
    var rename = { "mood-c": "coven", "sky": "tide", "orchid": "dusk", "midnight": "slate" };
    var valid = ["coven","tide","grove","ember","bloom","dusk","mist","slate","custom"];
    var theme = localStorage.getItem("coven-theme") || "coven";
    if (rename[theme]) {
      theme = rename[theme];
      localStorage.setItem("coven-theme", theme);
    }
    // Allowlist: corrupt or attacker-written localStorage values must not
    // land as data-theme attribute content. Unknown ids fall back to coven.
    if (valid.indexOf(theme) === -1) theme = "coven";
    var mode = localStorage.getItem("coven-mode") || "dark";
    if (mode !== "light" && mode !== "dark") mode = "dark";

    var html = document.documentElement;
    html.setAttribute("data-theme", theme);
    html.setAttribute("data-mode", mode);

    if (theme === "custom") {
      var raw = localStorage.getItem("coven-custom-theme");
      if (!raw) return;
      var data = JSON.parse(raw);
      var cssVars = data && data.cssVars;
      if (!cssVars) return;
      function applyGroup(group) {
        if (!group || typeof group !== "object") return;
        for (var name in group) {
          if (!Object.prototype.hasOwnProperty.call(group, name)) continue;
          if (typeof group[name] !== "string" || !name) continue;
          var cssName = name.indexOf("--") === 0 ? name : "--" + name;
          try { html.style.setProperty(cssName, group[name]); } catch (e) {}
        }
      }
      applyGroup(cssVars.theme);
      var modeGroup = mode === "light" ? cssVars.light : cssVars.dark;
      // Fallback to the opposite group if the selected mode is absent
      // (tweakcn imports from the dark-only era ship only cssVars.dark).
      if (!modeGroup) modeGroup = mode === "light" ? cssVars.dark : cssVars.light;
      applyGroup(modeGroup);
    }
    // ── Fonts ── apply saved non-default families before paint (no flash).
    // Inlined from src/lib/font-catalog.ts (SANS_FALLBACK / MONO_FALLBACK) and
    // src/lib/font-storage.ts (keys + stack shape) — keep in sync.
    var SANS_FB = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    var MONO_FB = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
    var fontSansId = localStorage.getItem("cave:font:sans");
    if (fontSansId && fontSansId !== "geist" && /^[a-z0-9-]+$/.test(fontSansId)) {
      try { html.style.setProperty("--font-sans", "var(--font-" + fontSansId + "), " + SANS_FB); } catch (e) {}
    }
    var fontMonoId = localStorage.getItem("cave:font:mono");
    if (fontMonoId && fontMonoId !== "jetbrains-mono" && /^[a-z0-9-]+$/.test(fontMonoId)) {
      try { html.style.setProperty("--font-mono", "var(--font-" + fontMonoId + "), " + MONO_FB); } catch (e) {}
    }
  } catch (e) {}
})();
`.trim();

/**
 * Inline <script> that runs synchronously before hydration.
 * Must be placed in <head>.
 */
export function ThemeScript() {
  return (
    <script
      id="theme-init"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: intentional flash-prevention inline script
      dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
    />
  );
}
