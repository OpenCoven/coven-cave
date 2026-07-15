export type Familiar = {
  id: string;
  name?: string;
  display_name: string;
  role: string;
  description?: string;
  pronouns?: string;
  color?: string;
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
   * URL of the familiar's workspace avatar image
   * (`~/.coven/workspaces/familiars/<id>/avatars/<img>`), served by
   * `GET /api/familiars/{id}/avatar` and cache-busted by file mtime. Set by
   * `/api/familiars` only when an avatar exists on disk; absent otherwise.
   */
  avatarUrl?: string;
  // CovenCave-side enrichment from cave-config.json
  harness?: string;
  defaultHarness?: string;
  harnessOverride?: string | null;
  model?: string;
  note?: string;
  voiceProvider?: string;
  voiceModel?: string;
  voiceName?: string;
  autoSelfReport?: boolean;
  /** Per-agent Asana assignment (see FamiliarBinding). Undefined = on when the
   *  app is connected; false opts this familiar out. */
  asanaEnabled?: boolean;
  /** Optional Asana workspace gid this familiar is scoped to. */
  asanaWorkspaceGid?: string;
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
  /**
   * True for daemon sessions with no Cave conversation behind them — runs
   * spawned by generators (journal narratives, flows, automations, CLI runs)
   * rather than by someone chatting. Chat lists hide these; the sessions stay
   * reachable from their origination surfaces (Work Queue, Schedules, …).
   */
  generated?: boolean;
  initiator?: SessionInitiator;
  git?: SessionGitContext | null;
  /**
   * Branch recorded from the chat's own cwd when its last turn was saved —
   * per-session attribution for PR context. Distinct from `git.branch`, which
   * is whatever branch the project root happens to have checked out at poll
   * time (a shared checkout churns branches, so that must never be treated as
   * "this session's branch").
   */
  workBranch?: string | null;
  pullRequest?: SessionPullRequestContext | null;
  /** Working-tree change size vs HEAD, for the Recent Activity roll-up's `+N -N`. */
  diff?: { additions: number; deletions: number } | null;
  /** Keep mark from Cave state (never auto-archived when true). */
  keep?: boolean;
  /** Cave-local auto-archive defer-until timestamp, if set. */
  archive_extended_until?: string | null;
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
  | "call"
  | "canvas"
  | "journal"
  | "enhance";

export type SessionInitiator = {
  kind: "human" | "familiar" | "system" | "unknown";
  label: string;
  channel?: string;
  username?: string;
  agentId?: string;
};
