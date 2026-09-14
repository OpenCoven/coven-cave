import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { userInfo } from "node:os";
import {
  DEVICE_ACCESS_COOKIE, DEVICE_ACCESS_HEADER, DEVICE_CREDENTIAL_PREFIX,
  type DevicePeer, type DeviceRecord,
} from "./contract.ts";
import { DeviceAccessError, type DeviceAccessStore } from "./store.ts";
import {
  createDevicePeerResolver, resolveDevicePeer, type DevicePeerInventory,
} from "./peers.ts";
import { DEVICE_GRANT_HEADER, DEVICE_MANAGED_HEADER, DEVICE_PAIRING_PAGE_HEADER } from "../../device-access-markers.ts";

const API = "/api/device-access";
const BODY_LIMIT = 4096;
const COOKIE_AGE = 34_560_000;

function credentialCookie(res: ServerResponse, credential: string) {
  res.setHeader("set-cookie", `${DEVICE_ACCESS_COOKIE}=${credential}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${COOKIE_AGE}`);
}

function single(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name];
  return typeof value === "string" ? value : null;
}

function equal(left: string | null, right: string): boolean {
  if (!left || !right) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function suppliedCredential(req: IncomingMessage): string | null {
  const explicit = single(req, DEVICE_ACCESS_HEADER);
  if (explicit) return explicit;
  const authorization = single(req, "authorization");
  if (authorization?.startsWith(`Bearer ${DEVICE_CREDENTIAL_PREFIX}`)) return authorization.slice(7);
  const cookie = single(req, "cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${DEVICE_ACCESS_COOKIE}=`));
  return cookie ? cookie.slice(DEVICE_ACCESS_COOKIE.length + 1) : null;
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function requireOrigin(req: IncomingMessage, direct: boolean): void {
  const expected = `${direct ? "http" : "https"}://${single(req, direct ? "host" : "x-forwarded-host") ?? ""}`;
  const origin = single(req, "origin");
  const referer = single(req, "referer");
  if (origin && origin !== expected) throw new DeviceAccessError("forbidden", "Request origin does not match this desktop.", 403);
  if (referer) {
    let source: URL;
    try { source = new URL(referer); } catch {
      throw new DeviceAccessError("forbidden", "Invalid request source.", 403);
    }
    if (source.origin !== expected) throw new DeviceAccessError("forbidden", "Request source does not match this desktop.", 403);
  }
  if (req.method !== "GET" && req.method !== "HEAD" && !origin && !referer) {
    throw new DeviceAccessError("forbidden", "A same-origin request source is required.", 403);
  }
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(single(req, "content-type") ?? "")) {
    throw new DeviceAccessError("invalid_request", "Expected application/json.", 415);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > BODY_LIMIT) {
      req.resume();
      throw new DeviceAccessError("invalid_request", "Request is too large.", 413);
    }
    chunks.push(bytes);
  }
  let result: unknown;
  try { result = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {
    throw new DeviceAccessError("invalid_request", "Invalid JSON.", 400);
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new DeviceAccessError("invalid_request", "Expected an object.", 400);
  }
  return result as Record<string, unknown>;
}

function stringField(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200) {
    throw new DeviceAccessError("invalid_request", "A valid device identity is required.", 400);
  }
  return value.trim();
}

export function createDeviceAccessGateway(options: {
  store: DeviceAccessStore;
  isDirectLoopback: (req: IncomingMessage) => boolean;
  sidecarToken: string;
  packaged: boolean;
  stampSecret: string;
  inventory?: () => Promise<DevicePeerInventory>;
  onAuthenticated?: (req: IncomingMessage, device: DeviceRecord) => void;
  onPolicyChanged?: () => void;
}) {
  const { store } = options;
  const inventory = options.inventory ?? createDevicePeerResolver();
  const active = new Map<ServerResponse, { req: IncomingMessage; credential: string; device: DeviceRecord }>();
  const legacy = new Set<ServerResponse>();
  const completionWrites = new Set<Promise<void>>();
  let revalidating = false;
  let managedObserved = false;
  const actor = `desktop:${userInfo().username}`;

  function closeLegacy() {
    for (const response of legacy) response.destroy();
    legacy.clear();
    options.onPolicyChanged?.();
  }

  async function currentPolicy() {
    const policy = await store.policy();
    if (policy.enabled && !managedObserved) {
      managedObserved = true;
      closeLegacy();
    }
    return policy;
  }

  async function eligible(req: IncomingMessage): Promise<DevicePeer> {
    const peer = resolveDevicePeer(req, await inventory());
    if (!peer) throw new DeviceAccessError("forbidden", "A verified Tailscale device is required.", 403);
    return peer;
  }

  function closeDevice(id: string) {
    for (const [res, session] of active) {
      if (session.device.id === id) {
        res.destroy();
      }
    }
  }

  async function revalidateActive() {
    if (revalidating) return;
    revalidating = true;
    try {
      await currentPolicy();
      for (const [res, session] of active) {
        try {
          if (await store.verify(session.credential, await eligible(session.req))) continue;
        } catch (error) {
          console.warn("[device-access] Active connection revalidation failed:", error instanceof Error ? error.message : "unavailable");
        }
        res.destroy();
      }
    } catch (error) {
      console.warn("[device-access] Policy revalidation failed:", error instanceof Error ? error.message : "unavailable");
      closeLegacy();
      for (const res of active.keys()) res.destroy();
    } finally {
      revalidating = false;
    }
  }

  const timer = setInterval(() => { void revalidateActive(); }, 1_000);
  timer.unref();

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    delete req.headers[DEVICE_GRANT_HEADER];
    delete req.headers[DEVICE_PAIRING_PAGE_HEADER];
    delete req.headers[DEVICE_MANAGED_HEADER];
    const direct = options.isDirectLoopback(req);
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    const isApi = pathname === API || pathname.startsWith(`${API}/`);
    try {
      const policy = await currentPolicy();
      if (policy.enabled) req.headers[DEVICE_MANAGED_HEADER] = options.stampSecret;
      if (isApi) {
        requireOrigin(req, direct);
        if (pathname === `${API}/admin` || pathname.startsWith(`${API}/admin/`)) {
          if (!direct || (options.sidecarToken
            ? !equal(single(req, "x-coven-cave-token"), options.sidecarToken)
            : options.packaged)) {
            throw new DeviceAccessError("forbidden", "Device access is managed only by this desktop.", 403);
          }
          if (pathname === `${API}/admin` && req.method === "GET") {
            const snapshot = await store.snapshot();
            let network: { host: string; tailnet: string } | null = null;
            let networkError: string | null = null;
            try {
              const current = await inventory();
              network = { host: current.host, tailnet: current.tailnet };
            } catch (error) {
              networkError = error instanceof Error ? error.message : "Tailscale is unavailable.";
            }
            json(res, 200, { ok: true, ...snapshot, network, networkError });
            return true;
          }
          if (pathname === `${API}/admin/tailnets` && req.method === "PUT") {
            const input = await body(req);
            if (!Array.isArray(input.tailnets) || !input.tailnets.every((entry) => typeof entry === "string")) {
              throw new DeviceAccessError("invalid_request", "Expected a list of tailnets.", 400);
            }
            await store.setAllowedTailnets(input.tailnets, actor);
            await currentPolicy();
            await revalidateActive();
            json(res, 200, { ok: true });
            return true;
          }
          if (pathname === `${API}/admin/decision` && req.method === "POST") {
            const input = await body(req);
            if (input.decision !== "allowed" && input.decision !== "denied" && input.decision !== "revoked") {
              throw new DeviceAccessError("invalid_request", "Invalid device decision.", 400);
            }
            const device = await store.decide(stringField(input.id), input.decision, actor);
            if (device.status !== "allowed") closeDevice(device.id);
            json(res, 200, { ok: true, device });
            return true;
          }
          throw new DeviceAccessError("not_found", "Unknown device management operation.", 404);
        }
        const peer = await eligible(req);
        if (pathname === `${API}/requests` && req.method === "POST") {
          if (policy.unavailable) {
            json(res, 503, {
              ok: false, error: "unavailable",
              message: "Device access could not be verified on this host.",
            });
            return true;
          }
          if (!policy.enabled) {
            json(res, 409, {
              ok: false, error: "disabled",
              message: "Desktop device approval is not enabled. Use the current desktop pairing invite.",
            });
            return true;
          }
          const input = await body(req);
          const issued = await store.request(peer, {
            installationId: stringField(input.installationId),
            label: stringField(input.label),
          });
          // A pending cookie is only a proof for polling, never authorization.
          credentialCookie(res, issued.credential);
          json(res, 201, { ok: true, device: issued.device });
          return true;
        }
        if (pathname === `${API}/status` && req.method === "GET") {
          const credential = suppliedCredential(req);
          const device = credential ? await store.inspect(credential, peer) : null;
          if (!device) throw new DeviceAccessError("forbidden", "Device pairing is required.", 403);
          json(res, 200, { ok: true, device });
          return true;
        }
        throw new DeviceAccessError("not_found", "Unknown device pairing operation.", 404);
      }
      if (direct) return false;
      if (policy.unavailable) {
        // Legacy mode is for "device access is configured off", which is a
        // decision someone made. An unreadable policy is not that decision, and
        // passing a remote request through on the strength of it would admit
        // exactly what pairing exists to stop.
        throw new DeviceAccessError(
          "unavailable",
          "Device access could not be verified on this host.",
          503,
        );
      }
      if (!policy.enabled) {
        legacy.add(res);
        res.once("close", () => { legacy.delete(res); });
        return false;
      }
      res.setHeader("x-coven-device-pairing", "1");
      const peer = await eligible(req);
      if (!policy.allowedTailnets.includes(peer.tailnet)) {
        throw new DeviceAccessError("forbidden", "This tailnet is not allowed by the desktop.", 403);
      }
      if (pathname === "/connect" || pathname.startsWith("/_next/static/")
        || pathname === "/favicon.ico") {
        req.headers[DEVICE_PAIRING_PAGE_HEADER] = options.stampSecret;
        return false;
      }
      const credential = suppliedCredential(req);
      const device = credential ? await store.verify(credential, peer) : null;
      if (!device || !credential) {
        if (req.method === "GET" && !pathname.startsWith("/api/") && single(req, "accept")?.includes("text/html")) {
          res.writeHead(303, { location: "/connect", "cache-control": "no-store" });
          res.end();
          return true;
        }
        throw new DeviceAccessError("forbidden", "Device approval is required. Open /connect.", 403);
      }
      // A managed remote grant is not a local/admin, terminal, or client-v1
      // credential. Those boundaries must not be relaxed by the new transport.
      if (pathname.startsWith("/api/client/") || pathname.startsWith("/api/pty")
        || pathname.startsWith("/api/passkey/register") || pathname === "/api/mobile-handoff") {
        throw new DeviceAccessError("forbidden", "This operation requires local desktop authority.", 403);
      }
      requireOrigin(req, false);
      const requestId = randomUUID();
      await store.recordAccess(device.id, { requestId, method: req.method ?? "GET", path: pathname, status: 0 });
      if (single(req, "cookie")?.includes(`${DEVICE_ACCESS_COOKIE}=${credential}`)) {
        credentialCookie(res, credential);
      }
      res.setHeader("x-coven-request-id", requestId);
      req.headers[DEVICE_GRANT_HEADER] = options.stampSecret;
      options.onAuthenticated?.(req, device);
      active.set(res, { req, credential, device });
      const finish = () => {
        active.delete(res);
        const write = store.recordAccess(device.id, {
          requestId, method: req.method ?? "GET", path: pathname,
          status: res.writableFinished ? res.statusCode : 499,
        }).catch((error: unknown) => {
          console.error("[device-access] Could not persist request completion:", error instanceof Error ? error.message : "unavailable");
        });
        completionWrites.add(write);
        void write.finally(() => { completionWrites.delete(write); });
      };
      res.once("close", finish);
      return false;
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : undefined);
      } else if (error instanceof DeviceAccessError) {
        json(res, error.status, { ok: false, error: error.code, message: error.message });
      } else {
        console.error("[device-access] Request refused:", error instanceof Error ? error.message : "unavailable");
        json(res, 503, { ok: false, error: "unavailable", message: "Device access could not be verified." });
      }
      return true;
    }
  }

  return {
    handle,
    async blocksUpgrade(req: IncomingMessage): Promise<boolean> {
      if (options.isDirectLoopback(req)) return false;
      const policy = await currentPolicy();
      // Unavailable blocks too: an upgrade admitted because the policy could
      // not be read is a long-lived socket granted by a check that never ran.
      return policy.enabled || policy.unavailable === true;
    },
    async close() {
      clearInterval(timer);
      const closing = [...active.keys()].map((res) => new Promise<void>((resolve) => {
        res.once("close", resolve);
        res.destroy();
      }));
      for (const res of legacy) res.destroy();
      await Promise.all(closing);
      await Promise.all(completionWrites);
      active.clear();
      legacy.clear();
    },
  };
}
