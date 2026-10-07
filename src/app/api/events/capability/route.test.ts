import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const { GET } = await import("./route.ts");

const ENV_KEYS = ["COVEN_CAVE_EVENT_PLANE_ENABLED", "COVEN_CAVE_EVENT_WEB_MODE", "COVEN_CAVE_EVENT_IOS_MODE"] as const;

async function capabilityWith(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  try {
    const res = GET();
    assert.equal(res.headers.get("cache-control"), "no-store");
    return (await res.json()).eventPlane;
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test("the event plane is advertised as off by default", async () => {
  assert.deepEqual(await capabilityWith({}), {
    enabled: false,
    protocolVersion: 1,
    path: "/api/events-ws",
    topics: ["sessions", "board", "runs", "familiars", "daemon"],
    rolloutMode: { web: "off", ios: "off" },
  });
});

test("the kill switch and per-platform modes come from the environment", async () => {
  assert.deepEqual(
    await capabilityWith({ COVEN_CAVE_EVENT_PLANE_ENABLED: "1", COVEN_CAVE_EVENT_WEB_MODE: "shadow" }),
    {
      enabled: true,
      protocolVersion: 1,
      path: "/api/events-ws",
      topics: ["sessions", "board", "runs", "familiars", "daemon"],
      rolloutMode: { web: "shadow", ios: "off" },
    },
  );
  const invalid = await capabilityWith({ COVEN_CAVE_EVENT_PLANE_ENABLED: "1", COVEN_CAVE_EVENT_IOS_MODE: "always" });
  assert.equal(invalid.rolloutMode.ios, "off", "an invalid mode fails closed");
});

test("the capability never asks the daemon", () => {
  const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /callDaemon|coven-daemon/, "it answers while Coven is down");
});
