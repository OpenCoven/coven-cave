/**
 * rite-flow — when each step of the summoning rite is open (cave-3rz.3).
 *
 * The rite has one slow dependency: the scry, which costs 12–18 s and is the
 * thing that fills the offices and sigils. The original flow let the user walk
 * into the office step mid-flight and pick sigils the scry was about to write
 * over, which was a race patched with a `touched` ref rather than removed.
 *
 * This module removes it. While a scry is in flight the rite only offers the
 * two choices the scry never touches — the vessel (harness) and the mind
 * (model) — and the office step is held until the likeness has actually been
 * read. The wait becomes work rather than a collision.
 *
 * **The one rule that matters here is that it cannot deadlock.** Every way a
 * scry can end must open the step:
 *
 *  · `done`   — the scry landed, with or without usable offices.
 *  · `failed` — it errored, timed out, or the stream died.
 *  · manual   — the user skipped the scry, or no local vision harness exists.
 *  · a ceiling — even if the hook somehow never reaches a terminal state, the
 *    lock lifts on its own. This is belt-and-braces over `useScry`, which
 *    already guarantees a terminal state; a lock whose release depends on
 *    someone else's invariant is a lock that will one day not release.
 *
 * Pure and dependency-free so the gate is testable without a DOM — see
 * `rite-flow.test.ts`, which enumerates every status.
 */

/** The scry lifecycle, mirroring `ScryState["status"]` in `use-scry.ts`. */
export type RiteScryStatus = "idle" | "scrying" | "done" | "failed";

/**
 * How long the office step may be held before it opens regardless.
 *
 * A scry is 12–18 s against a local vision harness and the endpoint kills its
 * child at 90 s. This sits between the two: long enough that an ordinary slow
 * scry is never cut short, short enough that a wedged run does not strand
 * anyone. When it fires the step opens with nothing pre-filled, exactly as a
 * failure would.
 */
export const OFFICE_HOLD_CEILING_MS = 45_000;

export type OfficeGateInput = {
  /** The user is filling the rite in by hand; no scry will land. */
  manual: boolean;
  status: RiteScryStatus;
  /** The ceiling above has passed while still `scrying`. */
  waitedTooLong?: boolean;
};

/**
 * True only while a scry that could still populate the offices is in flight.
 *
 * `idle` is open on purpose: before an image is dropped there is nothing to
 * wait for, and someone who wants to summon with defaults must never be held.
 */
export function officeStepHeld({ manual, status, waitedTooLong }: OfficeGateInput): boolean {
  if (manual) return false;
  if (waitedTooLong) return false;
  return status === "scrying";
}

/**
 * Error codes that mean "no scry is possible here", as opposed to "this scry
 * did not work".
 *
 * `no_local_vision_harness` is the only one today: the machine has no local
 * harness that can open an image file, so retrying is pointless and an error
 * banner is the wrong shape. The rite drops into manual mode with a plain
 * explanation instead. Codes come from `POST /api/scry`'s error events.
 */
export const MANUAL_FALLBACK_CODES: readonly string[] = ["no_local_vision_harness"];

/** Whether a finished scry should turn the rite manual rather than show an error. */
export function shouldFallBackToManual(
  status: RiteScryStatus,
  errorCode: string | null | undefined,
): boolean {
  if (status !== "failed") return false;
  return !!errorCode && MANUAL_FALLBACK_CODES.includes(errorCode);
}
