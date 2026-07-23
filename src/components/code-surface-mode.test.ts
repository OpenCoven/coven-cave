// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Pin suite for the dedicated Code surface (cave-k0ua).
//
// History: a standalone "code" WorkspaceMode was retired and this file's
// predecessor (code-view.test.ts) was the retirement guard keeping it deleted.
// The owner requested a Codex-style multi-session coding surface — diffs,
// files, terminal, per-session PR context, worktrees, branches, with GitHub
// absorbed as a tab — so the mode returned, flag-gated by caveCodeSurface()
// (NEXT_PUBLIC_CAVE_CODE_SURFACE). These pins document the sanctioned shape:
// the surface exists, the flag gates entry, and Chat's own code rail stays
// untouched until the flagged follow-up that slims it.

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const modeType = await readFile(new URL("../lib/workspace-mode.ts", import.meta.url), "utf8");
const codeView = await readFile(new URL("./code-view.tsx", import.meta.url), "utf8");
const lazySurfaces = await readFile(new URL("./lazy-surfaces.tsx", import.meta.url), "utf8");
const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const chatRouter = await readFile(new URL("./chat-router.tsx", import.meta.url), "utf8");
const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");

// ── Mode vocabulary ──────────────────────────────────────────────────────────

assert.match(modeType, /\|\s*"code"/, "WorkspaceMode includes the Code surface again (cave-k0ua)");

// ── Workspace wiring ─────────────────────────────────────────────────────────

assert.match(
  workspace,
  /code: "Code"/,
  "WORKSPACE_MODE_TITLES names the Code surface (canonical-nav agreement)",
);
assert.match(
  workspace,
  /mode === "code" \? \(\s*<CodeView/,
  "Workspace renders CodeView on the code mode",
);
assert.match(
  lazySurfaces,
  /const loadCodeView = \(\) => import\("@\/components\/code-view"\)\.then\(\(m\) => m\.CodeView\)/,
  "CodeView stays code-split behind lazy-surfaces — its chunk must not join the boot bundle",
);

// Flag gating: while caveCodeSurface() is off, "code" deep links keep the
// retirement-era fallback (newest repo chat); with it on they land on the
// surface. Both behaviors live in the same navigate-mode branch.
assert.match(
  workspace,
  /if \(targetMode === "code" && !caveCodeSurface\(\)\) \{[\s\S]*?filter\(\(s\) => s\.project_root\)[\s\S]*?openFamiliarSession\(repoSession\.id, repoSession\.familiarId\)[\s\S]*?setMode\("chat"\)/,
  "flag-off code deep-links redirect to the newest repo chat or Chat fallback",
);
// The setMode funnel is the choke point for every other entry (?mode= deep
// link, persisted last-surface restore): flag off, "code" lands on Chat
// instead of rendering a gated surface.
assert.match(
  workspace,
  /if \(next === "code" && !caveCodeSurface\(\)\) \{[\s\S]{0,600}?setModeRaw\("chat"\);\s*return;/,
  "setMode funnels flag-off code requests to Chat",
);

// File/diff links from inbox cards etc. still target Chat's code rail this
// phase — retargeting them to the Code surface is an explicit follow-up.
assert.match(
  workspace,
  /File\/diff links target ChatSurface's code rail[\s\S]*?setPendingCodeRailOpen\([\s\S]*?setMode\("chat"\)/,
  "file-open events keep targeting Chat's code rail until the flagged follow-up",
);

// The primary keyboard cluster is unchanged: Code is a quiet destination, not
// a ⌘1-5 surface.
assert.match(
  workspace,
  /const SURFACE_ORDER: WorkspaceMode\[\] = \[\s*"home", "chat", "board", "inbox", "browser",\s*\]/,
  "keyboard surface order keeps the primary cluster without Code",
);

// ── Sidebar row swap ─────────────────────────────────────────────────────────

// One quiet slot, two vocabularies: flag on → Code row (GitHub becomes a tab
// inside the surface); flag off → the standalone GitHub row, byte-identical to
// the pre-flag sidebar. The conditional spread keeps FOLDER_MODES a single
// literal so palette/mobile/canonical-name extraction regexes stay valid.
assert.match(
  sidebar,
  /\.\.\.\(caveCodeSurface\(\)\s*\?\s*\[\{ id: "code", label: "Code", iconName: "ph:code"/,
  "flag on: the Code quiet row takes the GitHub slot",
);
assert.match(
  sidebar,
  /\{ id: "github", label: "GitHub", iconName: "ph:github-logo"/,
  "flag off: the GitHub row literal survives in FOLDER_MODES",
);
assert.match(
  codeView,
  /import\("@\/components\/github-view"\)\.then\(\(m\) => m\.GitHubView\)/,
  "the Code surface mounts GitHubView whole under its GitHub tab",
);

// ── Chat stays untouched this phase ──────────────────────────────────────────

// Phase 1 builds the surface *behind the flag* without slimming Chat: the code
// rail, its surface-agnostic shape, and composer copy are exactly as the
// retirement left them. Removing/redirecting them is the follow-up phase.
assert.doesNotMatch(
  chatSurface,
  /surface\s*=\s*"chat"|surface === "code"|isCodeSurface|CodeInlineToolbar|data-surface=\{surface\}/,
  "ChatSurface must not regrow a code-surface branch",
);
assert.match(chatSurface, /const compactRail = hideThreadRail/, "ChatSurface compact mode is driven only by hideThreadRail");
assert.match(chatSurface, /\{\s*id:\s*"projects",\s*label:\s*"Projects"\s*\}/, "Chat keeps Projects as its second primary tab");
assert.match(workspace, /const contextualNav = mode === "chat" \? chatSidebar : sidebar;/, "chat mode replaces the global nav with the contextual Chats sidebar");
assert.match(workspace, /nav=\{contextualNav\}\s*list=\{undefined\}/, "workspace mounts the contextual Chat nav without an independent list pane");
assert.doesNotMatch(chatRouter, /surface\?:|surface=\{surface\}/, "ChatRouter must not forward a surface prop");
assert.doesNotMatch(chatView, /surface\?:|surface === "code"|Ask for follow-up changes/, "ChatView must not carry Code-specific composer copy this phase");

console.log("code-surface-mode.test.ts: ok");
