// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const chatSidebar = await readFile(new URL("./chat-sidebar.tsx", import.meta.url), "utf8");
const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");

// ── Left-sidebar transformation: chat mode swaps the nav for the ChatSidebar,
//    mirroring how code mode swaps in the CodeSidebar. ─────────────────────────
assert.match(
  workspace,
  /mode === "code" \? codeSidebar : mode === "chat" \? chatSidebar : sidebar/,
  "workspace nav should swap to chatSidebar in chat mode",
);
assert.match(
  workspace,
  /const chatSidebar =\s*\(\s*<ChatSidebar/,
  "workspace should define the chatSidebar element",
);
assert.match(
  workspace,
  /const exitChatMode = useCallback/,
  "workspace should provide exitChatMode so the sidebar back control returns to the prior surface",
);

// ── Subpanel removal: the in-surface thread rail is dropped in chat mode, since
//    the ChatSidebar now owns the project-grouped thread list. ────────────────
assert.match(
  workspace,
  /hideThreadRail/,
  "the chat-mode ChatSurface should set hideThreadRail",
);
assert.match(chatSurface, /hideThreadRail = false/, "ChatSurface should accept a hideThreadRail prop");
assert.match(
  chatSurface,
  /const compactRail = isCodeSurface \|\| hideThreadRail/,
  "ChatSurface should fold hideThreadRail into the compact rail flag",
);
assert.match(chatSurface, /compact=\{compactRail\}/, "ChatRouter should receive the combined compact flag");

// ── Recreated sidepanel: project-grouped threads + register-as-project. ───────
assert.match(
  chatSidebar,
  /deriveChatProjectGroups\(applyProjectOverrides/,
  "ChatSidebar should group threads by project (with local overrides applied)",
);
assert.match(
  chatSidebar,
  /handleRegister/,
  "ChatSidebar should offer register-as-project for unregistered roots",
);
assert.match(
  chatSidebar,
  /Register \$\{label\} as a project/,
  "ChatSidebar register affordance should be labeled for assistive tech",
);

// ── Easy add-project on failure: a 403 project-access denial surfaces a
//    one-click register + grant + retry. ───────────────────────────────────────
assert.match(chatView, /setProjectAccessRoot/, "chat-view should capture the failing project root on a 403");
assert.match(chatView, /async function handleAddProject/, "chat-view should implement the add-project recovery");
assert.match(
  chatView,
  /onAddProject=\{projectAccessRoot \? handleAddProject : undefined\}/,
  "chat-view should wire the add-project action into the error strip",
);

// ── Organize sidebar: recency view (default) + by-project, via a header menu. ─
assert.match(
  chatSidebar,
  /deriveChatRecencyBuckets\(/,
  "ChatSidebar should derive time buckets for the Recent view",
);
assert.match(chatSidebar, /Organize sidebar/, "ChatSidebar should expose the Organize sidebar menu");
assert.match(
  chatSidebar,
  /readChatSidebarView\(\)/,
  "the organize mode should hydrate from the persisted preference",
);
assert.match(
  chatSidebar,
  /relativeTime\(iso, Date\.now\(\), "bare"\)/,
  'sidebar row times should use the bare density (no "ago")',
);
assert.ok(
  (chatSidebar.match(/<ThreadRow/g) ?? []).length >= 2,
  "both view branches should render the shared ThreadRow",
);

console.log("chat-sidebar-wiring.test.ts passed");
