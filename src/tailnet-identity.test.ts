// @ts-nocheck
//
// Tailnet identity gate (cave-zm6pn). Remote access is authorized by per-device
// Tailscale identity instead of a shared pairing secret. Two halves are tested
// here:
//
//   1. Behavior — verifiedTailnetNode, exercised with concrete inputs so a
//      refactor that keeps the source text but breaks the stamp is still
//      caught.
//   2. Source pinning of server.ts, which is the ONLY component that can mint
//      the stamp (it alone sees the raw socket) and which cannot import from
//      src/ — esbuild emits server.mjs with --bundle=false — so the invariants
//      are duplicated there and must be held in agreement by assertion.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  verifiedTailnetNode,
  TAILNET_PEER_HEADER,
} from "./proxy-helpers.ts";

// ─── verifiedTailnetNode ───────────────────────────────────────────────────
const SECRET = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
const NODE = "nEXAMPLE0000011CNTRL";

assert.equal(
  verifiedTailnetNode(`${SECRET}:${NODE}`, SECRET),
  NODE,
  "a stamp bearing the per-boot secret yields the node id",
);

// The whole point of the stamp: a client cannot forge it, because the secret
// never leaves server.ts. These are the shapes an attacker actually controls.
assert.equal(
  verifiedTailnetNode(`wrong-secret:${NODE}`, SECRET),
  null,
  "a stamp with the wrong secret is refused",
);
assert.equal(
  verifiedTailnetNode(NODE, SECRET),
  null,
  "a bare node id with no secret is refused",
);
assert.equal(
  verifiedTailnetNode(`:${NODE}`, SECRET),
  null,
  "an empty secret segment is refused",
);
assert.equal(
  verifiedTailnetNode(`${SECRET}:`, SECRET),
  null,
  "an empty node id is refused",
);
assert.equal(verifiedTailnetNode(null, SECRET), null, "an absent header is refused");
assert.equal(verifiedTailnetNode("", SECRET), null, "an empty header is refused");

// Next running without server.ts in front has no secret to compare against.
// That must deny rather than admit — otherwise the gate opens exactly when the
// component that enforces it is missing.
assert.equal(
  verifiedTailnetNode(`${SECRET}:${NODE}`, undefined),
  null,
  "an unset per-boot secret fails closed",
);
assert.equal(
  verifiedTailnetNode(`${SECRET}:${NODE}`, ""),
  null,
  "an empty per-boot secret fails closed",
);

// Split on the FIRST colon only: the secret is a UUID (no colons) but node ids
// are opaque and must survive verbatim.
assert.equal(
  verifiedTailnetNode(`${SECRET}:node:with:colons`, SECRET),
  "node:with:colons",
  "only the first colon separates secret from node id",
);

// ─── server.ts source pinning ──────────────────────────────────────────────
const src = readFileSync(new URL("../server.ts", import.meta.url), "utf8");

assert.match(
  src,
  /const TAILNET_PEER_HEADER = "x-coven-cave-tailnet-peer";/,
  "server.ts must use the same header name as src/proxy-helpers.ts (it cannot import it)",
);
assert.equal(
  TAILNET_PEER_HEADER,
  "x-coven-cave-tailnet-peer",
  "the src/ mirror of the header name must match server.ts",
);
assert.match(
  src,
  /const TAILNET_PEER_SECRET = randomUUID\(\);\s*process\.env\.COVEN_CAVE_TAILNET_PEER_SECRET = TAILNET_PEER_SECRET;/,
  "the stamp secret is minted fresh per boot and never inherited from ambient env",
);

// Any client-supplied copy of the header must die before Next sees the request,
// or the stamp proves nothing at all.
assert.match(
  src,
  /delete req\.headers\[TAILNET_PEER_HEADER\];/,
  "a client-supplied tailnet stamp is stripped before Next handles the request",
);

// Fail-closed shape: no allowlist means no tailnet access, and an unreadable
// `tailscale status` must clear the map rather than leave a stale one standing
// (otherwise a revoked device keeps working for as long as the CLI is broken).
assert.match(
  src,
  /if \(allowed\.size === 0\) \{\s*tailnetPeerAddresses = new Map\(\);\s*return;\s*\}/,
  "an empty allowlist disables tailnet access entirely",
);
assert.match(
  src,
  /catch \(err\) \{[\s\S]*?tailnetPeerAddresses = new Map\(\);/,
  "a failed tailnet refresh clears the allowlist instead of keeping stale entries",
);

// The peer must be loopback (Serve forwards over loopback), the forwarded hop
// must be a Tailscale CGNAT address, and it must map to an allowlisted node.
// Dropping any one of these turns the gate into a client-controlled header.
assert.match(
  src,
  /function resolveTailnetPeer\(req: IncomingMessage\): string \| null \{\s*if \(tailnetPeerAddresses\.size === 0\) return null;\s*if \(!isLoopbackAddress\(req\.socket\.remoteAddress\)\) return null;/,
  "tailnet resolution requires a socket-verified loopback peer and a non-empty allowlist",
);
assert.match(
  src,
  /if \(!isTailscaleAddress\(address\)\) return null;/,
  "the forwarded hop must be a Tailscale CGNAT address",
);
assert.match(
  src,
  /return tailnetPeerAddresses\.get\(address\) \?\? null;/,
  "only an address currently mapped to an allowlisted node resolves",
);

// The allowlist is by STABLE node id — not hostname, not IP, both of which move.
assert.match(
  src,
  /if \(!nodeId \|\| !allowed\.has\(nodeId\)\) continue;/,
  "peers are admitted by stable node id membership in the allowlist",
);

console.log("tailnet-identity.test.ts: ok");
