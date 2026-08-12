/**
 * Render a maintenance fence refusal as something the reader can act on.
 *
 * Lives in its own module because `worktree-lifecycle-create.ts` calls `main()`
 * at load, so a function defined there cannot be imported by a test without
 * running the CLI. The rendering is the part with branches worth pinning.
 *
 * @typedef {{
 *   reason?: string,
 *   holder?: string,
 *   holderPid?: number,
 *   holderHost?: string,
 *   phase?: string,
 *   expiresAt?: string,
 * }} FenceRefusal
 */

/**
 * @param {FenceRefusal} refusal
 * @param {number} [now]
 * @returns {string}
 */
export function fenceRefusalMessage(refusal, now = Date.now()) {
  const lines = [`maintenance fence acquisition failed: ${refusal.reason ?? "unknown"}`];
  if (refusal.holder) {
    const pid = Number.isSafeInteger(refusal.holderPid) ? ` (pid ${refusal.holderPid}` : "";
    const host = pid && refusal.holderHost ? ` on ${refusal.holderHost})` : pid ? ")" : "";
    lines.push(`  held by: ${refusal.holder}${pid}${host}`);
  }
  if (refusal.phase) lines.push(`  phase: ${refusal.phase}`);

  const expiresAtMs = refusal.expiresAt ? Date.parse(refusal.expiresAt) : Number.NaN;
  if (Number.isFinite(expiresAtMs)) {
    const remainingMs = expiresAtMs - now;
    if (remainingMs > 0) {
      lines.push(
        `  lease expires: ${refusal.expiresAt} (in ~${Math.ceil(remainingMs / 1000)}s)`,
        "  Wait for the lease to expire, then rerun this command.",
      );
    } else {
      // A `gate-stale` refusal is exactly this: the lease is already past its
      // TTL and the gate STILL refuses, because the owner is not provably gone
      // and nothing in shipping code passes `takeoverStale`. Telling this
      // reader to wait would be the same unactionable advice this whole change
      // exists to remove — the wait already happened and did not help.
      lines.push(
        `  lease expired: ${refusal.expiresAt} (${Math.floor(-remainingMs / 1000)}s ago)`,
        "  Waiting will NOT clear this. The lease has already lapsed and the fence",
        "  still refuses, so check whether the holder process above is alive.",
      );
    }
  }
  lines.push(
    "  Do NOT fall back to `git worktree add`: a worktree created that way",
    "  carries no lifecycle metadata, reports `uncertain` permanently, and can",
    "  never be retired automatically (cave-l52dt).",
  );
  return lines.join("\n");
}
