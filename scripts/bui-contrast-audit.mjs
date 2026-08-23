// Beautiful UI badge-contrast audit (cave-j80ph).
//
// Several vendored components paint a FIXED foreground (`text-white`) on a
// THEMED background (`bg-bui-green`, `bg-bui-orange`, `bg-bui-accent`, …).
// Upstream designed that against two modes; Cave ships 12 palettes x 2 modes,
// and a palette whose success or warning hue is light turns white-on-tint into
// unreadable text.
//
// This measures rather than guesses. For every palette/mode combination it
// walks the gallery, finds each element carrying a fixed foreground, resolves
// its EFFECTIVE background (compositing up through transparent ancestors), and
// computes the WCAG 2.1 contrast ratio.
//
// Colour conversion is done by the browser, not by hand: computed styles come
// back as oklch() under Tailwind v4, so each colour is painted to a canvas and
// read back as sRGB. That way the audit measures what a person actually sees.
//
//   node scripts/bui-contrast-audit.mjs [--url http://127.0.0.1:3711] [--json]

import { chromium } from "@playwright/test";

const URL_ARG = process.argv.indexOf("--url");
const BASE = URL_ARG !== -1 ? process.argv[URL_ARG + 1] : "http://127.0.0.1:3711";
const AS_JSON = process.argv.includes("--json");

// 12 palettes. "coven" is the default: it has no [data-theme="coven"] block —
// its values are the :root defaults — but the app still SETS the attribute to
// "coven" (settings-shell.tsx, applyThemeToRoot), so the audit does the same
// rather than removing the attribute. Removing it leaves whatever the theme
// controller last applied, which is how a first pass measured dark tokens
// while labelling them light.
const THEMES = [
  "coven",
  "tide",
  "ember",
  "ghosty",
  "claymorphism",
  "claude",
  "codex",
  "pastel-dreams",
  "snow",
  "slate",
  "contrast",
  "solstice",
];
const MODES = ["dark", "light"];

// The palette switch and the measurement happen in ONE evaluate, with no await
// between them. src/lib/themes/theme-runtime.ts reconciles data-theme/data-mode from
// stored preferences, so attributes written in a separate round-trip get
// reverted before the measurement lands — silently, which is worse than
// loudly. Everything below is synchronous, and reading getComputedStyle forces
// the style flush, so the controller never gets a turn.
const audit = async (page, theme, mode) =>
  page.evaluate(([themeId, modeId]) => {
    const root = document.documentElement;
    root.setAttribute("data-theme", themeId);
    root.setAttribute("data-mode", modeId);
    // Force a style recalculation before anything is measured.
    void getComputedStyle(root).backgroundColor;

    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    /** Ask the browser to resolve any CSS colour string to sRGB + alpha. */
    const toRgba = (color) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = color; // invalid values leave the previous fillStyle
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    };

    const luminance = ({ r, g, b }) => {
      const ch = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    };

    const ratio = (fg, bg) => {
      const a = luminance(fg);
      const b = luminance(bg);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };

    /** Composite `over` (with alpha) onto `under` (opaque). */
    const composite = (over, under) => ({
      r: over.r * over.a + under.r * (1 - over.a),
      g: over.g * over.a + under.g * (1 - over.a),
      b: over.b * over.a + under.b * (1 - over.a),
      a: 1,
    });

    /** Effective background: walk up until something is opaque enough. */
    const effectiveBackground = (el) => {
      let node = el;
      const stack = [];
      while (node && node !== document.documentElement) {
        const bg = toRgba(getComputedStyle(node).backgroundColor);
        if (bg.a > 0) stack.push(bg);
        if (bg.a >= 0.999) break;
        node = node.parentElement;
      }
      const root = toRgba(getComputedStyle(document.documentElement).backgroundColor);
      let acc = root.a >= 0.999 ? root : { r: 255, g: 255, b: 255, a: 1 };
      for (let i = stack.length - 1; i >= 0; i--) acc = composite(stack[i], acc);
      return acc;
    };

    /** Is this text actually painted for a person right now?
     *
     * These are self-running demos: they animate content in from opacity 0,
     * collapse rows to a 0fr grid track, and keep off-screen measurement spans.
     * Measuring any of those reports contrast for pixels nobody sees — which is
     * how a first pass at this audit "found" 1.07:1 on code tokens that were
     * mid-fade. Anything not currently visible is skipped. */
    const isVisible = (el) => {
      if (typeof el.checkVisibility === "function") {
        if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) {
          return false;
        }
      }
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return false;
      // Ancestor opacity multiplies; anything materially transparent is still
      // arriving (or leaving) and its contrast is not the settled contrast.
      let node = el;
      while (node && node !== document.documentElement) {
        const cs = getComputedStyle(node);
        if (cs.visibility === "hidden" || cs.display === "none") return false;
        if (parseFloat(cs.opacity) < 0.95) return false;
        node = node.parentElement;
      }
      return true;
    };

    const results = [];
    for (const el of document.querySelectorAll("main *")) {
      const text = (el.textContent || "").trim();
      if (!text || text.length > 40) continue;
      // Only leaf-ish nodes actually paint text.
      if (el.children.length > 0) continue;
      if (!isVisible(el)) continue;
      const cs = getComputedStyle(el);
      const fgRaw = toRgba(cs.color);
      if (fgRaw.a === 0) continue;
      const bg = effectiveBackground(el);
      const fg = fgRaw.a >= 0.999 ? fgRaw : composite(fgRaw, bg);
      const size = parseFloat(cs.fontSize) || 0;
      const weight = parseInt(cs.fontWeight, 10) || 400;
      const isLarge = size >= 24 || (size >= 18.66 && weight >= 700);
      const r = ratio(fg, bg);
      const section = el.closest("section")?.id || "(page)";
      // A stable identity for the NODE, so grouping counts combinations rather
      // than colliding several sibling spans that share text and classes.
      const path = (() => {
        const parts = [];
        let node = el;
        while (node && node.tagName !== "MAIN") {
          const parent = node.parentElement;
          if (!parent) break;
          parts.unshift(`${node.tagName.toLowerCase()}:${[...parent.children].indexOf(node)}`);
          node = parent;
        }
        return parts.join(">");
      })();
      results.push({
        section,
        path,
        text: text.slice(0, 24),
        cls: (el.className || "").toString().slice(0, 70),
        fg: `rgb(${Math.round(fg.r)},${Math.round(fg.g)},${Math.round(fg.b)})`,
        bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
        size,
        weight,
        isLarge,
        ratio: Math.round(r * 100) / 100,
        min: isLarge ? 3 : 4.5,
        pass: r >= (isLarge ? 3 : 4.5),
      });
    }
    return results;
  }, [theme, mode]);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
