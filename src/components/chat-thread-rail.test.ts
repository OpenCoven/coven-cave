// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-project-sidebar.tsx", import.meta.url), "utf8");

// ── Always-visible flat all-chats list (Codex-style visibility) ───────────────
assert.match(
  source,
  /const allSessions = useMemo\(\(\) => \{[\s\S]*groups\.flatMap\(\(g\) => g\.sessions\)/,
  "Rail should flatten every project group into one always-visible all-chats list",
);
assert.match(
  source,
  /\.sort\(\(a, b\) =>[\s\S]*updated_at[\s\S]*created_at/,
  "The flat list should be globally recency-sorted, not hidden behind collapsed folders",
);

// ── Drag-and-drop reorder via @dnd-kit, persisted ────────────────────────────
assert.match(source, /from "@dnd-kit\/core"/, "Rail uses @dnd-kit for drag reorder");
assert.match(source, /SortableContext/, "Rail wraps the flat list in a SortableContext");
assert.match(source, /useSortable\(\{\s*id: session\.id/, "Each thread row is sortable by session id");
assert.match(
  source,
  /activationConstraint: \{ distance: 5 \}/,
  "PointerSensor activation distance keeps a quick click an 'open', not a drag",
);
assert.match(
  source,
  /writeSessionOrder\(/,
  "A drag must persist the new manual order so it survives reloads",
);
assert.match(
  source,
  /const live = new Set\(allSessions\.map\(\(s\) => s\.id\)\)[\s\S]*merged\.filter\(\(id\) => live\.has\(id\)\)/,
  "Persisted order must be pruned against live sessions so it can't grow unbounded across deletes",
);

// ── Launch new chats from the rail ───────────────────────────────────────────
assert.match(
  source,
  /onClick=\{\(\) => onNewChat\(null\)\}[\s\S]*New/,
  "Rail header should carry a prominent New chat launcher (global new chat)",
);

// ── Search + mode filters (All / Active / Tasks / Pinned) ────────────────────
assert.match(source, /placeholder="Search chats…"/, "Rail offers inline chat search");
assert.match(
  source,
  /type ChatFilter = "all" \| "active" \| "tasks" \| "pinned"/,
  "Rail exposes All/Active/Tasks/Pinned mode filters",
);
assert.match(
  source,
  /s\.origin === "board"/,
  "The Tasks filter is honest — it keys off board-originated sessions, not invented state",
);
assert.match(
  source,
  /s\.status === "running"/,
  "The Active filter keys off live running sessions",
);

// ── Pin toggle is Cave-local (shared localStorage key with the chat list) ────
assert.match(source, /PINNED_SESSIONS_KEY/, "Rail pins share the chat list's localStorage key");
assert.match(source, /togglePinnedSession/, "Rail toggles pins through the shared helper");

// ── Default floats pinned; once dragged, manual order wins (no tug-of-war) ───
assert.match(
  source,
  /if \(order\.length === 0\) rows = partitionPinnedFirst\(rows, pinnedIds\)/,
  "Pinned rows float by default, but a manual drag order takes precedence afterward",
);

// ── Preserved contracts other suites rely on ─────────────────────────────────
assert.match(
  source,
  /onClick=\{\(\) => \{[\s\S]*onSelect\(key\);[\s\S]*onToggleExpanded\(key\);[\s\S]*\}\}[\s\S]*aria-expanded=\{expanded\}/,
  "Project folder rows must keep the label/count collapse trigger contract",
);
assert.match(
  source,
  /edge-rail-chip[\s\S]{0,120}ph:sidebar-simple/,
  "Collapsed rail keeps the pressable reopen chip",
);

console.log("chat-thread-rail.test.ts: ok");
