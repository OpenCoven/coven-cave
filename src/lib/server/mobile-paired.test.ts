// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { MOBILE_ACCESS_HEADER } from "../../proxy-helpers.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "cave-mobile-paired-"));
process.env.COVEN_CAVE_HOME = root;

const paired = await import("./mobile-paired.ts");
const stateFile = path.join(root, "mobile-paired.json");

async function persistedLastSeen(): Promise<number | null> {
  try {
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    return state.lastSeenAt;
  } catch {
    return null;
  }
}

test("only proxy-verified mobile roster requests create the paired signal", async () => {
  await paired.recordMobilePresenceForRequest(
    new Request("http://127.0.0.1/api/familiars"),
    1_000,
  );
  assert.equal(await persistedLastSeen(), null, "an ordinary local request is ignored");

  const verifiedMobile = new Request("https://cave.example/api/familiars", {
    headers: { [MOBILE_ACCESS_HEADER]: "1" },
  });
  await paired.recordMobilePresenceForRequest(verifiedMobile, 2_000);
  assert.equal(await persistedLastSeen(), 2_000, "the verified phone records its first beat");
});

test("foreground beats coalesce for five minutes and concurrent probes are serialized", async () => {
  const interval = paired.MOBILE_PRESENCE_WRITE_INTERVAL_MS;

  await paired.recordMobilePresenceBeat(2_000 + interval - 1);
  assert.equal(await persistedLastSeen(), 2_000, "a beat inside the window does not rewrite");

  await Promise.all([
    paired.recordMobilePresenceBeat(2_000 + interval),
    paired.recordMobilePresenceBeat(2_001 + interval),
    paired.recordMobilePresenceBeat(2_002 + interval),
  ]);
  assert.equal(
    await persistedLastSeen(),
    2_000 + interval,
    "the first due concurrent probe wins and later probes observe its timestamp",
  );
});

test("token refresh remains unconditional and shares ordering with probe beats", async () => {
  const interval = paired.MOBILE_PRESENCE_WRITE_INTERVAL_MS;
  const baseline = 2_000 + interval;

  await paired.recordMobileSeen(baseline + 10);
  assert.equal(
    await persistedLastSeen(),
    baseline + 10,
    "refresh advances last-seen even inside the probe coalescing window",
  );

  await Promise.all([
    paired.recordMobilePresenceBeat(baseline + interval + 10),
    paired.recordMobileSeen(baseline + interval + 20),
    paired.recordMobilePresenceBeat(baseline + interval + 30),
  ]);
  assert.equal(
    await persistedLastSeen(),
    baseline + interval + 20,
    "a queued refresh cannot be overwritten by a delayed coalesced probe",
  );
});

test("write failures stay best-effort and do not poison later beats", async () => {
  process.env.COVEN_CAVE_HOME = path.join(root, "missing", "cave");
  await assert.doesNotReject(() => paired.recordMobileSeen(9_000_000));

  process.env.COVEN_CAVE_HOME = root;
  await paired.recordMobileSeen(9_000_001);
  assert.equal(await persistedLastSeen(), 9_000_001, "the serialized queue recovers after failure");
});

test("GET /api/familiars records presence before attempting daemon work", async () => {
  const route = await readFile(
    new URL("../../app/api/familiars/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    route,
    /export async function GET\(req: Request\) \{\s*[\s\S]{0,500}await recordMobilePresenceForRequest\(req\);[\s\S]{0,200}loadVisibleFamiliarRoster\(\)/,
    "authenticated mobile presence must land even when the downstream roster is unhealthy",
  );
});

test.after(async () => {
  delete process.env.COVEN_CAVE_HOME;
  await rm(root, { recursive: true, force: true });
});
