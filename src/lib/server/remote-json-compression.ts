import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Compression for API JSON sent to remote clients (#5576).
 *
 * Cave runs a custom server, which bypasses the Next router-server layer where
 * `compress` applies, so no API response was compressed. A paired phone over
 * Tailscale Serve received a 21 MB transcript at 20.8 MB and re-downloaded a
 * ~300 KB chat list on every poll (37 KB gzipped).
 *
 * Scope is deliberately narrow:
 * - remote only: a direct loopback request (the desktop app) is uncompressed,
 *   because there the CPU costs more than the bytes it would save;
 * - `/api/` only, never a WebSocket upgrade;
 * - `application/json` bodies only: chat streams (`text/event-stream`) and RSC
 *   payloads must stay unbuffered, so the filter never matches them.
 */

export const REMOTE_JSON_COMPRESSION_THRESHOLD_BYTES = 1024;
/** Level 1: measured 8x on the list in about 1ms; higher levels gain little. */
export const REMOTE_JSON_COMPRESSION_LEVEL = 1;

type Next = (error?: unknown) => void;
export type HttpMiddleware = (req: IncomingMessage, res: ServerResponse, next: Next) => void;
type CompressionFactory = (options: {
  threshold: number;
  level: number;
  filter: (req: IncomingMessage, res: ServerResponse) => boolean;
}) => HttpMiddleware;

export function shouldCompressRemoteRequest(req: IncomingMessage, directLoopback: boolean): boolean {
  if (directLoopback) return false;
  if (req.headers.upgrade !== undefined) return false;
  const url = req.url ?? "";
  return url === "/api" || url.startsWith("/api/") || url.startsWith("/api?");
}

export function isCompressibleJsonResponse(res: ServerResponse): boolean {
  const type = String(res.getHeader("content-type") ?? "").trim().toLowerCase();
  return type === "application/json" || type.startsWith("application/json;");
}

export function createRemoteJsonCompression(factory: CompressionFactory): HttpMiddleware {
  return factory({
    threshold: REMOTE_JSON_COMPRESSION_THRESHOLD_BYTES,
    level: REMOTE_JSON_COMPRESSION_LEVEL,
    filter: (_req, res) => isCompressibleJsonResponse(res),
  });
}
