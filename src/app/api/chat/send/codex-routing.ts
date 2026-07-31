import {
  CODEX_BOOTSTRAP_SCHEMAS,
  resolveCodexSchema,
  type CodexCapabilities,
  type CodexEventSchema,
  type CodexRuntimeReport,
  type CodexSchemaSources,
} from "../../../../lib/codex-compatibility.ts";

/**
 * Fallback causes worth a one-line compatibility notice. `null` means the
 * fallback is the ordinary expected route (SSH / non-Codex harness) and no
 * notice is emitted.
 */
export type CodexCompatibilityDiagnosticCode =
  | "probe-unavailable"
  | "unsupported-version"
  | "capability-mismatch"
  | "invalid-schema"
  | "resume-unsupported";

export type CodexChatRouting =
  | {
      mode: "direct";
      schema: CodexEventSchema;
      report: CodexRuntimeReport;
      compatibilityDiagnostic: null;
      diagnosticCode: null;
    }
  | {
      mode: "fallback";
      schema: null;
      report: CodexRuntimeReport | null;
      compatibilityDiagnostic: string | null;
      diagnosticCode: CodexCompatibilityDiagnosticCode | null;
    };

// The generic `coven run codex` transport (with its filtered chat text and
// hook-line tool parsing) stays available for every fallback, so diagnostics
// describe a degraded transport choice, never a blocked chat.
const CODEX_FALLBACK_DIAGNOSTICS: Record<CodexCompatibilityDiagnosticCode, string> = {
  "probe-unavailable":
    "Couldn't verify the Codex CLI's JSON event protocol; continuing through the Coven transport",
  "unsupported-version":
    "This Codex CLI version has no verified event schema; continuing through the Coven transport",
  "capability-mismatch":
    "This Codex CLI does not advertise compatible JSON events; continuing through the Coven transport",
  "invalid-schema":
    "Codex event schema selection was ambiguous; continuing through the Coven transport",
  "resume-unsupported":
    "This Codex CLI cannot resume sessions over JSON events; continuing this conversation through the Coven transport",
};

function fallback(code: CodexCompatibilityDiagnosticCode | null, report: CodexRuntimeReport | null): CodexChatRouting {
  return {
    mode: "fallback",
    schema: null,
    report,
    compatibilityDiagnostic: code ? CODEX_FALLBACK_DIAGNOSTICS[code] : null,
    diagnosticCode: code,
  };
}

// Codex thread ids observed in the JSONL contract are UUID-like tokens. The
// resume id becomes a positional argv value on `codex exec resume`, so it must
// never begin with `-` (option injection) or carry shell-relevant bytes.
const CODEX_RESUME_SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

export function isSafeCodexResumeSessionId(id: string | null | undefined): id is string {
  return typeof id === "string" && CODEX_RESUME_SESSION_ID_RE.test(id);
}

/**
 * Keep the direct `codex exec --json` launch behind an explicit, testable
 * capability gate. An unknown, remote, prerelease, or resume-incapable client
 * always retains the established filtered `coven run codex` path — the
 * routing NEVER blocks a chat.
 */
