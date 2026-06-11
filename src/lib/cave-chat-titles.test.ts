// @ts-nocheck
import assert from "node:assert/strict";
import {
  defaultChatTitleForSession,
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
assert.equal(defaultChatTitleForSession("session-1234567890"), "New Session 12345678");
assert.equal(defaultChatTitleForSession(""), "New Session");

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
