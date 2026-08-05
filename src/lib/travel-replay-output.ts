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

function outputChunks(events: ReplayDaemonEvent[]): string[] {
  const chunks: string[] = [];
  for (const event of events) {
    if (event.kind !== "output") continue;
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
    chunks.push(payload.data);
  }
  return chunks;
}

function cleanTerminalOutput(chunks: string[]): string {
  return resolveBackspaces(stripAnsi(chunks.join("")));
}

function decodeDirectPlain(chunks: string[]): string {
  return cleanTerminalOutput(chunks);
}

function decodeCodexPlain(chunks: string[]): string {
  const filter = new AssistantFilter();
  const cleaned = cleanTerminalOutput(chunks);
  return filter.push(cleaned) + filter.flush();
}

function decodeHermesPlain(chunks: string[]): string {
  const filter = new AssistantFilter({ passthrough: true });
  const cleaned = cleanTerminalOutput(chunks);
  return filter.push(cleaned) + filter.flush();
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
  copilot: decodeDirectPlain,
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
    harness === "opencode" &&
    request.launchMode === "nonInteractive" &&
    request.outputFormat === "plain"
  ) {
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

  const decoded = decoder(outputChunks(request.events)).trim();
  return decoded || null;
}
