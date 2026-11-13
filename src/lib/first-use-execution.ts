import { parseFirstUseState, type FirstUseState } from "./first-use.ts";

export const FIRST_USE_OPEN_EVENT = "cave:first-use-open";
export const FIRST_USE_REQUIRED_MESSAGE = "Complete the introduction before starting a familiar run. Your draft is kept.";
let knownState: FirstUseState | null = null;
let readInFlight: Promise<void> | null = null;

/** The workspace provider publishes only parsed, acknowledged host progress. */
export function publishFirstUseExecutionState(state: FirstUseState): void {
  knownState = parseFirstUseState(state);
}

/** All browser familiar generations share the introduction gate, including
 * Enhance and automatic suggestions. Server/CLI workers have no UI journey;
 * their existing authorization and execution contracts remain authoritative. */
export async function firstUseAllowsExecution(): Promise<boolean> {
  if (typeof window === "undefined") return true;
  if (!knownState) {
    readInFlight ??= (async () => {
      try {
        const response = await fetch("/api/onboarding/journey", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
        const data = await response.json();
        if (response.ok && data.ok && !knownState) knownState = parseFirstUseState(data.state);
      } catch { /* Missing or unreadable progress remains a visible blocker. */ }
    })().finally(() => { readInFlight = null; });
    await readInFlight;
  }
  if (knownState?.step === "complete") return true;
  window.dispatchEvent(new Event(FIRST_USE_OPEN_EVENT));
  return false;
}
