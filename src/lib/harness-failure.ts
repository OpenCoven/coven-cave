/**
 * Harness/runtime failure detection — turns the daemon's raw error prose into
 * a structured, actionable shape so error surfaces can render inline fixes
 * instead of a dead-end message.
 *
 * The canonical example (from `coven`):
 *
 *   unsupported harness `copilot`. Configured harnesses: codex, claude.
 *   To use Hermes, run `coven adapter install hermes`, then
 *   `coven adapter doctor hermes`. For other external harnesses, create a
 *   trusted adapter manifest under COVEN_HOME/adapters or set
 *   COVEN_HARNESS_ADAPTER_MANIFEST / COVEN_HARNESS_ADAPTER_DIRS before
 *   starting Coven.
 *
 * Pure and React-free so every surface (chat strip, group chat, board) and the
 * unit test can share it.
 */

import {
  COMPATIBILITY_ADAPTERS,
  canonicalHarnessId,
  isTrustedChatHarness,
} from "./harness-adapters.ts";

export type HarnessFailure = {
  /** Canonical id of the harness that failed, when identifiable. */
  harness: string | null;
  /** Display label for the failed harness (adapter catalog, else raw id). */
  harnessLabel: string | null;
  /** Canonical ids parsed from a "Configured harnesses: …" list (failed one excluded). */
  configured: string[];
  /** Shell commands the error quotes as the fix (e.g. `coven adapter install hermes`). */
  commands: string[];
};

export type HarnessSwitchTarget = { id: string; label: string };

function adapterLabel(id: string): string {
  return COMPATIBILITY_ADAPTERS.find((adapter) => adapter.id === id)?.label ?? id;
}

// "unsupported harness `copilot`" / "unknown harness copilot" /
// "unrecognized harness 'copilot'"
const FAILED_HARNESS_RE =
  /\b(?:unsupported|unknown|unrecognized|invalid)\s+harness\s+[`'"]?([\w.-]+)[`'"]?/i;
// "harness `copilot` is not configured" / "harness copilot not installed/available/found/supported"
const HARNESS_NOT_RE =
  /\bharness\s+[`'"]?([\w.-]+)[`'"]?\s+(?:is\s+)?not\s+(?:configured|installed|available|supported|found)\b/i;
// "Configured harnesses: codex, claude." — capture up to the sentence end.
const CONFIGURED_RE = /\bconfigured\s+harnesses?\s*:\s*([^.\n]+)/i;
// Backtick-quoted fix commands: only trust the coven adapter verbs.
const COMMAND_RE = /`(coven\s+adapter\s+[^`]+)`/gi;
// Missing runtime binary: "spawn claude ENOENT" / "claude: command not found" /
// "command not found: claude" — only meaningful when the binary maps to a
// known adapter.
const SPAWN_ENOENT_RE = /\bspawn\s+([\w.-]+)\s+ENOENT\b/i;
const NOT_FOUND_A_RE = /(?:^|[\s"'`])([\w.-]+):\s*command not found\b/im;
const NOT_FOUND_B_RE = /\bcommand not found[:\s]+[`'"]?([\w.-]+)[`'"]?/i;

function knownAdapterId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const canonical = canonicalHarnessId(raw);
  return COMPATIBILITY_ADAPTERS.some((adapter) => adapter.id === canonical)
    ? canonical
    : null;
}

/**
 * Parse a harness/runtime failure out of error text. Returns null when the
 * text doesn't look like a harness problem (so surfaces render nothing extra).
 */
