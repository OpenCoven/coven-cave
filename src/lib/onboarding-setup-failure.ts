// Failure taxonomy for the wizard's setup actions (Coven home scaffold,
// daemon start, connection save). The install lane already ships hints from
// its API route; these three actions surfaced raw error messages with no
// next step and no retry, which strands exactly the users the wizard exists
// for. classifySetupFailure keeps the raw message (diagnosable) and derives
// one plain-language hint (actionable) from its shape.

export type SetupAction = "scaffold" | "daemon-start" | "connection-save";

export type SetupFailure = {
  action: SetupAction;
  /** Raw route/exception message — kept verbatim for diagnostics. */
  message: string;
  /** One plain-language next step, or null when the message defies classing. */
  hint: string | null;
};

const ACTION_FALLBACK_MESSAGE: Record<SetupAction, string> = {
  scaffold: "setup failed",
  "daemon-start": "daemon start failed",
  "connection-save": "connection setup failed",
};

/** The label the error banner's retry affordance shows for each action. */
export function setupRetryLabel(action: SetupAction): string {
  switch (action) {
    case "scaffold":
      return "Retry creating Coven home";
    case "daemon-start":
      return "Retry daemon start";
    case "connection-save":
      return "Retry saving connection";
  }
}

function hintFor(action: SetupAction, message: string): string | null {
  // Order matters: the first matching class wins, and the most specific
  // shapes (missing binary, permissions, ports) come before generic
  // transport failures.
  if (/not found on PATH|ENOENT|spawn .*coven/i.test(message)) {
    return action === "daemon-start"
      ? "The daemon is started by the `coven` binary. Finish step 1 (Install the Coven CLI), then retry."
      : "The Coven CLI wasn't found on PATH. Finish step 1 (Install the Coven CLI), then retry.";
  }
  if (/EACCES|EPERM|permission denied|read-only file system|EROFS/i.test(message)) {
    return "Cave couldn't write to your home folder. Check ownership and permissions of ~/.coven (e.g. `ls -ld ~/.coven`), fix them, then retry.";
  }
  if (/EADDRINUSE|address already in use|socket.*in use|port .*in use/i.test(message)) {
    return "Another process is holding the daemon's socket or port. Stop the other copy (or restart Cave so it can reconnect), then retry.";
  }
  if (/ENOSPC|no space left/i.test(message)) {
    return "The disk is full. Free some space, then retry.";
  }
  if (/timeout|timed out|ETIMEDOUT/i.test(message)) {
    return action === "daemon-start"
      ? "The daemon didn't come up within its start window. It may still be warming up — wait a moment for the next status re-check, or retry."
      : "The request timed out. The machine may be busy — retry in a moment.";
  }
  if (/failed to fetch|networkerror|fetch failed|ECONNREFUSED|load failed/i.test(message)) {
    return "Cave's local server didn't answer. Restart Cave, then retry.";
  }
  if (/invalid|must be|expected/i.test(message) && action === "connection-save") {
    return "Check the hub URL and executor URLs — every entry must be a reachable http(s) address.";
  }
  return null;
}

/** Build the structured failure the wizard's error banner renders: verbatim
 *  message + derived hint. `raw` may be an Error, a string, or anything a
 *  rejected fetch produced. */
export function classifySetupFailure(action: SetupAction, raw: unknown): SetupFailure {
  const message =
    raw instanceof Error
      ? raw.message
      : typeof raw === "string" && raw.trim()
        ? raw.trim()
        : ACTION_FALLBACK_MESSAGE[action];
  return { action, message, hint: hintFor(action, message) };
}
