import type { Familiar, SessionRow } from "@/lib/types";

export type PresenceState =
  | "focused"
  | "blocked"
  | "dreaming"
  | "idle"
  | "offline"
  | "remote"
  | "failed"
  | "missing";

export type Presence = {
  state: PresenceState;
  label: string;
  /** Tailwind classes for the pill background + text. */
  pill: string;
  /** Tailwind class for the small status dot. */
  dot: string;
};

/**
 * Harness IDs that indicate a familiar lives in a remote lane (e.g. Telegram
 * via OpenClaw) and has no local daemon session. These should read as
 * "remote" rather than "offline" — the familiar is reachable, just not via
 * the local Coven daemon.
 */
export const REMOTE_HARNESSES = new Set(["openclaw", "telegram", "signal", "whatsapp"]);

const PRESETS: Record<PresenceState, Pick<Presence, "label" | "pill" | "dot">> = {
  focused: { label: "focused", pill: "bg-emerald-500/15 text-emerald-300", dot: "bg-emerald-400" },
  blocked: { label: "needs reply", pill: "bg-amber-500/20 text-amber-200", dot: "bg-amber-400" },
  dreaming: { label: "dreaming", pill: "bg-purple-500/15 text-purple-200", dot: "bg-purple-400" },
  failed: { label: "failed", pill: "bg-rose-500/20 text-rose-200", dot: "bg-rose-400" },
  offline: { label: "offline", pill: "bg-zinc-700/40 text-zinc-400", dot: "bg-zinc-600" },
  remote:  { label: "remote",  pill: "bg-sky-900/40 text-sky-400",  dot: "bg-sky-600" },
  missing: { label: "missing", pill: "bg-rose-700/30 text-rose-200", dot: "bg-rose-500" },
  idle: { label: "idle", pill: "bg-zinc-800 text-zinc-400", dot: "bg-zinc-600" },
};

type Args = {
  familiar: Familiar;
  sessions: SessionRow[];
  needsReply: boolean;
  harnessInstalled?: boolean;
  /** True when the harness is installed locally. Remote-only harnesses pass false here. */
  isRemoteHarness?: boolean;
};

const DREAM_WINDOW_HOURS = 24;

/** Crude "X minutes ago" → minutes converter that handles the daemon's
 * memory_freshness format ("5m ago", "3h ago", "2d ago"). */
function freshMinutes(raw?: string): number | null {
  if (!raw) return null;
  const m = raw.match(/(\d+)\s*([smhd])/i);
  if (!m) return null;
  const value = parseInt(m[1], 10);
  switch (m[2].toLowerCase()) {
    case "s":
      return value / 60;
    case "m":
      return value;
    case "h":
      return value * 60;
    case "d":
      return value * 60 * 24;
    default:
      return null;
  }
}

export function computePresence({ familiar, sessions, needsReply, harnessInstalled, isRemoteHarness }: Args): Presence {
  const mine = sessions.filter((s) => s.familiarId === familiar.id);
  const running = mine.some((s) => s.status === "running");
  const recentlyFailed = mine
    .filter((s) => s.status === "failed")
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0];

  // Was the most recent session a failure in the last hour?
  const failedFresh =
    recentlyFailed &&
    Date.now() - new Date(recentlyFailed.updated_at).getTime() < 60 * 60 * 1000 &&
    !running;

  const onlineByDaemon = familiar.status === "online";
  const dreamMinutes = freshMinutes(familiar.memory_freshness);
  const dreaming =
    dreamMinutes != null && dreamMinutes < DREAM_WINDOW_HOURS * 60 && !running && !needsReply;

  // Remote-only harnesses (openclaw/Telegram lanes) are never "offline" —
  // they simply have no local daemon session. Show "remote" instead.
  if (isRemoteHarness) {
    if (needsReply) return { state: "blocked", ...PRESETS.blocked };
    return { state: "remote", ...PRESETS.remote };
  }

  if (harnessInstalled === false) return { state: "missing", ...PRESETS.missing };
  if (needsReply) return { state: "blocked", ...PRESETS.blocked };
  if (running) return { state: "focused", ...PRESETS.focused };
  if (failedFresh) return { state: "failed", ...PRESETS.failed };
  if (dreaming) return { state: "dreaming", ...PRESETS.dreaming };
  if (!onlineByDaemon && mine.length === 0) return { state: "offline", ...PRESETS.offline };
  return { state: "idle", ...PRESETS.idle };
}
