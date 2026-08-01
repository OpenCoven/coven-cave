// @ts-nocheck
import assert from "node:assert/strict";
import { generateChatTitle, latestExchangeForTitle } from "./chat-title-generation.ts";

const turn = (role, text, extra = {}) => ({
  id: `${role}-${text.slice(0, 8)}-${Math.abs(text.length)}`,
  role,
  text,
  createdAt: "2026-07-31T00:00:00.000Z",
  ...extra,
});

// ── Empty / meaningless threads yield nothing ────────────────────────────────
// Callers keep the existing title on null rather than blanking it, so "no
// signal" must be null and never an empty string.
assert.equal(latestExchangeForTitle([]), null);
assert.equal(generateChatTitle([]), null);
assert.equal(latestExchangeForTitle([turn("user", "   ")]), null);
assert.equal(generateChatTitle([turn("user", "   ")]), null);

// ── The freshest settled exchange wins ───────────────────────────────────────
// A long thread should be named after where it *is*, not where it opened.
const thread = [
  turn("user", "How do I set up the vault?"),
  turn("assistant", "Run the init command."),
  turn("user", "Now rotate the signing key"),
  turn("assistant", "Use the rotate subcommand."),
];
assert.deepEqual(latestExchangeForTitle(thread), {
  userText: "Now rotate the signing key",
  assistantText: "Use the rotate subcommand.",
});

// ── Pending assistant turns are skipped ──────────────────────────────────────
// Naming a chat after a reply that is still streaming captures a half-formed
// thought, so the newest SETTLED assistant turn is the anchor.
const streaming = [...thread, turn("user", "And the audit log?"), turn("assistant", "Partial…", { pending: true })];
const streamingExchange = latestExchangeForTitle(streaming);
assert.equal(streamingExchange.assistantText, "Use the rotate subcommand.");
assert.equal(streamingExchange.userText, "Now rotate the signing key");

// ── Errored assistant turns are skipped too ──────────────────────────────────
const errored = [...thread, turn("user", "And the audit log?"), turn("assistant", "boom", { error: true })];
assert.equal(latestExchangeForTitle(errored).assistantText, "Use the rotate subcommand.");

// ── Before any assistant reply, the last user turn stands alone ──────────────
// This is exactly what the first-exchange auto-name already does.
const openingOnly = [turn("user", "Draft the release notes")];
assert.deepEqual(latestExchangeForTitle(openingOnly), {
  userText: "Draft the release notes",
  assistantText: null,
});
assert.equal(typeof generateChatTitle(openingOnly), "string");

// ── An assistant turn with no preceding user turn still names the chat ───────
const assistantFirst = [turn("assistant", "Here is the summary of the incident.")];
const assistantOnly = latestExchangeForTitle(assistantFirst);
assert.equal(assistantOnly.userText, null);
assert.equal(assistantOnly.assistantText, "Here is the summary of the incident.");

// ── System turns never supply the title ──────────────────────────────────────
assert.equal(latestExchangeForTitle([turn("system", "You are a helpful familiar.")]), null);

// ── Whitespace-only turns are treated as absent ──────────────────────────────
const blankReply = [turn("user", "Rotate the key"), turn("assistant", "   ")];
assert.deepEqual(latestExchangeForTitle(blankReply), {
  userText: "Rotate the key",
  assistantText: null,
});

// ── Generation is pure: same input, same output, no I/O ──────────────────────
assert.equal(generateChatTitle(thread), generateChatTitle(thread));
assert.equal(typeof generateChatTitle(thread), "string");
assert.ok(generateChatTitle(thread).length > 0);
