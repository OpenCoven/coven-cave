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
   * Daemon-owned glyph hint. Either a literal emoji character (`"🐈"`) or a
   * Phosphor icon name (`"ph:cat-fill"`). The Cave-local override store
   * (see `cave-glyph-overrides.ts`) wins over this when both are present.
   */
  emoji?: string;
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
};
