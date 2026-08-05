import { resolveBackspaces, stripAnsi } from "@/lib/ansi";
import { AssistantFilter } from "@/lib/chat-assistant-filter";
import { parseClaudeTextOnlyEnvelope } from "@/lib/claude-stream";
import { canonicalHarnessId } from "@/lib/harness-adapters";

export type ReplayDaemonEvent = {
  kind?: string;
  payload_json?: string;
};

export type ReplayLaunchMode = "nonInteractive" | "stream";
export type ReplayOutputFormat = "plain" | "stream-json";
export type ReplayOutputContract = {
  launchMode: ReplayLaunchMode;
  outputFormat: ReplayOutputFormat;
};
export type ReplayOutputDecodeRequest = ReplayOutputContract & {
  harness: string;
  events: ReplayDaemonEvent[];
};

export const OFFLINE_REPLAY_LAUNCH_CONTRACT = {
  launchMode: "nonInteractive",
  outputFormat: "plain",
} as const satisfies ReplayOutputContract;

export type ReplayOutputDecodeErrorCode =
  | "truncated_output"
  | "malformed_output_event"
  | "malformed_assistant_event"
  | "malformed_structured_frame"
  | "unsupported_harness";

export class ReplayOutputDecodeError extends Error {
  public readonly code: ReplayOutputDecodeErrorCode;

  constructor(code: ReplayOutputDecodeErrorCode, message: string) {
    super(message);
    this.name = "ReplayOutputDecodeError";
    this.code = code;
  }
}

function replayOutputDecodeError(
  code: ReplayOutputDecodeErrorCode,
  message: string,
): ReplayOutputDecodeError {
  return new ReplayOutputDecodeError(code, message);
}

class ReplayLineDecoder {
  private buffer = "";
  private readonly onLine: (line: string) => void;

  constructor(onLine: (line: string) => void) {
    this.onLine = onLine;
  }

