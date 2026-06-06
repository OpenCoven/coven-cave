const HOOK_LINE_RE = /^hook:\s+/;
const BANNER_LINE_RE = /^(?:--------|workdir:|model:|provider:|approval:|sandbox:|reasoning:|session id:|tokens used|\d[\d,]*\s*$)/;
const CODEX_START_LINE = "codex";
const CLAUDE_ASSISTANT_RE = /^claude(?:\s+code)?$/i;

const STARTUP_BLOCK_TAGS = new Set([
  "AGENT_SOUL",
  "INSTRUCTIONS",
  "apps_instructions",
  "available_skills",
  "collaboration_mode",
  "conversation_context",
  "environment_context",
  "plugins_instructions",
  "skills_instructions",
]);

const STARTUP_SINGLE_LINE_RE =
  /^(?:#\s*AGENTS\.md\b|#\s*AGENTS\.md instructions\b|Conversation info \(untrusted metadata\):|Sender \(untrusted metadata\):|OpenClaw assembled context|Treat the conversation context below|Current user request:|Knowledge cutoff:|Current date:|You are (?:ChatGPT|Codex|an AI assistant)\b)/i;

function startupBlockTag(trimmed: string): { tag: string; closing: boolean } | null {
  const match = trimmed.match(/^<\/?([A-Za-z_][A-Za-z0-9_-]*)>$/);
  if (!match) return null;
  const tag = match[1];
  if (!STARTUP_BLOCK_TAGS.has(tag)) return null;
  return { tag, closing: trimmed.startsWith("</") };
}

function isStartupNoiseLine(trimmed: string): boolean {
  return STARTUP_SINGLE_LINE_RE.test(trimmed);
}

/**
 * Filter raw harness stdout (after JSON event lines have been stripped) into
 * assistant-authored text. Startup context/prompt echoes are intentionally
 * dropped so the chat only shows the user's prompt, collapsible tools, private
 * reasoning blocks, and the assistant's actual reply.
 */
export class AssistantFilter {
  private phase: "pre" | "assistant" | "post" = "pre";
  private buf = "";
  private suppressedStartupTag: string | null = null;

  push(chunk: string): string {
    this.buf += chunk;
    let out = "";
    let idx;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      out += this.processLine(line);
    }
    return out;
  }

  flush(): string {
    if (!this.buf) return "";
    const remainder = this.processLine(this.buf);
    this.buf = "";
    return remainder;
  }

  private processLine(rawLine: string): string {
    const line = rawLine.replace(/\r/g, "");
    const trimmed = line.trim();

    if (trimmed === CODEX_START_LINE || CLAUDE_ASSISTANT_RE.test(trimmed)) {
      this.phase = "assistant";
      return "";
    }
    if (HOOK_LINE_RE.test(trimmed)) {
      if (this.phase === "assistant" && /stop/i.test(trimmed)) {
        this.phase = "post";
      }
      return "";
    }
    if (trimmed === "user") {
      return "";
    }
    if (BANNER_LINE_RE.test(trimmed)) {
      return "";
    }
    if (this.phase !== "assistant") return "";

    if (this.suppressedStartupTag) {
      const tag = startupBlockTag(trimmed);
      if (tag?.closing && tag.tag === this.suppressedStartupTag) {
        this.suppressedStartupTag = null;
      }
      return "";
    }

    const tag = startupBlockTag(trimmed);
    if (tag && !tag.closing) {
      this.suppressedStartupTag = tag.tag;
      return "";
    }
    if (tag?.closing || isStartupNoiseLine(trimmed)) {
      return "";
    }

    return line + "\n";
  }
}
