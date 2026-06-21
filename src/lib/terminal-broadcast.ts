// Pure helper for broadcast-input ("sync panes") mode: when a keystroke is typed
// in one pane, it is mirrored to every OTHER live pane. The origin pane has
// already written to its own PTY, so it must be excluded to avoid a double
// write. Kept DOM-free so the fan-out target selection is unit-testable.

/**
 * The pane ids that should receive a mirrored keystroke originating in
 * `originId`: every id except the origin, de-duplicated, in input order.
 */
export function broadcastTargetIds(
  paneIds: readonly string[],
  originId: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of paneIds) {
    if (!id || id === originId || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Broadcast only does something useful with two or more live panes. */
export function broadcastIsActionable(enabled: boolean, paneCount: number): boolean {
  return enabled && paneCount > 1;
}
