// @ts-nocheck
// Source pins for the workspace-sidebar PR-status badge — the sidebar twin of
// the chat list's badge (#2983): thread rows swap the status dot (and the
// title-heuristic PR/branch glyph) for a clickable GitHub PR-state icon when
// the session carries real PR context; clicking opens the PR in the in-app
// browser (new-tab fallback) without opening the chat.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sidebar = readFileSync(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// ── ThreadRow: real PR context wins the leading slot ─────────────────────────
assert.match(
  sidebar,
  /const prStatus = sessionPrStatus\(session\.pullRequest\);/,
  "rows derive PR status from the session's pullRequest context (shared lib)",
);
assert.match(
  sidebar,
  /\{prStatus \? <ThreadPrBadge prStatus=\{prStatus\} onOpenUrl=\{onOpenUrl\} \/> : null\}\s*\n\s*<button/,
  "the badge renders as a SIBLING before the row's main <button> — never nested inside it",
);
assert.match(
  sidebar,
  /\{prStatus \? null : glyph \? \(/,
  "real PR context suppresses the dot AND the title-heuristic glyph",
);

// ── Pinned rail rows carry the badge too ─────────────────────────────────────
const pinStart = sidebar.indexOf('aria-label="Pinned threads"');
assert.ok(pinStart > 0, "the pinned rail section exists");
const pinnedRail = sidebar.slice(pinStart, sidebar.indexOf('view === "recent"', pinStart));
assert.match(
  pinnedRail,
  /<ThreadPrBadge prStatus=\{prStatus\} onOpenUrl=\{onOpenUrl\} \/>/,
  "pinned rail rows show the PR badge as well",
);

// ── Badge behavior mirrors the chat-list badge ───────────────────────────────
assert.match(
  sidebar,
  /data-pr-state=\{prStatus\.key\}/,
  "the badge carries data-pr-state for state-colored styling",
);
assert.match(
  sidebar,
  /e\.stopPropagation\(\);\s*\n\s*if \(onOpenUrl\) onOpenUrl\(prStatus\.url\);/,
  "clicking the badge opens the PR without opening the chat",
);
assert.match(
  sidebar,
  /window\.open\(prStatus\.url, "_blank", "noopener,noreferrer"\)/,
  "without an in-app opener the badge falls back to a new tab",
);
assert.match(
  sidebar,
  /aria-label=\{`Open pull request \(\$\{prStatus\.label\}\)`\}/,
  "the badge has an accessible name naming the PR and its state",
);

// ── Wiring: workspace hands the sidebar its in-app URL opener ────────────────
assert.match(
  workspace,
  /<WorkspaceSidebar[\s\S]*?onOpenUrl=\{openUrlInAppBrowser\}/,
  "workspace passes the in-app browser opener to the chat sidebar",
);

// ── Styling: GitHub's state colors + gutter alignment ────────────────────────
for (const state of ["merged", "closed", "draft"]) {
  assert.match(
    css,
    new RegExp(`\\.cnav__pr-badge\\[data-pr-state="${state}"\\]`),
    `globals.css styles the ${state} PR state`,
  );
}
assert.match(
  css,
  /\.cnav__pr-badge \+ \.cnav__thread-main/,
  "the row button trades its indent for the badge's gutter (no double indent)",
);

console.log("workspace-sidebar-pr-badge.test.ts passed");
