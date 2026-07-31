import { spawn } from "node:child_process";
import { normalizeCopilotModels } from "../copilot-models.ts";
import { copilotStreamSpec } from "../copilot-stream.ts";
import { harnessSpawnEnv } from "../harness-spawn-env.ts";
import type { RuntimeModelOption } from "../runtime-models.ts";
import {
  resolveCopilotRuntimeLaunch,
  type CopilotRuntimeLaunch,
} from "./copilot-runtime-launch.ts";

const RPC_TIMEOUT_MS = 8_000;
const FORCE_KILL_GRACE_MS = 250;
const MAX_HEADER_BYTES = 8 * 1024;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const CACHE_MS = 60_000;
const MAX_CACHE_ENTRIES = 64;
const MAX_CONCURRENT_DISCOVERIES = 4;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

export class CopilotRpcFrameDecoder {
  private buffer = Buffer.alloc(0);
  private totalBytes = 0;
  private readonly maxHeaderBytes: number;
  private readonly maxBodyBytes: number;
  private readonly maxTotalBytes: number;

  constructor(options: {
    maxHeaderBytes?: number;
    maxBodyBytes?: number;
    maxTotalBytes?: number;
  } = {}) {
    this.maxHeaderBytes = options.maxHeaderBytes ?? MAX_HEADER_BYTES;
    this.maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
    this.maxTotalBytes = options.maxTotalBytes ?? MAX_TOTAL_BYTES;
  }

  push(chunk: Buffer | string): unknown[] {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.totalBytes += bytes.length;
    if (this.totalBytes > this.maxTotalBytes) {
      throw new Error("Copilot RPC output is too large");
    }
    this.buffer = Buffer.concat([this.buffer, bytes]);
    const frames: unknown[] = [];
    while (this.buffer.length > 0) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) {
        if (this.buffer.length > this.maxHeaderBytes) {
          throw new Error("Invalid Copilot RPC frame header");
        }
        break;
      }
      if (headerEnd > this.maxHeaderBytes) {
        throw new Error("Invalid Copilot RPC frame header");
      }
      const headers = this.buffer
        .subarray(0, headerEnd)
        .toString("ascii")
        .split("\r\n");
      const lengths = headers.flatMap((line) => {
        const match = /^content-length:\s*(\d+)\s*$/i.exec(line);
        return match ? [match[1]!] : [];
      });
      if (lengths.length !== 1) {
        throw new Error("Invalid Copilot RPC frame");
      }
      const bodyLength = Number(lengths[0]);
      if (!Number.isSafeInteger(bodyLength) || bodyLength > this.maxBodyBytes) {
        throw new Error("Copilot RPC frame is too large");
      }
      const bodyStart = headerEnd + 4;
      const frameEnd = bodyStart + bodyLength;
      if (this.buffer.length < frameEnd) break;
      const body = this.buffer.subarray(bodyStart, frameEnd).toString("utf8");
      this.buffer = this.buffer.subarray(frameEnd);
      try {
        frames.push(JSON.parse(body));
      } catch {
        throw new Error("Invalid Copilot RPC frame JSON");
      }
    }
    return frames;
  }
}

export function encodeCopilotRpcFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"),
    body,
  ]);
}

type CopilotModelDependencies = {
  spawnImpl?: typeof spawn;
  scopedEnv?: (
    familiarId?: string | null,
  ) => Record<string, string | undefined>;
  resolveRuntimeLaunch?: typeof resolveCopilotRuntimeLaunch;
  timeoutMs?: number;
  forceKillGraceMs?: number;
  now?: () => number;
  cacheMs?: number;
  maxCacheEntries?: number;
  maxConcurrentDiscoveries?: number;
};

type CacheEntry = { expiresAt: number; models: RuntimeModelOption[] };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<RuntimeModelOption[]>>();

function positiveLimit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
}

