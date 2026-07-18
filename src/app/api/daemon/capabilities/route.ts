import { NextResponse } from "next/server";
import { callDaemon, extractDaemonError, type DaemonResponse } from "@/lib/coven-daemon";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The daemon's control-plane capability catalog, served at the exact
// GET /api/v1/capabilities path (coven `control_plane::capabilities()`).
//
// This is deliberately distinct from the harness capability *manifests* at
// `/api/capabilities` (skills/plugins per adapter). This catalog describes the
// daemon's own control-plane features and the actions each one can route —
// i.e. it is the capability-negotiation surface Cave uses to feature-detect
// what the connected daemon can actually do before offering it in the UI.
//
// Field casing mirrors the Rust `#[serde(rename_all = "camelCase")]` output.
export type DaemonCapabilityStatus = "available" | "planned";
export type DaemonCapabilityPolicy = "allow" | "requiresApproval";

export type DaemonCapability = {
  id: string;
  label: string;
  adapter: string;
  status: DaemonCapabilityStatus;
  policy: DaemonCapabilityPolicy;
  actions: string[];
};

export type DaemonCapabilityCatalog = {
  capabilities: DaemonCapability[];
};

export type DaemonCapabilitiesResponse = {
  ok: boolean;
  // Whether the daemon answered at all (reachable), independent of whether it
  // serves the control-plane catalog. Lets the UI distinguish "daemon offline"
  // from "daemon up but too old to expose control-plane capabilities".
  running: boolean;
  capabilities: DaemonCapability[];
  // Flattened, de-duped action ids across every available capability — the set
  // of control actions Cave may POST to /api/v1/actions on this daemon.
  actions: string[];
  fetchedAt: string;
  error?: string;
};

function isCatalog(data: unknown): data is DaemonCapabilityCatalog {
  return Boolean(
    data &&
      typeof data === "object" &&
      Array.isArray((data as DaemonCapabilityCatalog).capabilities),
  );
}

// A status of 0 or a connection-level error string means the socket/hub never
// answered — the daemon is genuinely offline, not merely lacking the catalog.
function daemonOffline(res: DaemonResponse<unknown>): boolean {
  return (
    res.status === 0 ||
    (res.error != null && /(ENOENT|ECONNREFUSED|ETIMEDOUT|socket|connect)/i.test(res.error))
  );
}

export async function GET() {
  const res = await callDaemon<DaemonCapabilityCatalog>({
    path: "/api/v1/capabilities",
    timeoutMs: 1500,
  });
  const fetchedAt = new Date().toISOString();

  // Some daemons answer the same exact path with the harness-manifest aggregate
  // ({ harness_capabilities: [...] }), which carries no `capabilities` array.
  // Validate the shape so we surface the real catalog or a truthful degradation
  // rather than passing an unrelated payload through as if it were the catalog.
  if (res.ok && isCatalog(res.data)) {
    const capabilities = res.data.capabilities;
    const actions = [
      ...new Set(
        capabilities
          .filter((c) => c.status === "available")
          .flatMap((c) => c.actions ?? []),
      ),
    ];
    return NextResponse.json({
      ok: true,
      running: true,
      capabilities,
      actions,
      fetchedAt,
    } satisfies DaemonCapabilitiesResponse);
  }

  if (daemonOffline(res)) {
    return NextResponse.json(
      {
        ok: false,
        running: false,
        capabilities: [],
        actions: [],
        fetchedAt,
        error: "daemon offline",
      } satisfies DaemonCapabilitiesResponse,
      { status: 503 },
    );
  }

  // Reachable, but no recognizable control-plane catalog — the daemon is
  // healthy yet predates (or does not expose) this surface. Report it as a
  // non-error informational state so the UI can hide catalog-gated affordances
  // without claiming an outage.
  return NextResponse.json({
    ok: false,
    running: true,
    capabilities: [],
    actions: [],
    fetchedAt,
    error:
      extractDaemonError(res) ??
      "daemon does not expose a control-plane capability catalog",
  } satisfies DaemonCapabilitiesResponse);
}
