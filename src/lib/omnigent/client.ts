import { resolveOmnigentAuth, normalizeOmnigentBaseUrl } from "./token.ts";
import type {
  CreateSessionInput,
  OmnigentAgent,
  OmnigentHost,
  OmnigentSession,
  OmnigentSessionListItem,
} from "./types.ts";

export class OmnigentError extends Error {
  status: number;
  body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "OmnigentError";
    this.status = status;
    this.body = body;
  }
}

export class OmnigentClient {
  readonly baseUrl: string;
  private token: string | null;
  private extraHeaders: Record<string, string>;
  readonly authMode: "jwt" | "env" | "databricks" | "none";
  /** True when we have JWT/env/databricks material — not required for local Omnigent. */
  readonly authenticated: boolean;

  constructor(
    baseUrl: string,
    token: string | null = null,
    opts?: {
      extraHeaders?: Record<string, string>;
      authMode?: "jwt" | "env" | "databricks" | "none";
      authenticated?: boolean;
    },
  ) {
    this.baseUrl = normalizeOmnigentBaseUrl(baseUrl);
    this.token = token;
    this.extraHeaders = opts?.extraHeaders ?? {};
    this.authMode = opts?.authMode ?? (token ? "jwt" : "none");
    this.authenticated = opts?.authenticated ?? Boolean(token);
  }

  static async fromBaseUrl(baseUrl: string): Promise<OmnigentClient> {
    const normalized = normalizeOmnigentBaseUrl(baseUrl);
    const auth = await resolveOmnigentAuth(normalized);
    return new OmnigentClient(normalized, auth.token, {
      extraHeaders: auth.extraHeaders,
      authMode: auth.mode,
      authenticated: auth.authenticated,
    });
  }

  /** @deprecated Prefer `authenticated` / `authMode`. Kept for UI that shows "token found". */
  get hasToken(): boolean {
    return Boolean(this.token);
  }

  private headers(json = true): HeadersInit {
    const h: Record<string, string> = {
      Accept: "application/json",
      ...this.extraHeaders,
    };
    if (json) h["Content-Type"] = "application/json";
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.baseUrl) {
      throw new OmnigentError("Omnigent base URL is not configured", 400, "");
    }
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const res = await fetch(url, {
      method,
      headers: this.headers(body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      throw new OmnigentError(
        `Omnigent ${method} ${path} failed (${res.status})`,
        res.status,
        text.slice(0, 2000),
      );
    }
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new OmnigentError("Omnigent returned non-JSON", res.status, text.slice(0, 500));
    }
  }

  health(): Promise<{ status?: string }> {
    return this.request("GET", "/health");
  }

  async listHosts(): Promise<OmnigentHost[]> {
    const data = await this.request<{ hosts?: OmnigentHost[] } | OmnigentHost[]>("GET", "/v1/hosts");
    if (Array.isArray(data)) return data;
    return Array.isArray(data.hosts) ? data.hosts : [];
  }

  async listAgents(limit = 100): Promise<OmnigentAgent[]> {
    const data = await this.request<{ data?: OmnigentAgent[] }>(
      "GET",
      `/v1/agents?limit=${Math.min(Math.max(limit, 1), 1000)}`,
    );
    return Array.isArray(data.data) ? data.data : [];
  }

  async listSessions(limit = 30): Promise<OmnigentSessionListItem[]> {
    const data = await this.request<{ data?: OmnigentSessionListItem[] }>(
      "GET",
      `/v1/sessions?limit=${Math.min(Math.max(limit, 1), 100)}&order=desc&sort_by=updated_at`,
    );
    return Array.isArray(data.data) ? data.data : [];
  }

  getSession(sessionId: string): Promise<OmnigentSession> {
    return this.request("GET", `/v1/sessions/${encodeURIComponent(sessionId)}`);
  }

