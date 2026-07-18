import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
async function source(path: string) {
  return readFile(new URL(path, root), "utf8");
}

const routePage = await source("app/familiars/[id]/analytics/page.tsx");
const dashPage = await source("app/dashboard/familiars/[id]/analytics/page.tsx");
const shell = await source("components/analytics-page-shell.tsx");
const css = await source("styles/analytics-page-shell.css");

// ── Both standalone analytics routes wrap the view in the left-sidepanel shell ──
for (const [name, page] of [
  ["/familiars/[id]/analytics", routePage],
  ["/dashboard/familiars/[id]/analytics", dashPage],
]) {
  assert.match(page, /import \{ AnalyticsPageShell \} from "@\/components\/analytics-page-shell"/, `${name} imports the shell`);
  assert.match(
    page,
    /<AnalyticsPageShell>[\s\S]*<FamiliarAnalyticsView familiarId=\{id\} \/>[\s\S]*<\/AnalyticsPageShell>/,
    `${name} renders the analytics view inside AnalyticsPageShell (left sidepanel)`,
  );
}

// ── The shell renders a real left nav rail into the app's SPA surfaces ──────────
assert.match(shell, /<nav className="aps-rail" aria-label="Primary">/, "shell renders a labelled left nav rail");
assert.match(shell, /href: "\/\?mode=home"/, "rail deep-links Home into the SPA");
assert.match(shell, /href: "\/\?mode=chat"/, "rail deep-links Chat");
assert.match(shell, /href: "\/\?mode=board"/, "rail deep-links Tasks");
assert.match(shell, /href="\/dashboard"/, "rail links to the Dashboard route");

// ── Persistent at EVERY screen size — the rail must not be hidden on small widths ─
assert.match(css, /\.aps-rail\s*\{/, "the rail has base styles");
assert.doesNotMatch(css, /\.aps-rail[^{]*\{[^}]*display:\s*none/, "the rail is never display:none");
assert.doesNotMatch(css, /@media[^{]*\{[^}]*\.aps-rail[^}]*display:\s*none/, "no media query hides the rail on small screens");

console.log("analytics-page-shell guard passed");
