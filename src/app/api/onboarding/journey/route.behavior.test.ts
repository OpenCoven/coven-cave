import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CaveConfig } from "@/lib/cave-config";
import { advanceFirstUse, createFirstUseState, createQuickStartState } from "@/lib/first-use";
import { updateFirstUseState } from "@/lib/server/first-use-store";
import { inspectFirstUseContext } from "@/lib/server/first-use-context";
import { GET, POST } from "./route";

const fixture = vi.hoisted(() => ({
  config: { defaults: { harness: "hermes", model: "", runtime: { kind: "local" } }, familiars: {}, inferenceRoutes: {} } as unknown as CaveConfig,
  env: { NODE_ENV: "test", PATH: "" } as NodeJS.ProcessEnv,
  grants: [] as Array<{ familiarId: string; projectId: string; access: "read" | "write" }>,
  groups: [] as Array<{ id: string; name: string; memberFamiliarIds: string[]; projectGrants: Array<{ projectId: string; access: "read" | "write" }> }>,
  supreme: "nova" as string | null,
  visible: true,
  rosterAvailable: true,
  projectRoot: "/synthetic/practice",
  projectValid: true,
  gatewayAuth: false,
  openClawEnv: { NODE_ENV: "test", PATH: "" } as NodeJS.ProcessEnv,
  openClawLaunch: { command: "openclaw", fixedArgs: [] } as { command: string; fixedArgs: string[]; requiredFiles?: string[] },
}));
vi.mock("@/lib/cave-projects", () => ({ loadProjects: async () => [{ id: "p", name: "Practice", root: fixture.projectRoot }] }));
vi.mock("@/lib/project-permissions", async (original) => ({
  ...await original<typeof import("@/lib/project-permissions")>(),
  loadProjectPermissions: async () => ({ projectGrants: fixture.grants, accessGroups: fixture.groups }),
  loadHumanPermissionConfig: async () => ({ supremeFamiliarId: fixture.supreme }),
}));
vi.mock("@/lib/server/familiar-roster", () => ({ loadVisibleFamiliarRoster: async () => fixture.rosterAvailable
  ? { ok: true, config: fixture.config, roster: fixture.visible ? [{ id: "nova", display_name: "Nova", role: "General" }] : [] }
  : { ok: false, config: fixture.config, status: 503, error: "Roster unavailable" } }));
vi.mock("@/lib/server/project-paths", () => ({ validateCaveProjectRootAsync: async (root: string) => fixture.projectValid ? ({ ok: true, root }) : ({ ok: false, error: "Project unavailable" }) }));
vi.mock("@/lib/harness-spawn-env", () => ({ harnessSpawnEnv: () => fixture.env, warmHarnessSpawnPath: async () => {} }));
vi.mock("@/lib/openclaw-gateway", () => ({ openClawGatewayPairedDeviceAuthStatus: () => ({ available: fixture.gatewayAuth }) }));
vi.mock("@/lib/openclaw-bin", () => ({ openClawLaunchCommand: () => fixture.openClawLaunch, openClawSpawnEnv: () => fixture.openClawEnv }));
vi.mock("@/lib/server/first-use-store", async (original) => ({
  ...await original<typeof import("@/lib/server/first-use-store")>(),
  readFirstUseState: async () => ({ ...createFirstUseState(), revision: 2, step: "access", defaults: { projectId: "p", familiarIds: ["nova"], actingFamiliarId: "nova" } }),
  updateFirstUseState: vi.fn(() => { throw new Error("A refused access review must not write state"); }),
}));

const defaults = { projectId: "p", familiarIds: ["nova"], actingFamiliarId: "nova" };
function runtimeRequest(id = "nova", host = "localhost", projectId = "p") {
  return new Request(`http://${host}/api/onboarding/journey?runtimeFamiliarId=${encodeURIComponent(id)}&projectId=${encodeURIComponent(projectId)}`, { headers: { host } });
}
beforeEach(() => {
  vi.mocked(updateFirstUseState).mockReset().mockImplementation(async () => { throw new Error("A refused setup change must not write state"); });
  fixture.config = { defaults: { harness: "hermes", model: "", runtime: { kind: "local" } }, familiars: {}, inferenceRoutes: {} } as unknown as CaveConfig;
  fixture.env = { NODE_ENV: "test", PATH: "" };
  fixture.grants = [];
  fixture.groups = [];
  fixture.supreme = "nova";
  fixture.visible = true;
  fixture.rosterAvailable = true;
  fixture.projectRoot = "/synthetic/practice";
  fixture.projectValid = true;
  fixture.gatewayAuth = false;
  fixture.openClawEnv = { NODE_ENV: "test", PATH: "" };
  fixture.openClawLaunch = { command: "openclaw", fixedArgs: [] };
  vi.stubEnv("OPENCLAW_GATEWAY_DISPATCH", "0");
  vi.stubEnv("OPENCLAW_GATEWAY_URL", "");
});
afterEach(() => vi.unstubAllEnvs());

