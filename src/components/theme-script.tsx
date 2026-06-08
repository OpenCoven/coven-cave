/**
 * ThemeScript — flash-free theme restoration.
 *
 * Rendered as a <script> tag inside <head> via layout.tsx.
 * Runs before the first paint so there's no theme flash.
 *
 * Strategy:
 *  1. Read localStorage["coven-theme"]  (preset id or "custom")
 *  2. If preset — set data-theme on <html>
 *  3. If custom  — read localStorage["coven-custom-theme"] and inject
 *     the dark CSS vars as inline style on <html>
 */

const THEME_SCRIPT = `
(function () {
  try {
    var theme = localStorage.getItem("coven-theme");
    if (!theme || theme === "mood-c") return; // default :root handles it

    if (theme === "midnight" || theme === "orchid") {
      document.documentElement.setAttribute("data-theme", theme);
      return;
    }

    if (theme === "custom") {
      var raw = localStorage.getItem("coven-custom-theme");
      if (!raw) return;
      var data = JSON.parse(raw);
      var vars = data.cssVars && data.cssVars.dark ? data.cssVars.dark : null;
      if (!vars) return;
      var MAP = {
        "--background": "--background",
        "--foreground": "--foreground",
        "--card": "--card",
        "--primary": "--primary",
        "--muted": "--muted",
        "--muted-foreground": "--muted-foreground",
        "--border": "--border",
        "--accent": "--accent",
        "--ring": "--ring",
        "--secondary": "--secondary"
      };
      var style = "";
      for (var src in MAP) {
        if (vars[src]) {
          style += MAP[src] + ":" + vars[src] + ";";
        }
      }
      if (style) {
        document.documentElement.setAttribute("style",
          (document.documentElement.getAttribute("style") || "") + style
        );
      }
    }
  } catch (e) {}
})();
`.trim();

/**
 * Renders an inline <script> that runs synchronously before hydration.
 * Must be placed in <head> (before any CSS-in-JS or painted content).
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
