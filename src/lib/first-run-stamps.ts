// cave-fy1q phase 3: first-run funnel stamps — measurement only. Two keys,
// each written once ever: first app open (only stamped while onboarding is
// still undismissed, so existing installs never fake a fresh funnel) and the
// first completed familiar reply (only stamped when a first-open exists).
// Time-to-first-reply is the delta the analytics header surfaces.

export const FIRST_OPEN_AT_KEY = "cave:first-open-at";
export const FIRST_REPLY_AT_KEY = "cave:first-reply-at";
const ONBOARDING_DISMISSED_KEY = "cave:onboarding:dismissed";

type StringStore = Pick<Storage, "getItem" | "setItem">;

function defaultStore(): StringStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Stamp the first app open — only on a machine still mid-onboarding, so the
 *  funnel measures fresh installs and never re-anchors an existing one. */
export function stampFirstOpenOnce(store: StringStore | null = defaultStore(), now = new Date()): void {
  if (!store) return;
  try {
    if (store.getItem(FIRST_OPEN_AT_KEY)) return;
    if (store.getItem(ONBOARDING_DISMISSED_KEY)) return;
    store.setItem(FIRST_OPEN_AT_KEY, now.toISOString());
  } catch {
    /* best-effort */
  }
}

/** Stamp the first completed reply — requires a first-open anchor, so
 *  pre-existing installs (no anchor) never record a meaningless delta. */
export function stampFirstReplyOnce(store: StringStore | null = defaultStore(), now = new Date()): void {
  if (!store) return;
  try {
    if (store.getItem(FIRST_REPLY_AT_KEY)) return;
    if (!store.getItem(FIRST_OPEN_AT_KEY)) return;
    store.setItem(FIRST_REPLY_AT_KEY, now.toISOString());
  } catch {
    /* best-effort */
  }
}

/** Milliseconds from first open to first reply, when both stamps exist. */
export function timeToFirstReplyMs(store: StringStore | null = defaultStore()): number | null {
  if (!store) return null;
  try {
    const open = store.getItem(FIRST_OPEN_AT_KEY);
    const reply = store.getItem(FIRST_REPLY_AT_KEY);
    if (!open || !reply) return null;
    const ms = Date.parse(reply) - Date.parse(open);
    return Number.isFinite(ms) && ms >= 0 ? ms : null;
  } catch {
    return null;
  }
}

/** Compact human form: "42s", "18m", "3h 20m", "2d 4h". */
export function formatTimeToFirstReply(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH > 0 ? `${d}d ${remH}h` : `${d}d`;
}
