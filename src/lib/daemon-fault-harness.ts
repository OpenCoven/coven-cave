import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

/**
 * Deterministic fault injection for daemon connectivity (cave-58eoq.4).
 *
 * Daemon connectivity tests kept re-inventing a throwaway `createServer` per
 * case, which made the interesting failures — a hang, a half-written body, a
 * reset mid-stream — one-off and easy to get subtly wrong. Worse, an ad-hoc
 * server that is hung or half-written is exactly the one whose `close()` never
 * resolves, so a test asserting on a fault would itself hang. A suite that
 * hangs on the failure path is not coverage; it is a stalled required check.
 *
 * So this harness owns two guarantees the individual tests could not:
 *
 *  - **Bounded.** Every accepted socket is tracked and destroyed on `close()`.
 *    Node's `server.close()` only stops new connections and waits for existing
 *    ones to drain; a deliberately hung response never drains. Without the
 *    socket registry, `hang` and `partial-response` would leak a handle and
 *    hold the process open past the test.
 *  - **Deterministic.** Faults are driven by request count, not wall-clock
 *    timing, so `delayedReadyAfter: 3` means the fourth request succeeds on a
 *    loaded CI runner exactly as it does locally. Where a delay is unavoidable
 *    it is explicit, small, and injectable.
 *
 * Transport note: this binds TCP on loopback rather than a unix socket or a
 * Windows named pipe. The HTTP contract is what the client code shares across
 * platforms, and loopback behaves identically on all three, so the same case
 * list runs everywhere. Pipe- and permission-specific faults belong to the
 * socket-boundary work in cave-58eoq.6, not here.
 */
export type DaemonFaultMode =
  /** Serves a healthy JSON body on every request. */
  | "healthy"
  /** Fails readiness for the first N requests, then serves healthy. */
  | "delayed-ready"
  /** Accepts the connection and never replies. Closeable regardless. */
  | "hang"
  /** Writes a JSON prefix, then destroys the socket mid-body. */
  | "partial-response"
  /** Destroys the connection before any byte of the response. */
  | "reset"
  /** Serves healthy N times, then stops listening entirely. */
  | "crash-after"
  /** Replies 401 with the daemon's error envelope. */
  | "unauthorized"
  /** Replies 403 — the shape a permission failure takes over HTTP. */
  | "forbidden"
  /** Replies with a body larger than any sane client cap. */
  | "oversized";

export type DaemonFaultOptions = {
  mode: DaemonFaultMode;
  /** Requests to fail before recovering, for `delayed-ready`. */
  delayedReadyAfter?: number;
  /** Requests to serve before dying, for `crash-after`. */
  crashAfter?: number;
  /** Body size for `oversized`. Kept small by default: the point is to exceed
   *  a client cap, and allocating megabytes per test buys nothing. */
  oversizedBytes?: number;
};

export type DaemonFaultHarness = {
  readonly url: string;
  readonly port: number;
  /** Requests the server has accepted, including ones it refused to answer. */
  requestCount(): number;
  /** Sockets still open. Should be 0 after close — the orphan check. */
  openSocketCount(): number;
  close(): Promise<void>;
};

const HEALTHY_BODY = JSON.stringify({ ok: true, status: "ready" });

export async function startDaemonFaultHarness(
  options: DaemonFaultOptions,
): Promise<DaemonFaultHarness> {
  const delayedReadyAfter = options.delayedReadyAfter ?? 1;
  const crashAfter = options.crashAfter ?? 1;
  const oversizedBytes = options.oversizedBytes ?? 64 * 1024;

  let requests = 0;
  let closed = false;
  const sockets = new Set<Socket>();

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    requests += 1;
    handle(req, res, requests);
  });

  // Track every accepted socket. This is what makes close() bounded: a hung
  // response holds its socket forever, and server.close() would wait for it.
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  function handle(_req: IncomingMessage, res: ServerResponse, n: number): void {
    switch (options.mode) {
      case "healthy":
        return respondHealthy(res);
      case "delayed-ready":
        return n > delayedReadyAfter
          ? respondHealthy(res)
          : respondJson(res, 503, { ok: false, error: "not-ready" });
      case "hang":
        // Deliberately no response and no timeout: the client's own deadline is
        // what is under test. close() still reclaims the socket.
        return;
      case "partial-response":
        res.writeHead(200, { "content-type": "application/json" });
        res.write('{"ok":true,"items":[');
        res.socket?.destroy();
        return;
      case "reset":
        res.socket?.destroy();
        return;
      case "crash-after":
        if (n <= crashAfter) {
          respondHealthy(res);
          return;
        }
        res.socket?.destroy();
        // Stop listening so a retry gets ECONNREFUSED rather than another
        // reset — that is the difference between "daemon died" and "daemon is
        // misbehaving", and the classifier is expected to tell them apart.
        server.close();
        return;
      case "unauthorized":
        return respondJson(res, 401, { ok: false, error: "unauthorized" });
      case "forbidden":
        return respondJson(res, 403, { ok: false, error: "forbidden" });
      case "oversized":
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, blob: "x".repeat(oversizedBytes) }));
        return;
    }
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("daemon fault harness: expected a TCP address");
  }
  const { port } = address;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requestCount: () => requests,
    openSocketCount: () => sockets.size,
    async close() {
      if (closed) return;
      closed = true;
      // Destroy each socket and WAIT for its "close" event, which is what
      // removes it from the registry.
      //
      // Two ways to get this wrong, and the autofix in b8d540e0cc fixed one of
      // them: clearing the set outright makes openSocketCount() report 0
      // unconditionally. But destroying without awaiting has the same effect at
      // the moment a test looks — `destroy()` is asynchronous, so the "close"
      // event that removes the socket may not have fired when close() resolves.
      // Either way the leak assertions, and stressDaemonLifecycle's
      // leakedSockets, become true by construction. Awaiting is what makes a
      // zero count mean the sockets genuinely closed.
      const pending = [...sockets];
      await Promise.all(
        pending.map(
          (socket) =>
            new Promise<void>((resolve) => {
              if (socket.destroyed && !sockets.has(socket)) {
                resolve();
                return;
              }
              socket.once("close", () => resolve());
              socket.destroy();
            }),
        ),
      );
      await new Promise<void>((resolve) => {
        // Already-closed is not an error here: `crash-after` closes the server
        // itself, and a harness whose cleanup threw for doing its job would
        // make every test using it fail in teardown rather than assertion.
        server.close(() => resolve());
        if (!server.listening) resolve();
      });
    },
  };
}

function respondHealthy(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(HEALTHY_BODY);
}

function respondJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * Repeated start/stop stress. The acceptance criteria call for detecting
 * orphaned processes and stale endpoint state, and the cheap local proxy for
 * both is: after N cycles, no socket survives and no port is reused while
 * still bound. Returns the ports used so a caller can assert they were
 * genuinely distinct rather than one lucky rebind.
 */
export async function stressDaemonLifecycle(input: {
  cycles: number;
  mode?: DaemonFaultMode;
}): Promise<{ ports: number[]; leakedSockets: number }> {
  const ports: number[] = [];
  let leakedSockets = 0;
  for (let i = 0; i < input.cycles; i += 1) {
    const harness = await startDaemonFaultHarness({ mode: input.mode ?? "healthy" });
    ports.push(harness.port);
    await fetch(`${harness.url}/health`).catch(() => undefined);
    await harness.close();
    leakedSockets += harness.openSocketCount();
  }
  return { ports, leakedSockets };
}
