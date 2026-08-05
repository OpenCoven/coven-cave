export type ReplayLaunchContract = {
  launchMode: "nonInteractive" | "stream";
  outputFormat: "plain" | "stream-json";
};

export type ReplayEvent = {
  kind?: string;
  payload_json?: string | null;
  timestamp?: string | null;
};

export const OFFLINE_REPLAY_LAUNCH_CONTRACT: ReplayLaunchContract = {
  launchMode: "nonInteractive",
  outputFormat: "plain",
};

export class ReplayOutputDecodeError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ReplayOutputDecodeError";
    this.code = code;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parsePayload(event: ReplayEvent): Record<string, unknown> {
  if (typeof event.payload_json !== "string" || !event.payload_json.trim()) return {};
  try {
    const parsed = JSON.parse(event.payload_json);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}

function applyBackspaces(text: string): string {
  const out: string[] = [];
  for (const ch of text) {
    if (ch === "\b") out.pop();
    else out.push(ch);
  }
  return out.join("");
}

function normalizePlainText(harness: string, text: string): string {
  let normalized = applyBackspaces(stripAnsi(text));
  if (harness === "hermes") {
    normalized = normalized.replace(/^Normalized model '[^']+' to '[^']+' for openai-codex\.\n?/, "");
  }
  return normalized;
}

export function replayOutputContractForHarness(harness: string): ReplayLaunchContract {
  return harness === "codex" ? { launchMode: "stream", outputFormat: "stream-json" } : OFFLINE_REPLAY_LAUNCH_CONTRACT;
}

export function replayOutputContractBlockReason(args: { harness: string } & ReplayLaunchContract): string | null {
  if (args.harness === "codex" && args.outputFormat !== "stream-json") {
    return "Codex replay requires stream-json because delimiter-like stdout can forge assistant content or attention markers";
  }
  return null;
}

type StructuredPart = { messageId: string | null; text: string };

type StructuredState = {
  parts: StructuredPart[];
};

function combinedMessageText(parts: StructuredPart[], messageId: string): string {
  return parts.filter((part) => part.messageId === messageId).map((part) => part.text).join("");
}

function currentCombinedText(state: StructuredState): string {
  return state.parts.map((part) => part.text).join("");
}

function appendStructuredDelta(state: StructuredState, messageId: string | null, text: string): void {
  if (!text) return;
  state.parts.push({ messageId, text });
}

function appendStructuredCumulative(state: StructuredState, messageId: string | null, text: string): void {
  if (!text) return;
  if (!messageId) {
    const messageIds = [...new Set(state.parts.map((part) => part.messageId).filter(Boolean))];
    if (messageIds.length === 1) {
      messageId = messageIds[0] ?? null;
    }
  }
  if (!messageId) {
    if (currentCombinedText(state).endsWith(text)) return;
    state.parts.push({ messageId: null, text });
    return;
  }
  const prior = combinedMessageText(state.parts, messageId);
  if (prior === text) return;
  state.parts = state.parts.filter((part) => part.messageId !== messageId);
  state.parts.push({ messageId, text });
}

function decodeStructuredTranscript(events: ReplayEvent[]): string {
  const state: StructuredState = { parts: [] };
  let buffer = "";
  for (const event of events) {
    if (event.kind === "output_truncated") {
      throw new ReplayOutputDecodeError("truncated_output", "Replay output was truncated before assistant text could be reconstructed");
    }
    const payload = parsePayload(event);
    if (event.kind === "assistant.message") {
      const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : payload;
      appendStructuredCumulative(state, stringValue(data.messageId), stringValue(data.content) ?? "");
      continue;
    }
    if (event.kind !== "data") continue;
    const chunk = stringValue(payload.data) ?? "";
    buffer += chunk;
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        throw new ReplayOutputDecodeError("malformed_structured_frame", "Replay stream contained a malformed structured frame");
      }
      const data = parsed.data && typeof parsed.data === "object" ? parsed.data as Record<string, unknown> : {};
      const type = stringValue(parsed.type) ?? "";
      const messageId = stringValue(data.messageId);
      if (type === "assistant.message_delta") {
        appendStructuredDelta(state, messageId, stringValue(data.deltaContent) ?? stringValue(data.content) ?? "");
      } else if (type === "assistant.message") {
        appendStructuredCumulative(state, messageId, stringValue(data.content) ?? "");
      }
    }
  }
  if (buffer.trim()) {
    throw new ReplayOutputDecodeError("malformed_structured_frame", "Replay stream ended with an incomplete structured frame");
  }
  return currentCombinedText(state).trim();
}

function decodePlainTimeline(harness: string, events: ReplayEvent[]): string {
  let text = "";
  for (const event of events) {
    if (event.kind === "output_truncated") {
      throw new ReplayOutputDecodeError("truncated_output", "Replay output was truncated before assistant text could be reconstructed");
    }
    const payload = parsePayload(event);
    if (event.kind === "output" || event.kind === "data") {
      text += stringValue(payload.data) ?? "";
      continue;
    }
    if (event.kind === "assistant.message") {
      const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : payload;
      const content = stringValue(data.content);
      if (content) text += content;
    }
  }
  return normalizePlainText(harness, text).trim();
}

export function decodeReplayAssistantOutput(args: { harness: string; events: ReplayEvent[] } & ReplayLaunchContract): string {
  const reason = replayOutputContractBlockReason(args);
  if (reason) throw new ReplayOutputDecodeError("unsupported_harness", reason);
  if (args.outputFormat === "stream-json") {
    return decodeStructuredTranscript(args.events);
  }
  return decodePlainTimeline(args.harness, args.events);
}
