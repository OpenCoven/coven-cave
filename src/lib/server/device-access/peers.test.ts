import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDevicePeerResolver, parseDevicePeerInventory, tailnetFromDnsName,
} from "./peers.ts";

const NOW = Date.parse("2026-09-09T12:00:00Z");
const status = {
  BackendState: "Running",
  Self: { DNSName: "desktop.example.ts.net." },
  User: { "12": { LoginName: "operator@example.test" } },
  Peer: {
    first: { ID: "node-1", UserID: 12, DNSName: "phone.example.ts.net.", HostName: "Phone", TailscaleIPs: ["100.64.0.2"] },
  },
};

test("tailnet identity comes from canonical Tailscale DNS metadata, not URL-shaped strings", () => {
  assert.equal(tailnetFromDnsName("phone.EXAMPLE.ts.net."), "example.ts.net");
  for (const value of ["example.ts.net", "https://phone.example.ts.net", "phone.example.ts.net.attacker.test", "*.example.ts.net"]) {
    assert.equal(tailnetFromDnsName(value), null);
  }
  assert.equal(parseDevicePeerInventory(status, NOW).peers.get("100.64.0.2")?.nodeId, "node-1");
});

test("expired and tagged nodes cannot earn a human-owned pairing identity", () => {
  for (const override of [{ Expired: true }, { Tags: ["tag:server"] }, { KeyExpiry: new Date(NOW).toISOString() }]) {
    assert.equal(parseDevicePeerInventory({
      ...status, Peer: { first: { ...status.Peer.first, ...override } },
    }, NOW).peers.size, 0);
  }
  assert.throws(() => parseDevicePeerInventory({ ...status, BackendState: "Stopped" }, NOW));
  assert.throws(() => parseDevicePeerInventory({
    ...status, Peer: { ...status.Peer, second: { ...status.Peer.first, ID: "node-2" } },
  }, NOW), /ambiguous/);
});

test("a failed membership refresh never leaves stale authorization context", async () => {
  let now = NOW;
  let failure = false;
  let calls = 0;
  const resolve = createDevicePeerResolver(async () => {
    calls++;
    if (failure) throw new Error("Tailscale offline");
    return status;
  }, () => now);
  await resolve();
  await resolve();
  assert.equal(calls, 1);
  now += 10_000;
  failure = true;
  await assert.rejects(resolve(), /offline/);
  await assert.rejects(resolve(), /offline/);
  assert.equal(calls, 3);
  failure = false;
  assert.equal((await resolve()).peers.size, 1);
});
