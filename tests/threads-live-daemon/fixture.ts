import { test as base, expect } from "@playwright/test";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, chmodSync, openSync, closeSync, readdirSync, existsSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const pin = JSON.parse(readFileSync(new URL("./compatibility.json", import.meta.url), "utf8"));
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
type Owned = { child: ChildProcess; stop: () => Promise<void> };
function launch(binary: string, args: string[], env: NodeJS.ProcessEnv, log: string): Owned {
  const fd = openSync(log, "a", 0o600);
  const child = spawn(binary, args, { env, detached: true, stdio: ["ignore", fd, fd] });
  closeSync(fd);
  let spawnError: Error | undefined;
  child.on("error", error => { spawnError = error; });
  const groupAlive = () => {
    if (!child.pid) return false;
    try { process.kill(-child.pid, 0); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      // Confirm group membership independently when the signal probe is denied.
      // Never treat permission denial alone as proof that cleanup succeeded.
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        const groups = execFileSync("ps", ["-axo", "pgid="], { encoding: "utf8" });
        return groups.split(/\s+/).some(group => Number(group) === child.pid);
      }
      throw error;
    }
  };
  const signalGroup = (signal: NodeJS.Signals) => {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  };
  return { child, async stop() {
    if (spawnError) throw spawnError;
    // The group can outlive its leader. Verify the entire owned group is gone.
    if (!groupAlive()) return;
    signalGroup("SIGTERM");
    const deadline = Date.now() + 5000;
    while (groupAlive() && Date.now() < deadline) await delay(50);
    if (groupAlive()) signalGroup("SIGKILL");
    const killDeadline = Date.now() + 5000;
    while (groupAlive() && Date.now() < killDeadline) await delay(50);
    if (groupAlive()) throw new Error("Owned fixture process group survived cleanup");
  } };
}
async function unusedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Cannot allocate fixture port");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
async function ready(child: ChildProcess, probe: () => Promise<boolean>, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("Owned fixture process exited before readiness");
    try { if (await probe()) return; } catch { /* Readiness only; never retry a mutation. */ }
    await delay(100);
  }
  throw new Error("Owned fixture process did not become ready");
}
function daemonRequest(socketPath: string, method: string, requestPath: string, body?: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = http.request({ socketPath, method, path: requestPath,
      headers: payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {} }, response => {
      const chunks: Buffer[] = []; let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) { response.destroy(new Error("Fixture response exceeds budget")); return; }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        try { resolve({ status: response.statusCode ?? 0, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) }); }
        catch (error) { reject(error); }
      });
    });
    request.setTimeout(15_000, () => request.destroy(new Error("Fixture request timed out")));
    request.on("error", reject);
    request.end(payload);
  });
}

export type LiveDaemon = {
  baseURL: string;
  headers: Record<string, string>;
  workspace: string;
  home: string;
  runId: string;
  artifactRoot: string;
  artifactSecrets: string[];
  advance: (seconds: number) => Promise<void>;
  tick: () => Promise<void>;
  stopDaemon: () => Promise<void>;
  restartDaemon: () => Promise<void>;
};

