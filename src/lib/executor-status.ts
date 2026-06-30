import type { CaveConfig } from "./cave-config.ts";
import { normalizeHubUrl } from "./coven-daemon.ts";

export type ExecutorAvailability = {
  url: string;
  healthUrl: string;
  ok: boolean;
  state: "available" | "unreachable";
  detail: string;
};

type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<Response>;

type CheckExecutorOptions = {
  timeoutMs?: number;
  fetchImpl?: FetchLike;
};

export function normalizeExecutorUrl(rawUrl: string): string {
  return normalizeHubUrl(rawUrl);
}

function executorHealthUrl(rawUrl: string): string {
  const url = normalizeExecutorUrl(rawUrl);
  return new URL("/api/v1/health", `${url}/`).toString();
}

function normalizeExecutorError(err: unknown): string {
  if (err instanceof DOMException && err.name === "AbortError") {
    return "executor timeout";
  }
  const code = err && typeof err === "object" ? (err as { code?: unknown }).code : null;
  if (code === "ENOENT" || code === "ECONNREFUSED" || code === "EHOSTUNREACH") {
    return "executor offline";
  }
  if (err instanceof Error && err.message === "timeout") return "executor timeout";
  return err instanceof Error && err.message.trim() ? err.message : "executor unreachable";
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function checkExecutorAvailability(
  urls: string[],
  options: CheckExecutorOptions = {},
): Promise<ExecutorAvailability[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 800;
  const normalizedUrls = Array.from(
    new Set(urls.map(normalizeExecutorUrl).filter(Boolean)),
  );

  return Promise.all(
    normalizedUrls.map(async (url) => {
      const healthUrl = executorHealthUrl(url);
      try {
        const res = await fetchWithTimeout(fetchImpl, healthUrl, timeoutMs);
        if (!res.ok) {
          return {
            url,
            healthUrl,
            ok: false,
            state: "unreachable" as const,
            detail: `executor http ${res.status}`,
          };
        }
        const data = await res.json().catch(() => null);
        if (data && typeof data === "object" && (data as { ok?: unknown }).ok === false) {
          return {
            url,
            healthUrl,
            ok: false,
            state: "unreachable" as const,
            detail: "executor reported unhealthy",
          };
        }
        return {
          url,
          healthUrl,
          ok: true,
          state: "available" as const,
          detail: "executor reachable",
        };
      } catch (err) {
        return {
          url,
          healthUrl,
          ok: false,
          state: "unreachable" as const,
          detail: normalizeExecutorError(err),
        };
      }
    }),
  );
}

export function executorStatusesForConfig(
  config: Pick<CaveConfig, "multiHost">,
): Promise<ExecutorAvailability[]> {
  if (config.multiHost.mode !== "hub") return Promise.resolve([]);
  return checkExecutorAvailability(config.multiHost.executorUrls);
}
