import { newestRuntimeModelFamilies } from "../runtime-model-families.ts";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { codexLaunchCommand } from "../codex-bin.ts";
import { harnessSpawnEnv, warmHarnessSpawnPath } from "../harness-spawn-env.ts";
import { isSafeRuntimeModelId, type RuntimeModelOption } from "../runtime-models.ts";

type Runtime = "codex" | "claude";
type RecordValue = Record<string, unknown>;
type Inventory = { models: RuntimeModelOption[]; provenance: "live" | "cached" | "unavailable" };
type Launch = { command: string; args: string[] };
type Dependencies = {
  spawnImpl?: typeof spawn;
  scopedEnv?: (familiarId?: string | null) => NodeJS.ProcessEnv;
  warmSpawnPath?: () => Promise<void>;
  launch?: (runtime: Runtime) => Launch;
  timeoutMs?: number;
  maxBytes?: number;
  now?: () => number;
};
const cache = new Map<string, { expiresAt: number; models: RuntimeModelOption[] }>();
const inFlight = new Map<string, Promise<RuntimeModelOption[] | null>>();
const unavailable = (): Inventory => ({ models: [], provenance: "unavailable" });

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue : null;
}

/** Use resolved launch IDs, never display aliases. Retired, hidden, and
 * migration-only choices are not advertised as current models. */
export function normalizeCliRuntimeModels(runtime: Runtime, values: unknown[]): RuntimeModelOption[] {
  const models = new Map<string, RuntimeModelOption>();
  const defaultRows = new Set<string>();
  for (const value of values) {
    const model = record(value);
    if (!model || model.hidden === true || model.deprecated === true || model.upgrade ||
      record(model.upgradeInfo)?.retirementAt) continue;
    const nativeId = runtime === "codex" ? model.model : model.resolvedModel;
    if (typeof nativeId !== "string" || nativeId.length > 256 || !isSafeRuntimeModelId(nativeId)) continue;
    const id = `${runtime === "codex" ? "openai" : "anthropic"}/${nativeId}`;
    const label = typeof model.displayName === "string" && model.displayName.trim() &&
      model.displayName.length <= 200 && !/[\u0000-\u001f\u007f]/.test(model.displayName)
      ? model.displayName.trim() : nativeId;
    // Claude's default row can resolve to the same ID as a named family row.
    if (!models.has(id) || (defaultRows.has(id) && model.value !== "default")) {
      models.set(id, { id, label });
      if (model.value === "default") defaultRows.add(id);
      else defaultRows.delete(id);
    }
  }
  return newestRuntimeModelFamilies([...models.values()]);
}

function launchFor(runtime: Runtime): Launch {
  if (runtime === "claude") {
    return { command: "claude", args: ["--input-format", "stream-json", "--output-format", "stream-json", "--verbose"] };
  }
  const launch = codexLaunchCommand();
  if (launch.unresolvedWindowsShim) throw new Error("Codex launch unavailable");
  return { command: launch.command, args: [...launch.fixedArgs, "app-server", "--stdio"] };
}

/** Initializes only the control protocol. No thread, prompt, turn, or tool is
 * executed. The response is reduced to model IDs/labels before retention. */