export const test = base.extend<{ live: LiveDaemon; sanitizedTrace: void }>({
  sanitizedTrace: [async ({ context, live }, use, info) => {
    await context.tracing.start({ title: live.runId, screenshots: true, snapshots: true, sources: false });
    await use();
    const raw = path.join(live.artifactRoot, "browser-trace.raw.zip");
    await context.tracing.stop({ path: raw });
    const target = info.outputPath("trace.zip");
    execFileSync("python3", [path.resolve("scripts/sanitize-threads-trace.py"), raw, target], { input: JSON.stringify(live.artifactSecrets), stdio: ["pipe", "ignore", "pipe"] });
    await info.attach("trace", { path: target, contentType: "application/zip" });
  }, { auto: true }],
  live: async ({}, use, info) => {
    if (process.platform === "win32") throw new Error("The initial live-daemon project requires a Unix owner-local socket");
    const manifestPath = process.env.COVEN_THREADS_E2E_PROVENANCE;
    if (!manifestPath || !path.isAbsolute(manifestPath)) throw new Error("Set COVEN_THREADS_E2E_PROVENANCE to the isolated builder's absolute provenance.json path");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const key of ["covenCommit", "threadsCommit", "cargoLockSha256"]) {
      if (manifest[key] !== pin[key]) throw new Error(`Unreviewed fixture ${key}`);
    }
    if (manifest.schema !== "cave-threads-live-binary-v1" || manifest.platform !== process.platform
      || !manifest.features?.includes("threads-test-clock") || hash(manifest.binary) !== manifest.binarySha256
      || hash(manifest.corpus) !== manifest.corpusSha256) throw new Error("Fixture binary/corpus provenance does not match");
    const corpus = JSON.parse(readFileSync(manifest.corpus, "utf8"));
    if (corpus.provenance?.historical_data_used !== false || corpus.provenance?.kind !== "synthetic") throw new Error("Synthetic corpus required");
    const example = corpus.valid_cases.find((item: { id: string }) => item.id === "familiar-review");
    if (!example) throw new Error("Canonical familiar-review case missing");
    const runId = randomUUID();
    // Short root keeps Unix socket names inside the macOS length limit.
    const root = mkdtempSync(`/tmp/cave-threads-${runId.slice(0, 8)}-`);
    const home = path.join(root, "coven"); const workspace = path.join(home, "familiars", "sage");
    const socket = path.join(home, "coven.sock");
    mkdirSync(workspace, { recursive: true });
    const facts = Object.fromEntries(example.candidate_facts.map((fact: { fact: string; value: string }) => [fact.fact, fact.value]));
    const quoted = JSON.stringify;
    writeFileSync(path.join(home, "familiars.toml"), `[[familiar]]\nid = "sage"\n${["name", "person", "pronouns", "coven"].map(key => `${key} = ${quoted(facts[key])}`).join("\n")}\ndisplay_name = ${quoted(facts.name)}\nrole = "Synthetic fixture"\ndescription = "Repository-authored synthetic fixture."\n`);
    writeFileSync(path.join(workspace, "SOUL.md"), `# I am ${facts.name}\nMy purpose is ${facts.purpose}\n`);
    writeFileSync(path.join(workspace, "IDENTITY.md"), `# IDENTITY.md - ${facts.name}\n- **Pronouns:** ${facts.pronouns}\n`);
    for (const surface of example.surfaces) {
      if (!["TOOLS.md", "HEARTBEAT.md"].includes(surface.path)) throw new Error("Unexpected corpus surface");
      writeFileSync(path.join(workspace, surface.path), surface.before);
    }
    const veto = example.approval.veto;
    if (veto.duration_seconds % 3600 !== 0) throw new Error("Retired Ward duration must be whole hours");
    const legacy = `[meta]\nversion = "0.1.0"\nowner = "sage"\n[protected]\nfiles = ["SOUL.md", "IDENTITY.md"]\ninvariants = ${quoted(example.declarations)}\n[editable]\npaths = ${quoted(example.surfaces.map((s: { path: string }) => s.path))}\nharness_blocks = ${quoted(example.expected.regions)}\n[approval_tiers.familiar_review]\nblocks = ${quoted(example.expected.regions)}\ngate = "familiar_coherence_check"\nhuman_veto_window_hours = ${veto.duration_seconds / 3600}\nmin_visible_seconds = ${veto.min_visible_seconds}\n`;
    writeFileSync(path.join(workspace, "ward.toml"), legacy);
    const peer = randomUUID(); const access = randomUUID(); const capability = randomUUID();
    const port = await unusedPort(); const baseURL = `http://127.0.0.1:${port}`;
    for (const name of [".env", ".env.local", ".env.development", ".env.development.local"]) {
      if (existsSync(path.resolve(name))) throw new Error(`Isolated fixture refuses local environment file: ${name}`);
    }
    const userHome = path.join(root, "user");
    const temporary = path.join(root, "tmp");
    mkdirSync(userHome, { mode: 0o700 }); mkdirSync(temporary, { mode: 0o700 });
    const env = { NODE_ENV: "development" as const, PATH: process.env.PATH, LANG: "en_US.UTF-8", TZ: "UTC", HOME: userHome,
      TMPDIR: temporary, XDG_CONFIG_HOME: path.join(userHome, "config"), XDG_DATA_HOME: path.join(userHome, "data"),
      XDG_CACHE_HOME: path.join(userHome, "cache"), NEXT_TELEMETRY_DISABLED: "1", COVEN_HOME: home, COVEN_SOCKET: socket, COVEN_BIN: manifest.binary,
      COVEN_CAVE_HOME: path.join(root, "cave"), COVEN_CAVE_E2E: "1", COVEN_THREADS_ADAPTER: "daemon",
      COVEN_CAVE_PORT: String(port), COVEN_PREFERENCES_PATH: path.join(root, "preferences.json"),
      CAVE_PROJECTS_PATH_OVERRIDE: path.join(root, "projects.json"), CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE: path.join(root, "permissions.json"),
      COVEN_CAVE_LOCAL_PEER_SECRET: peer, COVEN_CAVE_ACCESS_TOKEN: access };
    writeFileSync(env.CAVE_PROJECTS_PATH_OVERRIDE, JSON.stringify({ version: 1, projects: [] }));
    writeFileSync(env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE, JSON.stringify({ version: 2, projectGrants: [], accessGroups: [], grantProposals: [], permissionAudit: [] }));
    const headers = { "x-coven-cave-local-peer": peer, authorization: `Bearer ${access}` };
    let daemon: Owned | undefined; let app: Owned | undefined; let migration: Owned | undefined;
    const request = (method: string, url: string, body?: unknown) => daemonRequest(socket, method, url, body);
    try {
      migration = launch(manifest.binary, ["ward", "migrate", "--familiar", "sage", "--fingerprint", "fpr-e2e-synthetic", "--apply"], env, path.join(root, "migration.log"));
      await Promise.race([
        new Promise<void>((resolve, reject) => { migration!.child.once("exit", code => code === 0 ? resolve() : reject(new Error("Synthetic Ward migration failed"))); migration!.child.once("error", reject); }),
        delay(30_000, undefined, { ref: false }).then(() => { throw new Error("Synthetic Ward migration timed out"); }),
      ]);
      expect(readFileSync(path.join(workspace, "ward.toml.v01.bak"), "utf8")).toBe(legacy);
      const clock = path.join(home, "test-fixtures", "threads-deterministic-clock");
      mkdirSync(clock, { recursive: true, mode: 0o700 }); chmodSync(path.dirname(clock), 0o700);
      for (const [name, value] of Object.entries({ enabled: "threads_test_clock_v1\n", capability, "state.json": '{"now":"2099-01-01T00:00:00Z"}' })) writeFileSync(path.join(clock, name), value, { mode: 0o600 });
      const startDaemon = async () => {
        daemon = launch(manifest.binary, ["daemon", "serve"], env, path.join(root, "daemon.log"));
        await ready(daemon.child, async () => (await request("GET", "/health")).status === 200);
      };
      await startDaemon();
      const advance = async (seconds: number) => {
        const now = new Date(Date.UTC(2099, 0, 1) + seconds * 1000).toISOString();
        const response = await request("POST", "/api/v1/internal/threads/test-clock", { capability, now });
        expect(response.status).toBe(200); expect(response.data.source).toBe("deterministic_fixture");
      };
      await advance(0);
      app = launch(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], env, path.join(root, "cave.log"));
      await ready(app.child, async () => (await fetch(`${baseURL}/proposals`, { headers, signal: AbortSignal.timeout(10_000) })).ok, 60_000);
      await info.attach("run-identity", { body: JSON.stringify({ runId, ...pin, binarySha256: manifest.binarySha256 }), contentType: "application/json" });
      await use({ baseURL, headers, workspace, home, runId, advance, artifactRoot: root, artifactSecrets: [peer, access, capability],
        tick: async () => { expect((await request("POST", "/api/v1/internal/threads/test-clock/tick", { capability })).status).toBe(200); },
        stopDaemon: async () => { await daemon?.stop(); },
        restartDaemon: async () => { await daemon?.stop(); await startDaemon(); } });
    } finally {
      // Reap all owned processes even if another teardown fails.
      const stopped = await Promise.allSettled([app?.stop(), daemon?.stop(), migration?.stop()]);
      const sanitize = (value: string) => [peer, access, capability].reduce((text, secret) => text.split(secret).join("[REDACTED]"), value);
      for (const error of info.errors) {
        if (error.message) error.message = sanitize(error.message);
        if (error.stack) error.stack = sanitize(error.stack);
        if (error.value) error.value = sanitize(error.value);
      }
      for (const name of ["cave.log", "daemon.log", "migration.log"]) {
        try { writeFileSync(info.outputPath(name), `run-id: ${runId}\n${sanitize(readFileSync(path.join(root, name), "utf8"))}`, { mode: 0o600 }); } catch { /* Startup can fail before a log exists. */ }
      }
      const pending = path.join(home, "pending");
      const staged = existsSync(pending) ? readdirSync(pending).filter(name => name.endsWith(".json")).map(name => ({ name, contents: readFileSync(path.join(pending, name), "utf8") })) : [];
      writeFileSync(info.outputPath("pending.json"), sanitize(JSON.stringify({ runId, staged }, null, 2)), { mode: 0o600 });
      const surfaces = ["TOOLS.md", "HEARTBEAT.md", "SOUL.md", "IDENTITY.md"].map(name => ({ name, sha256: hash(path.join(workspace, name)) }));
      writeFileSync(info.outputPath("workspace.json"), JSON.stringify({ runId, surfaces }, null, 2), { mode: 0o600 });
      try {
        const { DatabaseSync } = await import("node:sqlite");
        const db = new DatabaseSync(path.join(home, "coven.sqlite3"), { readOnly: true });
        try {
          const audit = db.prepare("SELECT id, event_type, proposal_id, decision, detail, submitted_at, decided_at FROM ward_audit ORDER BY id").all();
          writeFileSync(info.outputPath("audit.json"), sanitize(JSON.stringify({ runId, audit }, null, 2)), { mode: 0o600 });
        } finally { db.close(); }
      } catch { /* A startup failure can precede schema creation. */ }
      writeFileSync(info.outputPath("manifest.json"), JSON.stringify({ runId, ...pin, root, project: info.project.name, retry: info.retry,
        status: stopped.some(result => result.status === "rejected") ? "failed" : info.status, expectedStatus: info.expectedStatus, fixtureProcessesStopped: stopped.every(result => result.status === "fulfilled") }, null, 2));
      const failure = stopped.find(result => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    }
  },
});
export { expect };
