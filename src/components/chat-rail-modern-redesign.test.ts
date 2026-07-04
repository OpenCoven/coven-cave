// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-project-sidebar.tsx", import.meta.url), "utf8");
const router = readFileSync(new URL("./chat-router.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

// ── Simplified rail chrome: no redundant top action cluster ─────────────────
assert.doesNotMatch(
  source,
  /label="New session"/,
  "The global New session action stays out of this project rail",
);
assert.doesNotMatch(source, /Skills & Tools/, "Skills & Tools no longer occupies the project rail");
assert.doesNotMatch(source, /Artifacts/, "Artifacts no longer occupies the project rail");
assert.doesNotMatch(source, /function RailNavRow/, "The removed top action cluster leaves no nav-row component");
assert.doesNotMatch(
  source,
  /label: "Messaging"/,
  "Messaging is omitted — the cave has no messaging surface to route to",
);
assert.doesNotMatch(
  source,
  /cave:navigate-mode/,
  "Cross-surface shortcuts are not part of the project rail chrome",
);
assert.match(
  workspace,
  /addEventListener\("cave:navigate-mode", onNavigate/,
  "Workspace still supports cave:navigate-mode for surfaces that own those shortcuts",
);
assert.match(
  workspace,
  /const targetMode = \(e as CustomEvent<\{ mode\?: string \}>\)\.detail\?\.mode;[\s\S]*?if \(targetMode === "code"\)[\s\S]*?setMode\(targetMode as WorkspaceMode\)/,
  "The navigate listener redirects retired code links, then calls setMode with other requested modes",
);

// ── Uppercase counted section headers (RESULTS) + compact Projects header ────
assert.match(source, /function RailSection/, "Rail uses a shared section-header primitive");
assert.match(
  source,
  /uppercase tracking-\[0\.12em\]/,
  "Section headers are uppercase + letter-spaced for the modern grouping look",
);
assert.match(
  source,
  /<RailSection label="Results" count=\{display\.length\}/,
  "Search results use a counted RESULTS section only when needed",
);
assert.match(
  source,
  /aria-label="Chat projects header"[\s\S]*Projects[\s\S]*aria-label="Hide sessions"/,
  "Projects lives in the same top row as the collapse toggle",
);
assert.doesNotMatch(source, /<RailSection\s+label="Projects"/, "Projects is not repeated as a separate section row");
assert.doesNotMatch(source, /Pin a session to keep it here/, "Pinned hints are gone with the permanent flat list");
assert.doesNotMatch(source, /chat-thread-filters/, "All/Active/Tasks/Pinned tabs are removed");

// ── Familiar selection lives in the page header, not this rail ───────────────
assert.doesNotMatch(source, /function RailFamiliarStrip/, "Rail no longer carries a duplicate familiar-avatar strip");
assert.doesNotMatch(source, /<FamiliarAvatar familiar=\{f\} size="sm"/, "Familiar chips moved out of the session rail");
assert.match(source, /placeholder="Search sessions…"/, "Rail search uses session language");
assert.match(source, /aria-label="Familiar sessions"/, "Rail names the region as familiar sessions");

// ── Ops footer (Git / Inspect / Debug) is preserved ─────────────────────────
assert.match(
  source,
  /event: "cave:changes-open", label: "Git"/,
  "Git/Inspect/Debug ops row is preserved",
);

// ── Router no longer forwards familiar selection into the rail ───────────────
assert.doesNotMatch(
  router,
  /onSelectFamiliar=\{/,
  "ChatRouter keeps familiar selection out of the session rail",
);

console.log("chat-rail-modern-redesign.test.ts: ok");
