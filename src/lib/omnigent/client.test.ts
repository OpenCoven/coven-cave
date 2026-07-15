// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { pickDefaultAgentId, pickDefaultHostId } from "./client.ts";
import { normalizeOmnigentBaseUrl } from "./token.ts";
// Keep .ts extensions so node --experimental-strip-types can resolve (same as other suite tests).

test("normalizeOmnigentBaseUrl strips path and trailing slash", () => {
  assert.equal(
    normalizeOmnigentBaseUrl("https://omnigent.example.com/foo/"),
    "https://omnigent.example.com",
  );
});

test("normalizeOmnigentBaseUrl adds https when scheme missing", () => {
  assert.equal(normalizeOmnigentBaseUrl("omnigent.example.com"), "https://omnigent.example.com");
});

test("pickDefaultAgentId prefers preferred id then claude-native-ui", () => {
  const agents = [
    { id: "ag_a", name: "polly" },
    { id: "ag_b", name: "claude-native-ui", harness: "claude-native" },
  ];
  assert.equal(pickDefaultAgentId(agents, "ag_a"), "ag_a");
  assert.equal(pickDefaultAgentId(agents), "ag_b");
});

test("pickDefaultHostId prefers preferred id then online host", () => {
  const hosts = [
    { host_id: "host_offline", name: "down", status: "offline" },
    { host_id: "host_online", name: "up", status: "online" },
  ];
  assert.equal(pickDefaultHostId(hosts, "host_offline"), "host_offline");
  assert.equal(pickDefaultHostId(hosts), "host_online");
});

test("omnigent host option ids round-trip", async () => {
  const { omnigentHostOptionId, parseOmnigentHostOptionId, isOmnigentHostOptionId } = await import(
    "./ids.ts"
  );
  const id = omnigentHostOptionId("host_abc");
  assert.equal(id, "omnigent:host_abc");
  assert.equal(parseOmnigentHostOptionId(id), "host_abc");
  assert.equal(isOmnigentHostOptionId(id), true);
  assert.equal(isOmnigentHostOptionId("local"), false);
});

test("normalizeOmnigentConfig keeps hostMap and exposeHostsInComposer", async () => {
  const { normalizeOmnigentConfig } = await import("../cave-config.ts");
  const cfg = normalizeOmnigentConfig({
    baseUrl: "https://omni.example.com/",
    hostMap: { "ubuntu-root": "host_9" },
    exposeHostsInComposer: false,
  });
  assert.equal(cfg.baseUrl, "https://omni.example.com");
  assert.equal(cfg.hostMap["ubuntu-root"], "host_9");
  assert.equal(cfg.exposeHostsInComposer, false);
});