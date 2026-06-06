const HOOK_LINE_RE = /^hook:\s+/;
const BANNER_LINE_RE = /^(?:--------|workdir:|model:|provider:|approval:|sandbox:|reasoning:|session id:|tokens used|\d[\d,]*\s*$)/;
const CODEX_START_LINE = "codex";
const CLAUDE_ASSISTANT_RE = /^claude(?:\s+code)?$/i;

// Exec-echo blocks emitted by Codex into stdout — NOT structured JSON events.
// Format:
//   exec
//   /bin/zsh -lc '...' in /path
//    exited N in Nms:
//    <output lines>
// We detect the block header line and suppress until the block ends.
const EXEC_ECHO_HEADER_RE = /^exec$/;
const EXEC_ECHO_CMDLINE_RE = /^\/.+ in (?:\/[^\s]|~)/;
const EXEC_ECHO_STATUS_RE = /^\s*(?:succeeded|exited|failed|timed out)(?: \d+)? in \d+(?:ms|s)/;

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
  // Exec-echo block suppression
  private inExecEcho: "none" | "header" | "cmdline" | "output" = "none";
  private execEchoDepth = 0;

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

    // ── Exec-echo block detection ─────────────────────────────────────────
    // State machine: none → header → cmdline → output
    // We suppress the entire block from the saved assistant text.
    if (this.inExecEcho === "none" && EXEC_ECHO_HEADER_RE.test(trimmed)) {
      this.inExecEcho = "header";
      this.execEchoDepth = 0;
      return "";
    }
    if (this.inExecEcho === "header") {
      // Next non-empty line is the command line (path + args + "in /dir")
      if (trimmed === "") return "";
      if (EXEC_ECHO_CMDLINE_RE.test(trimmed)) {
        this.inExecEcho = "cmdline";
        return "";
      }
      // Didn't look like a command line — bail and emit both lines
      this.inExecEcho = "none";
      return "exec\n" + line + "\n";
    }
    if (this.inExecEcho === "cmdline") {
      // Next line is the status line ("succeeded|exited|failed in Nms:")
      if (trimmed === "") return "";
      if (EXEC_ECHO_STATUS_RE.test(trimmed)) {
        this.inExecEcho = "output";
        return "";
      }
      // Didn't look like status — bail
      this.inExecEcho = "none";
      return line + "\n";
    }
    if (this.inExecEcho === "output") {
      // Suppress output lines until we hit the NEXT exec block header or a
      // blank line followed by non-indented text that doesn't look like output.
      // Heuristic: a blank line + the next line starts "exec" = new block.
      // Otherwise keep suppressing output lines (they may contain arbitrary text).
      if (EXEC_ECHO_HEADER_RE.test(trimmed)) {
        // New exec block starts
        this.inExecEcho = "header";
        this.execEchoDepth = 0;
        return "";
      }
      // A line that looks like regular assistant prose after the block:
      // non-empty, not indented, not a status line, and the preceding blank
      // line signals end of output. We track blank lines to know when output ended.
      if (trimmed === "") {
        this.execEchoDepth++;
        return "";
      }
      if (this.execEchoDepth > 0 && !EXEC_ECHO_STATUS_RE.test(trimmed) && !EXEC_ECHO_CMDLINE_RE.test(trimmed)) {
        // Likely back in assistant prose
        this.inExecEcho = "none";
        this.execEchoDepth = 0;
        return line + "\n";
      }
      // Still in output block
      this.execEchoDepth = 0;
      return "";
    }
    // ─────────────────────────────────────────────────────────────────────

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
