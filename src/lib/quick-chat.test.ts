import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveQuickChatTarget } from "./quick-chat.ts";
import type { Familiar } from "./types.ts";

const familiars: Familiar[] = [
  { id: "nova", display_name: "Nova", role: "research" },
  { id: "sage", display_name: "Sage Counsel", name: "Sage", role: "review" },
];

describe("resolveQuickChatTarget", () => {
  it("uses a leading @mention as the familiar and strips it from the prompt", () => {
    const result = resolveQuickChatTarget("@sage summarize this", familiars, "nova");

    assert.equal(result.familiarId, "sage");
    assert.equal(result.prompt, "summarize this");
    assert.equal(result.error, null);
  });

  it("matches @mentions against display names, names, and ids", () => {
    const result = resolveQuickChatTarget("@sage-counsel check the plan", familiars, "nova");

    assert.equal(result.familiarId, "sage");
    assert.equal(result.prompt, "check the plan");
  });

  it("falls back to the selected familiar when there is no @mention", () => {
    const result = resolveQuickChatTarget("what should I do next?", familiars, "nova");

    assert.equal(result.familiarId, "nova");
    assert.equal(result.prompt, "what should I do next?");
    assert.equal(result.error, null);
  });

  it("returns an explicit error for unknown @mentions", () => {
    const result = resolveQuickChatTarget("@ghost ping", familiars, "nova");

    assert.equal(result.familiarId, null);
    assert.equal(result.prompt, "ping");
    assert.match(result.error ?? "", /Unknown familiar @ghost/);
  });

  it("requires prompt text after the familiar target", () => {
    const result = resolveQuickChatTarget("@sage", familiars, "nova");

    assert.equal(result.familiarId, "sage");
    assert.equal(result.prompt, "");
    assert.match(result.error ?? "", /prompt/i);
  });
});
