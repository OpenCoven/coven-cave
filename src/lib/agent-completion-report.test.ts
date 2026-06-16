// @ts-nocheck
import assert from "node:assert/strict";
import {
  formatAgentCompletionReportMarkdown,
  type AgentCompletionReport,
} from "./agent-completion-report.ts";

// ---------------------------------------------------------------------------
// 1. Minimal report: only required fields render.
// ---------------------------------------------------------------------------
const minimal: AgentCompletionReport = {
  kind: "completion",
  title: "Empty title",
};
const minimalOut = formatAgentCompletionReportMarkdown(minimal);
assert.equal(
  minimalOut,
  "# ✅ Completion — Empty title\n",
  "minimal report renders only the title with kind badge",
);

// ---------------------------------------------------------------------------
// 2. Decision-needed kind uses its own badge.
// ---------------------------------------------------------------------------
const decision: AgentCompletionReport = {
  kind: "decision-needed",
  title: "Should we ship X?",
};
const decisionOut = formatAgentCompletionReportMarkdown(decision);
assert.match(
  decisionOut,
  /^# 🟡 Decision needed — Should we ship X\?\n$/,
  "decision-needed badge renders correctly",
);

// ---------------------------------------------------------------------------
// 3. Subtitle renders as a blockquote line.
// ---------------------------------------------------------------------------
const withSubtitle: AgentCompletionReport = {
  kind: "completion",
  title: "Subtitled run",
  subtitle: "PR #232 squash-merged at 07:51Z",
};
const subOut = formatAgentCompletionReportMarkdown(withSubtitle);
assert.ok(
  subOut.includes("> PR #232 squash-merged at 07:51Z"),
  "subtitle renders as blockquote",
);

// ---------------------------------------------------------------------------
// 4. Metadata table renders fixed key order with chips on commit/branch/PR.
// ---------------------------------------------------------------------------
const withMeta: AgentCompletionReport = {
  kind: "completion",
  title: "Meta example",
  metadata: {
    repo: "OpenCoven/coven",
    sourceBranch: "chore/remove-dead-docs-site-builder",
    targetBranch: "main",
    worktreePath: "coven.wt/chore-remove-dead-docs-site-builder",
    primaryCheckout: "clean",
    commitHash: "6eb4cb13",
    signature: "signed",
    pushTarget: "origin/chore/remove-dead-docs-site-builder",
    prRef: "#232",
    prState: "merged",
    linkedIssues: ["#3"],
    claim: "nova",
  },
};
const metaOut = formatAgentCompletionReportMarkdown(withMeta);
assert.ok(metaOut.includes("| Field | Value |"), "metadata table header present");
assert.ok(metaOut.includes("| --- | --- |"), "metadata table separator present");
// Commit, Source, Target, PR all chipped (`backticks`).
assert.ok(metaOut.includes("| Commit | `6eb4cb13` |"), "commit hash chip");
assert.ok(
  metaOut.includes("| Source | `chore/remove-dead-docs-site-builder` |"),
  "source branch chip",
);
assert.ok(metaOut.includes("| Target | `main` |"), "target branch chip");
assert.ok(metaOut.includes("| PR | `#232` |"), "PR ref chip");
// Non-chip rows render plain.
assert.ok(metaOut.includes("| Repo | OpenCoven/coven |"), "repo plain");
assert.ok(metaOut.includes("| Signature | signed |"), "signature plain");
assert.ok(metaOut.includes("| Linked issues | #3 |"), "linked issues plain");
assert.ok(metaOut.includes("| Claim | nova |"), "claim plain");

// Metadata key order is stable (Repo before Source before Commit).
const repoIdx = metaOut.indexOf("| Repo |");
const sourceIdx = metaOut.indexOf("| Source |");
const commitIdx = metaOut.indexOf("| Commit |");
const prIdx = metaOut.indexOf("| PR |");
assert.ok(
  repoIdx < sourceIdx && sourceIdx < commitIdx && commitIdx < prIdx,
  "metadata rows render in stable order",
);

// ---------------------------------------------------------------------------
// 5. Empty metadata object renders no table.
// ---------------------------------------------------------------------------
const emptyMeta: AgentCompletionReport = {
  kind: "completion",
  title: "No meta",
  metadata: {},
};
const emptyMetaOut = formatAgentCompletionReportMarkdown(emptyMeta);
assert.ok(
  !emptyMetaOut.includes("| Field | Value |"),
  "empty metadata renders no table",
);

