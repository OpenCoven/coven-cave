// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./skill-browser.tsx", import.meta.url), "utf8");
const hub = readFileSync(new URL("./marketplace-view.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// ── Three-column browser: rail · list · detail ───────────────────────────────
assert.match(src, /export function SkillBrowser\(/, "exports the SkillBrowser component");
assert.match(src, /className="skill-browser__rail"/, "renders the category rail");
assert.match(src, /className="skill-browser__list"/, "renders the card list");
assert.match(src, /className="skill-browser__detail"/, "renders the detail pane");

// Category rail: All / Claude Code / Generic with derived counts.
assert.match(src, /label: "All Skills"/, "rail has an All Skills entry");
assert.match(src, /label: "Claude Code"[\s\S]*?icon: "ph:terminal-window"/, "rail has a Claude Code entry");
assert.match(src, /label: "Generic"[\s\S]*?icon: "ph:puzzle-piece"/, "rail has a Generic entry");
assert.match(
  src,
  /familiar === "user" \? "claude" : "generic"/,
  "maps scan scope (user→Claude Code, global→Generic)",
);
assert.match(src, /className="skill-browser__cat-count"/, "each category shows a count");

// Detail pane sources the SKILL.md body from /api/skills/file and renders it.
assert.match(
  src,
  /fetch\(`\/api\/skills\/file\?path=\$\{encodeURIComponent\(selectedPath\)\}`/,
  "detail fetches the selected skill's SKILL.md via /api/skills/file",
);
assert.match(src, /stripFrontmatter\(preview\.text\)/, "strips YAML frontmatter before rendering");
assert.match(src, /<MarkdownBlock text=\{body\}/, "renders the SKILL.md body as markdown");
assert.match(src, /selected\.description \|\| "No preview available/, "falls back to the description on error/empty (e.g. 403 outside allow-listed roots)");
assert.match(src, /skill-browser__detail-path/, "detail shows the skill's path");

// Selection is sticky-but-safe: first visible when the pick is filtered out.
assert.match(src, /visible\.find\(\(s\) => skillKey\(s\) === selectedKey\) \?\? visible\[0\]/, "auto-selects the first visible skill");

// ── Detail-pane actions: reveal folder + delete ─────────────────────────────
assert.match(src, /className="skill-browser__actions"/, "detail head has an actions cluster");
assert.match(src, /name="ph:folder-open"/, "reveal-folder action uses the folder-open icon");
assert.match(src, /name="ph:trash"/, "delete action uses the trash icon");
// Reveal shells out via Tauri and copies the path on the web.
assert.match(src, /invoke\("shell_open", \{ url: dir \}\)/, "reveal opens the folder via Tauri shell_open on desktop");
assert.match(src, /copyText\(dir\)/, "reveal copies the path to the clipboard as the web fallback");
// Delete is a two-step confirm hitting the DELETE route, then re-scans.
assert.match(src, /if \(!confirmingDelete\) \{[\s\S]*?setConfirmingDelete\(true\)/, "delete requires an explicit confirm step");
assert.match(
  src,
  /fetch\(`\/api\/skills\/local\?path=\$\{encodeURIComponent\(selectedPath\)\}`,\s*\{\s*method: "DELETE"/,
  "delete calls DELETE /api/skills/local with the selected path",
);
assert.match(src, /onChanged\?\.\(\)/, "a successful delete asks the parent to re-scan");

// ── Marketplace-hub wiring: the Skills section renders the browser ───────────
assert.match(hub, /import \{ SkillBrowser, type SkillBrowserEntry \}/, "the Marketplace hub imports SkillBrowser");
assert.match(hub, /<SkillBrowser\s+skills=\{skills\}/, "the Skills section renders SkillBrowser with the full skill list");
assert.match(hub, /onChanged=\{loadSkills\}/, "the Skills section wires onChanged to re-scan after a delete");
assert.doesNotMatch(hub, /import \{ SkillCard \}/, "the old flat SkillCard list stays retired");
// The Skills section is full-bleed so the browser owns per-column scrolling.
assert.match(
  hub,
  /id="marketplace-panel-skills"[\s\S]{0,120}overflow-hidden/,
  "the Skills tabpanel is full-bleed (browser scrolls its own columns)",
);

// ── CSS present ──────────────────────────────────────────────────────────────
assert.match(css, /\.skill-browser \{[\s\S]*?display: flex;/, "the browser is a flex 3-column layout");
assert.match(css, /\.skill-browser__card\.is-active \{/, "the selected card is highlighted");
assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.skill-browser__rail \{ display: none;/, "the rail collapses on small screens");

console.log("skill-browser.test.ts OK");
