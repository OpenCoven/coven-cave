import type { ToolEvent, VerificationKind, VerifiedResultEvidence } from "./chat-turn-state.ts";

const RUNNER_NAMES = new Set(["bash", "shell", "exec", "command"]);
const UNSAFE_SHELL_SYNTAX = /(?:&&|\|\||[;|&><`]|\r|\n|\$\()/;
const TEST_COMMAND_RE = /^pnpm test(?::app|:api|:mobile|:e2e)?$/;
const SAFE_TEST_SELECTOR_RE = /^[\w./:=@][\w./:=@-]*$/;
const COMMANDS: ReadonlyArray<{
  pattern: RegExp;
  kind: VerificationKind;
  running: string;
  passed: string;
  failed: string;
}> = [
  {
    pattern: /^pnpm test(?::app|:api|:mobile|:e2e)?(?:\s+[\w./:=@-]+)*$/,
    kind: "test",
    running: "Running app tests",
    passed: "App tests passed",
    failed: "App tests failed",
  },
  {
    pattern: /^pnpm typecheck$/,
    kind: "typecheck",
    running: "Running typecheck",
    passed: "Typecheck passed",
    failed: "Typecheck failed",
  },
  {
    pattern: /^pnpm lint$/,
    kind: "lint",
    running: "Running lint",
    passed: "Lint passed",
    failed: "Lint failed",
  },
  {
    pattern: /^pnpm build$/,
    kind: "build",
    running: "Checking production build",
    passed: "Production build passed",
    failed: "Production build failed",
  },
];

function buildVerificationEvidence(tool: ToolEvent, registration: (typeof COMMANDS)[number]): VerifiedResultEvidence {
  const state = tool.status === "running" ? "running" : tool.status === "ok" ? "passed" : "failed";
  const label =
    state === "running"
      ? registration.running
      : state === "passed"
        ? registration.passed
        : registration.failed;
  return {
    id: `verified:${registration.kind}:${tool.id}`,
    kind: registration.kind,
    label,
    state,
    source: "verified-event",
  };
}

function isSafeTestCommand(command: string): boolean {
  const [runner, commandName, ...selectors] = command.split(" ");
  if (runner !== "pnpm" || !TEST_COMMAND_RE.test(`pnpm ${commandName ?? ""}`)) return false;
  return selectors.every((selector) => SAFE_TEST_SELECTOR_RE.test(selector));
}

export function verificationEvidenceFromTool(tool: ToolEvent): VerifiedResultEvidence | null {
  if (!RUNNER_NAMES.has(tool.name.trim().toLowerCase()) || !tool.input) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(tool.input);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const command = (parsed as { command?: unknown }).command;
  if (typeof command !== "string") return null;
  if (/\r|\n/.test(command)) return null;
  const normalized = command.trim().replace(/\s+/g, " ");
  if (!normalized || UNSAFE_SHELL_SYNTAX.test(normalized)) return null;
  if (normalized.startsWith("pnpm test") && !isSafeTestCommand(normalized)) return null;
  const registration = COMMANDS.find((entry) => entry.pattern.test(normalized));
  if (!registration) return null;
  return buildVerificationEvidence(tool, registration);
}

export function verificationEvidenceFromTools(
  tools: readonly ToolEvent[] | undefined,
): VerifiedResultEvidence[] {
  return (tools ?? [])
    .map(verificationEvidenceFromTool)
    .filter((value): value is VerifiedResultEvidence => value !== null);
}
