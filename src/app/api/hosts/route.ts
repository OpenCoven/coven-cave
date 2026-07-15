import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { hostname } from "node:os";
import { loadConfig, saveConfig } from "@/lib/cave-config";
import { chatHostOptions, sshHostRegistry, type ChatHostOption } from "@/lib/chat-hosts";
import { isSshRuntime, normalizeFamiliarRuntime } from "@/lib/familiar-runtime";
import { OmnigentClient } from "@/lib/omnigent/client";
import { omnigentHostOptionId } from "@/lib/omnigent/ids";
import { rejectNonLocalRequest } from "@/lib/server/api-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Fast per-host reachability probe. BatchMode keeps it from hanging on a
 *  password prompt (key auth is the supported path, same as ssh-check). */
const PROBE_TIMEOUT_MS = 3_500;

function probeSshHost(host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = execFile(
      "ssh",
      ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=3", "--", host, "true"],
      { timeout: PROBE_TIMEOUT_MS },
      (error) => resolve(!error),
    );
    child.on("error", () => resolve(false));
  });
}

function registryFromConfig(config: Awaited<ReturnType<typeof loadConfig>>) {
  return sshHostRegistry({
    remoteHosts: config.remoteHosts,
    familiarRuntimes: Object.values(config.familiars ?? {}).map((binding) => binding?.runtime),
  });
}

async function omnigentHostOptions(
  config: Awaited<ReturnType<typeof loadConfig>>,
): Promise<ChatHostOption[]> {
  if (!config.omnigent.baseUrl || !config.omnigent.exposeHostsInComposer) return [];
  try {
    const client = await OmnigentClient.fromBaseUrl(config.omnigent.baseUrl);
    // Fleet gate: no auth token (tokenless local mode) → no omnigent options
    // in the chip. Mirrors isFleetTokenPresent in @/lib/omnigent/fleet-gate.
    if (!client.authenticated || client.authMode === "none") return [];
    const hosts = await client.listHosts();
    return hosts.map((h) => {
      const online = (h.status ?? "").toLowerCase() === "online";
      const label = h.name?.trim() || h.host_id.slice(0, 14);
      return {
        id: omnigentHostOptionId(h.host_id),
        kind: "omnigent" as const,
        label: `Omnigent · ${label}`,
        online,
      };
    });
  } catch {
    return [];
  }
}

/**
 * GET /api/hosts — the chat host picker's registry: this machine plus every
 * registered ssh host, each ssh host annotated with a live reachability probe
 * (skip with ?probe=0 for an instant list). When Omnigent is configured,
 * fleet hosts are appended as omnigent:<host_id> options.
 */
export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const config = await loadConfig();
  const registry = registryFromConfig(config);
  const options = chatHostOptions({ localLabel: hostname(), registry });

  const probe = new URL(req.url).searchParams.get("probe") !== "0";
  let hosts: ChatHostOption[] = options;
  if (probe) {
    const results = await Promise.all(
      options.map(async (option) =>
        option.kind === "ssh" ? { ...option, online: await probeSshHost(option.id) } : option,
      ),
    );
    hosts = results;
  }

  const fleet = await omnigentHostOptions(config);
  if (fleet.length) hosts = [...hosts, ...fleet];

  return NextResponse.json({ ok: true, hosts });
}

/**
 * POST /api/hosts — register a new remote host for chat execution. Validates
 * the host shape, probes reachability (BatchMode ssh), then persists it to
 * config.remoteHosts. The remote `command` is intentionally NOT accepted from
 * the client here — hosts registered through the picker run the default
 * `coven`; custom commands stay a config-file/onboarding concern.
 */
export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  let body: { host?: unknown; cwd?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  const candidate = normalizeFamiliarRuntime({
    kind: "ssh",
    host: typeof body.host === "string" ? body.host : "",
    cwd: typeof body.cwd === "string" && body.cwd.trim() ? body.cwd : "~",
  });
  if (!isSshRuntime(candidate)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Host must be an SSH alias or hostname (letters, digits, dots, underscores, dashes, colons).",
      },
      { status: 400 },
    );
  }

  const reachable = await probeSshHost(candidate.host);
  if (!reachable) {
    return NextResponse.json(
      {
        ok: false,
        error: `Couldn't reach '${candidate.host}' non-interactively. Run \`ssh ${candidate.host}\` once to trust the host key and confirm key-based auth works.`,
      },
      { status: 502 },
    );
  }

  const config = await loadConfig();
  await saveConfig({
    remoteHosts: [
      ...config.remoteHosts.filter((entry) => entry.host !== candidate.host),
      { host: candidate.host, cwd: candidate.cwd },
    ],
  });
  return NextResponse.json({ ok: true, host: { host: candidate.host, cwd: candidate.cwd } });
}

/**
 * DELETE /api/hosts — unregister a remote host (body: { host }). The route
 * existed for GET/POST only, leaving no removal path anywhere (cave-4zdp).
 * Conversations recorded on the removed host fail closed at send time with a
 * re-pick error rather than silently running locally.
 */
export async function DELETE(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  let body: { host?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const host = typeof body.host === "string" ? body.host.trim() : "";
  if (!host) {
    return NextResponse.json({ ok: false, error: "host is required" }, { status: 400 });
  }
  const config = await loadConfig();
  if (!config.remoteHosts.some((entry) => entry.host === host)) {
    return NextResponse.json({ ok: false, error: `host '${host}' is not registered` }, { status: 404 });
  }
  await saveConfig({ remoteHosts: config.remoteHosts.filter((entry) => entry.host !== host) });
  return NextResponse.json({ ok: true });
}
