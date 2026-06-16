/**
 * Agent Completion Report — schema + Markdown generator.
 *
 * Purpose: structured "agent completion report" for coding/git workflows,
 * scannable issue-ready summaries with strong information architecture and
 * predictable section order. Built as an audit-trail artifact, NOT chat-log
 * cleanup. Output is copy-pasteable into GitHub issues, PR notes, feedback,
 * or memory files.
 *
 * Section order (predictable, per the design brief):
 *   1. Title
 *   2. Metadata Affordances (branch, commit, signature, PR/issue, etc.)
 *   3. Context     — what was the situation, what was being asked
 *   4. Risk        — what could go wrong / what surface was touched
 *   5. Resolution  — what was actually done
 *   6. Result      — outcome, links, hashes, push targets
 *   7. Follow-up   — open work, deferred decisions
 *   8. Proposed Convention — generalizable pattern to capture
 *
 * Design constraints:
 *   - terse labels, readable Markdown
 *   - compact metadata table for at-a-glance scan
 *   - graceful when sections are missing (omit, not empty header)
 *   - never mix diagnosis/command-history/outcome/policy in one paragraph
 *   - works for multi-agent / shared-checkout environments (worktree path,
 *     primary-checkout-clean indicator, shared branch claim, etc.)
 *
 * NOTE: this is a pure data → string formatter. It does not run git, parse
 * shell output, or call out to GitHub. Inputs are produced upstream by an
 * agent runtime (or hand-built by a familiar) and passed in as a typed object.
 */

export type AgentReportKind = "completion" | "decision-needed";

export type SignatureStatus = "signed" | "unsigned" | "unknown";

export type PrimaryCheckoutState = "clean" | "dirty" | "unknown";

/**
 * Compact metadata affordances rendered as a tight table at the top of the
 * report. All fields are optional — the renderer omits unknowns rather than
 * showing "n/a" noise.
 */
export interface AgentReportMetadata {
  /** Source branch (the branch the agent committed on). */
  sourceBranch?: string;
  /** Target branch the agent intends to merge into. */
  targetBranch?: string;
  /** Repo identifier, e.g. "OpenCoven/coven-cave". */
  repo?: string;
  /** Worktree path used for the work, e.g. "coven-cave.wt/feat-foo". */
  worktreePath?: string;
  /** Primary-checkout state at the end of the run. */
  primaryCheckout?: PrimaryCheckoutState;
  /** Most recent commit hash (short or long). */
  commitHash?: string;
  /** Whether commits in this report are signed. */
  signature?: SignatureStatus;
  /** Push target, e.g. "origin/feat/foo" or "(not pushed)". */
  pushTarget?: string;
  /** Linked PR number / id (e.g. "#232"). */
  prRef?: string;
  /** PR or issue state ("open", "merged", "closed", "draft"). */
  prState?: string;
  /** Linked issue references (e.g. ["#230"]). */
  linkedIssues?: string[];
  /** Optional shared-checkout claim holder ("nova", "codex-a", etc.). */
  claim?: string;
}

/**
 * A single titled bullet entry. The body is plain Markdown text and may
 * contain inline links / code spans / etc. The renderer escapes nothing —
 * inputs are trusted authored content.
 */
export interface AgentReportBullet {
  /** Optional short label rendered as **bold** prefix. */
  label?: string;
  /** Required body text. */
  body: string;
}

/**
 * A section can be omitted entirely (undefined) or carry a list of bullets
 * plus optional intro paragraph.
 */
export interface AgentReportSection {
  /** Optional one-paragraph intro before bullets. */
  intro?: string;
  /** Bullet list. Empty array is treated as "section was set but had no
   *  items"; renderer still omits the section header in that case. */
  bullets?: AgentReportBullet[];
}

/**
 * Top-level report shape. Title and kind are required; every other section is
 * optional and omitted when absent or empty.
 */
export interface AgentCompletionReport {
  kind: AgentReportKind;
  title: string;
  /** Optional one-line subtitle/summary line under the title. */
  subtitle?: string;
  metadata?: AgentReportMetadata;
  context?: AgentReportSection;
  risk?: AgentReportSection;
  resolution?: AgentReportSection;
  result?: AgentReportSection;
  followUp?: AgentReportSection;
  proposedConvention?: AgentReportSection;
  /** Free-form footer (rendered after Proposed Convention, no header). */
  footer?: string;
}

