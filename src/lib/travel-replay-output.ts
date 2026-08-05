import { resolveBackspaces, stripAnsi } from "@/lib/ansi";
import { AssistantFilter } from "@/lib/chat-assistant-filter";
import { parseClaudeTextOnlyEnvelope } from "@/lib/claude-stream";
import {
  CopilotMessageTranscript,
  CopilotTextAssembler,
  parseCopilotChatEvent,
} from "@/lib/copilot-stream";
import { parseGrokStreamEvent } from "@/lib/grok-build";
import { canonicalHarnessId } from "@/lib/harness-adapters";
import {
  HermesSseDecoder,
  parseHermesResponsesEvent,
} from "@/lib/hermes-responses-stream";
import { BUILTIN_OPENCODE_SCHEMA_BUNDLE } from "@/lib/opencode-compatibility";
import { handleOpenCodeJsonLine } from "@/lib/opencode-stream";

export type ReplayDaemonEvent = {
  kind?: string;
  payload_json?: string;
};

type LineHandler = (line: string) => void;

class ReplayLineDecoder {
  private buffer = "";
  private readonly onLine: LineHandler;

  constructor(onLine: LineHandler) {
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

function canonicalAssistantText(events: ReplayDaemonEvent[]): string | null {
  let latest: string | null = null;
  for (const event of events) {
    if (event.kind !== "assistant.message" && event.kind !== "assistant_message") continue;
    if (typeof event.payload_json !== "string" || !event.payload_json.trim()) continue;
    try {
      const payload = record(JSON.parse(event.payload_json));
      const text = typeof payload?.content === "string"
        ? payload.content
        : typeof payload?.text === "string"
          ? payload.text
          : null;
      if (text) latest = text;
    } catch {
      // A malformed compatibility event is not assistant text.
    }
  }
  return latest?.trim() || null;
}

function outputChunks(events: ReplayDaemonEvent[]): string[] {
  const chunks: string[] = [];
  for (const event of events) {
    if (event.kind !== "output" || typeof event.payload_json !== "string") continue;
    try {
      const payload = record(JSON.parse(event.payload_json));
      if (typeof payload?.data === "string") chunks.push(payload.data);
    } catch {
      // The daemon transport envelope must be valid JSON with a string `data`.
    }
  }
  return chunks;
}

function decodeClaude(chunks: string[]): string {
  const text: string[] = [];
  const lines = new ReplayLineDecoder((line) => {
    if (!line.trim()) return;
    try {
      text.push(...parseClaudeTextOnlyEnvelope(JSON.parse(line)));
    } catch {
      // Claude output is trusted only through complete stream-json envelopes.
    }
  });
  for (const chunk of chunks) lines.push(chunk);
  lines.finish();
  return text.join("");
}

function decodeCodex(chunks: string[]): string {
  const filter = new AssistantFilter();
  const text: string[] = [];
  const pushFiltered = (chunk: string) => {
    const filtered = filter.push(chunk);
    if (filtered) text.push(filtered);
  };
  const lines = new ReplayLineDecoder((line) => {
    const trimmed = line.trim();
    if (trimmed) {
      try {
        const envelope = record(JSON.parse(trimmed));
        if (!envelope) return;
        if (envelope.type === "output" && typeof envelope.text === "string") {
          pushFiltered(resolveBackspaces(stripAnsi(envelope.text)));
        } else {
          text.push(...parseClaudeTextOnlyEnvelope(envelope));
        }
        return;
      } catch {
        // Raw PTY transcript lines continue through the phase-aware filter.
      }
    }
    pushFiltered(`${resolveBackspaces(stripAnsi(line))}\n`);
  });
  for (const chunk of chunks) lines.push(chunk);
  lines.finish();
  text.push(filter.flush());
  return text.join("");
}

function decodeCopilot(chunks: string[]): string {
  const assembler = new CopilotTextAssembler();
  const transcript = new CopilotMessageTranscript();
  const lines = new ReplayLineDecoder((line) => {
    if (!line.trim()) return;
    try {
      const event = parseCopilotChatEvent(JSON.parse(line));
      if (event?.kind === "text_delta") {
        const delta = assembler.delta(event.messageId, event.text, event.frameId);
        if (delta) transcript.appendDelta(event.messageId, delta);
      } else if (event?.kind === "message") {
        assembler.message(event.messageId, event.content);
        transcript.setMessage(event.messageId, event.content);
      }
    } catch {
      // Non-JSON and malformed protocol output is never assistant prose.
    }
  });
  for (const chunk of chunks) lines.push(chunk);
  lines.finish();
  return transcript.text;
}

function decodeOpenCode(chunks: string[]): string {
  const text: string[] = [];
  const lines = new ReplayLineDecoder((line) => {
    handleOpenCodeJsonLine(
      line,
      BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
      {
        onText(event) {
          text.push(event.text.endsWith("\n") ? event.text : `${event.text}\n`);
        },
      },
    );
  });
  for (const chunk of chunks) lines.push(chunk);
  lines.finish();
  return text.join("");
}

function decodeGrok(chunks: string[]): string {
  const structuredText: string[] = [];
  const plainText: string[] = [];
  const plain = new AssistantFilter({ passthrough: true });
  let structured = false;
  const lines = new ReplayLineDecoder((line) => {
    if (line.trim()) {
      try {
        const raw = JSON.parse(line);
        if (raw && typeof raw === "object") {
          structured = true;
          const event = parseGrokStreamEvent(raw);
          if (event.kind === "text") structuredText.push(event.text);
          return;
        }
      } catch {
        // Grok's verified plain mode reserves stdout for final response prose.
      }
    }
    const filtered = plain.push(`${resolveBackspaces(stripAnsi(line))}\n`);
    if (filtered) plainText.push(filtered);
  });
  for (const chunk of chunks) lines.push(chunk);
  lines.finish();
  plainText.push(plain.flush());
  return structured ? structuredText.join("") : plainText.join("");
}

function decodeHermes(chunks: string[]): string {
  const decoder = new HermesSseDecoder();
  const structuredText: string[] = [];
  const plainText: string[] = [];
  const plain = new AssistantFilter({ passthrough: true });
  let structured = false;
  let sseFraming = false;
  const framingLines = new ReplayLineDecoder((line) => {
    if (/^(?::|event:|data:|id:|retry:)/.test(line)) sseFraming = true;
  });

  const consume = (frames: Array<{ event: string; data: string }>) => {
    for (const frame of frames) {
      structured = true;
      try {
        const event = parseHermesResponsesEvent(frame.event, JSON.parse(frame.data));
        if (event.kind === "text") structuredText.push(event.text);
      } catch {
        // Malformed SSE payloads never become assistant text.
      }
    }
  };

  for (const chunk of chunks) {
    consume(decoder.push(chunk));
    framingLines.push(chunk);
    const filtered = plain.push(resolveBackspaces(stripAnsi(chunk)));
    if (filtered) plainText.push(filtered);
  }
  consume(decoder.finish());
  framingLines.finish();
  plainText.push(plain.flush());
  return structured || sseFraming ? structuredText.join("") : plainText.join("");
}

const DECODERS: Record<string, (chunks: string[]) => string> = {
  claude: decodeClaude,
  "coven-code": decodeClaude,
  codex: decodeCodex,
  copilot: decodeCopilot,
  opencode: decodeOpenCode,
  grok: decodeGrok,
  hermes: decodeHermes,
};

export function decodeReplayAssistantOutput(
  harness: string,
  events: ReplayDaemonEvent[],
): string | null {
  const canonical = canonicalAssistantText(events);
  const id = canonicalHarnessId(harness).trim().toLowerCase();
  const decoder = DECODERS[id];
  if (!decoder) {
    if (canonical) return canonical;
    throw new Error(`offline replay output decoding is not supported for harness '${id || harness}'`);
  }
  const decoded = decoder(outputChunks(events)).trim();
  return decoded || canonical;
}
