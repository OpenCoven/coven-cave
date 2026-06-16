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
  /** Legacy daemon glyph field. Treated as an icon hint of last resort. */
  emoji?: string;
  /**
   * Daemon-owned glyph. Must be a Phosphor icon name (`"ph:cat-fill"`).
   * Written by `PUT /api/v1/familiars/{id}/icon`.
   * Wins over `emoji` and is the primary daemon source of truth for the
   * familiar's glyph. The Cave-local override store still wins on render
   * while it has a value, but its writes flow back into this field.
   */
  icon?: string;
  /**
   * Absolute filesystem path to the familiar's workspace avatar image
   * (`~/.coven/workspaces/familiars/<id>/avatars/<img>`). Set by `/api/familiars`
   * only when an avatar exists on disk; absent otherwise. The client links
   * straight to this file through Tauri's asset protocol (`convertFileSrc`),
   * falling back to the `GET /api/familiars/<id>/avatar` route when the asset
   * link isn't usable (browser, or a workspace path outside the asset scope).
   */
  avatarPath?: string;
  /**
   * Avatar file mtime in ms — appended to the asset URL as `?v=` so an updated
   * image busts the webview cache without a restart.
   */
  avatarVersion?: number;
  // CovenCave-side enrichment from cave-config.json
  harness?: string;
  model?: string;
  note?: string;
  voiceProvider?: string;
  voiceModel?: string;
  voiceName?: string;
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
  model?: string | null;
  runtime?: string | null;
  title: string;
  status: string;
  exit_code: number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  familiarId?: string | null;
  origin?: SessionOrigin;
  initiator?: SessionInitiator;
  git?: SessionGitContext | null;
  pullRequest?: SessionPullRequestContext | null;
};

export type SessionGitContext = {
  branch?: string | null;
  worktreeRoot?: string | null;
  isWorktree?: boolean;
};

export type SessionPullRequestContext = {
  repo: string;
  number?: number;
  url?: string;
  state?: string;
  branch?: string;
  draft?: boolean;
};

export type SessionOrigin =
  | "chat"
  | "mention"
  | "board"
  | "cron"
  | "heartbeat"
  | "call";

export type SessionInitiator = {
  kind: "human" | "familiar" | "system" | "unknown";
  label: string;
  channel?: string;
  username?: string;
  agentId?: string;
};
