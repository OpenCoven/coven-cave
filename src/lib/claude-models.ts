import type { RuntimeModelOption } from "./runtime-models.ts";

export const CLAUDE_OPUS_5_CAVE_ID = "anthropic/claude-opus-5";
export const CLAUDE_OPUS_5_NATIVE_MODEL = "anthropic/opus";
export const CLAUDE_OPUS_5_MINIMUM_CODE_VERSION = "2.1.219";

type ClaudeModelEnvironment = Record<string, string | undefined>;

export type ClaudeOpus5Probe = {
  versionOutput: string | null | undefined;
  env: ClaudeModelEnvironment;
};

const VERSION_NUMBER = "(?:0|[1-9]\\d*)";
const CLAUDE_VERSION = new RegExp(
  `^(?:(?:Claude Code)\\s+v?)?(${VERSION_NUMBER})\\.(${VERSION_NUMBER})\\.(${VERSION_NUMBER})(?:\\s+\\(Claude Code\\))?$`,
  "i",
);

/** Parse one complete Claude Code release banner without accepting prereleases
 * or trailing version components that have not shipped the verified contract. */
export function parseClaudeCodeVersion(output: string | null | undefined): string | null {
  if (!output) return null;
  const line = output.trim();
  if (!line || /[\r\n]/.test(line)) return null;
  const match = CLAUDE_VERSION.exec(line);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

function compareVersion(left: string, right: string): number | null {
  const parse = (value: string): string[] | null => {
    const match = new RegExp(
      `^(${VERSION_NUMBER})\\.(${VERSION_NUMBER})\\.(${VERSION_NUMBER})$`,
    ).exec(value);
    return match ? [match[1]!, match[2]!, match[3]!] : null;
  };
  const first = parse(left);
  const second = parse(right);
  if (!first || !second) return null;
  for (let index = 0; index < first.length; index += 1) {
    const a = first[index]!;
    const b = second[index]!;
    if (a.length !== b.length) return a.length - b.length;
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

function enabled(value: string | undefined): boolean {
  return /^(?:1|true|yes)$/i.test(value?.trim() ?? "");
}

function explicitOpus5Mapping(env: ClaudeModelEnvironment): boolean | null {
  const model = env.ANTHROPIC_DEFAULT_OPUS_MODEL?.trim();
  if (!model) return null;
  const displayName = env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME?.trim() ?? "";
  return /(?:^|[._:/-])claude[._-]opus[._-]5(?:$|[._:@/+\-[\]])/i.test(model) ||
    /\bclaude\s+opus\s+5\b/i.test(displayName);
}

function hasCustomAnthropicBaseUrl(value: string | undefined): boolean {
  const raw = value?.trim();
  if (!raw) return false;
  try {
    return new URL(raw).hostname.toLowerCase() !== "api.anthropic.com";
  } catch {
    return true;
  }
}

/** Whether this concrete Claude Code/provider configuration can truthfully
 * offer Cave's canonical Opus 5 choice. */
export function claudeOpus5Available(probe: ClaudeOpus5Probe): boolean {
  const version = parseClaudeCodeVersion(probe.versionOutput);
  if (
    !version ||
    (compareVersion(version, CLAUDE_OPUS_5_MINIMUM_CODE_VERSION) ?? -1) < 0
  ) {
    return false;
  }

  const explicitMapping = explicitOpus5Mapping(probe.env);
  if (explicitMapping !== null) return explicitMapping;

  const providerModes = [
    enabled(probe.env.CLAUDE_CODE_USE_BEDROCK),
    enabled(probe.env.CLAUDE_CODE_USE_VERTEX),
    enabled(probe.env.CLAUDE_CODE_USE_FOUNDRY),
  ];
  if (providerModes.filter(Boolean).length > 1) return false;
  // Foundry and arbitrary gateways use deployment names Cave cannot infer.
  if (
    enabled(probe.env.CLAUDE_CODE_USE_FOUNDRY) ||
    hasCustomAnthropicBaseUrl(probe.env.ANTHROPIC_BASE_URL)
  ) {
    return false;
  }
  return true;
}

/** Add the verified dynamic choice ahead of the fallback seed. */
export function withClaudeOpus5(
  seed: readonly RuntimeModelOption[],
  probe: ClaudeOpus5Probe,
): RuntimeModelOption[] {
  if (!claudeOpus5Available(probe)) return [...seed];
  return [
    { id: CLAUDE_OPUS_5_CAVE_ID, label: "Claude Opus 5" },
    ...seed.filter((model) => model.id !== CLAUDE_OPUS_5_CAVE_ID),
  ];
}
