// @ts-nocheck
import assert from "node:assert/strict";
import {
  defaultChatTitleForSession,
  disambiguateSessionTitles,
  mergeSessionTitleOverrides,
  normalizeChatTitle,
} from "./cave-chat-titles.ts";

const sessions = [
  { id: "s1", title: "daemon title", updated_at: "2026-06-01T00:00:00.000Z" },
  { id: "s2", title: "keep me", updated_at: "2026-06-01T00:00:01.000Z" },
];

assert.equal(normalizeChatTitle("  Renamed chat  "), "Renamed chat");
assert.equal(normalizeChatTitle("one\n  two\tthree"), "one two three");
assert.equal(normalizeChatTitle("   "), null);
assert.equal(normalizeChatTitle("x".repeat(130)), "x".repeat(120));
assert.equal(defaultChatTitleForSession("session-1234567890"), "New chat");
assert.equal(defaultChatTitleForSession(""), "New chat");
assert.equal(defaultChatTitleForSession(null), "New chat");

assert.deepEqual(
  mergeSessionTitleOverrides(sessions, {
    s1: "manual title",
    missing: "ignored",
    s2: "   ",
  }),
  [
    { id: "s1", title: "manual title", updated_at: "2026-06-01T00:00:00.000Z" },
    { id: "s2", title: "keep me", updated_at: "2026-06-01T00:00:01.000Z" },
  ],
);

// disambiguateSessionTitles — collisions get a relative-time suffix; uniques don't.
{
  const now = new Date();
  const iso = (minsAgo) => new Date(now.getTime() - minsAgo * 60000).toISOString();
  const rows = [
    { id: "a", title: "New chat", updated_at: iso(5) },
    { id: "b", title: "New chat", updated_at: iso(120) },
    { id: "c", title: "Fix the parser bug", updated_at: iso(10) },
  ];
  const map = disambiguateSessionTitles(rows);
  assert.notEqual(map.get("a"), "New chat", "colliding title gets a suffix");
  assert.notEqual(map.get("b"), "New chat", "the other colliding title gets a suffix");
  assert.notEqual(map.get("a"), map.get("b"), "the two collisions are now distinct");
  assert.match(map.get("a"), /^New chat · /, "suffix is appended after the title");
  assert.equal(map.get("c"), "Fix the parser bug", "a unique title is unchanged");
}
// missing updated_at on a collision → no crash, falls back to the bare title.
{
  const map = disambiguateSessionTitles([
    { id: "x", title: "New chat" },
    { id: "y", title: "New chat" },
  ]);
  assert.equal(map.get("x"), "New chat", "no time => no suffix, no crash");
  assert.equal(map.get("y"), "New chat");
}

console.log("cave-chat-titles.test.ts ok");
