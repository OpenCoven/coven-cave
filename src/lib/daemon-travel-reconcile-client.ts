export type DaemonTravelReconcileRequest = (input: { signal: AbortSignal }) => Promise<void>;

export type DaemonTravelReconcileRequester = {
  trigger(): void;
  stop(): void;
};

export function createDaemonTravelReconcileRequester(
  input: { request: DaemonTravelReconcileRequest },
): DaemonTravelReconcileRequester {
  let stopped = false;
  let trailing = false;
  let active: { controller: AbortController; promise: Promise<void> } | null = null;

  function start(): void {
    if (stopped || active) return;
    const controller = new AbortController();
    const request = {
      controller,
      promise: Promise.resolve()
        .then(() => input.request({ signal: controller.signal }))
        .catch(() => {})
        .finally(() => {
          if (active?.controller === controller) active = null;
          if (stopped || !trailing) {
            trailing = false;
            return;
          }
          trailing = false;
          start();
        }),
    };
    active = request;
    request.promise.catch(() => {});
  }

  return {
    trigger(): void {
      if (stopped) return;
      if (active) {
        trailing = true;
        return;
      }
      start();
    },

    stop(): void {
      stopped = true;
      trailing = false;
      const current = active;
      active = null;
      current?.controller.abort();
    },
  };
}
