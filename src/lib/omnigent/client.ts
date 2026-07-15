import { loadOmnigentToken, normalizeOmnigentBaseUrl } from "./token.ts";
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

  constructor(baseUrl: string, token: string | null = null) {
    this.baseUrl = normalizeOmnigentBaseUrl(baseUrl);
    this.token = token;
  }

  static async fromBaseUrl(baseUrl: string): Promise<OmnigentClient> {
    const normalized = normalizeOmnigentBaseUrl(baseUrl);
    const token = await loadOmnigentToken(normalized);
    return new OmnigentClient(normalized, token);
  }

  get hasToken(): boolean {
    return Boolean(this.token);
  }

  private headers(json = true): HeadersInit {
    const h: Record<string, string> = { Accept: "application/json" };
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

  createSession(input: CreateSessionInput): Promise<OmnigentSession> {
    const labels: Record<string, string> = { ...(input.labels ?? {}) };
    if (input.familiar) labels["coven.familiar"] = input.familiar;
    if (input.sourceSha256) labels["coven.source_sha256"] = input.sourceSha256;

    const body: Record<string, unknown> = {
      agent_id: input.agentId,
      host_type: input.hostType ?? "external",
      title: input.title ?? (input.familiar ? `${input.familiar}: run` : undefined),
      labels,
      initial_items: input.prompt
        ? [
            {
              type: "message",
              data: {
                role: "user",
                content: [{ type: "input_text", text: input.prompt }],
              },
            },
          ]
        : [],
    };

    if ((input.hostType ?? "external") === "external") {
      if (input.hostId) body.host_id = input.hostId;
      if (input.workspace) body.workspace = input.workspace;
    } else if (input.workspace) {
      body.workspace = input.workspace;
    }

    return this.request("POST", "/v1/sessions", body);
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
