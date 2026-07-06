// src/lib/user-profile-shared.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeUserProfilePatch,
  userDisplayName,
  PROFILE_LIMITS,
} from "./user-profile-shared.ts";

describe("normalizeUserProfilePatch", () => {
  it("trims and accepts valid fields", () => {
    const res = normalizeUserProfilePatch({
      name: "  Buns ", pronouns: "they/them", bio: "hi", timezone: "America/Chicago",
      links: [{ label: "GitHub", url: "https://github.com/BunsDev" }],
    });
    assert.ok(res.ok);
    if (!res.ok) return;
    assert.equal(res.patch.name, "Buns");
    assert.equal(res.patch.links?.[0].url, "https://github.com/BunsDev");
  });
  it("empty string clears a field (null in patch)", () => {
    const res = normalizeUserProfilePatch({ name: "" });
    assert.ok(res.ok);
    if (!res.ok) return;
    assert.equal(res.patch.name, null);
  });
  it("rejects unknown keys", () => {
    const res = normalizeUserProfilePatch({ nickname: "x" } as Record<string, unknown>);
    assert.ok(!res.ok);
    if (res.ok) return;
    assert.match(res.error, /unknown field: nickname/);
  });
  it("rejects over-limit lengths", () => {
    const res = normalizeUserProfilePatch({ name: "x".repeat(PROFILE_LIMITS.name + 1) });
    assert.ok(!res.ok);
    if (res.ok) return;
    assert.match(res.error, /name/);
  });
  it("rejects bad timezone and non-http links", () => {
    assert.ok(!normalizeUserProfilePatch({ timezone: "Mars/Olympus" }).ok);
    assert.ok(!normalizeUserProfilePatch({ links: [{ label: "x", url: "javascript:alert(1)" }] }).ok);
    assert.ok(!normalizeUserProfilePatch({ links: Array.from({ length: 9 }, (_, i) => ({ label: `l${i}`, url: "https://a.b" })) }).ok);
  });
});

describe("userDisplayName", () => {
  it("falls back to You", () => {
    assert.equal(userDisplayName(null), "You");
    assert.equal(userDisplayName({ name: "  " }), "You");
    assert.equal(userDisplayName({ name: "Buns" }), "Buns");
  });
});
