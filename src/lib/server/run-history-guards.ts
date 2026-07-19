import { isLocalOrigin } from "@/lib/server/local-origin";

/**
 * Run-history ownership + forge-resistance model (issue #3470).
 *
 * Flow and workflow run records back the run-history UI and any automation
 * that keys off run status. To keep that history trustworthy the mutating
 * routes (POST/PATCH/DELETE) enforce a single, shared model:
 *
 * 1. OWNERSHIP. Run records are executor/daemon owned in production. The
 *    daemon is the authoritative writer of production status transitions and
  *    it presents the first-party sidecar token, so only a request that passes
  *    `isLocalOrigin` may claim `source: "daemon"` (this implicitly requires the
  *    token when `COVEN_CAVE_AUTH_TOKEN` is configured). Mobile/tailnet callers
  *    are always pinned to `source: "cave"`. Client POSTs remain allowed for editor preview / dry-run
  *    snapshots, but they cannot forge daemon provenance.
 *    snapshots, but they cannot forge daemon provenance.
 *
 * 2. DESKTOP-ONLY MUTATION. All mutators are gated by `isLocalOrigin`, which
 *    rejects mobile/tailnet requests even when the Host header is spoofed to
 *    loopback. Reads (GET) stay open so the iOS app can render history.
 *
 * 3. BOUNDED STEPS. Step arrays are capped by count and serialized bytes so a
 *    single forged/oversized run cannot balloon the store (DoS footgun).
 *
 * 4. SAFE WIPE. A full history wipe requires an explicit `?all=1` flag;
 *    scoped deletes by flow/workflow id do not. This prevents an accidental
 *    "delete everything" from a bare DELETE.
 *
 * Both route families import from here so their guards stay in lockstep.
 */

/** Max number of steps persisted per run record. */
export const MAX_RUN_STEPS = 500;

/** Max serialized byte size of a run's steps array. */
export const MAX_RUN_STEPS_BYTES = 256 * 1024;

export type StepValidation<T> =
  | { ok: true; steps: T[] }
  | { ok: false; error: string };

/**
 * Validate and bound an incoming steps array. Non-arrays coerce to an empty
 * list (backwards compatible with the previous `Array.isArray(...) ? ... : []`
 * behavior); arrays that exceed the count or byte caps are rejected so the
 * caller returns a 413-style error instead of persisting an oversized record.
 */
export function validateSteps<T>(value: unknown): StepValidation<T> {
  if (!Array.isArray(value)) {
    return { ok: true, steps: [] };
  }
  if (value.length > MAX_RUN_STEPS) {
    return { ok: false, error: `too many steps (max ${MAX_RUN_STEPS})` };
  }
  let bytes: number;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return { ok: false, error: "steps not serializable" };
  }
  if (bytes > MAX_RUN_STEPS_BYTES) {
    return { ok: false, error: `steps too large (max ${MAX_RUN_STEPS_BYTES} bytes)` };
  }
  return { ok: true, steps: value as T[] };
}

/**
 * Resolve the trustworthy `source` for a run write. Only a token-bearing
 * desktop/loopback request may assert `daemon`; everything else is `cave`,
 * regardless of what the body claims.
 */
export function resolveRunSource(req: Request, claimed: unknown): "cave" | "daemon" {
  if (claimed === "daemon" && isLocalOrigin(req)) return "daemon";
  return "cave";
}

/**
 * Decide whether a DELETE is a scoped clear (by id) or a full wipe, and
 * whether a full wipe is authorized. Full wipes require `?all=1`.
 */
export function resolveWipe(
  scopeId: string | undefined,
  searchParams: URLSearchParams,
): { ok: true; scopeId: string | undefined } | { ok: false; error: string } {
  if (scopeId) return { ok: true, scopeId };
  if (searchParams.get("all") === "1") return { ok: true, scopeId: undefined };
  return {
    ok: false,
    error: "full run-history wipe requires ?all=1 (or pass an id to scope the clear)",
  };
}
