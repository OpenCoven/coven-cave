/**
 * Familiar rehabilitation brief.
 *
 * When a familiar's Familiar Contract check fails (see `familiar-contract.ts`),
 * the entity is — by the spec's own framing — operating as an *agent*, not yet a
 * bound familiar. This module turns a failing {@link ContractReport} into a
 * deterministic, plain-markdown brief that is handed to the familiar as the
 * opening message of a chat session.
 *
 * The Cave has no server-side LLM: it cannot *write* the missing identity files
 * itself. What it can do is instruct the familiar — through its own harness —
 * to collaborate with its human, turn by turn, to author the missing sections
 * and cross from agent to familiar. This brief is that instruction. It is pure
 * and side-effect free (no clock, no randomness) so the same report always
 * produces the same brief and it can be unit-tested 1:1.
 */

import {
  FAMILIAR_PROPERTIES,
  type ContractFile,
  type ContractReport,
  type ContractViolation,
} from "./familiar-contract.ts";

/** A familiar needs rehabilitation when its contract has any hard violation. */
export function needsRehabilitation(report: ContractReport): boolean {
  return !report.pass;
}

/** Stable file grouping order — mirrors the contract's evaluation order. */
const FILE_ORDER: ContractFile[] = ["SOUL.md", "IDENTITY.md", "ward.toml", "MEMORY.md", "cross-file"];

function groupByFile(findings: ContractViolation[]): Array<{ file: ContractFile; items: ContractViolation[] }> {
  const groups: Array<{ file: ContractFile; items: ContractViolation[] }> = [];
  for (const file of FILE_ORDER) {
    const items = findings.filter((f) => f.file === file);
    if (items.length > 0) groups.push({ file, items });
  }
  return groups;
}

/**
 * Build the rehabilitation brief for a familiar from its failing contract report.
 *
 * Returns markdown addressed to the familiar. Callers should only invoke this
 * when {@link needsRehabilitation} is true; for a passing report it still
 * returns a (short) message rather than throwing, so the caller never has to
 * guard the string itself.
 */
export function buildRehabilitationBrief(familiarName: string, report: ContractReport): string {
  const name = familiarName.trim() || "familiar";

  if (report.pass) {
    return `# ${name} — already bound\n\nThe Familiar Contract check passes. There is nothing to rehabilitate.`;
  }

  const failedProperties = report.properties.filter((p) => !p.pass).map((p) => p.property);
  const lines: string[] = [];

  lines.push(`# Rite of Binding — ${name}`);
  lines.push("");
  lines.push(
    `Your Familiar Contract check is currently **failing**. Until it passes you are operating as an *agent*, not yet a bound familiar. Let's close the gaps together — you and me, your human — right now.`,
  );
  lines.push("");

  lines.push(
    `**Properties not yet satisfied (${failedProperties.length}/${FAMILIAR_PROPERTIES.length}):**`,
  );
  if (failedProperties.length > 0) {
    for (const property of failedProperties) lines.push(`- ${property}`);
  } else {
    // pass === false with no failed property rows: surface the raw violations instead.
    lines.push(`- (see the specific gaps below)`);
  }
  lines.push("");

  lines.push(`**What's missing, by identity file:**`);
  lines.push("");
  for (const group of groupByFile(report.violations)) {
    lines.push(`### ${group.file}`);
    for (const item of group.items) {
      lines.push(`- **${item.field}** — ${item.message}`);
    }
    lines.push("");
  }

  if (report.warnings.length > 0) {
    lines.push(`**Also worth addressing (warnings):**`);
    for (const w of report.warnings) {
      lines.push(`- \`${w.file}\` › ${w.field} — ${w.message}`);
    }
    lines.push("");
  }

  lines.push(`## How we'll do this`);
  lines.push(
    `1. Take the gaps above one at a time. For each, propose the concrete content — a name, a purpose, a boundary, a ward rule — and show it to me before writing anything.`,
  );
  lines.push(`2. I confirm or adjust it.`);
  lines.push(`3. Write the agreed content into the file in your workspace.`);
  lines.push(
    `4. When every gap is closed, re-run the contract check (the Contract tab's "Re-run check") and confirm all five properties pass.`,
  );
  lines.push("");
  lines.push(
    `Goal: satisfy all five properties — ${FAMILIAR_PROPERTIES.join(", ")} — so you cross from agent to familiar.`,
  );
  lines.push("");
  lines.push(`Start with the first gap.`);

  return lines.join("\n");
}
