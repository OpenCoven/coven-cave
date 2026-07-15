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