export function parseHarnessFailure(
  text: string | null | undefined,
): HarnessFailure | null {
  if (!text || typeof text !== "string") return null;

  let harness: string | null = null;
  let matched = false;

  const failed = FAILED_HARNESS_RE.exec(text) ?? HARNESS_NOT_RE.exec(text);
  if (failed) {
    matched = true;
    harness = canonicalHarnessId(failed[1]);
  }

  // A missing adapter binary is a runtime failure even without the word
  // "harness" — but only when the binary is a known adapter's (a random
  // tool's ENOENT is not a harness problem).
  if (!matched) {
    const candidates = [
      SPAWN_ENOENT_RE.exec(text)?.[1],
      NOT_FOUND_A_RE.exec(text)?.[1],
      NOT_FOUND_B_RE.exec(text)?.[1],
    ];
    for (const binary of candidates) {
      const known = knownAdapterId(binary);
      if (known) {
        matched = true;
        harness = known;
        break;
      }
    }
  }

  const configuredMatch = CONFIGURED_RE.exec(text);
  const configured = configuredMatch
    ? [
        ...new Set(
          configuredMatch[1]
            .split(/[,;/]|\band\b/i)
            .map((token) => token.trim().replace(/^[`'"]|[`'"]$/g, ""))
            .filter(Boolean)
            .map((token) => canonicalHarnessId(token))
            .filter(
              (id) => id !== harness && isTrustedChatHarness(id),
            ),
        ),
      ]
    : [];
  if (configured.length > 0) matched = true;

  const commands: string[] = [];
  for (const match of text.matchAll(COMMAND_RE)) {
    const command = match[1].replace(/\s+/g, " ").trim();
    if (!commands.includes(command)) commands.push(command);
  }
  if (commands.length > 0 && (harness || configured.length > 0)) matched = true;

  if (!matched || (harness === null && configured.length === 0)) return null;

  return {
    harness,
    harnessLabel: harness ? adapterLabel(harness) : null,
    configured,
    commands: harness || configured.length > 0 ? commands : [],
  };
}

// ── Runtime auth failures ─────────────────────────────────────────────────────
// The onboarding wizard greens a runtime the moment its binary installs — it
// never verifies login — so an unauthenticated runtime fails at the user's
// FIRST MESSAGE with raw stderr (cave-f6ol). Recognize the common sign-in
// failure shapes and hand surfaces a copyable login command. Patterns are
// deliberately conservative: a bare "unauthorized" is NOT matched (the app's
// own access-gate 401s use that word and are not a runtime-login problem).

export type HarnessAuthFailure = {
  /** Canonical id of the runtime needing login, when the caller knows it. */
  harness: string | null;
  harnessLabel: string | null;
  /** Copyable terminal command that starts the sign-in flow, when known. */
  loginCommand: string | null;
};

const AUTH_FAILURE_PATTERNS: RegExp[] = [
  /\bnot (?:signed|logged) in\b/i,
  /\bplease (?:run )?[`'"]?\/?login\b/i,
  /\brun [`'"]?(?:codex login|claude \/login|copilot \/login|gh auth login)[`'"]?/i,
  /\binvalid api key\b/i,
  /\bapi key (?:not set|missing|not found|expired)\b/i,
  /\bauthentication (?:error|failed|required)\b/i,
  /\bcredentials? (?:missing|not found|expired|invalid|required)\b/i,
  /\bauthentication[_-]error\b/i,
];

/** Terminal sign-in command per runtime (mirrors the onboarding install prose). */
const LOGIN_COMMANDS: Record<string, string> = {
  claude: "claude /login",
  codex: "codex login",
  copilot: "copilot /login",
};

/**
 * Detect a runtime sign-in failure in error text. `harnessId` is the runtime
 * the failing send used (the stderr rarely names it) — pass it when known so
 * the fix can name the runtime and its exact login command.
 */
export function parseHarnessAuthFailure(
  text: string | null | undefined,
  harnessId?: string | null,
): HarnessAuthFailure | null {
  if (!text || typeof text !== "string") return null;
  if (!AUTH_FAILURE_PATTERNS.some((re) => re.test(text))) return null;
  const harness = knownAdapterId(harnessId);
  return {
    harness,
    harnessLabel: harness ? adapterLabel(harness) : null,
    loginCommand: harness ? LOGIN_COMMANDS[harness] ?? null : null,
  };
}

/**
 * The harnesses a fix UI should offer to switch to: the configured list when
 * the error names one, otherwise every other chat-supported adapter. Capped so
 * the button row never crowds the surface.
 */
export function harnessSwitchTargets(
  failure: HarnessFailure,
  limit = 3,
): HarnessSwitchTarget[] {
  const ids =
    failure.configured.length > 0
      ? failure.configured
      : COMPATIBILITY_ADAPTERS.filter(
          (adapter) => adapter.chatSupported && adapter.id !== failure.harness,
        ).map((adapter) => adapter.id);
  return ids.slice(0, limit).map((id) => ({ id, label: adapterLabel(id) }));
}

/** One copy-pasteable fix command line (install + doctor chained). */
export function harnessFixCommand(failure: HarnessFailure): string | null {
  if (failure.commands.length === 0) return null;
  return failure.commands.join(" && ");
}
