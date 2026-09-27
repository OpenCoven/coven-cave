/**
 * Fetches one tool's full output for a card opened in a transcript loaded with
 * `?toolOutputs=recent` (#5581). Concurrent and repeated opens of the same
 * tool share one request; a failure is forgotten so Retry asks again.
 */

const MAX_ENTRIES = 200;
const TIMEOUT_MS = 15_000;
const outputs = new Map<string, Promise<string>>();

export class ToolOutputFetchError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ToolOutputFetchError";
    this.status = status;
  }
}

export function fetchToolOutput(
  sessionId: string,
  toolId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const key = `${sessionId}\u0000${toolId}`;
  const existing = outputs.get(key);
  if (existing) return existing;
  const request = (async () => {
    const url = `/api/chat/conversation/${encodeURIComponent(sessionId)}/tool-output?toolId=${encodeURIComponent(toolId)}`;
    const res = await fetchImpl(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; output?: unknown; error?: string } | null;
    if (!res.ok || !json?.ok || typeof json.output !== "string") {
      throw new ToolOutputFetchError(json?.error ?? `Request failed (${res.status})`, res.status);
    }
    return json.output;
  })();
  outputs.set(key, request);
  if (outputs.size > MAX_ENTRIES) outputs.delete(outputs.keys().next().value as string);
  request.catch(() => {
    if (outputs.get(key) === request) outputs.delete(key);
  });
  return request;
}

export function clearToolOutputCache(): void {
  outputs.clear();
}