await ctx.addInitScript(() => localStorage.setItem("cave:onboarding:dismissed", "1"));
const page = await ctx.newPage();

await page.goto(`${BASE}/aesthetic/beautiful`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("section#selection-actions", { timeout: 30_000 });
await page.waitForTimeout(3000); // let the self-running demos settle

// Kill colour transitions before measuring anything.
//
// Several vendored rules transition `color` (e.g. `.records-row >
// .records-cell` at 120ms). Switching palette and reading in the same
// synchronous task therefore samples the colour MID-INTERPOLATION — it returns
// the colour the element is leaving, not the one it is arriving at. That is
// how a first pass at this audit reported ~1.01:1 on a hundred perfectly fine
// light-mode cells: it was reading dark-mode white against a light panel.
//
// Waiting instead of freezing is not an option: theme-runtime.ts reconciles
// data-theme/data-mode from stored preferences, so anything that yields to the
// event loop gets its palette switched back underneath it. Removing the
// transition removes the interpolation, so the synchronous read is final.
await page.addStyleTag({
  content: "*, *::before, *::after { transition: none !important; }",
});
await page.waitForTimeout(200);

const failures = [];
let measured = 0;

for (const theme of THEMES) {
  for (const mode of MODES) {
    const rows = await audit(page, theme, mode);
    measured += rows.length;
    for (const row of rows) {
      if (!row.pass) failures.push({ theme, mode, ...row });
    }
  }
}

await browser.close();

if (AS_JSON) {
  console.log(JSON.stringify({ measured, failures }, null, 2));
} else {
  console.log(`bui-contrast-audit: measured ${measured} text nodes across ${THEMES.length * MODES.length} palette/mode combinations`);
  if (!failures.length) {
    console.log("✓ every measured node meets its WCAG minimum");
  } else {
    // Group by the thing a fix would touch, not by combination.
    const byNode = new Map();
    for (const f of failures) {
      const key = `${f.section} :: ${f.path} :: ${f.text}`;
      const seen = byNode.get(key) ?? { ...f, combos: [], worst: f.ratio };
      seen.combos.push(`${f.theme}/${f.mode} ${f.ratio}:1`);
      seen.worst = Math.min(seen.worst, f.ratio);
      byNode.set(key, seen);
    }
    console.log(`✗ ${failures.length} failing measurements across ${byNode.size} distinct nodes\n`);
    for (const [key, f] of [...byNode].sort((a, b) => a[1].worst - b[1].worst)) {
      console.log(`  ${key}`);
      console.log(`    worst ${f.worst}:1 (needs ${f.min}:1) — ${f.size}px/${f.weight}`);
      console.log(`    fails in ${f.combos.length}/${THEMES.length * MODES.length}: ${f.combos.slice(0, 6).join(", ")}${f.combos.length > 6 ? ", …" : ""}`);
    }
  }
  process.exitCode = failures.length ? 1 : 0;
}
