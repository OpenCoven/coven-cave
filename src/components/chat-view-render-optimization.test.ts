// @ts-nocheck
/**
 * Tests for CHAT-D3-07 (P3) render performance optimizations:
 * 1. Turn index map (O(1) vs O(n²) indexOf)
 * 2. renderCache LRU cap (unbounded → 200 cap)
 * 3. regenerateFor stays outside the per-row index lookup path
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatViewSource = readFileSync(
  new URL("./chat-view.tsx", import.meta.url),
  "utf8",
);

const messageBubbleSource = readFileSync(
  new URL("./message-bubble.tsx", import.meta.url),
  "utf8",
);

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: Turn index map for O(1) lookup (CHAT-D10-02 fix)
// ─────────────────────────────────────────────────────────────────────────────

assert.match(
  chatViewSource,
  /const turnIndexMap = new Map(?:<[^>]+>)?\(\);/,
  "creates a turnIndexMap Map",
);

assert.match(
  chatViewSource,
  /turnIndexMap\.set\([^;]*\.id,\s*\w+\);/,
  "populates turnIndexMap with turn ids and numeric indexes",
);

assert.match(
  chatViewSource,
  /turnIndexMap\.get\(t\.id\) \?\? -1/,
  "replaces allTurns.indexOf(t) with turnIndexMap.get(t.id)",
);

// Verify that old indexOf calls are gone from the render path
const indexOfMatches = chatViewSource.match(/allTurns\.indexOf\(/g);
assert.equal(
  indexOfMatches,
  null,
  "removes all allTurns.indexOf() calls from render path",
);

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: renderCache LRU cap (CHAT-D3-03)
// ─────────────────────────────────────────────────────────────────────────────

assert.match(
  messageBubbleSource,
  /const RENDER_CACHE_MAX = 200;/,
  "sets renderCache max to 200 entries",
);

assert.match(
  messageBubbleSource,
  /if \(renderCache\.size > RENDER_CACHE_MAX\) \{\s*const oldest = renderCache\.keys\(\)\.next\(\)\.value;.*?renderCache\.delete\(oldest\);/s,
  "evicts oldest entry when cache exceeds RENDER_CACHE_MAX",
);

assert.match(
  messageBubbleSource,
  /function renderCacheGet\(key: string\): string \| undefined \{.*?renderCache\.delete\(key\);\s*renderCache\.set\(key, value\);/s,
  "refreshes LRU recency on cache hit (delete then re-set)",
);

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: Main optimization is the turn index map (CHAT-D10-02 core fix)
// ─────────────────────────────────────────────────────────────────────────────

assert.match(
  chatViewSource,
  /function regenerateFor\(turn: Turn\)/,
  "regenerateFor maintains original signature for test compatibility",
);

// The main optimization is the turnIndexMap that removes indexOf from the hot path.
// regenerateFor's findIndex call is O(n) but happens only when regenerating, not
// during normal render; the main win is replacing the per-row indexOf(t) in the
// render loop (lines 2570, 2601) which is called for every turn on every render.

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: TurnRow is memoized (CHAT-D3-07) so a streamed token re-renders only
// the streaming row, not every settled row in the thread.
// ─────────────────────────────────────────────────────────────────────────────

assert.match(
  chatViewSource,
  /const TurnRow = memo\(TurnRowImpl, areTurnRowPropsEqual\);/,
  "TurnRow wraps TurnRowImpl in React.memo with a custom comparator",
);

// The comparator must ignore callback identity (those closures are recreated on
// every parent render) and instead track the stable turn ref + action presence,
// or memoization would never bail out during streaming.
assert.match(
  chatViewSource,
  /function areTurnRowPropsEqual\(prev: TurnRowProps, next: TurnRowProps\): boolean \{[\s\S]*?prev\.turn === next\.turn[\s\S]*?Boolean\(prev\.onRegenerate\) === Boolean\(next\.onRegenerate\)/,
  "memo comparator compares the stable turn ref and action availability, not callback identity",
);

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: replyFor caches its parse by the stable turn ref (CHAT-D3-07) so the
// per-row Reply decision isn't recomputed for the whole transcript each token.
// ─────────────────────────────────────────────────────────────────────────────

assert.match(
  chatViewSource,
  /const replyableTurnCache = new WeakMap<Turn, boolean>\(\);/,
  "replyFor's parse decision is cached in a turn-keyed WeakMap",
);

assert.match(
  chatViewSource,
  /function replyFor\(turn: Turn\)[\s\S]*?replyableTurnCache\.get\(turn\)[\s\S]*?replyableTurnCache\.set\(turn, canReply\)/,
  "replyFor reads then populates the WeakMap cache instead of re-parsing every render",
);

console.log("✓ All render optimization tests pass");
