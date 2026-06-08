/**
 * ThemeScript — flash-free theme restoration.
 *
 * Rendered as a <script> tag inside <head> via layout.tsx.
 * Runs before the first paint so there's no theme flash.
 *
 * Strategy:
 *  1. Read localStorage["coven-theme"]  (preset id or "custom")
 *  2. If preset — set data-theme on <html>
 *  3. If custom  — read localStorage["coven-custom-theme"] and apply
 *     every CSS var from cssVars.theme + cssVars.dark via setProperty.
 */

const THEME_SCRIPT = `
(function () {
  try {
    var theme = localStorage.getItem("coven-theme");
    if (!theme || theme === "mood-c") return; // default :root handles it

    if (theme === "midnight" || theme === "orchid" || theme === "sky") {
      document.documentElement.setAttribute("data-theme", theme);
      return;
    }

    if (theme === "custom") {
      var raw = localStorage.getItem("coven-custom-theme");
      if (!raw) return;
      var data = JSON.parse(raw);
      var cssVars = data && data.cssVars;
      if (!cssVars) return;
      var html = document.documentElement;
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
      applyGroup(cssVars.dark);
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