test.each(["direct", "group"])("a supreme designation preserves an actual %s Read grant", async (source) => {
  if (source === "direct") fixture.grants = [{ familiarId: "nova", projectId: "p", access: "read" }];
  else fixture.groups = [{ id: "readers", name: "Readers", memberFamiliarIds: ["nova"], projectGrants: [{ projectId: "p", access: "read" }] }];
  const inspection = await inspectFirstUseContext(defaults);
  expect(inspection.access[0]).toMatchObject({ familiarId: "nova", level: "read", supreme: true });
  expect(inspection.resolution.kind).toBe("ready");
  const response = await POST(new Request("http://localhost/api/onboarding/journey", {
    method: "POST", headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ revision: 2, action: { kind: "review-access", permissionMode: "full" } }),
  }));
  expect(response.status).toBe(409);
});

test("short setup cannot complete Full access against an actual Read grant", async () => {
  fixture.grants = [{ familiarId: "nova", projectId: "p", access: "read" }];
  const response = await POST(new Request("http://localhost/api/onboarding/journey", {
    method: "POST", headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ revision: 2, action: { kind: "finish-setup", defaults, permissionMode: "full" } }),
  }));
  expect(response.status).toBe(409);
});

test.each(["read", "full"] as const)("short setup persists reviewed %s mode only with live project and runtime evidence", async (permissionMode) => {
  fixture.grants = [{ familiarId: "nova", projectId: "p", access: permissionMode === "full" ? "write" : "read" }];
  fixture.env = { NODE_ENV: "test", PATH: "", HERMES_BIN: process.execPath };
  const ready = advanceFirstUse(advanceFirstUse(createQuickStartState(), { kind: "choose-assistant", familiarId: "nova" }), { kind: "finish-setup", defaults, permissionMode });
  vi.mocked(updateFirstUseState).mockResolvedValueOnce(ready);
  const response = await POST(new Request("http://localhost/api/onboarding/journey", {
    method: "POST", headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ revision: 2, action: { kind: "finish-setup", defaults, permissionMode } }),
  }));
  expect(response.status).toBe(200);
  expect((await response.json()).state).toMatchObject({ version: 2, step: "complete", permissionMode, practice: { verified: false } });
});

test("short setup refuses completion when its configured runtime disappears", async () => {
  fixture.grants = [{ familiarId: "nova", projectId: "p", access: "write" }];
  const response = await POST(new Request("http://localhost/api/onboarding/journey", {
    method: "POST", headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ revision: 2, action: { kind: "finish-setup", defaults, permissionMode: "full" } }),
  }));
  expect(response.status).toBe(409);
  expect(vi.mocked(updateFirstUseState)).not.toHaveBeenCalled();
});

test("supreme designation without project grants remains an access repair", async () => {
  const inspection = await inspectFirstUseContext(defaults);
  expect(inspection.access[0]).toMatchObject({ level: null, direct: null, groups: [], supreme: true });
  expect(inspection.resolution).toMatchObject({ kind: "repair", reason: "access" });
});

test("an inherited write grant remains Full regardless of supreme designation", async () => {
  fixture.grants = [{ familiarId: "nova", projectId: "p", access: "read" }];
  fixture.groups = [{ id: "builders", name: "Builders", memberFamiliarIds: ["nova"], projectGrants: [{ projectId: "p", access: "write" }] }];
  expect((await inspectFirstUseContext(defaults)).access[0]).toMatchObject({ level: "write", direct: "read", groups: [{ groupName: "Builders", access: "write" }], supreme: true });
});

test("an unsaved actor with a supported SSH binding does not need its local CLI", async () => {
  fixture.config.defaults.harness = "claude";
  fixture.config.defaults.runtime = { kind: "ssh", host: "practice-host", cwd: "/remote/practice", command: "coven" };
  const response = await GET(runtimeRequest());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, runtime: { familiarId: "nova", harness: "claude", transport: "ssh", state: "ready" } });
});

test("bare Hermes with valid scoped API configuration does not need a local CLI or expose credentials", async () => {
  fixture.env = { NODE_ENV: "test", PATH: "", HERMES_API_URL: "http://127.0.0.1:8642/v1", HERMES_API_KEY: "synthetic-secret" };
  const response = await GET(runtimeRequest());
  expect(await response.json()).toEqual({ ok: true, runtime: { familiarId: "nova", harness: "hermes", transport: "api", state: "ready" } });
});

test.each([undefined, "bad\nkey"])("missing or invalid API configuration still requires an available local Hermes CLI", async (key) => {
  fixture.env = { NODE_ENV: "test", PATH: "", HERMES_API_URL: "http://127.0.0.1:8642/v1", HERMES_API_KEY: key };
  const response = await GET(runtimeRequest());
  expect(await response.json()).toEqual({ ok: true, runtime: { familiarId: "nova", harness: "hermes", transport: "local", state: "unavailable" } });
});

test("an available local Hermes command is accepted by the same passive launch check", async () => {
  fixture.env = { NODE_ENV: "test", PATH: "", HERMES_BIN: process.execPath };
  expect(await (await GET(runtimeRequest())).json()).toEqual({ ok: true, runtime: { familiarId: "nova", harness: "hermes", transport: "local", state: "ready" } });
});

