import { createHash } from "node:crypto";
import path from "node:path";
import { bindingFor, loadConfig } from "@/lib/cave-config";
import { loadProjects } from "@/lib/cave-projects";
import { caveHome } from "@/lib/coven-paths";
import { canonicalHarnessId } from "@/lib/harness-adapters";
import { isSshRuntime } from "@/lib/familiar-runtime";
import { listAccessibleProjects, describePrivateStateWriteOverlap } from "@/lib/project-permissions";
import { covenRunSupportsWriteScope } from "../send/chat-send-capabilities";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import { readJsonBody, rejectNonLocalOrMobileRequest } from "@/lib/server/api-security";
import { createSignalSweepStore } from "@/lib/server/signal-sweep-store";
import { listSelfReports } from "@/lib/server/familiar-self-reports";
import { latestSignalReports, signalSweepIsPresent } from "@/lib/signal-sweep-identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Advisory only: preparing a signal fix never grants access or launches a
 * model. Chat/send remains authoritative after the handoff and on every retry. */
async function access(familiarId: string) {
  const config = await loadConfig();
  const binding = bindingFor(config, familiarId);
  const harness = canonicalHarnessId(binding.harness);
  const projects = await listAccessibleProjects(await loadProjects(), familiarId);
  let writeScopeSupported: boolean | null = null;
  let error: string | undefined;
  if (harness === "claude" && !isSshRuntime(binding.runtime)) {
    const supported = await covenRunSupportsWriteScope();
    writeScopeSupported = supported;
    if (!supported) error = "Claude on this runtime cannot enforce project write access. Choose a compatible runtime before starting a signal fix.";
    if (!error) {
      const overlap = await describePrivateStateWriteOverlap({ familiarId,
        familiarName: binding.display_name?.trim() || familiarId,
        writableProjects: projects.filter((entry) => entry.access === "write").map((entry) => entry.project),
        primaryRoot: "",
      });
      error = overlap?.message;
    }
  }
  const revision = hash([harness, binding.runtime, binding.model, writeScopeSupported,
    projects.map(({ project, access }) => [project.id, project.root, access]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
  return { ok: true as const, available: !error, revision, ...(error ? { error } : {}) };
}

export async function GET(req: Request) {
  const familiarId = new URL(req.url).searchParams.get("familiarId") ?? "";
  if (!isValidFamiliarId(familiarId)) return Response.json({ ok: false, error: "Choose a valid familiar." }, { status: 400 });
  try { return Response.json(await access(familiarId)); }
  catch { return Response.json({ ok: false, error: "Couldn’t check signal fix access. Check again before starting a thread." }, { status: 503 }); }
}

export async function POST(req: Request) {
  const rejected = rejectNonLocalOrMobileRequest(req);
  if (rejected) return rejected;
  const parsed = await readJsonBody<Record<string, unknown>>(req, 32_768);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  if (!body || typeof body.familiarId !== "string" || !isValidFamiliarId(body.familiarId)) {
    return Response.json({ ok: false, error: "Choose a valid familiar." }, { status: 400 });
  }
  const store = createSignalSweepStore(path.join(/* turbopackIgnore: true */ caveHome(), "signal-fixes", `${hash(body.familiarId)}.json`));
  try {
    if (body.action === "release" || body.action === "commit") {
      if (typeof body.requestId !== "string" || !/^[a-f0-9-]{36}$/.test(body.requestId)) return Response.json({ ok: false, error: "Invalid fix receipt." }, { status: 400 });
      if (body.action === "release") await store.release(body.requestId);
      else await store.commit(body.requestId);
      return Response.json({ ok: true });
    }
    if (body.action !== "prepare" || typeof body.sourceReportId !== "string" || !body.sourceReportId || body.sourceReportId.length > 256
      || !Array.isArray(body.identities) || body.identities.length < 1 || body.identities.length > 100
      || body.identities.some((identity) => typeof identity !== "string" || identity.length < 1 || identity.length > 512)
      || (body.expectedPrevious !== undefined && (!body.expectedPrevious || typeof body.expectedPrevious !== "object" || Array.isArray(body.expectedPrevious)
        || Object.keys(body.expectedPrevious).length > 100 || Object.values(body.expectedPrevious).some((value) => typeof value !== "string" || !/^[a-f0-9-]{36}$/.test(value))))) {
      return Response.json({ ok: false, error: "Choose valid signals to fix." }, { status: 400 });
    }
    const checked = await access(body.familiarId);
    if (!checked.available) return Response.json({ ok: false, error: checked.error }, { status: 409 });
    const { reports } = await listSelfReports(body.familiarId, { limit: "all" });
    const identities = body.identities as string[];
    const source = latestSignalReports(reports.filter((report) => report.familiarId === body.familiarId)).find((report) => report.id === body.sourceReportId);
    if (!source || identities.some((identity) => !signalSweepIsPresent(identity, source))) {
      return Response.json({ ok: false, error: "This signal is not in its current source report. Refresh thread signals before requesting a fix." }, { status: 409 });
    }
    const result = await store.prepare(body.familiarId, identities, checked.revision, body.expectedPrevious as Record<string, string> | undefined);
    return Response.json(result, { status: result.ok ? 200 : 409 });
  } catch { return Response.json({ ok: false, error: "Couldn’t establish a signal fix receipt. Review existing fix threads before checking again." }, { status: 503 }); }
}
