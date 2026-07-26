// @ts-nocheck
// Source pins for the session rail's zero-session state. When a familiar is
// selected but no sessions exist yet, the rail must render a friendly
// invitation with a real affordance — not a blank nav (board card:
// "Chat empty state — no affordance when no sessions exist").
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("./chat-project-sidebar.tsx", import.meta.url), "utf8");

// The empty state renders only when there is genuinely nothing to show:
// no search in flight and zero project groups.
assert.match(
  src,
  /\{!hasSearch && groups\.length === 0 \? \(/,
  "zero-session empty state is gated on no-search + no-groups",
);

// It reuses the shared EmptyState primitive, not bespoke markup.
assert.match(
  src,
  /import \{ EmptyState \} from "@\/components\/ui\/empty-state"/,
  "the rail uses the shared EmptyState primitive",
);
assert.match(
  src,
  /icon="ph:chat-circle-dots"/,
  "the empty state carries a chat glyph as the visual cue",
);

// The affordance is real: a primary button that opens a fresh compose view
// through the same onNewChat path as the folder "+" buttons.
assert.match(
  src,
  /<Button size="sm" variant="primary" leadingIcon="ph:plus" onClick=\{\(\) => onNewChat\(null\)\}>/,
  "the empty state's Start-a-chat button routes through onNewChat(null)",
);

console.log("chat-project-sidebar-empty.test.ts: ok");