export function resolveCodexChatRouting(input: {
  harness: string;
  isSshRuntime: boolean;
  report: CodexRuntimeReport | null;
  sources?: CodexSchemaSources | null;
  /** The native session id this turn intends to resume, when continuing. */
  resumeSessionId?: string | null;
}): CodexChatRouting {
  // Remote Coven routing is unchanged by design; non-Codex harnesses never
  // reach the Codex protocol machinery.
  if (input.isSshRuntime || input.harness !== "codex") {
    return fallback(null, null);
  }
  const report = input.report;
  if (!report || !report.version) {
    return fallback("probe-unavailable", report);
  }
  const resolution = resolveCodexSchema(
    report,
    input.sources ?? [{ source: "builtin", schemas: CODEX_BOOTSTRAP_SCHEMAS }],
  );
  if (!resolution.ok) {
    const code: CodexCompatibilityDiagnosticCode =
      resolution.reason === "runtime-unavailable"
        ? "probe-unavailable"
        : resolution.reason === "unsupported-version"
          ? "unsupported-version"
          : resolution.reason === "invalid-schema"
            ? "invalid-schema"
            : "capability-mismatch";
    return fallback(code, report);
  }
  // Belt and braces: every direct launch needs the probed `--json` contract,
  // independent of what a (registry-refreshed) schema chose to require.
  if (report.capabilities.jsonEvents !== true) {
    return fallback("capability-mismatch", report);
  }
  if (input.resumeSessionId != null) {
    // `codex exec resume` is a distinct argv contract. Resuming without its
    // probed `--json` support — or with a token unsafe as a positional —
    // keeps this turn on the generic Coven path instead of forking the chat.
    if (report.capabilities.resumeJson !== true || !isSafeCodexResumeSessionId(input.resumeSessionId)) {
      return fallback("resume-unsupported", report);
    }
  }
  return {
    mode: "direct",
    schema: resolution.schema,
    report,
    compatibilityDiagnostic: null,
    diagnosticCode: null,
  };
}

/**
 * Route-level preparation with injectable I/O, mirroring
 * `prepareCopilotChatRouting`: the probe and schema sources stay at this
 * boundary so the fail-safe launch choice is behaviorally testable without
 * starting a local CLI process. SSH and non-Codex requests never probe.
 */
export async function prepareCodexChatRouting(input: {
  harness: string;
  isSshRuntime: boolean;
  resumeSessionId?: string | null;
  probe: () => Promise<CodexRuntimeReport | null>;
  resolveSources: () => Promise<CodexSchemaSources | null>;
}): Promise<CodexChatRouting> {
  if (input.isSshRuntime || input.harness !== "codex") {
    return resolveCodexChatRouting({
      harness: input.harness,
      isSshRuntime: input.isSshRuntime,
      report: null,
    });
  }
  const [report, sources] = await Promise.all([
    input.probe().catch(() => null),
    input.resolveSources().catch(() => null),
  ]);
  return resolveCodexChatRouting({
    harness: input.harness,
    isSshRuntime: false,
    report,
    sources,
    resumeSessionId: input.resumeSessionId,
  });
}

/**
 * Direct `codex exec` argv. Every flag is gated on the exact capability the
 * bounded help probe observed (fresh and resume help are distinct contracts),
 * and the prompt is always a positional behind `--` so its text can never be
 * parsed as an option.
 */
export function buildCodexExecArgs(input: {
  prompt: string;
  resumeSessionId: string | null;
  capabilities: CodexCapabilities;
  model: string | null;
  readOnly: boolean;
  addDirs: readonly string[];
}): string[] {
  const caps = input.capabilities;
  // Routing already refused unsafe resume tokens; this second check keeps the
  // builder safe on its own so a future caller cannot inject an option.
  const resumeSessionId = isSafeCodexResumeSessionId(input.resumeSessionId)
    ? input.resumeSessionId
    : null;
  if (resumeSessionId) {
    const a = ["exec", "resume", resumeSessionId, "--json"];
    if (input.model && caps.resumeModel) a.push("--model", input.model);
    if (caps.resumeSkipGitRepoCheck) a.push("--skip-git-repo-check");
    a.push("--", input.prompt);
    return a;
  }
  const a = ["exec", "--json"];
  if (input.model && caps.model) a.push("--model", input.model);
  // Cave's Read-only chip maps onto Codex's native sandbox exactly like
  // `coven run --permission read-only` does; "full" stays implicit so the
  // harness keeps its own default sandbox rather than being widened.
  if (input.readOnly && caps.sandbox) a.push("--sandbox", "read-only");
  if (caps.addDir) {
    for (const dir of input.addDirs) a.push("--add-dir", dir);
  }
  if (caps.skipGitRepoCheck) a.push("--skip-git-repo-check");
  if (caps.color) a.push("--color", "never");
  a.push("--", input.prompt);
  return a;
}
