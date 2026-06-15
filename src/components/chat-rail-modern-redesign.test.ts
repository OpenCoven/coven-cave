// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-project-sidebar.tsx", import.meta.url), "utf8");
const router = readFileSync(new URL("./chat-router.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

// ── Nav block: prominent New session + jump links to real surfaces ───────────
assert.match(
  source,
  /label="New session"/,
  "Nav block leads with a New session action (mockup vibe)",
);
assert.match(
  source,
  /\{ mode: "capabilities", label: "Skills & Tools"/,
  "Skills & Tools jumps to the Capabilities surface",
);
assert.match(
  source,
  /\{ mode: "library", label: "Artifacts"/,
  "Artifacts jumps to the Library surface",
);
assert.doesNotMatch(
  source,
  /label: "Messaging"/,
  "Messaging is omitted — the cave has no messaging surface to route to",
);

// ── Decoupled cross-surface navigation via a window event ────────────────────
assert.match(
  source,
  /new CustomEvent\("cave:navigate-mode", \{ detail: \{ mode \} \}\)/,
  "Nav rows announce intent through cave:navigate-mode instead of holding setMode",
);
assert.match(
  workspace,
  /addEventListener\("cave:navigate-mode", onNavigate/,
  "Workspace listens for cave:navigate-mode and switches the active surface",
);
assert.match(
  workspace,
  /const mode = \(e as CustomEvent<\{ mode\?: WorkspaceMode \}>\)\.detail\?\.mode;[\s\S]{0,40}if \(mode\) setMode\(mode\)/,
  "The navigate listener calls setMode with the requested mode",
);

// ── Uppercase counted section headers (PINNED / SESSIONS / PROJECTS) ──────────
assert.match(source, /function RailSection/, "Rail uses a shared section-header primitive");
assert.match(
  source,
  /uppercase tracking-\[0\.12em\]/,
  "Section headers are uppercase + letter-spaced for the modern grouping look",
);
assert.match(source, /<RailSection label="Pinned" \/>/, "A PINNED section header is rendered");
assert.match(
  source,
  /<RailSection label="Sessions" count=\{restRows\.length\}/,
  "A counted SESSIONS section header is rendered",
);
assert.match(source, /label="Projects"/, "Projects keep a section header");
assert.match(
  source,
  /Pin a session to keep it here/,
  "Empty PINNED section shows a hint, like the mockup",
);

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
