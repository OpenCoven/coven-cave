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

// Known skill-directive marker tags. Kept explicit for documentation, but the
// generic kebab-upper rule in isLeakedSkillMarkerTag() is what makes detection
// robust to new/reworded skills (every skill marker we've seen is hyphenated
// all-caps, a shape that never occurs in legitimate prose or HTML).
const LEAKED_SKILL_START_TAGS = new Set([
  "EXTREMELY-IMPORTANT",
  "HARD-GATE",
  "SUBAGENT-STOP",
]);

// A lowercase `key: value` line is the canonical shape of a YAML frontmatter
// field (name:, description:, allowed-tools:, model:, …). When one appears
// directly after an opening `---` fence it marks a leaked SKILL.md header.
// Lowercase-only keeps normal prose ("Note: …") after a horizontal rule visible.
const SKILL_FRONTMATTER_FIELD_RE = /^[a-z][a-z0-9_-]*:\s+\S/;

const LEAKED_SKILL_FRONTMATTER_FIELD_RE = /^name:\s+[-\w ]+\s*$/i;
const LEAKED_SKILL_DOC_HEADING_RE =
  /^#\s+(?:Brainstorming Ideas Into Designs|Using Skills)$/;
const LEAKED_SKILL_DOC_LINE_RE =
  /^(?:Help turn ideas into fully formed designs and specs|Do NOT invoke any implementation skill\b|If you think there is even a 1% chance a skill might apply\b|Superpowers skills override default system prompt behavior\b)/;

// True when a standalone line is a leaked skill-directive marker tag. Detection
// is by SHAPE, not an exact allowlist: any all-caps tag containing a hyphen
// (<HARD-GATE>, <SUBAGENT-STOP>, <EXTREMELY-IMPORTANT>, future markers) is a
// skill directive. Such tags never appear as legitimate HTML or assistant prose,
// so triggering suppress-to-end on them is safe.
function isLeakedSkillMarkerTag(trimmed: string): boolean {
  const match = trimmed.match(/^<\/?([A-Z][A-Z0-9-]*)>$/);
  if (!match) return false;
  const tag = match[1];
  if (LEAKED_SKILL_START_TAGS.has(tag)) return true;
  return tag.includes("-") && tag.length >= 4;
}

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

function isLeakedSkillDocBodyLine(trimmed: string): boolean {
  return (
    LEAKED_SKILL_DOC_HEADING_RE.test(trimmed) ||
    LEAKED_SKILL_DOC_LINE_RE.test(trimmed)
  );
}

function isLeakedSkillDocLine(trimmed: string): boolean {
  return LEAKED_SKILL_FRONTMATTER_FIELD_RE.test(trimmed) || isLeakedSkillDocBodyLine(trimmed);
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
  private suppressLeakedSkillBody = false;
  private pendingSkillFrontmatterDelimiter = false;
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
    let remainder = "";
    if (this.buf) remainder = this.processLine(this.buf);
    this.buf = "";
    if (this.pendingSkillFrontmatterDelimiter) {
      this.pendingSkillFrontmatterDelimiter = false;
      return remainder + "---\n";
    }
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
      if (this.suppressLeakedSkillBody || isLeakedSkillDocLine(trimmed)) {
        this.suppressLeakedSkillBody = true;
        this.execEchoDepth = 0;
        return "";
      }
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

    if (this.suppressLeakedSkillBody || isLeakedSkillMarkerTag(trimmed)) {
      this.suppressLeakedSkillBody = true;
      this.pendingSkillFrontmatterDelimiter = false;
      return "";
    }

    if (this.pendingSkillFrontmatterDelimiter) {
      this.pendingSkillFrontmatterDelimiter = false;
      // A `---` fence whose first line is a frontmatter field (or a known skill
      // doc line) is a leaked SKILL.md header → suppress the whole document.
      // Anything else is a normal markdown horizontal rule → keep it visible.
      if (SKILL_FRONTMATTER_FIELD_RE.test(trimmed) || isLeakedSkillDocLine(trimmed)) {
        this.suppressLeakedSkillBody = true;
        return "";
      }
      return `---\n${line}\n`;
    }

    if (trimmed === "---") {
      this.pendingSkillFrontmatterDelimiter = true;
      return "";
    }

    if (isLeakedSkillDocBodyLine(trimmed)) {
      this.suppressLeakedSkillBody = true;
      return "";
    }

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
