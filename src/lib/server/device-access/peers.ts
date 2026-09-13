import { execFile } from "node:child_process";
import { isIP } from "node:net";
import { promisify } from "node:util";
import type { IncomingMessage } from "node:http";
import { tailscaleBin, tailscaleSpawnEnv } from "../../mobile-handoff.ts";
import type { DevicePeer } from "./contract.ts";

const exec = promisify(execFile);
export const DEVICE_PEER_REFRESH_MS = 10_000;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function identifier(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return text(value);
}

export function tailnetFromDnsName(value: unknown): string | null {
  const name = text(value)?.toLowerCase().replace(/\.$/, "");
  if (!name || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.ts\.net$/.test(name)) {
    return null;
  }
  return name.slice(name.indexOf(".") + 1);
}

export type DevicePeerInventory = {
  host: string;
  tailnet: string;
  peers: Map<string, DevicePeer>;
};

export function parseDevicePeerInventory(value: unknown, now = Date.now()): DevicePeerInventory {
  const status = record(value);
  const self = record(status?.Self);
  const host = text(self?.DNSName)?.toLowerCase().replace(/\.$/, "");
  const tailnet = tailnetFromDnsName(host);
  if (status?.BackendState !== "Running" || !host || !tailnet) {
    throw new Error("Tailscale must be running with a verified MagicDNS identity.");
  }
  const users = record(status.User);
  const peers = new Map<string, DevicePeer>();
  for (const raw of Object.values(record(status.Peer) ?? {})) {
    const peer = record(raw);
    const nodeId = text(peer?.ID);
    const userId = identifier(peer?.UserID);
    const loginName = userId ? text(record(users?.[userId])?.LoginName) : null;
    const peerTailnet = tailnetFromDnsName(peer?.DNSName);
    const expiry = text(peer?.KeyExpiry);
    if (!peer || !nodeId || !userId || !loginName || !peerTailnet
      || peer.Expired === true || (Array.isArray(peer.Tags) && peer.Tags.length > 0)
      || (expiry && (!Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) <= now))) continue;
    const identity: DevicePeer = {
      nodeId,
      userId,
      loginName,
      tailnet: peerTailnet,
      deviceName: text(peer.HostName) ?? text(peer.DNSName) ?? nodeId,
    };
    for (const ip of Array.isArray(peer.TailscaleIPs) ? peer.TailscaleIPs : []) {
      if (typeof ip !== "string" || !isIP(ip)) continue;
      if (peers.has(ip)) throw new Error("Tailscale reported an ambiguous device address.");
      peers.set(ip, identity);
    }
  }
  return { host, tailnet, peers };
}

export function resolveDevicePeer(
  req: IncomingMessage,
  inventory: DevicePeerInventory,
): DevicePeer | null {
  const remote = req.socket.remoteAddress;
  if (remote !== "127.0.0.1" && remote !== "::1" && remote !== "::ffff:127.0.0.1") return null;
  // Serve overwrites these headers. Reject chains, Funnel, and aliases rather
  // than choosing an attacker-controlled hop or trusting a hostname as identity.
  if (req.headers["tailscale-funnel-request"] !== undefined
    || req.headers["x-forwarded-proto"] !== "https") return null;
  const address = req.headers["x-forwarded-for"];
  if (typeof address !== "string" || !isIP(address)) return null;
  const host = req.headers["x-forwarded-host"];
  if (typeof host !== "string") return null;
  let url: URL;
  try {
    url = new URL(`https://${host}`);
  } catch {
    return null;
  }
  if (url.hostname !== inventory.host || url.username || url.password || url.pathname !== "/") return null;
  const peer = inventory.peers.get(address);
  if (!peer || req.headers["tailscale-user-login"] !== peer.loginName) return null;
  return peer;
}

export function createDevicePeerResolver(
  load: () => Promise<unknown> = async () => {
    const { stdout } = await exec(tailscaleBin(), ["status", "--json"], {
      encoding: "utf8", timeout: 5_000, maxBuffer: 2 * 1024 * 1024,
      windowsHide: true, env: tailscaleSpawnEnv(),
    });
    return JSON.parse(stdout);
  },
  now: () => number = Date.now,
) {
  let cached: DevicePeerInventory | null = null;
  let validUntil = 0;
  let loading: Promise<DevicePeerInventory> | null = null;
  return async (): Promise<DevicePeerInventory> => {
    if (cached && now() < validUntil) return cached;
    if (loading) return loading;
    cached = null;
    validUntil = 0;
    loading = load().then((raw) => {
      const parsed = parseDevicePeerInventory(raw, now());
      cached = parsed;
      validUntil = now() + DEVICE_PEER_REFRESH_MS;
      return parsed;
    });
    try {
      return await loading;
    } finally {
      loading = null;
    }
  };
}
