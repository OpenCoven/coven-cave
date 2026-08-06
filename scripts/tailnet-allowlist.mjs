#!/usr/bin/env node
//
// Lists the tailnet devices this machine can see, with the stable node IDs the
// tailnet identity gate (cave-zm6pn) admits, and prints the env line to set.
//
//   node scripts/tailnet-allowlist.mjs                 # list devices
//   node scripts/tailnet-allowlist.mjs my-phone my-laptop   # emit env for these
//
// Match is by prefix against the device's short DNS name or hostname, so
// `my-phone` is enough. Stable node IDs are what the gate stores because they
// survive IP changes, renames, and re-authentication — a hostname or IP does
// not.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TAILSCALE_BIN = process.env.COVEN_CAVE_TAILSCALE_BIN ?? "tailscale";

function shortName(peer) {
  const dns = (peer.DNSName ?? "").replace(/\.$/, "");
  return dns.split(".")[0] || peer.HostName || "";
}

async function main() {
  let status;
  try {
    const { stdout } = await execFileAsync(TAILSCALE_BIN, ["status", "--json"], {
      maxBuffer: 16 * 1024 * 1024,
    });
    status = JSON.parse(stdout);
  } catch (err) {
    console.error(`tailnet-allowlist: could not read tailscale status: ${err?.message ?? err}`);
    console.error("Is Tailscale running? Set COVEN_CAVE_TAILSCALE_BIN if it is not on PATH.");
    process.exit(1);
  }

  const peers = Object.values(status.Peer ?? {})
    .map((peer) => ({
      id: peer.ID,
      name: shortName(peer),
      os: peer.OS ?? "",
      online: Boolean(peer.Online),
      ips: peer.TailscaleIPs ?? [],
    }))
    .filter((peer) => peer.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  const wanted = process.argv.slice(2);
  if (wanted.length === 0) {
    if (peers.length === 0) {
      console.log("No tailnet peers visible.");
      return;
    }
    console.log("Tailnet devices (stable node ID is what the allowlist stores):\n");
    for (const peer of peers) {
      const mark = peer.online ? "●" : "○";
      const os = peer.os ? ` ${peer.os}` : "";
      console.log(`  ${mark} ${peer.name.padEnd(24)} ${peer.id}${os}`);
      console.log(`    ${peer.ips.join("  ")}`);
    }
    console.log("\n● online  ○ offline");
    console.log("\nTo allow specific devices, re-run with their names:");
    console.log(`  node scripts/tailnet-allowlist.mjs ${peers[0].name}`);
    return;
  }

  const selected = [];
  const missing = [];
  for (const want of wanted) {
    const match = peers.find(
      (peer) => peer.name === want || peer.name.startsWith(want) || peer.id === want,
    );
    if (match) selected.push(match);
    else missing.push(want);
  }

  if (missing.length > 0) {
    console.error(`tailnet-allowlist: no tailnet device matched: ${missing.join(", ")}`);
    console.error("Run with no arguments to list what is visible.");
    process.exit(1);
  }

  for (const peer of selected) {
    console.error(`# ${peer.name} -> ${peer.id}`);
  }
  console.log(`COVEN_CAVE_TAILNET_ALLOWED_NODES=${selected.map((peer) => peer.id).join(",")}`);
}

await main();
