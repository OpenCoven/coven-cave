// src/app/api/profile-route.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const profileRoute = readFileSync(
  fileURLToPath(new URL("./profile/route.ts", import.meta.url)), "utf8");
const avatarRoute = readFileSync(
  fileURLToPath(new URL("./profile/avatar/route.ts", import.meta.url)), "utf8");

describe("profile routes", () => {
  it("PATCH validates through the shared normalizer, not ad-hoc checks", () => {
    assert.match(profileRoute, /normalizeUserProfilePatch/);
    assert.match(profileRoute, /applyUserProfilePatch/);
  });
  it("profile writes persist via saveConfig (atomic), never raw fs", () => {
    assert.match(profileRoute, /saveConfig\(/);
    assert.doesNotMatch(profileRoute, /writeFile|fs\/promises/);
  });
  it("/api/config does not accept profile writes (validated route only)", () => {
    const configRoute = readFileSync(
      fileURLToPath(new URL("./config/route.ts", import.meta.url)), "utf8");
    assert.doesNotMatch(configRoute, /"profile"/);
  });
  it("avatar GET serves bytes with content-type and etag; POST/DELETE go through the file store", () => {
    assert.match(avatarRoute, /readUserAvatarFile/);
    assert.match(avatarRoute, /writeUserAvatarFile/);
    assert.match(avatarRoute, /deleteUserAvatarFile/);
    assert.match(avatarRoute, /ETag/i);
    assert.match(avatarRoute, /Content-Type/i);
  });
  it("avatar route never accepts svg", () => {
    assert.doesNotMatch(avatarRoute, /svg/i);
  });
});
