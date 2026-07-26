/** Wire types for Omnigent OpenAPI used by Cave Fleet. */

export type OmnigentHost = {
  host_id: string;
  name?: string | null;
  owner?: string | null;
  status?: string | null;
  sandbox_provider?: string | null;
  configured_harnesses?: Record<string, boolean>;
};

export type OmnigentAgent = {
  id: string;
  name: string;
  description?: string | null;
  harness?: string | null;
  builtin?: boolean;
  created_at?: number;
};

export type OmnigentSessionListItem = {
  id: string;
  agent_id: string;
  agent_name?: string | null;
  status: string;
  created_at: number;
  updated_at?: number;
  title?: string | null;
  labels?: Record<string, string>;
  runner_id?: string | null;
  host_id?: string | null;
  owner?: string | null;
  pending_elicitations_count?: number;
  archived?: boolean;
};

export type OmnigentSession = OmnigentSessionListItem & {
  workspace?: string | null;
  runner_online?: boolean | null;
  host_online?: boolean | null;
  harness?: string | null;
  items?: unknown[];
  last_task_error?: { code?: string; message?: string } | null;
};

export type CreateSessionInput = {
  agentId: string;
  prompt?: string;
  hostId?: string;
  workspace?: string;
  hostType?: "external" | "managed";
  title?: string;
  familiar?: string;
  sourceSha256?: string;
  labels?: Record<string, string>;
};

export type CaveOmnigentConfig = {
  /** Omnigent server base URL, e.g. https://omnigent.tail3c92ee.ts.net */
  baseUrl: string;
  /** Preferred catalog agent id (from GET /v1/agents). Empty = auto-pick claude-native-ui. */
  defaultAgentId: string;
  /** Preferred host id when starting a run. Empty = first online host. */
  defaultHostId: string;
  /** Absolute default workspace path for new runs on external hosts. */
  defaultWorkspace: string;
  /**
   * Map Cave/SSH host aliases → Omnigent host_id.
   * e.g. { "ubuntu-root": "host_9add…" }
   */
  hostMap: Record<string, string>;
  /**
   * Absolute workspace path keyed by Omnigent host_id, host name, or hostMap alias.
   * Used after the run host is resolved; falls back to defaultWorkspace.
   * e.g. { "host_854c…": "/Users/…/coven-cave", "ubuntu-root": "/root/work" }
   */
  hostWorkspaceMap: Record<string, string>;
  /**
   * When true, /api/hosts includes Omnigent fleet hosts (omnigent:<host_id>)
   * in the composer Host chip so Chat/Home can run on the fleet.
   */
  exposeHostsInComposer: boolean;
};
