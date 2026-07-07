// src/lib/user-profile.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./user-profile.ts", import.meta.url)), "utf8");

describe("user-profile client store", () => {
  it("subscribes through useSyncExternalStore with a null server snapshot", () => {
    assert.match(source, /useSyncExternalStore\(subscribe, getSnapshot, getServerSnapshot\)/);
    assert.match(source, /getServerSnapshot = \(\) => null/);
  });
  it("cross-window sync uses a BroadcastChannel and re-fetches on message", () => {
    assert.match(source, /BroadcastChannel/);
    assert.match(source, /cave:user-profile/);
  });
  it("saves commit to memory only after a 2xx (persist-first)", () => {
    assert.match(source, /!res\.ok \|\| !json\?\.ok/);
  });
  it("exposes avatar URL with an updatedAt cache-buster", () => {
    assert.match(source, /\/api\/profile\/avatar\?v=/);
  });
  it("reports avatar removal failures instead of silently succeeding", () => {
    assert.match(source, /export async function removeUserProfileAvatar\(\): Promise<SaveResult>/);
    assert.match(source, /return \{ ok: false, reason:/);
  });
});
