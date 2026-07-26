const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const OSC_RE = /\x1B\][^\x07]*(?:\x07|\x1B\\)/g;

export function stripAnsi(input: string): string {
  return input.replace(OSC_RE, "").replace(ANSI_RE, "");
}

// Apply terminal backspace semantics: "x\b" erases x. TTY-first CLIs piped
// through `coven run` leave self-erasing artifacts in stdout — GitHub Copilot
// CLI prints "^D\b\b" before each reply, which a terminal erases but a pipe
// preserves — and those bytes would otherwise land verbatim in chat bubbles.
// Leading backspaces (nothing left to erase) are dropped.
export function resolveBackspaces(input: string): string {
  if (!input.includes("\b")) return input;
  const out: string[] = [];
  for (const ch of input) {
    if (ch === "\b") out.pop();
    else out.push(ch);
  }
  return out.join("");
}

const PROMPT_PATTERNS: RegExp[] = [
  /\?\s*$/,
  /\?\s*\([^)]*\)\s*$/,
  /press\s+enter\b/i,
  /\[y\/n\]\s*$/i,
  /\(y\/n\)\s*$/i,
  /›\s*$/,
  />\s*$/,
  /:\s*$/,
];

export function needsResponse(stripped: string): boolean {
  const tail = stripped.replace(/\s+$/, "").slice(-400);
  if (!tail) return false;
  return PROMPT_PATTERNS.some((re) => re.test(tail));
}
