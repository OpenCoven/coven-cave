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
 *   covenBinary?: string,
 *   covenVersion?: string,
 *   covenVersionOutput?: string,
 *   covenMinimumVersion?: string,
 *   covenDrain?: {
 *     phase: string,
 *     waitMs: number,
 *     writerCount?: number,
 *     writers: { id: string, kind: string, expires_at: number }[],
 *   },
 * }} FenceRefusal
 */

/**
 * @param {FenceRefusal} refusal
 * @param {number} [now]
 * @returns {string}
 */
export function fenceRefusalMessage(refusal, now = Date.now()) {
  const lines = [`maintenance fence acquisition failed: ${refusal.reason ?? "unknown"}`];
  if (refusal.reason === "coven-still-draining" || refusal.reason === "coven-acquire-failed: coven-still-draining") {
    lines.push("  Coven has fenced new writers but is still draining existing writer leases.");
    if (refusal.covenDrain) {
      const { waitMs, writers, writerCount = writers.length } = refusal.covenDrain;
      lines.push(`  ${writerCount} existing writer lease(s) remained after the ${waitMs}ms wait.`);
      for (const writer of writers.slice(0, 10)) {
        lines.push(`    ${writer.id} (${writer.kind}); lease expires ${new Date(writer.expires_at * 1_000).toISOString()}`);
      }
      if (writerCount > 10) lines.push(`    ${writerCount - 10} more writer lease(s).`);
    }
    lines.push(
      "  A supervisor can keep renewing a writer lease, including your own session.",
      "  Waiting longer alone may never converge; missing session-index data is not proof it is dead.",
      "  Inspect with the resolved Coven CLI: coven maintenance status --json",
      '  For managed worktree creation only, explicitly append --override-coven-drain "<reason>".',
      "  This accepts the already-observed writer generations; it does not stop their work.",
      "  Lease ownership, expiry, local exclusion and retirement remain strict.",
      "  Destructive rollback is disabled: failures preserve new artifacts for separately fenced recovery.",
      "  Do not remove writer records or terminate an unidentified session.",
    );
  }
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
  // A version refusal is about the WRONG BINARY far more often than a missing
  // one: several `coven` installs routinely coexist on one machine (an npm
  // global, a `cargo install` copy in ~/.cargo/bin, a vendored one) and only
  // the resolver knows which it picked. Naming it, what it reported, what is
  // required, and the override turns a toolchain-fault hunt into one command
  // (cave-6bb4m). Every field is optional, so a caller that cannot supply one
  // degrades to fewer lines rather than to "undefined".
  if (refusal.covenBinary || refusal.covenVersion || refusal.covenVersionOutput) {
    if (refusal.covenBinary) lines.push(`  coven binary: ${refusal.covenBinary}`);
    if (refusal.covenVersion) lines.push(`  it reported version: ${refusal.covenVersion}`);
    if (refusal.covenVersionOutput) {
      lines.push(`  its --version output: ${refusal.covenVersionOutput}`);
    }
    if (refusal.covenMinimumVersion) {
      lines.push(`  minimum supported: ${refusal.covenMinimumVersion} (prereleases are not accepted)`);
    }
    lines.push(
      "  Another install may already be supported. Check every one on PATH, then",
      "  point COVEN_BIN at an absolute path to a supported launcher and rerun:",
      "    COVEN_BIN=/absolute/path/to/coven pnpm beads:worktrees:create …",
    );
  }
  lines.push(
    "  Do NOT fall back to `git worktree add`: a worktree created that way",
    "  carries no lifecycle metadata, reports `uncertain` permanently, and can",
    "  never be retired automatically (cave-l52dt).",
  );
  return lines.join("\n");
}