test("relative Hermes PATH entries are resolved from the selected registered project", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "cave-guide-hermes-cwd-"));
  try {
    const bin = path.join(projectRoot, ".runtime", "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, "hermes"), "#!/bin/sh\nexit 99\n");
    await chmod(path.join(bin, "hermes"), 0o755);
    fixture.projectRoot = projectRoot;
    fixture.env = { NODE_ENV: "test", PATH: ".runtime/bin" };
    expect(await (await GET(runtimeRequest())).json()).toEqual({ ok: true, runtime: { familiarId: "nova", harness: "hermes", transport: "local", state: "ready" } });
  } finally { await rm(projectRoot, { recursive: true, force: true }); }
});

test("local runtime readiness requires the selected registered project and its valid directory", async () => {
  fixture.env = { NODE_ENV: "test", PATH: "", HERMES_BIN: process.execPath };
  expect((await GET(runtimeRequest("nova", "localhost", ""))).status).toBe(400);
  expect((await (await GET(runtimeRequest("nova", "localhost", "unknown"))).json()).runtime?.state).not.toBe("ready");
  fixture.projectValid = false;
  expect((await (await GET(runtimeRequest())).json()).runtime?.state).not.toBe("ready");
});

test("a configured paired Gateway is ready for OpenClaw without any local CLI", async () => {
  fixture.config.defaults.harness = "openclaw";
  fixture.gatewayAuth = true;
  vi.stubEnv("OPENCLAW_GATEWAY_DISPATCH", "true");
  vi.stubEnv("OPENCLAW_GATEWAY_URL", "wss://synthetic.example/gateway");
  expect(await (await GET(runtimeRequest())).json()).toEqual({ ok: true, runtime: { familiarId: "nova", harness: "openclaw", transport: "gateway", state: "ready" } });
});

test.each(["disabled", "missing-url", "unpaired"])("OpenClaw with an %s Gateway still needs its CLI fallback", async (reason) => {
  fixture.config.defaults.harness = "openclaw";
  fixture.gatewayAuth = reason !== "unpaired";
  vi.stubEnv("OPENCLAW_GATEWAY_DISPATCH", reason === "disabled" ? "0" : "1");
  vi.stubEnv("OPENCLAW_GATEWAY_URL", reason === "missing-url" ? "" : "wss://synthetic.example/gateway");
  expect(await (await GET(runtimeRequest())).json()).toEqual({ ok: true, runtime: { familiarId: "nova", harness: "openclaw", transport: "local", state: "unavailable" } });
});

test("OpenClaw's CLI fallback uses its own canonical spawn environment and required artifacts", async () => {
  fixture.config.defaults.harness = "openclaw";
  fixture.openClawLaunch = { command: path.basename(process.execPath), fixedArgs: [] };
  fixture.openClawEnv = { NODE_ENV: "test", PATH: path.dirname(process.execPath) };
  expect(await (await GET(runtimeRequest())).json()).toEqual({ ok: true, runtime: { familiarId: "nova", harness: "openclaw", transport: "local", state: "ready" } });
  fixture.openClawLaunch.requiredFiles = ["/synthetic/missing-launch-artifact.js"];
  expect(await (await GET(runtimeRequest())).json()).toEqual({ ok: true, runtime: { familiarId: "nova", harness: "openclaw", transport: "local", state: "unavailable" } });
});

test("profile-bound Hermes cannot borrow a bare API configuration to bypass its missing CLI", async () => {
  fixture.config.familiars.nova = { harness: "hermes", model: "", hermesProfile: { id: "work", homePath: "/synthetic/.hermes/profiles/work" } };
  fixture.env = { NODE_ENV: "test", PATH: "", HERMES_API_URL: "http://127.0.0.1:8642/v1", HERMES_API_KEY: "synthetic-secret" };
  expect(await (await GET(runtimeRequest())).json()).toEqual({ ok: true, runtime: { familiarId: "nova", harness: "hermes", transport: "local", state: "unavailable" } });
});

test("an unsupported SSH binding remains unavailable even without checking a local CLI", async () => {
  fixture.config.defaults.harness = "grok";
  fixture.config.defaults.runtime = { kind: "ssh", host: "practice-host", cwd: "/remote/practice", command: "coven" };
  expect(await (await GET(runtimeRequest())).json()).toEqual({ ok: true, runtime: { familiarId: "nova", harness: "grok", transport: "ssh", state: "unavailable" } });
});

test.each(["../nova", "unknown"])("runtime selection rejects invalid or invisible actors (%s)", async (id) => {
  const response = await GET(runtimeRequest(id));
  expect(response.status).toBe(id === "unknown" ? 404 : 400);
  expect((await response.json()).ok).toBe(false);
});

test("runtime inspection is local-only and fails closed when the visible roster cannot load", async () => {
  expect((await GET(runtimeRequest("nova", "outside.example"))).status).toBe(403);
  fixture.rosterAvailable = false;
  const response = await GET(runtimeRequest());
  expect(response.status).toBe(503);
  expect((await response.json()).ok).toBe(false);
});
