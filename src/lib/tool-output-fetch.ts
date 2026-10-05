/** Read one projected output on demand. Each open rechecks the current server
 * authorization; completed results never enter a shared client cache. */
const TIMEOUT_MS = 15_000;
const MAX_ENVELOPE_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;

export class ToolOutputFetchError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(status === 401 || status === 403 ? "Access to this output was denied."
      : status === 404 ? "This output is no longer available."
      : status === 409 ? "This tool has no unique saved output."
      : "Couldn't load this output.");
    this.name = "ToolOutputFetchError";
    this.status = status;
  }
}

export async function fetchToolOutput(
  sessionId: string,
  toolId: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<string> {
  if (!sessionId || sessionId.length > 240 || sessionId.trim() !== sessionId
    || sessionId === "." || sessionId === ".." || /[/\\\0]/.test(sessionId)
    || !toolId || toolId.length > 256 || toolId.trim() !== toolId) {
    throw new ToolOutputFetchError(400);
  }
  const requestSignal = AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), ...(signal ? [signal] : [])]);
  requestSignal.throwIfAborted();
  try {
    const url = `/api/chat/conversation/${encodeURIComponent(sessionId)}/tool-output?toolId=${encodeURIComponent(toolId)}`;
    const res = await fetchImpl(url, { cache: "no-store", credentials: "same-origin", mode: "same-origin", redirect: "error", signal: requestSignal });
    requestSignal.throwIfAborted();
    if (res.status !== 200 || res.redirected || (res.url && typeof location !== "undefined" && res.url !== new URL(url, location.href).href)) {
      await res.body?.cancel();
      throw new ToolOutputFetchError(res.status === 200 ? 0 : res.status);
    }
    const reader = res.body?.getReader();
    if (!reader) throw new ToolOutputFetchError(0);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let body = "";
    let bytes = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        requestSignal.throwIfAborted();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_ENVELOPE_BYTES) throw new ToolOutputFetchError(0);
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    const json: unknown = JSON.parse(body);
    if (typeof json !== "object" || json === null || !("ok" in json) || json.ok !== true
      || !("output" in json) || typeof json.output !== "string"
      || new TextEncoder().encode(json.output).byteLength > MAX_OUTPUT_BYTES) {
      throw new ToolOutputFetchError(0);
    }
    return json.output;
  } catch (error) {
    requestSignal.throwIfAborted();
    throw error instanceof ToolOutputFetchError ? error : new ToolOutputFetchError(0);
  }
}
