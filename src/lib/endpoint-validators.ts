import { upstreamFetch } from "./server/upstream-fetch.ts";

/**
 * Endpoint reachability probe for remote (URL-based) MCP plugins. Posts a
 * minimal JSON-RPC `initialize` and classifies the response. This checks that
 * the integration endpoint is LIVE — not that the user is authenticated (remote
 * MCP servers authenticate via in-client OAuth). Injectable fetch for tests.
 */

export type EndpointCheck = { reachable: boolean; detail?: string; error?: string };
type FetchLike = typeof fetch;

export async function checkMcpEndpoint(url: string, fetchImpl: FetchLike = fetch): Promise<EndpointCheck> {
  try {
    const res = await upstreamFetch("mcp-endpoint", url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "coven-cave", version: "0" } },
      }),
      cache: "no-store",
    }, { fetchImpl, timeoutMs: 5_000 });
    if (res.status === 401 || res.status === 403) return { reachable: true, detail: "reachable — sign in on connect" };
    if (res.ok) return { reachable: true, detail: "endpoint live" };
    return { reachable: true, detail: `reachable (HTTP ${res.status})` };
  } catch {
    return { reachable: false, error: "could not reach endpoint" };
  }
}
