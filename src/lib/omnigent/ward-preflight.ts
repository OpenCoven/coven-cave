/**
 * Ward preflight + identity injection for Omnigent runs.
 *
 * When a Cave familiar is bound to a session, Coven owns identity/authority:
 * - Fail closed if the Familiar Contract has hard violations.
 * - Prefix the user prompt with SOUL / IDENTITY / USER so host-launched
 *   catalog harnesses still act as that familiar (Omnigent has no Coven workspace).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  evaluateFamiliarContract,
  type ContractReport,
  type ContractViolation,
} from "../familiar-contract.ts";
import {
  isValidFamiliarId,
  readFamiliarContractFiles,
} from "../server/familiar-contract-files.ts";
import { familiarWorkspace } from "../coven-paths.ts";

/** Soft cap per identity file so a runaway doc can't blow the turn. */
const MAX_IDENTITY_CHARS = 12_000;

export class WardPreflightError extends Error {
  readonly familiarId: string;
  readonly report: ContractReport;
  readonly code = "WARD_PREFLIGHT_FAILED" as const;

  constructor(familiarId: string, report: ContractReport) {
    super(formatWardFailure(familiarId, report.violations));
    this.name = "WardPreflightError";
    this.familiarId = familiarId;
    this.report = report;
  }
}

export type OmnigentIdentityContext = {
  familiarId: string;
  report: ContractReport;
  /** Prefix to prepend to the user prompt (empty when no identity files). */
  promptPrefix: string;
  /** Files that contributed content. */
  included: Array<"SOUL.md" | "IDENTITY.md" | "USER.md">;
};

function formatWardFailure(familiarId: string, violations: ContractViolation[]): string {
  const lines = violations.slice(0, 8).map((v) => `- ${v.file}/${v.field}: ${v.message}`);
  const more = violations.length > 8 ? `\n- …and ${violations.length - 8} more` : "";
  return (
    `Ward preflight failed for familiar "${familiarId}" ` +
    `(${violations.length} violation${violations.length === 1 ? "" : "s"}). ` +
    `Fix SOUL.md / IDENTITY.md / ward.toml in Familiar Studio, then retry.\n` +
    lines.join("\n") +
    more
  );
}

function clip(text: string, max = MAX_IDENTITY_CHARS): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n\n…[truncated for Omnigent prompt]`;
}

/**
 * Build the identity block from loaded contract files + optional USER.md.
 * Pure enough for tests when files are passed in.
 */
export function buildOmnigentIdentityPrefix(input: {
  soul: string | null;
  identity: string | null;
  user?: string | null;
  familiarId?: string;
}): { prefix: string; included: OmnigentIdentityContext["included"] } {
  const included: OmnigentIdentityContext["included"] = [];
  const parts: string[] = [];

  const who = input.familiarId?.trim() || "this familiar";
  parts.push(
    `[Coven familiar identity — you are "${who}". Follow SOUL/IDENTITY for persona, purpose, and bounds for this entire session.]`,
  );

  if (input.soul?.trim()) {
    included.push("SOUL.md");
    parts.push(`## SOUL.md\n\n${clip(input.soul)}`);
  }
  if (input.identity?.trim()) {
    included.push("IDENTITY.md");
    parts.push(`## IDENTITY.md\n\n${clip(input.identity)}`);
  }
  if (input.user?.trim()) {
    included.push("USER.md");
    parts.push(`## USER.md\n\n${clip(input.user)}`);
  }

  if (included.length === 0) {
    return { prefix: "", included };
  }

  parts.push("---\n## Task");
  return { prefix: parts.join("\n\n"), included };
}

/** Compose final Omnigent user message: identity block + task prompt. */
export function composeOmnigentPrompt(prompt: string, identityPrefix: string): string {
  const task = prompt.trim();
  if (!identityPrefix.trim()) return task;
  return `${identityPrefix.trim()}\n\n${task}`;
}

async function readUserMd(familiarId: string): Promise<string | null> {
  try {
    const workspace = await familiarWorkspace(familiarId);
    return await readFile(path.join(workspace, "USER.md"), "utf8");
  } catch {
    return null;
  }
}

/**
 * Load contract files, fail closed on Ward violations, return identity prefix.
 * No-op path: call only when familiarId is set.
 */
export async function runWardPreflight(familiarId: string): Promise<OmnigentIdentityContext> {
  const id = familiarId.trim();
  if (!id) {
    throw new Error("familiar id is required for Ward preflight");
  }
  if (!isValidFamiliarId(id)) {
    throw new Error(`invalid familiar id for Ward preflight: ${id}`);
  }

  const { files } = await readFamiliarContractFiles(id);
  const report = evaluateFamiliarContract(files);
  if (!report.pass) {
    throw new WardPreflightError(id, report);
  }

  const user = await readUserMd(id);
  const { prefix, included } = buildOmnigentIdentityPrefix({
    soul: files.soul,
    identity: files.identity,
    user,
    familiarId: id,
  });

  return {
    familiarId: id,
    report,
    promptPrefix: prefix,
    included,
  };
}
