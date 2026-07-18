// src/lib/user-profile-shared.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeUserProfilePatch,
  applyUserProfilePatch,
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
  it("rejects non-object bodies without throwing", () => {
    const resNull = normalizeUserProfilePatch(null as unknown);
    assert.ok(!resNull.ok);
    if (resNull.ok) return;
    assert.match(resNull.error, /body must be an object/);
    
    const resNum = normalizeUserProfilePatch(123 as unknown);
    assert.ok(!resNum.ok);
    if (resNum.ok) return;
    assert.match(resNum.error, /body must be an object/);
    
    const resArray = normalizeUserProfilePatch([] as unknown);
    assert.ok(!resArray.ok);
    if (resArray.ok) return;
    assert.match(resArray.error, /body must be an object/);
    
    const resString = normalizeUserProfilePatch("" as unknown);
    assert.ok(!resString.ok);
    if (resString.ok) return;
    assert.match(resString.error, /body must be an object/);
    
    const resBool = normalizeUserProfilePatch(true as unknown);
    assert.ok(!resBool.ok);
    if (resBool.ok) return;
    assert.match(resBool.error, /body must be an object/);
  });
});

describe("applyUserProfilePatch", () => {
  it("applies name:null to {name:x} yields undefined", () => {
    const result = applyUserProfilePatch({ name: "x" }, { name: null });
    assert.equal(result, undefined);
  });
  it("applies bio:b to {name:x} yields {name:x, bio:b}", () => {
    const result = applyUserProfilePatch({ name: "x" }, { bio: "b" });
    assert.deepEqual(result, { name: "x", bio: "b" });
  });
  it("null clears only the targeted key", () => {
    const result = applyUserProfilePatch({ name: "x", bio: "b" }, { name: null });
    assert.deepEqual(result, { bio: "b" });
  });
  it("applies patch to undefined current", () => {
    const result = applyUserProfilePatch(undefined, { name: "new" });
    assert.deepEqual(result, { name: "new" });
  });
  it("returns undefined when all fields cleared", () => {
    const result = applyUserProfilePatch({ name: "x", bio: "b" }, { name: null, bio: null });
    assert.equal(result, undefined);
  });
});

describe("userDisplayName", () => {
  it("falls back to You", () => {
    assert.equal(userDisplayName(null), "You");
    assert.equal(userDisplayName({ name: "  " }), "You");
    assert.equal(userDisplayName({ name: "Buns" }), "Buns");
  });
});
