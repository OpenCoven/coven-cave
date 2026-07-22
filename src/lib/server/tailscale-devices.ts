import { execFile } from "node:child_process";
import { tailscaleBin, tailscaleSpawnEnv } from "../mobile-handoff.ts";

export type TailscaleDevice = {
  name: string;
  dnsName: string | null;
  hostName: string | null;
  tailnetIp: string | null;
  os: string | null;
  online: boolean;
  lastSeen: string | null;
  isSelf: boolean;
};

type RawDevice = {
  HostName?: unknown;
  DNSName?: unknown;
  TailscaleIPs?: unknown;
  OS?: unknown;
  Online?: unknown;
  LastSeen?: unknown;
};

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function deviceFromStatus(value: unknown, isSelf: boolean): TailscaleDevice | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as RawDevice;
  const hostName = optionalString(raw.HostName);
  const dnsName = optionalString(raw.DNSName)?.replace(/\.+$/, "") ?? null;
  const ips = Array.isArray(raw.TailscaleIPs) ? raw.TailscaleIPs : [];
  const tailnetIp = ips.find((ip): ip is string => typeof ip === "string" && /^100(?:\.\d{1,3}){3}$/.test(ip)) ?? null;
  const name = hostName ?? dnsName ?? tailnetIp;
  if (!name) return null;
  return {
    name,
    dnsName,
    hostName,
    tailnetIp,
    os: optionalString(raw.OS),
    online: isSelf || raw.Online === true,
    lastSeen: optionalString(raw.LastSeen),
    isSelf,
  };
}

export function parseTailscaleDevices(rawJson: string): TailscaleDevice[] {
  if (!rawJson.trim()) return [];
  let status: unknown;
  try {
    status = JSON.parse(rawJson);
  } catch {
    throw new Error("tailscale status returned invalid JSON");
  }
  if (!status || typeof status !== "object" || Array.isArray(status)) return [];
  const record = status as { Self?: unknown; Peer?: unknown };
  const self = deviceFromStatus(record.Self, true);
  const peers = record.Peer && typeof record.Peer === "object" && !Array.isArray(record.Peer)
    ? Object.values(record.Peer as Record<string, unknown>)
        .map((peer) => deviceFromStatus(peer, false))
        .filter((peer): peer is TailscaleDevice => peer !== null)
        .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
    : [];
  return self ? [self, ...peers] : peers;
}

export type TailscaleDevicesResult =
  | { ok: true; devices: TailscaleDevice[] }
  | { ok: false; reason: string };

function typedTailscaleFailure(error: { code?: string | number | null; message: string }, output: string): string {
  if (error.code === "ENOENT") return "Tailscale CLI not found";
  const detail = `${output} ${error.message}`.toLowerCase();
  if (detail.includes("logged out") || detail.includes("signed out") || detail.includes("not logged in")) {
    return "Tailscale is signed out";
  }
  if (detail.includes("not running") || detail.includes("stopped") || detail.includes("failed to connect to local tailscaled")) {
    return "Tailscale is not running";
  }
  return "Tailscale status unavailable";
}

export function loadTailscaleDevices(timeoutMs = 5000): Promise<TailscaleDevicesResult> {
  return new Promise((resolve) => {
    execFile(
      tailscaleBin(),
      ["status", "--json"],
      { encoding: "utf8", timeout: timeoutMs, env: tailscaleSpawnEnv(), maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          resolve({ ok: false, reason: typedTailscaleFailure(error, `${stdout} ${stderr}`) });
          return;
        }
        try {
          resolve({ ok: true, devices: parseTailscaleDevices(stdout) });
        } catch (parseError) {
          resolve({
            ok: false,
            reason: parseError instanceof Error ? parseError.message : "Tailscale status unavailable",
          });
        }
      },
    );
  });
}