  push(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      this.onLine(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  finish(): void {
    if (this.buffer) this.onLine(this.buffer.replace(/\r$/, ""));
    this.buffer = "";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function outputChunk(event: ReplayDaemonEvent): string | null {
  if (event.kind !== "output") return null;
  if (typeof event.payload_json !== "string") {
    throw replayOutputDecodeError(
      "malformed_output_event",
      "offline replay received a malformed daemon output event",
    );
  }
  let payload: Record<string, unknown> | null;
  try {
    payload = record(JSON.parse(event.payload_json));
  } catch {
    throw replayOutputDecodeError(
      "malformed_output_event",
      "offline replay received a malformed daemon output event",
    );
  }
  if (typeof payload?.data !== "string") {
    throw replayOutputDecodeError(
      "malformed_output_event",
      "offline replay received a malformed daemon output event",
    );
  }
  return payload.data;
}

function outputChunks(events: ReplayDaemonEvent[]): string[] {
  const chunks: string[] = [];
  for (const event of events) {
    const chunk = outputChunk(event);
    if (chunk !== null) chunks.push(chunk);
  }
  return chunks;
}

function structuredAssistantEventText(event: ReplayDaemonEvent): string | null {
  if (event.kind !== "assistant.message" && event.kind !== "assistant_message") return null;
  if (typeof event.payload_json !== "string") {
    throw replayOutputDecodeError(
      "malformed_assistant_event",
      "offline replay received a malformed assistant data event",
    );
  }
  let payload: Record<string, unknown> | null;
  try {
    payload = record(JSON.parse(event.payload_json));
  } catch {
    throw replayOutputDecodeError(
      "malformed_assistant_event",
      "offline replay received a malformed assistant data event",
    );
  }
  const text = typeof payload?.content === "string"
    ? payload.content
    : typeof payload?.text === "string"
      ? payload.text
      : null;
  if (text === null) {
    throw replayOutputDecodeError(
      "malformed_assistant_event",
      "offline replay received a malformed assistant data event",
    );
  }
  return text;
}

function unseenReplayAssistantSuffix(current: string, next: string): string {
  if (!next) return "";
  if (!current) return next;
  if (next.startsWith(current)) return next.slice(current.length);
  if (current.startsWith(next) || current.endsWith(next)) return "";
  const maxOverlap = Math.min(current.length, next.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (current.endsWith(next.slice(0, overlap))) {
      return next.slice(overlap);
    }
  }
  return next;
}

function appendReplayAssistantText(current: string, next: string): string {
  return current + unseenReplayAssistantSuffix(current, next);
}

type ReplayStructuredInsertion = {
  outputOffset: number;
  text: string;
  sequence: number;
};

function renderReplayTimeline(
  output: string,
  insertions: ReplayStructuredInsertion[],
): string {
  const ordered = [...insertions].sort((left, right) =>
    left.outputOffset - right.outputOffset || left.sequence - right.sequence
  );
  let rendered = "";
  let outputOffset = 0;
  for (const insertion of ordered) {
    const insertionOffset = Math.max(
      outputOffset,
      Math.min(output.length, insertion.outputOffset),
    );
    rendered += output.slice(outputOffset, insertionOffset) + insertion.text;
    outputOffset = insertionOffset;
  }
  return rendered + output.slice(outputOffset);
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let length = 0;
  while (length < limit && left[length] === right[length]) length += 1;
  return length;
}

function commonSuffixLength(left: string, right: string, prefixLength: number): number {
  const limit = Math.min(left.length, right.length) - prefixLength;
  let length = 0;
  while (
    length < limit &&
    left[left.length - length - 1] === right[right.length - length - 1]
  ) {
    length += 1;
  }
  return length;
}

function trimInsertionAgainstOutput(
  insertion: ReplayStructuredInsertion,
  output: string,
): void {
  const offset = Math.min(output.length, insertion.outputOffset);
  const prefix = output.slice(0, offset);
  const suffix = output.slice(offset);
  let text = insertion.text;
  if (prefix.endsWith(text) || suffix.startsWith(text)) {
    insertion.text = "";
    return;
  }

  const prefixOverlapLimit = Math.min(prefix.length, text.length);
  for (let overlap = prefixOverlapLimit; overlap > 0; overlap -= 1) {
    if (prefix.endsWith(text.slice(0, overlap))) {
      text = text.slice(overlap);
      break;
    }
  }
  const suffixOverlapLimit = Math.min(suffix.length, text.length);
  for (let overlap = suffixOverlapLimit; overlap > 0; overlap -= 1) {
    if (suffix.startsWith(text.slice(text.length - overlap))) {
      text = text.slice(0, text.length - overlap);
      break;
    }
  }
  insertion.text = text;
}

function reconcileReplayOutput(
  previous: string,
  next: string,
  insertions: ReplayStructuredInsertion[],
): void {
  if (previous !== next && !next.startsWith(previous)) {
    const prefixLength = commonPrefixLength(previous, next);
    const suffixLength = commonSuffixLength(previous, next, prefixLength);
    const previousChangedEnd = previous.length - suffixLength;
    const nextChangedEnd = next.length - suffixLength;
    for (const insertion of insertions) {
      if (insertion.outputOffset <= prefixLength) continue;
      if (insertion.outputOffset >= previousChangedEnd) {
        insertion.outputOffset =
          nextChangedEnd + (insertion.outputOffset - previousChangedEnd);
      } else {
        insertion.outputOffset = nextChangedEnd;
      }
    }
  }

  for (const insertion of insertions) {
    trimInsertionAgainstOutput(insertion, next);
  }
  for (let index = insertions.length - 1; index >= 0; index -= 1) {
    if (!insertions[index].text) insertions.splice(index, 1);
  }
}

function decodePlainTimeline(
  events: ReplayDaemonEvent[],
  decoder: (chunks: string[]) => string,
): string | null {
  const chunks: string[] = [];
  const insertions: ReplayStructuredInsertion[] = [];
  let decodedOutput = "";

  const decodeOutput = () => decoder(chunks);
  const updateOutput = () => {
    const nextOutput = decodeOutput();
    reconcileReplayOutput(decodedOutput, nextOutput, insertions);
    decodedOutput = nextOutput;
  };

  for (const event of events) {
    const chunk = outputChunk(event);
    if (chunk !== null) {
      chunks.push(chunk);
      continue;
    }
    const structured = structuredAssistantEventText(event);
    if (structured === null) continue;
    updateOutput();
    const rendered = renderReplayTimeline(decodedOutput, insertions);
    const unseen = unseenReplayAssistantSuffix(rendered, structured);
    if (unseen) {
      insertions.push({
        outputOffset: decodedOutput.length,
        text: unseen,
        sequence: insertions.length,
      });
    }
  }
  updateOutput();
  return renderReplayTimeline(decodedOutput, insertions).trim() || null;
}

function cleanTerminalOutput(chunks: string[]): string {
  return resolveBackspaces(stripAnsi(chunks.join("")));
}

function decodeDirectPlain(chunks: string[]): string {
  return cleanTerminalOutput(chunks);
}

function decodeFilteredPlain(chunks: string[], filter: AssistantFilter): string {
  const cleaned = cleanTerminalOutput(chunks);
  let decoded = filter.push(cleaned) + filter.flush();
  if (!cleaned.endsWith("\n") && decoded.endsWith("\n")) {
    decoded = decoded.slice(0, -1);
  }
  return decoded;
}

function decodeCodexPlain(chunks: string[]): string {
  return decodeFilteredPlain(chunks, new AssistantFilter());
}

function decodeHermesPlain(chunks: string[]): string {
  return decodeFilteredPlain(chunks, new AssistantFilter({ passthrough: true }));
}

function decodeClaudeStreamJson(chunks: string[]): string {
  const text: string[] = [];
  const lines = new ReplayLineDecoder((line) => {
    if (!line.trim()) return;
    let envelope: unknown;
    try {
      envelope = JSON.parse(line);
    } catch {
      throw replayOutputDecodeError(
        "malformed_structured_frame",
        "offline replay received a malformed structured output frame",
      );
    }
    text.push(...parseClaudeTextOnlyEnvelope(envelope));
  });
  for (const chunk of chunks) lines.push(chunk);
  lines.finish();
  return text.join("");
}

const PLAIN_DECODERS: Record<string, (chunks: string[]) => string> = {
  claude: decodeDirectPlain,
  "coven-code": decodeDirectPlain,
  codex: decodeCodexPlain,
  grok: decodeDirectPlain,
  hermes: decodeHermesPlain,
};

const STREAM_JSON_DECODERS: Record<string, (chunks: string[]) => string> = {
  claude: decodeClaudeStreamJson,
  "coven-code": decodeClaudeStreamJson,
};

function decoderFor(
  harness: string,
  contract: ReplayOutputContract,
): ((chunks: string[]) => string) | null {
  if (contract.launchMode === "nonInteractive" && contract.outputFormat === "plain") {
    return PLAIN_DECODERS[harness] ?? null;
  }
  if (contract.launchMode === "stream" && contract.outputFormat === "stream-json") {
    return STREAM_JSON_DECODERS[harness] ?? null;
  }
  return null;
}

export function replayOutputContractBlockReason(
  request: ReplayOutputContract & { harness: string },
): string | null {
  const harness = canonicalHarnessId(request.harness).trim().toLowerCase();
  if (
    (harness === "opencode" || harness === "copilot") &&
    request.launchMode === "nonInteractive" &&
    request.outputFormat === "plain"
  ) {
    if (harness === "copilot") {
      return "offline replay cannot safely launch Copilot: the daemon command omits Copilot's --silent assistant-only mode, so its nonInteractive plain stdout does not separate assistant replies from tool or control output. Update the daemon launch contract to include --silent, use online chat, or choose another harness.";
    }
    return "offline replay cannot safely launch OpenCode: its nonInteractive plain stdout does not separate assistant replies from tool or control output. Use online chat or choose another harness.";
  }
  if (decoderFor(harness, request)) return null;
  return `offline replay output decoding is not supported for harness '${harness || request.harness}' with launchMode '${request.launchMode}' and output format '${request.outputFormat}'`;
}

export function supportsReplayOutputHarness(
  harness: string,
  contract: ReplayOutputContract,
): boolean {
  return replayOutputContractBlockReason({ harness, ...contract }) === null;
}

export function decodeReplayAssistantOutput(
  request: ReplayOutputDecodeRequest,
): string | null {
  if (request.events.some((event) => event.kind === "output_truncated")) {
    throw replayOutputDecodeError(
      "truncated_output",
      "offline replay daemon output log was truncated; refusing to mirror a partial assistant reply",
    );
  }

  const harness = canonicalHarnessId(request.harness).trim().toLowerCase();
  const decoder = decoderFor(harness, request);
  if (!decoder) {
    throw replayOutputDecodeError(
      "unsupported_harness",
      replayOutputContractBlockReason(request) ??
        `offline replay output decoding is not supported for harness '${harness || request.harness}'`,
    );
  }

  if (request.launchMode === "nonInteractive" && request.outputFormat === "plain") {
    return decodePlainTimeline(request.events, decoder);
  }

  const decoded = decoder(outputChunks(request.events)).trim();
  let merged = decoded;
  for (const event of request.events) {
    const structured = structuredAssistantEventText(event);
    if (structured !== null) {
      merged = appendReplayAssistantText(merged, structured.trim());
    }
  }
  return merged || null;
}