function query(runtime: Runtime, launch: Launch, env: NodeJS.ProcessEnv, dependencies: Dependencies): Promise<RuntimeModelOption[] | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = (dependencies.spawnImpl ?? spawn)(launch.command, launch.args, {
        env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
      });
    } catch { resolve(null); return; }
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let bytes = 0;
    let buffer = "";
    const decoder = new StringDecoder("utf8");
    const rows: unknown[] = [];
    const cursors = new Set<string>();
    let requestId = 1;
    let initialized = false;
    const finish = (models: RuntimeModelOption[] | null, terminate = true) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (terminate) {
        try { child.stdin?.end(); child.kill("SIGTERM"); } catch { /* Already closed. */ }
        killTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* Already closed. */ } }, 250);
        killTimer.unref();
      }
      resolve(models);
    };
    const timer = setTimeout(() => finish(null), dependencies.timeoutMs ?? 8_000);
    const send = (value: unknown) => {
      try { child.stdin?.write(JSON.stringify(value) + "\n"); } catch { finish(null); }
    };
    const handle = (value: unknown) => {
      const message = record(value);
      if (!message) return;
      if (runtime === "claude") {
        const response = record(message.response);
        if (message.type !== "control_response" || response?.request_id !== "cave-model-inventory") return;
        const models = record(response.response)?.models;
        finish(response.subtype === "success" && Array.isArray(models)
          ? normalizeCliRuntimeModels(runtime, models) : null);
        return;
      }
      if (message.id !== requestId) return;
      const result = record(message.result);
      if (!result || message.error) { finish(null); return; }
      if (!initialized) {
        initialized = true;
        send({ method: "initialized" });
      } else {
        if (!Array.isArray(result.data)) { finish(null); return; }
        rows.push(...result.data);
        if (result.nextCursor == null) { finish(normalizeCliRuntimeModels(runtime, rows)); return; }
        if (typeof result.nextCursor !== "string" || cursors.has(result.nextCursor) || cursors.size >= 20) {
          finish(null); return;
        }
        cursors.add(result.nextCursor);
      }
      send({ id: ++requestId, method: "model/list", params: {
        limit: 100, includeHidden: false, ...(initialized && result.nextCursor ? { cursor: result.nextCursor } : {}),
      } });
    };
    child.stdout?.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const raw = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += raw.length;
      if (bytes > (dependencies.maxBytes ?? 2 * 1024 * 1024)) { finish(null); return; }
      buffer += decoder.write(raw);
      let newline;
      while (!settled && (newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try { handle(JSON.parse(line)); } catch { finish(null); }
      }
    });
    child.stderr?.resume();
    child.stdin?.on("error", () => finish(null));
    child.once("error", () => finish(null));
    child.once("close", () => { clearTimeout(killTimer); finish(null, false); });
    send(runtime === "codex"
      ? { id: 1, method: "initialize", params: { clientInfo: { name: "coven_cave_models", version: "1" } } }
      : { type: "control_request", request_id: "cave-model-inventory", request: { subtype: "initialize" } });
  });
}

export async function listCliRuntimeModels(runtime: Runtime, familiarId?: string | null, dependencies: Dependencies = {}): Promise<Inventory> {
  const warm = dependencies.warmSpawnPath ?? (dependencies.scopedEnv ? undefined : warmHarnessSpawnPath);
  if (warm) await warm();
  let env: NodeJS.ProcessEnv;
  let launch: Launch;
  try {
    env = (dependencies.scopedEnv ?? harnessSpawnEnv)(familiarId);
    launch = (dependencies.launch ?? launchFor)(runtime);
  } catch { return unavailable(); }
  const now = (dependencies.now ?? Date.now)();
  for (const [key, entry] of cache) if (entry.expiresAt <= now) cache.delete(key);
  const fingerprint = createHash("sha256").update(JSON.stringify([
    launch, Object.entries(env).sort(([a], [b]) => a.localeCompare(b)),
  ])).digest("hex");
  const key = `${runtime}\0${familiarId ?? ""}\0${fingerprint}`;
  const cached = cache.get(key);
  if (cached) return { models: cached.models.map((m) => ({ ...m })), provenance: "cached" };
  let pending = inFlight.get(key);
  if (!pending) {
    if (inFlight.size >= 4) return unavailable();
    pending = query(runtime, launch, env, dependencies).then((models) => {
      if (models) {
        cache.set(key, { models, expiresAt: (dependencies.now ?? Date.now)() + 60_000 });
        while (cache.size > 64) cache.delete(cache.keys().next().value!);
      }
      return models;
    }).finally(() => { inFlight.delete(key); });
    inFlight.set(key, pending);
  }
  const models = await pending;
  return models ? { models: models.map((m) => ({ ...m })), provenance: "live" } : unavailable();
}

export function clearCliRuntimeModelCache(): void { cache.clear(); inFlight.clear(); }
