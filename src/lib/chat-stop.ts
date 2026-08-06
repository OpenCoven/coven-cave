export type ChatStopRequest = {
  runId: string;
};

export type ChatStopTerminalOutcome = "completed" | "error" | "cancelled";
export type ChatStopState = "accepted" | "transport-settled" | "not-found";

export type ChatStopResult = {
  runId: string;
  ok: boolean;
  stopped: boolean;
  status: number | null;
  state: ChatStopState | null;
  terminalOutcome: ChatStopTerminalOutcome | null;
  error?: string;
};

const CHAT_STOP_RETRY_DELAY_MS = 50;
const CHAT_STOP_TIMEOUT_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

export async function requestChatStopRun(request: ChatStopRequest): Promise<Omit<ChatStopResult, "runId">> {
  const response = await fetch("/api/chat/stop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId: request.runId }),
  });
  let payload: {
    ok?: boolean;
    stopped?: boolean;
    state?: ChatStopState;
    terminalOutcome?: ChatStopTerminalOutcome;
    error?: string;
  } | null = null;
  try {
    payload = await response.json() as {
      ok?: boolean;
      stopped?: boolean;
      state?: ChatStopState;
      terminalOutcome?: ChatStopTerminalOutcome;
      error?: string;
    };
  } catch {
    payload = null;
  }
  return {
    ok: response.ok,
    stopped: payload?.stopped ?? false,
    status: response.status,
    state: payload?.state ?? null,
    terminalOutcome: payload?.terminalOutcome ?? null,
    error: payload?.error ?? (response.ok ? undefined : `stop failed (${response.status})`),
  };
}

export async function stopChatRunWithRetry(args: {
  runId: string;
  stopRun: (request: ChatStopRequest) => Promise<Omit<ChatStopResult, "runId">>;
  isActive?: () => boolean;
  controller?: AbortController | null;
  abortLocalOnTransportSettled?: boolean;
  retryDelayMs?: number;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<ChatStopResult> {
  const isActive = args.isActive ?? (() => true);
  const now = args.now ?? (() => Date.now());
  const pause = args.sleep ?? sleep;
  const retryDelayMs = args.retryDelayMs ?? CHAT_STOP_RETRY_DELAY_MS;
  const timeoutMs = args.timeoutMs ?? CHAT_STOP_TIMEOUT_MS;
  const deadline = now() + timeoutMs;
  let acceptable = false;
  let shouldAbortLocal = false;
  let result: ChatStopResult = {
    runId: args.runId,
    ok: false,
    stopped: false,
    status: null,
    state: null,
    terminalOutcome: null,
  };

  for (;;) {
    if (!isActive()) {
      acceptable = true;
      break;
    }
    try {
      result = { runId: args.runId, ...await args.stopRun({ runId: args.runId }) };
    } catch (error) {
      result = {
        runId: args.runId,
        ok: false,
        stopped: false,
        status: null,
        state: null,
        terminalOutcome: null,
        error: error instanceof Error ? error.message : "stop failed",
      };
    }
    if (result.stopped) {
      acceptable = true;
      shouldAbortLocal = true;
      break;
    }
    if (result.state === "transport-settled") {
      acceptable = true;
      shouldAbortLocal = args.abortLocalOnTransportSettled ?? false;
      break;
    }
    if (!isActive()) {
      acceptable = true;
      break;
    }
    const retryable = now() < deadline;
    if (!retryable) {
      if (!result.error && isActive()) {
        result = {
          ...result,
          error: now() >= deadline ? "stop timed out" : "stop failed",
        };
      }
      shouldAbortLocal = isActive();
      break;
    }
    await pause(retryDelayMs);
  }

  if (shouldAbortLocal) args.controller?.abort();
  if (!acceptable && result.status === 404) {
    return result;
  }
  return result;
}
