export type Familiar = {
  id: string;
  name?: string;
  display_name: string;
  role: string;
  description?: string;
  pronouns?: string;
  status?: string;
  last_seen?: string;
  active_sessions?: number;
  memory_freshness?: string;
  /**
   * Legacy daemon emoji field. Treated as a glyph hint of last resort —
   * `icon` wins when both are present.
   */
  emoji?: string;
  /**
   * Daemon-owned glyph. Either a literal emoji character (`"🐈"`) or a
   * Phosphor icon name (`"ph:cat-fill"`). Written by `PUT /api/v1/familiars/{id}/icon`.
   * Wins over `emoji` and is the primary daemon source of truth for the
   * familiar's glyph. The Cave-local override store still wins on render
   * while it has a value, but its writes flow back into this field.
   */
  icon?: string;
  // CovenCave-side enrichment from cave-config.json
  harness?: string;
  model?: string;
  note?: string;
};

export type DaemonStatus = {
  running: boolean;
  reason?: string;
  apiVersion?: string;
  covenVersion?: string;
  daemon?: { pid: number; startedAt: string; socket: string };
};

export type SessionRow = {
  id: string;
  project_root: string;
  harness: string;
  title: string;
  status: string;
  exit_code: number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  familiarId?: string | null;
  origin?: SessionOrigin;
};

export type SessionOrigin =
  | "chat"
  | "mention"
  | "board"
  | "cron"
  | "heartbeat"
  | "call";
