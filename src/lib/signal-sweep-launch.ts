import { requestAgentsNewChat, type AgentsNewChatRequest, type AgentsNewChatDispatchResult } from "./agents-new-chat";
import { signalSweepIdentity } from "./signal-sweep-identity";
import type { ThreadSignalReviewItem } from "./thread-self-report";

export type SignalSweepAccess = { available: boolean; error?: string };
const observedReceipts = new Map<string, string>();
const receiptKey = (familiarId: string, identity: string) => JSON.stringify([familiarId, identity]);
export async function checkSignalSweepAccess(familiarId: string): Promise<SignalSweepAccess> {
  try {
    const response = await fetch(`/api/chat/signal-sweeps?${new URLSearchParams({ familiarId })}`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    const body = await response.json();
    if (!response.ok || body.ok !== true || typeof body.available !== "boolean") throw new Error();
    return { available: body.available, error: typeof body.error === "string" ? body.error : undefined };
  } catch { return { available: false, error: "Couldn’t check signal fix access. Check again before starting a thread." }; }
}

/** One server reservation covers both the card and analytics entry points.
 * New reports keep the same upstream identity, so neither a remount nor a
 * regenerated report makes an unresolved blocker new work. */
export async function launchSignalSweep(
  familiarId: string,
  items: readonly ThreadSignalReviewItem[],
  request: Omit<AgentsNewChatRequest, "familiarId" | "requestId" | "initialPrompt">,
  prompt: (accepted: readonly ThreadSignalReviewItem[]) => string,
  retry = false,
  canDispatch: () => boolean = () => true,
  scope = request.sourceSessionId ?? "",
  sourceReportId = "",
): Promise<AgentsNewChatDispatchResult & { requestId?: string; accepted?: string[] }> {
  const keyOf = (item: ThreadSignalReviewItem) => signalSweepIdentity(item, scope);
  // Reserve a standalone analytics tab while the click still has user
  // activation. Opening it after the async preflight is blocked by browsers.
  let reservedWindow: Window | null = null;
  let handedOff = false;
  try {
    if (typeof window !== "undefined" && window.location?.pathname && window.location.pathname !== "/") {
      reservedWindow = window.open("about:blank", "_blank");
      if (!reservedWindow) return { ok: false, error: "Allow pop-ups to open the Chat panel in a new tab." };
      reservedWindow.opener = null;
    }
    const response = await fetch("/api/chat/signal-sweeps", { method: "POST", signal: AbortSignal.timeout(8_000), headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "prepare", familiarId, sourceReportId, identities: items.map(keyOf),
        ...(retry ? { expectedPrevious: Object.fromEntries(items.flatMap((item) => {
          const identity = keyOf(item), receipt = observedReceipts.get(receiptKey(familiarId, identity));
          return receipt ? [[identity, receipt]] : [];
        })) } : {}) }) });
    const body = await response.json();
    if (body.receipts && typeof body.receipts === "object") {
      for (const identity of items.map(keyOf)) {
        if (typeof body.receipts[identity] === "string") observedReceipts.set(receiptKey(familiarId, identity), body.receipts[identity]);
      }
      while (observedReceipts.size > 2_000) observedReceipts.delete(observedReceipts.keys().next().value!);
    }
    if (!response.ok || body.ok !== true || typeof body.requestId !== "string" || !Array.isArray(body.accepted)) {
      return { ok: false, error: typeof body.error === "string" ? body.error : "Couldn’t establish a signal fix receipt. Check again." };
    }
    const accepted = items.filter((item) => body.accepted.includes(keyOf(item)));
    if (!accepted.length) return { ok: false, error: "No new signals need a fix thread." };
    const result: AgentsNewChatDispatchResult = canDispatch()
      ? requestAgentsNewChat({ ...request, familiarId, requestId: body.requestId,
          initialPrompt: prompt(accepted), initialControls: { ...request.initialControls, permissionMode: "full" } },
          reservedWindow ? { reservedWindow } : undefined)
      : { ok: false, error: "The signal selection changed. No fix thread was requested." };
    handedOff = result.ok;
    if (!result.ok) {
      // A rejected synchronous handoff dispatched nothing. Uncertain network
      // or later async failures keep their receipt to avoid duplicate work.
      await fetch("/api/chat/signal-sweeps", { method: "POST", signal: AbortSignal.timeout(8_000), headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "release", familiarId, requestId: body.requestId }) }).catch(() => {});
    } else {
      await fetch("/api/chat/signal-sweeps", { method: "POST", signal: AbortSignal.timeout(8_000), headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "commit", familiarId, requestId: body.requestId }) }).catch(() => {});
    }
    return { ...result, requestId: body.requestId, accepted: body.accepted };
  } catch { return { ok: false, error: "Couldn’t confirm the signal fix request. Review the Chat panel before checking again." }; }
  finally { if (!handedOff) reservedWindow?.close(); }
}