// ---------------------------------------------------------------------------
// 6. Section order is fixed: Context → Risk → Resolution → Result →
//    Follow-up → Proposed Convention. Sections defined out-of-order in the
//    input must still render in this canonical order.
// ---------------------------------------------------------------------------
const orderedSections: AgentCompletionReport = {
  kind: "completion",
  title: "Order test",
  proposedConvention: { intro: "Convention" },
  followUp: { intro: "Follow-up" },
  result: { intro: "Result" },
  resolution: { intro: "Resolution" },
  risk: { intro: "Risk" },
  context: { intro: "Context" },
};
const orderedOut = formatAgentCompletionReportMarkdown(orderedSections);
const sectionOrder = ["## Context", "## Risk", "## Resolution", "## Result", "## Follow-up", "## Proposed Convention"];
let lastIdx = -1;
for (const heading of sectionOrder) {
  const idx = orderedOut.indexOf(heading);
  assert.ok(idx > lastIdx, `${heading} appears in canonical position`);
  lastIdx = idx;
}

// ---------------------------------------------------------------------------
// 7. Empty sections (no intro, no bullets) are omitted entirely — no
//    dangling headers.
// ---------------------------------------------------------------------------
const emptySection: AgentCompletionReport = {
  kind: "completion",
  title: "Empty section test",
  context: { intro: "Has content" },
  risk: { bullets: [] }, // empty bullets, no intro -> omitted
  resolution: undefined,
  result: { intro: "" }, // whitespace-only intro -> omitted
};
const emptySectionOut = formatAgentCompletionReportMarkdown(emptySection);
assert.ok(emptySectionOut.includes("## Context"), "non-empty section renders");
assert.ok(!emptySectionOut.includes("## Risk"), "empty bullets section omitted");
assert.ok(!emptySectionOut.includes("## Resolution"), "undefined section omitted");
assert.ok(!emptySectionOut.includes("## Result"), "blank intro section omitted");

// ---------------------------------------------------------------------------
// 8. Bullets with labels render as **Label** — body; bullets without labels
//    render plain.
// ---------------------------------------------------------------------------
const bulletReport: AgentCompletionReport = {
  kind: "completion",
  title: "Bullet test",
  resolution: {
    bullets: [
      { label: "Step", body: "Did the thing" },
      { body: "Plain bullet" },
      { label: "  ", body: "Whitespace label = no label" },
      { label: "Empty body", body: "  " }, // empty body -> skipped
    ],
  },
};
const bulletOut = formatAgentCompletionReportMarkdown(bulletReport);
assert.ok(
  bulletOut.includes("- **Step** — Did the thing"),
  "labeled bullet renders correctly",
);
assert.ok(bulletOut.includes("- Plain bullet"), "unlabeled bullet renders plain");
assert.ok(
  bulletOut.includes("- Whitespace label = no label"),
  "whitespace-only label collapses to no label",
);
assert.ok(
  !bulletOut.includes("Empty body"),
  "empty body bullet is dropped (not rendered)",
);

// ---------------------------------------------------------------------------
// 9. Footer renders as trailing free-form (no header).
// ---------------------------------------------------------------------------
const footerReport: AgentCompletionReport = {
  kind: "completion",
  title: "Footer test",
  context: { intro: "Hi" },
  footer: "_Generated by Nova at 02:54 CDT_",
};
const footerOut = formatAgentCompletionReportMarkdown(footerReport);
assert.ok(
  footerOut.endsWith("_Generated by Nova at 02:54 CDT_\n"),
  "footer renders at the end without a header",
);

// ---------------------------------------------------------------------------
// 10. Output ends with exactly one trailing newline (copy-paste hygiene).
// ---------------------------------------------------------------------------
const trailingReport: AgentCompletionReport = {
  kind: "completion",
  title: "Trailing newline test",
  context: { intro: "x" },
};
const trailingOut = formatAgentCompletionReportMarkdown(trailingReport);
assert.ok(trailingOut.endsWith("\n"), "output ends with newline");
assert.ok(!trailingOut.endsWith("\n\n"), "output ends with single newline");

