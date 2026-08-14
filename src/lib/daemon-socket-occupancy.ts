import { connect, type Socket } from "node:net";

/**
 * Whether the local daemon's address is already bound.
 *
 * The health probe cannot answer this. It collapses two opposite situations
 * into one not-ok: a refused connection, where a launch will succeed, and a
 * stranger that accepts and answers something unusable, where the launch is
 * already doomed to fail its bind. Only a raw connect separates them.
 */
export type DaemonAddressOccupancy = "free" | "occupied" | "unknown";

/**
 * Launcher output for an address that is already bound. The local daemon binds
 * a UNIX socket path (a named pipe on Windows) rather than a TCP port, so the
 * port shapes are here for the hub and executor launchers that do.
 */
const DAEMON_ADDRESS_IN_USE_PATTERN =
  /EADDRINUSE|address (?:already )?in use|socket .*in use|port .*in use/i;

/** True when any captured launcher stream blames an already-bound address. */
export function reportsDaemonAddressInUse(...texts: Array<string | undefined | null>): boolean {
  return texts.some((text) => typeof text === "string" && DAEMON_ADDRESS_IN_USE_PATTERN.test(text));
}

function occupancyForConnectError(error: unknown): DaemonAddressOccupancy {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  // Nothing is accepting on the address: either no socket file exists, or a
  // dead one remains that the daemon's own bind replaces. Both are launchable,
  // and neither is Cave's to delete — removing a socket file that a live owner
  // still holds is how two daemons end up believing they own the same home.
  if (code === "ECONNREFUSED" || code === "ENOENT") return "free";
  // EACCES, EPERM, and anything else describe our ability to ask, not the
  // address. Refusing a launch on those would strand a user whose socket is
  // merely unreadable, so they stay unknown and the launch proceeds.
  return "unknown";
}

/**
 * Probes whether something is currently accepting on the daemon address.
 *
 * Deliberately conservative: only a completed connection proves occupancy, and
 * only a refusal proves freedom. Everything else is unknown, because this
 * result is used to refuse a start, and a false refusal is worse than a launch
 * that fails with its own diagnostic.
 */
export function inspectDaemonAddress(input: {
  socketPath: string;
  timeoutMs?: number;
  connectImpl?: (socketPath: string) => Socket;
}): Promise<DaemonAddressOccupancy> {
  const timeoutMs = input.timeoutMs ?? 750;
  const connectImpl = input.connectImpl ?? ((socketPath: string) => connect({ path: socketPath }));

  return new Promise((resolve) => {
    let socket: Socket | null = null;
    let settled = false;
    const settle = (occupancy: DaemonAddressOccupancy) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.destroy();
      } catch {
        // A socket that is already torn down needs nothing from us.
      }
      resolve(occupancy);
    };

    // A backlogged listener can accept slowly enough to look like silence.
    // That is genuinely ambiguous, so it does not refuse a launch.
    const timer = setTimeout(() => settle("unknown"), timeoutMs);
    timer.unref?.();

    try {
      socket = connectImpl(input.socketPath);
    } catch (error) {
      settle(occupancyForConnectError(error));
      return;
    }
    socket.once("connect", () => settle("occupied"));
    socket.once("error", (error) => settle(occupancyForConnectError(error)));
  });
}
