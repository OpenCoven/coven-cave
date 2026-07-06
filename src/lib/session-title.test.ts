// @ts-nocheck
// Continue-column display titles: compose the existing cave-chat-titles
// sanitizers and additionally reject role-prompt-shaped titles ("You are…",
// "Act as…") that leak system prompts into session lists.
import assert from "node:assert/strict";
import { sessionDisplayTitle, looksLikeRolePrompt } from "./session-title.ts";

// Role-prompt shapes are detected…
assert.equal(looksLikeRolePrompt("You are the spirit dwelling inside the Cave"), true);
assert.equal(looksLikeRolePrompt("you're a helpful coding assistant"), true);
assert.equal(looksLikeRolePrompt("Act as a senior reviewer"), true);
assert.equal(looksLikeRolePrompt("Your role is to triage issues"), true);
// …while ordinary titles pass through.
assert.equal(looksLikeRolePrompt("Fix the search bar"), false);
assert.equal(looksLikeRolePrompt("Are you able to parse YAML?"), false);
assert.equal(looksLikeRolePrompt("Actors list for the demo video"), false);

// sessionDisplayTitle: good titles pass through (normalized)…
assert.equal(sessionDisplayTitle({ title: "Fix the search bar" }), "Fix the search bar");
// …role-prompt leaks fall back to the neutral default…
assert.equal(sessionDisplayTitle({ title: "You are the spirit dwelling inside the Cave. Each…" }), "New chat");
// …as do canon-preamble leaks (delegated to sanitizeSessionTitle)…
assert.equal(sessionDisplayTitle({ title: "Coven identity canon: - Each familiar has…" }), "New chat");
// …and empty/missing titles.
assert.equal(sessionDisplayTitle({ title: "" }), "New chat");
assert.equal(sessionDisplayTitle({ title: null }), "New chat");
assert.equal(sessionDisplayTitle({}), "New chat");

console.log("session-title.test.ts: ok");
