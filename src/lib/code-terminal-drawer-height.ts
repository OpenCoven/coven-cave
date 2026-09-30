/**
 * Terminal drawer height for the Coding Desk (#5705).
 *
 * The drawer shipped with two fixed heights and a Taller/Shorter toggle. A
 * shell you read logs in wants the height YOU chose, kept between sessions
 * and reloads, and never taller than the room it opens over. The clamp is the
 * only rule with teeth: a stored height from a larger window must not swallow
 * the source viewer on a smaller one.
 */

export const CODE_TERMINAL_HEIGHT_STORAGE_KEY = "cave.code.terminal-height";
export const CODE_TERMINAL_MIN_HEIGHT_PX = 160;
export const CODE_TERMINAL_DEFAULT_HEIGHT_PX = 260;
export const CODE_TERMINAL_TALL_HEIGHT_PX = 460;
/** The drawer may cover at most this much of the room. */
export const CODE_TERMINAL_MAX_FRACTION = 0.7;

export function clampCodeTerminalHeight(heightPx: number, roomHeightPx: number | null | undefined): number {
  const height = Number.isFinite(heightPx) ? heightPx : CODE_TERMINAL_DEFAULT_HEIGHT_PX;
  const max =
    roomHeightPx != null && roomHeightPx >= 0
      ? Math.floor(roomHeightPx * CODE_TERMINAL_MAX_FRACTION)
      : Number.POSITIVE_INFINITY;
  return Math.round(Math.min(max, Math.max(CODE_TERMINAL_MIN_HEIGHT_PX, height)));
}

export function isCodeTerminalTall(heightPx: number, roomHeightPx: number | null | undefined): boolean {
  return heightPx >= clampCodeTerminalHeight(CODE_TERMINAL_TALL_HEIGHT_PX, roomHeightPx);
}

/** The Taller/Shorter toggle: between the two presets, clamped to the room. */
export function toggleCodeTerminalHeight(heightPx: number, roomHeightPx: number | null | undefined): number {
  return isCodeTerminalTall(heightPx, roomHeightPx)
    ? clampCodeTerminalHeight(CODE_TERMINAL_DEFAULT_HEIGHT_PX, roomHeightPx)
    : clampCodeTerminalHeight(CODE_TERMINAL_TALL_HEIGHT_PX, roomHeightPx);
}

export function readCodeTerminalHeight(storage: Pick<Storage, "getItem"> | null | undefined): number {
  if (!storage) return CODE_TERMINAL_DEFAULT_HEIGHT_PX;
  try {
    const raw = storage.getItem(CODE_TERMINAL_HEIGHT_STORAGE_KEY);
    const parsed = raw == null ? Number.NaN : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? clampCodeTerminalHeight(parsed, null) : CODE_TERMINAL_DEFAULT_HEIGHT_PX;
  } catch {
    return CODE_TERMINAL_DEFAULT_HEIGHT_PX;
  }
}

export function writeCodeTerminalHeight(storage: Pick<Storage, "setItem"> | null | undefined, heightPx: number): void {
  if (!storage) return;
  try {
    storage.setItem(CODE_TERMINAL_HEIGHT_STORAGE_KEY, String(Math.round(heightPx)));
  } catch {
    /* private mode / quota — the height still applies for this session */
  }
}
