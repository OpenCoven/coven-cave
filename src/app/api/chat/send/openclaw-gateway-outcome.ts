export type OpenClawGatewayRunResult = {
  state: "final" | "aborted" | "error";
  message?: string;
};

export function resolveOpenClawGatewayOutcome(
  result: OpenClawGatewayRunResult,
  stopRequested: boolean,
  detachTimeoutFired: boolean,
): {
  cancelledByUser: boolean;
  isError: boolean;
  emptyText: string;
  progressMessage?: string;
} {
  // Only /api/chat/stop can set this flag. A Gateway abort can also result
  // from the detached-client cap, so it is an interruption rather than a
  // user cancellation unless the registry recorded an explicit Stop.
  const cancelledByUser = stopRequested;
  const interrupted = result.state === "aborted" && !cancelledByUser;
  const detached = interrupted && detachTimeoutFired;

  return {
    cancelledByUser,
    isError: result.state === "error" || interrupted,
    emptyText: cancelledByUser
      ? "(cancelled)"
      : detached
        ? "_The OpenClaw Gateway response was interrupted before returning text._"
        : interrupted
          ? "_The OpenClaw Gateway aborted._"
        : result.message ?? "_The OpenClaw Gateway returned no text._",
    progressMessage: detached
      ? "The OpenClaw Gateway response was interrupted after the client detached."
      : interrupted
      ? "The OpenClaw Gateway response was aborted."
      : result.message,
  };
}