const SECTION_ORDER: ReadonlyArray<{
  key:
    | "context"
    | "risk"
    | "resolution"
    | "result"
    | "followUp"
    | "proposedConvention";
  heading: string;
}> = [
  { key: "context", heading: "Context" },
  { key: "risk", heading: "Risk" },
  { key: "resolution", heading: "Resolution" },
  { key: "result", heading: "Result" },
  { key: "followUp", heading: "Follow-up" },
  { key: "proposedConvention", heading: "Proposed Convention" },
];

const KIND_BADGE: Readonly<Record<AgentReportKind, string>> = {
  completion: "✅ Completion",
  "decision-needed": "🟡 Decision needed",
};

/**
 * Internal: format a metadata key/value into a single-row Markdown table cell
 * pair. Returns null if the value should be omitted entirely.
 */
function formatMetadataValue(
  key: keyof AgentReportMetadata,
  meta: AgentReportMetadata,
): string | null {
  const v = meta[key];
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) {
    if (v.length === 0) return null;
    return v.join(", ");
  }
  if (typeof v === "string" && v.trim() === "") return null;
  return String(v);
}

/**
 * Internal: render the metadata table. Returns an empty string when no fields
 * are populated, so the caller can skip emitting the block entirely.
 */
function renderMetadataTable(meta: AgentReportMetadata | undefined): string {
  if (!meta) return "";
  const rows: Array<[string, string]> = [];
  const push = (label: string, key: keyof AgentReportMetadata) => {
    const v = formatMetadataValue(key, meta);
    if (v !== null) rows.push([label, v]);
  };
  push("Repo", "repo");
  push("Source", "sourceBranch");
  push("Target", "targetBranch");
  push("Worktree", "worktreePath");
  push("Primary checkout", "primaryCheckout");
  push("Commit", "commitHash");
  push("Signature", "signature");
  push("Push target", "pushTarget");
  push("PR", "prRef");
  push("PR state", "prState");
  push("Linked issues", "linkedIssues");
  push("Claim", "claim");
  if (rows.length === 0) return "";
  // Two-column compact table.
  const lines: string[] = [];
  lines.push("| Field | Value |");
  lines.push("| --- | --- |");
  for (const [k, v] of rows) {
    // Wrap commit hash & PR refs in inline code for visual chip effect.
    const shouldChip =
      k === "Commit" || k === "Source" || k === "Target" || k === "PR";
    const valueOut = shouldChip ? `\`${v}\`` : v;
    lines.push(`| ${k} | ${valueOut} |`);
  }
  return lines.join("\n");
}

function renderSection(
  heading: string,
  section: AgentReportSection | undefined,
): string {
  if (!section) return "";
  const intro = section.intro?.trim();
  const bullets = section.bullets ?? [];
  if ((!intro || intro.length === 0) && bullets.length === 0) return "";
  const lines: string[] = [];
  lines.push(`## ${heading}`);
  if (intro && intro.length > 0) {
    lines.push("");
    lines.push(intro);
  }
  if (bullets.length > 0) {
    lines.push("");
    for (const b of bullets) {
      const body = b.body.trim();
      if (body.length === 0) continue;
      if (b.label && b.label.trim().length > 0) {
        lines.push(`- **${b.label.trim()}** — ${body}`);
      } else {
        lines.push(`- ${body}`);
      }
    }
  }
  return lines.join("\n");
}

/**
 * Render an AgentCompletionReport as Markdown. Output is suitable for direct
 * paste into a GitHub issue body, PR comment, feedback artifact, or memory
 * file. Pure function, no side effects.
 */
export function formatAgentCompletionReportMarkdown(
  report: AgentCompletionReport,
): string {
  const blocks: string[] = [];

  // 1. Title (with kind badge prefix).
  const badge = KIND_BADGE[report.kind];
  const title = report.title.trim();
  blocks.push(`# ${badge} — ${title}`);

  // 2. Optional subtitle (rendered as italic blockquote, one line).
  const subtitle = report.subtitle?.trim();
  if (subtitle && subtitle.length > 0) {
    blocks.push(`> ${subtitle}`);
  }

  // 3. Metadata table.
  const metaTable = renderMetadataTable(report.metadata);
  if (metaTable.length > 0) {
    blocks.push(metaTable);
  }

  // 4. Body sections in fixed order.
  for (const { key, heading } of SECTION_ORDER) {
    const section = report[key] as AgentReportSection | undefined;
    const out = renderSection(heading, section);
    if (out.length > 0) blocks.push(out);
  }

  // 5. Footer (no heading, just trailing free-form Markdown).
  const footer = report.footer?.trim();
  if (footer && footer.length > 0) {
    blocks.push(footer);
  }

  // Single trailing newline; blocks separated by blank lines.
  return blocks.join("\n\n") + "\n";
}
