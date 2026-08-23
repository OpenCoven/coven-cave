/**
 * The Coven daemon's `/api/v1/skills/eval-loop/:id` returns an enveloped
 * `{ ok, state: EvalLoopState }`. Several Cave call sites read the EvalLoopState
 * fields (`iterations`, `running`, `track_counts`, …) directly, so handing them
 * the envelope leaves every field `undefined` — the "double-wrap" bug.
 *
 * `unwrapDaemonEvalState` returns the inner EvalLoopState from that envelope,
 * while tolerating a daemon that already returns the state bare (detected by the
 * presence of an `iterations` field). Use it on the raw `callDaemon(...).data`
 * before reading state fields or re-serializing.
 */
export function unwrapDaemonEvalState(data: unknown): unknown {
  if (
    data &&
    typeof data === "object" &&
    "state" in data &&
    !("iterations" in data)
  ) {
    return (data as { state: unknown }).state;
  }
  return data;
}