function pruneExpiredCache(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

function cacheModels(
  key: string,
  entry: CacheEntry,
  maxEntries: number,
): void {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function queryCopilotModels(
  launch: CopilotRuntimeLaunch,
  dependencies: CopilotModelDependencies,
): Promise<unknown | null> {
  return new Promise((resolve) => {
    const spawnImpl = dependencies.spawnImpl ?? spawn;
    const timeoutMs = dependencies.timeoutMs ?? RPC_TIMEOUT_MS;
    const forceKillGraceMs =
      dependencies.forceKillGraceMs ?? FORCE_KILL_GRACE_MS;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnImpl(
        launch.command,
        [
          ...launch.fixedArgs,
          "--headless",
          "--no-auto-update",
          "--log-level",
          "error",
          "--stdio",
        ],
        {
          env: launch.env,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        },
      );
    } catch {
      resolve(null);
      return;
    }

    const decoder = new CopilotRpcFrameDecoder();
    let settled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
    const terminate = () => {
      try {
        child.stdin?.end();
      } catch {
        // A closed stdin needs no cleanup.
      }
      try {
        child.kill("SIGTERM");
      } catch {
        return;
      }
      forceKillTimer ??= setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // The process already exited.
        }
      }, forceKillGraceMs);
      forceKillTimer.unref?.();
    };
    const finish = (value: unknown | null, terminateChild = true) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (terminateChild) terminate();
      resolve(value);
    };
    const send = (id: number, method: string) => {
      try {
        child.stdin?.write(encodeCopilotRpcFrame({
          jsonrpc: "2.0",
          id,
          method,
          params: {},
        }));
      } catch {
        finish(null);
      }
    };
    const sendModels = () => send(2, "models.list");
    const handle = (value: unknown) => {
      const response = record(value);
      if (!response || typeof response.id !== "number") return;
      if (response.id === 1) {
        const error = record(response.error);
        if (error?.code === -32601) {
          send(3, "ping");
        } else if ("result" in response) {
          sendModels();
        } else {
          finish(null);
        }
        return;
      }
      if (response.id === 3) {
        if ("result" in response) sendModels();
        else finish(null);
        return;
      }
      if (response.id === 2) {
        finish("result" in response ? response.result : null);
      }
    };

    const timeout = setTimeout(() => finish(null), timeoutMs);
    child.stdout?.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      try {
        for (const value of decoder.push(chunk)) handle(value);
      } catch {
        finish(null);
      }
    });
    child.stderr?.resume();
    child.once("error", () => finish(null));
    child.once("close", () => {
      if (forceKillTimer) clearTimeout(forceKillTimer);
      finish(null, false);
    });
    send(1, "connect");
  });
}

async function discoverCopilotModels(
  familiarId: string | null | undefined,
  dependencies: CopilotModelDependencies,
): Promise<RuntimeModelOption[]> {
  const scopedEnv = dependencies.scopedEnv ?? harnessSpawnEnv;
  const executable = copilotStreamSpec()?.executable ?? "copilot";
  let env: Record<string, string | undefined>;
  try {
    // Match the chat launch path: construct the familiar-scoped environment
    // before the passive resolver starts its short filesystem deadline.
    env = scopedEnv(familiarId);
  } catch {
    return [];
  }
  let launch: CopilotRuntimeLaunch;
  try {
    launch = await (
      dependencies.resolveRuntimeLaunch ?? resolveCopilotRuntimeLaunch
    )(executable, {
      spawnEnv: () => env as NodeJS.ProcessEnv,
    });
  } catch {
    return [];
  }
  if (launch.availability.state !== "ready") return [];
  const response = await queryCopilotModels(launch, dependencies);
  const models = normalizeCopilotModels(response);
  if (models.length > 0) {
    const now = dependencies.now ?? Date.now;
    const currentTime = now();
    pruneExpiredCache(currentTime);
    cacheModels(
      familiarId ?? "",
      {
        expiresAt: currentTime + (dependencies.cacheMs ?? CACHE_MS),
        models,
      },
      positiveLimit(dependencies.maxCacheEntries, MAX_CACHE_ENTRIES),
    );
  }
  return models;
}

/** Read the authenticated, account-policy-scoped model inventory from Cave's
 * exact resolved Copilot CLI. */
export async function listCopilotModelInventory(
  familiarId?: string | null,
  dependencies: CopilotModelDependencies = {},
): Promise<{ models: RuntimeModelOption[]; provenance: "live" | "cached" }> {
  const key = familiarId ?? "";
  const now = dependencies.now ?? Date.now;
  pruneExpiredCache(now());
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return { models: [...cached.models], provenance: "cached" };
  }
  const pending = inFlight.get(key);
  if (pending) return { models: [...await pending], provenance: "live" };
  if (
    inFlight.size >= positiveLimit(
      dependencies.maxConcurrentDiscoveries,
      MAX_CONCURRENT_DISCOVERIES,
    )
  ) {
    return { models: [], provenance: "live" };
  }

  const discovery = discoverCopilotModels(familiarId, dependencies).finally(() => {
    if (inFlight.get(key) === discovery) inFlight.delete(key);
  });
  inFlight.set(key, discovery);
  return { models: [...await discovery], provenance: "live" };
}

/** Compatibility projection for callers that only need the entries. */
export async function listCopilotModels(
  familiarId?: string | null,
  dependencies: CopilotModelDependencies = {},
): Promise<RuntimeModelOption[]> {
  return (await listCopilotModelInventory(familiarId, dependencies)).models;
}

export function clearCopilotModelCache(): void {
  cache.clear();
  inFlight.clear();
}
