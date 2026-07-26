import assert from "node:assert/strict";
import test from "node:test";
import { parseTailscaleDevices } from "./tailscale-devices.ts";

const fixture = JSON.stringify({
  Self: {
    HostName: "cave-mac",
    DNSName: "cave-mac.tail123.ts.net.",
    TailscaleIPs: ["fd7a:115c:a1e0::1", "100.64.0.1"],
    OS: "macOS",
    Online: true,
    LastSeen: "2026-07-21T23:00:00Z",
  },
  Peer: {
    offline: {
      HostName: "archive",
      DNSName: "archive.tail123.ts.net.",
      TailscaleIPs: ["100.64.0.3"],
      OS: "linux",
      Online: false,
      LastSeen: "2026-07-20T20:00:00Z",
    },
    online: {
      HostName: "server",
      DNSName: "server.tail123.ts.net.",
      TailscaleIPs: ["100.64.0.2"],
      OS: "linux",
      Online: true,
      LastSeen: "2026-07-21T23:30:00Z",
    },
    ipv6Only: {
      HostName: "phone",
      DNSName: "phone.tail123.ts.net.",
      TailscaleIPs: ["fd7a:115c:a1e0::4"],
      OS: "iOS",
      Online: true,
    },
  },
});

test("parses self and peers with self first, then online peers, then offline peers", () => {
  assert.deepEqual(parseTailscaleDevices(fixture), [
    {
      name: "cave-mac",
      dnsName: "cave-mac.tail123.ts.net",
      hostName: "cave-mac",
      tailnetIp: "100.64.0.1",
      os: "macOS",
      online: true,
      lastSeen: "2026-07-21T23:00:00Z",
      isSelf: true,
    },
    {
      name: "phone",
      dnsName: "phone.tail123.ts.net",
      hostName: "phone",
      tailnetIp: null,
      os: "iOS",
      online: true,
      lastSeen: null,
      isSelf: false,
    },
    {
      name: "server",
      dnsName: "server.tail123.ts.net",
      hostName: "server",
      tailnetIp: "100.64.0.2",
      os: "linux",
      online: true,
      lastSeen: "2026-07-21T23:30:00Z",
      isSelf: false,
    },
    {
      name: "archive",
      dnsName: "archive.tail123.ts.net",
      hostName: "archive",
      tailnetIp: "100.64.0.3",
      os: "linux",
      online: false,
      lastSeen: "2026-07-20T20:00:00Z",
      isSelf: false,
    },
  ]);
});

test("returns an empty list for empty or structurally empty status JSON", () => {
  assert.deepEqual(parseTailscaleDevices(""), []);
  assert.deepEqual(parseTailscaleDevices("{}"), []);
});

test("rejects garbage JSON with a stable typed reason", () => {
  assert.throws(() => parseTailscaleDevices("not-json"), /tailscale status returned invalid JSON/);
});
