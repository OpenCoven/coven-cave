/**
 * Whether `--apply` may proceed on a degraded maintenance gate (cave-s03wp).
 *
 * `--apply` refuses unless all four maintenance planes report `enforced`. Three
 * of them — coven, beads, github — are hard-coded off pending cave-wqa0b.2/.3/.4,
 * all BLOCKED with no movement, so automated retirement has been unreachable for
 * as long as those have been open (cave-3aqvr).
 *
 * The cost is not theoretical and it compounds. Creation is automated;
 * retirement is not. Observed 2026-08-08: four units were hand-retired and the
 * checkout still went 19 -> 22 in the same session, because other sessions
 * created worktrees faster than hand-retirement removed them. Observed
 * 2026-08-10: the checkout reached 42 against a budget of 28, with 20 active
 * exceptions, and every sweep that day reported zero retirable units — the two
 * that had landed were held by cooldown and by this very gate.
 *
 * So this module admits a deliberately narrow exception, and the narrowness is
 * the whole design:
 *
 *  - **`local` is never waivable.** It is the plane performing the actual
 *    exclusion — the one that stops two actors retiring the same unit. Waiving
 *    it would not be a degraded run, it would be an unguarded one.
 *  - **Only the known-pending planes may be waived.** A plane that is off for a
 *    reason nobody has recorded is not a known gap; it is an unknown one, and
 *    unknown gaps are what a gate exists to catch.
 *  - **Never implicit.** Without the opt-in the answer is exactly what it is
 *    today, so no existing invocation changes behaviour.
 *
 * The caller is expected to audit any admitted degraded run — which planes were
 * waived, and which units were retired — because a retirement performed without
 * the coven/beads/github planes should be reconstructable later.
 */

export type MaintenancePlaneName = "local" | "coven" | "beads" | "github";

export type MaintenancePlaneState = { enforced: boolean; source?: string };

export type MaintenancePlaneCapabilities = Record<MaintenancePlaneName, MaintenancePlaneState>;

export type PlaneAdmission =
  | { ok: true; degraded: false }
  | { ok: true; degraded: true; waivedPlanes: MaintenancePlaneName[] }
  | { ok: false; code: PlaneAdmissionRefusal; missingPlanes: MaintenancePlaneName[]; diagnostic: string };

export type PlaneAdmissionRefusal =
  /** Planes are missing and the caller did not opt in. Today's behaviour. */
  | "gate-incomplete"
  /** The local plane is unenforced. Never waivable, flag or not. */
  | "local-plane-unenforced"
  /** A plane is off for a reason outside the known pending set. */
  | "unknown-plane-unenforced";

/**
 * Planes whose absence is a known, filed gap rather than a surprise. Kept as an
 * explicit set rather than "everything except local", so a plane added later
 * defaults to blocking until someone decides it is waivable.
 */
const WAIVABLE_PLANES: ReadonlySet<MaintenancePlaneName> = new Set(["coven", "beads", "github"]);

const PLANE_ORDER: readonly MaintenancePlaneName[] = ["local", "coven", "beads", "github"];

export function assessMaintenancePlaneAdmission(input: {
  capabilities: MaintenancePlaneCapabilities;
  /** The explicit opt-in. Absent, behaviour is unchanged. */
  allowUnenforcedPlanes: boolean;
}): PlaneAdmission {
  const missingPlanes = PLANE_ORDER.filter(
    (plane) => input.capabilities[plane]?.enforced === false,
  );

  if (missingPlanes.length === 0) return { ok: true, degraded: false };

  if (!input.allowUnenforcedPlanes) {
    return {
      ok: false,
      code: "gate-incomplete",
      missingPlanes,
      diagnostic:
        `--apply unavailable; missing maintenance planes: ${missingPlanes.join(", ")}`,
    };
  }

  // Checked before the known-set test so that waiving local can never be
  // reported as merely "unknown plane" — it is a categorically different
  // refusal and deserves its own message.
  if (missingPlanes.includes("local")) {
    return {
      ok: false,
      code: "local-plane-unenforced",
      missingPlanes,
      diagnostic:
        "the local maintenance plane is unenforced and is never waivable: it performs the exclusion that stops two actors retiring the same unit, so proceeding would be an unguarded run rather than a degraded one",
    };
  }

  const unknown = missingPlanes.filter((plane) => !WAIVABLE_PLANES.has(plane));
  if (unknown.length > 0) {
    return {
      ok: false,
      code: "unknown-plane-unenforced",
      missingPlanes,
      diagnostic:
        `these planes are unenforced for reasons outside the known pending set (${unknown.join(", ")}); an unrecorded gap is exactly what the gate exists to catch, so --allow-unenforced-planes does not waive it`,
    };
  }

  return { ok: true, degraded: true, waivedPlanes: missingPlanes };
}