// ---------------------------------------------------------------------------
// 11. Realistic full report — uses the actual PR #232 work as a reference
//     case to prove the format reads cleanly. This is also a snapshot of
//     "what good looks like" for future agents.
// ---------------------------------------------------------------------------
const fullReport: AgentCompletionReport = {
  kind: "completion",
  title: "Document worktree hygiene for agent commits from shared checkouts",
  subtitle:
    "PR #232 (chore: remove dead Mintlify-compat site builder) squash-merged at 07:51Z",
  metadata: {
    repo: "OpenCoven/coven",
    sourceBranch: "chore/remove-dead-docs-site-builder",
    targetBranch: "main",
    worktreePath: "coven.wt/chore-remove-dead-docs-site-builder",
    primaryCheckout: "clean",
    commitHash: "6eb4cb13",
    signature: "signed",
    pushTarget: "origin/main",
    prRef: "#232",
    prState: "merged",
    linkedIssues: ["#3"],
    claim: "nova",
  },
  context: {
    intro:
      "Dependabot alert #3 (`GHSA-h67p-54hq-rp68`) flagged `js-yaml@3.14.2` via `gray-matter@4.0.3` in the dead `docs/` site-builder scaffold.",
    bullets: [
      {
        label: "Source",
        body: "Canonical docs live in `OpenCoven/coven-docs`; the scaffold is from before the docs split.",
      },
      {
        label: "Constraint",
        body: "Val: do not touch `docs/*.md` content; only remove the site builder.",
      },
    ],
  },
  risk: {
    bullets: [
      {
        label: "Build-time only",
        body: "`js-yaml` parser path runs against repo-internal Markdown frontmatter; no runtime/user input surface.",
      },
      {
        body: "Real attack vector ≈ self-DoS by a writer who already has commit access. Practical risk near-zero.",
      },
    ],
  },
  resolution: {
    bullets: [
      {
        label: "Delete",
        body: "Removed `docs/scripts/docs-site/*.mjs`, `docs/package.json`, `docs/package-lock.json`, and stale top-level `docs/style.css`/`*.js`.",
      },
      {
        label: "Preserve",
        body: "All `docs/*.md` content untouched.",
      },
      {
        label: "Verify",
        body: "Confirmed no workflow references the deleted files. Pre-commit gitleaks ✓; `git diff --check` ✓.",
      },
    ],
  },
  result: {
    bullets: [
      {
        label: "Merge",
        body: "Squash-merged to `main` as `6eb4cb13` at 07:51:23Z.",
      },
      {
        label: "Alert",
        body: "Dependabot alert #3 auto-resolved as `fixed` at 06:34:59Z.",
      },
      {
        label: "Cleanup",
        body: "Local + remote `chore/remove-dead-docs-site-builder` branch deleted; worktree removed.",
      },
    ],
  },
  followUp: {
    bullets: [
      {
        body: "Optional: decide whether `docs/*.md` corpus should also move to `OpenCoven/coven-docs` over time.",
      },
      {
        body: "Re-enable `coven-cave/main` branch protection when ready.",
      },
    ],
  },
  proposedConvention: {
    intro: "When a Dependabot alert fingers a transitive in dead tooling:",
    bullets: [
      {
        body: "Prefer **delete the dead tooling** over `dismiss-as-tolerable-risk`, `overrides`, or `patch-package` — root-cause fix beats band-aid.",
      },
      {
        body: "Always verify nothing live references the deleted files before merging.",
      },
    ],
  },
  footer:
    "_Worktree: `coven.wt/chore-remove-dead-docs-site-builder`. Authored: `Val Alexander <bunsthedev@gmail.com>` co-authored with Nova._",
};
const fullOut = formatAgentCompletionReportMarkdown(fullReport);

// Sanity: full report contains every section.
assert.ok(fullOut.includes("## Context"), "full: Context");
assert.ok(fullOut.includes("## Risk"), "full: Risk");
assert.ok(fullOut.includes("## Resolution"), "full: Resolution");
assert.ok(fullOut.includes("## Result"), "full: Result");
assert.ok(fullOut.includes("## Follow-up"), "full: Follow-up");
assert.ok(fullOut.includes("## Proposed Convention"), "full: Proposed Convention");
assert.ok(fullOut.includes("`6eb4cb13`"), "full: commit hash chip");
assert.ok(fullOut.includes("`#232`"), "full: PR ref chip");

// Copy-paste hygiene: output should not contain literal `\n` strings or
// double-escaped sequences (a class of bug we hit before in PR bodies).
assert.ok(
  !fullOut.includes("\\n"),
  "no literal backslash-n sequences in output (copy-paste hygiene)",
);

console.log(`agent-completion-report.test.ts: 11 cases passed`);