  /**
   * Post a user message onto a live session (dispatches a turn when a runner
   * is bound). Used after host-launched create so the prompt is not only
   * seeded as history-only initial_items.
   */
  postMessage(sessionId: string, text: string): Promise<unknown> {
    const body = {
      type: "message",
      data: {
        role: "user",
        content: [{ type: "input_text", text }],
      },
    };
    return this.request("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/events`, body);
  }

  /**
   * Create a session.
   *
   * When `hostId` is set (Fleet external host path), the server launches a
   * runner *after* create returns — `initial_items` would only seed history and
   * would not dispatch a turn. In that case we create without initial_items,
   * then POST the prompt to `/events` so the runner actually starts work.
   */
  async createSession(input: CreateSessionInput): Promise<OmnigentSession> {
    const labels: Record<string, string> = { ...(input.labels ?? {}) };
    if (input.familiar) labels["coven.familiar"] = input.familiar;
    if (input.sourceSha256) labels["coven.source_sha256"] = input.sourceSha256;

    const hostType = input.hostType ?? "external";
    const hasHost = Boolean(input.hostId) && hostType === "external";
    const prompt = input.prompt?.trim() || "";

    // Host-launched: defer prompt to /events after create (Codex P1).
    // CLI-bound / no host: initial_items is fine.
    const seedInitialItems = Boolean(prompt) && !hasHost;

    const body: Record<string, unknown> = {
      agent_id: input.agentId,
      host_type: hostType,
      title: input.title ?? (input.familiar ? `${input.familiar}: run` : undefined),
      labels,
      initial_items: seedInitialItems
        ? [
            {
              type: "message",
              data: {
                role: "user",
                content: [{ type: "input_text", text: prompt }],
              },
            },
          ]
        : [],
    };

    if (hostType === "external") {
      if (input.hostId) body.host_id = input.hostId;
      if (input.workspace) body.workspace = input.workspace;
    } else if (input.workspace) {
      body.workspace = input.workspace;
    }

    const created = await this.request<OmnigentSession>("POST", "/v1/sessions", body);
    const sessionId = created.id;
    if (!sessionId) return created;

    if (hasHost && prompt) {
      // Host launch is async; brief settle so the runner can bind before the
      // first event. Retries cover slow host tunnels without blocking forever.
      const delaysMs = [0, 400, 800, 1600];
      let lastErr: unknown;
      for (const delay of delaysMs) {
        if (delay) await new Promise((r) => setTimeout(r, delay));
        try {
          await this.postMessage(sessionId, prompt);
          lastErr = undefined;
          break;
        } catch (err) {
          lastErr = err;
          // Retry only transient race (no runner / 409 / 503). 4xx auth/validation stop.
          if (err instanceof OmnigentError && err.status >= 400 && err.status < 500 && err.status !== 409) {
            throw err;
          }
        }
      }
      if (lastErr) {
        // Session exists with host; surface a soft failure by rethrowing so the
        // caller can show the session id + that the first turn did not dispatch.
        throw lastErr;
      }
    }

    // Return a fresh snapshot (runner_id / items after first event).
    try {
      return await this.getSession(sessionId);
    } catch {
      return created;
    }
  }

  webSessionUrl(sessionId: string): string {
    return `${this.baseUrl}/c/${encodeURIComponent(sessionId)}`;
  }
}

/** Prefer claude-native-ui, else first agent. */
export function pickDefaultAgentId(agents: OmnigentAgent[], preferred?: string): string | null {
  if (preferred) {
    const hit = agents.find((a) => a.id === preferred);
    if (hit) return hit.id;
  }
  const native = agents.find((a) => a.name === "claude-native-ui");
  if (native) return native.id;
  return agents[0]?.id ?? null;
}

export function pickDefaultHostId(hosts: OmnigentHost[], preferred?: string): string | null {
  if (preferred) {
    const hit = hosts.find((h) => h.host_id === preferred);
    if (hit) return hit.host_id;
  }
  const online = hosts.find((h) => (h.status ?? "").toLowerCase() === "online");
  return online?.host_id ?? hosts[0]?.host_id ?? null;
}
