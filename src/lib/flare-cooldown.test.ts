import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  FLARE_COOLDOWN_MS,
  SETTLE_MIN_RUN_MS,
  resetFlareCooldowns,
  shouldFlare,
} from "./flare-cooldown.ts";

describe("flare-cooldown (cave-q06w)", () => {
  beforeEach(() => resetFlareCooldowns());

  it("grants the first flare of a kind", () => {
    assert.equal(shouldFlare("session-settle", 1_000), true);
  });

  it("denies within the cooldown window and grants after it", () => {
    assert.equal(shouldFlare("session-settle", 1_000), true);
    assert.equal(shouldFlare("session-settle", 1_000 + FLARE_COOLDOWN_MS - 1), false);
    assert.equal(shouldFlare("session-settle", 1_000 + FLARE_COOLDOWN_MS), true);
  });

  it("tracks kinds independently", () => {
    assert.equal(shouldFlare("session-settle", 1_000), true);
    assert.equal(shouldFlare("memory-save", 1_000), true);
    assert.equal(shouldFlare("memory-save", 2_000), false);
  });

  it("does not record denials — a steady drizzle still flares once per window", () => {
    assert.equal(shouldFlare("memory-save", 0), true);
    // Saves every minute: each denial must not push the next grant out.
    for (let t = 60_000; t < FLARE_COOLDOWN_MS; t += 60_000) {
      assert.equal(shouldFlare("memory-save", t), false);
    }
    assert.equal(shouldFlare("memory-save", FLARE_COOLDOWN_MS), true);
  });

  it("reset forgets grants (test isolation hook)", () => {
    assert.equal(shouldFlare("session-settle", 1_000), true);
    resetFlareCooldowns();
    assert.equal(shouldFlare("session-settle", 1_001), true);
  });

  it("constants: 5-minute window, 60s settle significance floor", () => {
    // Pinned so a drive-by retune is a conscious, reviewed decision — these
    // two numbers ARE the cooldown model cave-q06w specifies.
    assert.equal(FLARE_COOLDOWN_MS, 300_000);
    assert.equal(SETTLE_MIN_RUN_MS, 60_000);
  });
});
