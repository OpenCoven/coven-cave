import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function normalizeWhitespace(source) {
  return source.replace(/\s+/g, " ").trim();
}

function section(source, heading, nextHeading) {
  const start = source.indexOf(heading);
  assert.notEqual(start, -1, `missing heading: ${heading}`);
  const end = source.indexOf(nextHeading, start + heading.length);
  assert.notEqual(end, -1, `missing next heading: ${nextHeading}`);
  return source.slice(start, end);
}

const skill = read(".agents/skills/branch-curator/SKILL.md");
const proof = read(".agents/skills/branch-curator/references/deletion-proof.md");
const agents = read("AGENTS.md");
const workflow = read("docs/workflows/github-work-tracking.md");
const hygiene = read("WORKTREE_HYGIENE.md");
const automaticDesign = read(
  "docs/superpowers/specs/2026-07-31-automatic-local-branch-retirement-design.md",
);
const implementationPlan = read(
  "docs/superpowers/plans/2026-08-01-maintainer-authorized-branch-cleanup.md",
);
const evals = JSON.parse(
  read(".agents/skills/branch-curator/evals/evals.json"),
).evals;

function runDocumentedReflogParser(contents) {
  const functionMatch = proof.match(/emit_reflog_records\(\) \{[\s\S]*?\n\}/);
  assert.ok(functionMatch, "missing documented emit_reflog_records function");
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "branch-curator-reflog-"));
  const fixture = path.join(fixtureRoot, "HEAD");
  fs.writeFileSync(fixture, contents);
  try {
    return spawnSync(
      "bash",
      ["-c", `oid_width=40\n${functionMatch[0]}\nemit_reflog_records "$1"`, "branch-curator-reflog", fixture],
      { encoding: "utf8" },
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

const issueFixture = {
  number: 5399,
  title: "Scoped branch curation",
  body: "Preserve ownership and require fresh proof.",
  state: "open",
  html_url: "https://github.com/OpenCoven/coven-cave/issues/5399",
  updated_at: "2026-09-14T12:00:00Z",
  assignees: [{ login: "owner" }],
  comments: 0,
};
const commentFixture = {
  id: 1,
  body: "Owner disposition for the exact candidate.",
  user: { login: "owner" },
  updated_at: "2026-09-14T12:00:00Z",
};

function runDocumentedIssueEvidence({
  issue = issueFixture,
  pages = [[]],
  issueJson = JSON.stringify(issue),
  issueStatus = 0,
  commentStatus = 0,
  issueNumber = "5399",
} = {}) {
  const producer = skill.match(/read_issue_evidence\(\) \{[\s\S]*?\n\}/);
  assert.ok(producer, "missing documented issue ownership producer");
  return spawnSync("bash", ["-c", `
audited_gh_repo=OpenCoven/coven-cave
${producer[0]}
gh() {
  case "$*" in
    "api --hostname github.com repos/OpenCoven/coven-cave/issues/5399")
      printf '%s' "$ISSUE_JSON"
      return "$ISSUE_STATUS"
      ;;
    "api --hostname github.com --paginate --slurp -X GET repos/OpenCoven/coven-cave/issues/5399/comments -f per_page=100")
      printf '%s' "$COMMENT_PAGES"
      return "$COMMENT_STATUS"
      ;;
    *) printf '%s\\n' 'unexpected or unscoped GitHub query' >&2; return 97 ;;
  esac
}
read_issue_evidence "$1"
`, "issue-evidence", issueNumber], {
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      GH_REPO: "unrelated/quiet",
      ISSUE_JSON: issueJson,
      ISSUE_STATUS: String(issueStatus),
      COMMENT_PAGES: JSON.stringify(pages),
      COMMENT_STATUS: String(commentStatus),
    },
  });
}

for (const [name, input] of [
  ["empty comments", {}],
  ["all 101 owner comments", {
    issue: { ...issueFixture, comments: 101 },
    pages: [
      Array.from({ length: 100 }, (_, index) => ({ ...commentFixture, id: index + 1 })),
      [{ ...commentFixture, id: 101 }],
    ],
  }],
  ["closed unassigned history", {
    issue: { ...issueFixture, state: "closed", assignees: [] },
  }],
]) {
  test(`documented GitHub ownership producer retains evidence: ${name}`, () => {
    const result = runDocumentedIssueEvidence(input);
    assert.equal(result.status, 0, result.stderr);
    const evidence = JSON.parse(result.stdout);
    assert.deepEqual(evidence.issue, input.issue ?? issueFixture);
    assert.deepEqual(evidence.comments, (input.pages ?? [[]]).flat());
    assert.deepEqual(Object.keys(evidence).sort(), ["comments", "issue"],
      "valid issue JSON must not manufacture owner clearance or a lease");
  });
}

for (const [name, input] of [
  ["failed issue producer with valid output", { issueStatus: 1 }],
  ["failed comments producer with valid output", { commentStatus: 1 }],
  ["malformed issue JSON", { issueJson: "{" }],
  ["missing issue", { issue: null }],
  ["wrong issue number", { issue: { ...issueFixture, number: 1 } }],
  ["pull request instead of issue", { issue: { ...issueFixture, pull_request: {} } }],
  ["unknown issue state", { issue: { ...issueFixture, state: "unknown" } }],
  ["missing assignee envelope", { issue: { ...issueFixture, assignees: null } }],
  ["missing pages", { pages: [] }],
  ["wrong page envelope", { pages: {} }],
  ["truncated or changed comment count", {
    issue: { ...issueFixture, comments: 2 },
    pages: [[commentFixture]],
  }],
  ["duplicated comment page", {
    issue: { ...issueFixture, comments: 2 },
    pages: [[commentFixture], [commentFixture]],
  }],
  ["missing comment author", {
    issue: { ...issueFixture, comments: 1 },
    pages: [[{ ...commentFixture, user: null }]],
  }],
  ["invalid issue reference", { issueNumber: "5399;false" }],
]) {
  test(`documented GitHub ownership producer fails closed: ${name}`, () => {
    const result = runDocumentedIssueEvidence(input);
    assert.equal(result.signal, null, result.stderr);
    assert.notEqual(result.status, 0, `${name} was accepted`);
    assert.equal(result.stdout, "", "failed evidence must not look like an empty ownership result");
  });
}

test("curation shell fragments retain Bash syntax", () => {
  for (const [name, source] of [["skill", skill], ["deletion proof", proof]]) {
    const blocks = [...source.matchAll(/```bash\n([\s\S]*?)\n```/g)];
    assert.ok(blocks.length > 0, `${name} has no shell fragments`);
    const parsed = spawnSync("bash", ["-n"], {
      input: blocks.map((match) => match[1]).join("\n"),
      encoding: "utf8",
    });
    assert.equal(parsed.status, 0, `${name}: ${parsed.stderr}`);
  }
});

test("GitHub ownership carries no Beads recipes and keeps safety evidence", () => {
  for (const [name, source] of [["skill", skill], ["proof", proof], ["hygiene", hygiene]]) {
    assert.ok(source.includes("docs/workflows/github-work-tracking.md"),
      `${name} must reference the canonical guide`);
    assert.doesNotMatch(source, /\bbd\s+(?:prime|ready|show|list|create|update|close|sync)\b/);
    assert.doesNotMatch(source, /\bpnpm\s+beads:/);
    assert.doesNotMatch(source, /\bdolt\s+(?:push|pull|fetch)\b/);
    assert.match(normalizeWhitespace(source), /not atomic execution leases/);
  }
  assert.match(skill, /__dolt_remote_info__/);
  assert.match(skill, /refs\/dolt\/data/);
  assert.match(skill, /Preserve legacy records and original owners/);
  assert.doesNotMatch(skill, /\bBeads-managed|\bBeads patrol/);
  assert.match(skill, /Never reassign or close\s+candidate-owning issues to ease cleanup/);
  assert.match(skill, /Commits, pushes, PR creation, and deletion need\s+current authority/);
  assert.match(skill, /Stay inside granted filesystem and evidence-access\s+boundaries; preserve inaccessible paths/);
  assert.match(normalizeWhitespace(skill),
    /candidate branch\/path references in titles, bodies, and comments/);
  assert.match(skill, /Truncated, inaccessible, or missing\s+coverage is unknown/);
  assert.match(skill, /test "\$\{#candidate_issue_numbers\[@\]\}" -gt 0 \|\|/);
  assert.match(skill, /PRESERVE - candidate issue ownership unknown/);
  assert.match(skill, /PRESERVE - candidate issue evidence unavailable'; continue 2/);
  assert.match(skill, /valid JSON is not owner clearance/);
  assert.match(skill, /Re-read every candidate issue and its comments under the selected lease before\s+each mutation/);
  assert.match(skill, /Neither an empty\s+assignee list nor issue closure proves runtime inactivity/);
  assert.match(proof, /Do not manufacture legacy lifecycle metadata/);
  assert.match(proof, /Every legacy ownership reference has a\s+current, owner-backed disposition/);
});

test("hygiene distinguishes local reports from retired lifecycle mutations", () => {
  assert.match(hygiene, /Current weekly mode adds the read-only remote-hygiene audit, not a lifecycle\s+patrol/);
  assert.match(hygiene, /lifecycle creator, inventory, and patrol were removed with Beads/);
  assert.match(hygiene, /current CLI refuses both `park --apply`\s+and `unpark --apply` before any Git query or tracker operation/);
  assert.match(hygiene, /`scripts\/worktree-sweep\.sh` is a no-side-effect exit-2 tombstone/);
  const recipes = [...hygiene.matchAll(/```bash\n([\s\S]*?)\n```/g)]
    .map((match) => match[1]).join("\n");
  assert.doesNotMatch(recipes, /(?:park|unpark)[^\n]*--apply/);
  assert.doesNotMatch(recipes, /worktree-sweep\.sh|\bbeads:/);
  assert.match(recipes, /^node scripts\/worktree-hygiene\.mjs thin --branch \S+ --apply$/m);
  for (const action of ["park", "unpark"]) {
    assert.match(recipes, new RegExp(
      `^node scripts/worktree-hygiene\\.mjs ${action} --branch \\S+$`, "m",
    ), `${action} must retain its supported read-only preview`);
  }
  assert.match(hygiene, /Never force-remove\s+a worktree, bypass its guard, or override another owner's lock/);
  assert.match(hygiene, /Unknown ownership or access means preserve/);
});

test("normative reflog parser accepts only the canonical message-less creation record", () => {
  const zero = "0".repeat(40);
  const created = "98be54a3a6901e3c60706fb09ef5e81121128b36";
  const committed = "c79e68eb6017b66be9e1bf9685adb61ed049288c";
  const creation = `${zero} ${created} Val Alexander <68980965+BunsDev@users.noreply.github.com> 1788294729 -0500\n`;
  const update = `${created} ${committed} Val Alexander <68980965+BunsDev@users.noreply.github.com> 1788296310 -0500\tcommit: reconcile tracker\n`;

  const accepted = runDocumentedReflogParser(creation + update);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.deepEqual(accepted.stdout.trim().split("\n"), [
    `1788294729 ${created}`,
    `1788296310 ${created}`,
    `1788296310 ${committed}`,
  ]);

  const missingLaterMessage = runDocumentedReflogParser(
    creation +
      `${created} ${committed} Val Alexander <68980965+BunsDev@users.noreply.github.com> 1788296310 -0500\n`,
  );
  assert.notEqual(missingLaterMessage.status, 0, "later message-less records must fail closed");

  const nonCreationFirstRecord = runDocumentedReflogParser(
    `${created} ${committed} Val Alexander <68980965+BunsDev@users.noreply.github.com> 1788296310 -0500\n`,
  );
  assert.notEqual(nonCreationFirstRecord.status, 0, "message-less first records with a nonzero old OID must fail closed");
});

test("Branch Curator separates automatic and maintainer-authorized cleanup", () => {
  const profiles = section(
    skill,
    "## Choose the deletion profile",
    "## Open a PR only for PR-shaped work",
  );
  const automatic = section(
    profiles,
    "### Automatic retirement",
    "### Maintainer-authorized manual cleanup",
  );
  const manualHeading = "### Maintainer-authorized manual cleanup";
  const manualStart = profiles.indexOf(manualHeading);
  assert.notEqual(manualStart, -1, `missing heading: ${manualHeading}`);
  const manual = profiles.slice(manualStart);

  assert.ok(
    profiles.includes(`Before
classifying anything as \`DELETE\`, choose exactly one profile and record it in
the curation issue. Never silently fall from the automatic profile into the
manual profile.`),
  );
  assert.ok(
    automatic.includes(`Unattended retirement requires the full repository-wide maintenance gate. It
must quiesce and exclude every supported local and remote writer, have one
auditable owner and bounded lifetime, and remain held from final checks through
postcondition verification. If any enforcement plane is absent, automatic
retirement remains proposal-only. Automatic retirement never deletes remote
refs.`),
  );
  assert.ok(
    manual.includes(`A current maintainer may explicitly authorize a bounded manual cleanup in the
current task. Record the instruction, repository, exact candidate set,
local-only or local-and-remote scope, issue, session, branch, worktree, and
audited default-branch OID before mutation. Historical, standing, inferred, or
unbounded permission is insufficient, and local cleanup authority does not
imply remote deletion.`),
  );
  assert.match(manual, /does not\s+imply remote deletion/);
  assert.ok(
    manual.includes(`It still must acquire and
retain the local maintenance lease, rerun every GitHub issue/comment ownership,
legacy disposition, PR, workflow, process, worktree, ref, recency, archive, and
recovery check immediately before each
mutation, and stop on any query failure, new or changed candidate-owning owner
or activity, drift, or uncertainty. It must run and never bypass
\`worktree-guard\`.`),
  );
  assert.ok(
    manual.includes(`Authorization expires when the batch ends, the local lease is lost, an audited
OID or owner changes, or task context changes. It never permits direct pushes
to \`main\`, protected-ref mutation, forced worktree removal, deletion of unique
work, or continuation after a failed or uncertain postcondition.`),
  );
  const guardFixContract = `If a strict worktree-guard refusal appears to be a false positive, stop the
cleanup. Fix the guard in a separate task with a regression test, verify both
strict and legacy behavior, then begin a new cleanup batch with fresh inventory
and authorization; never retry the refused removal in the current batch.`;
  assert.ok(skill.includes(guardFixContract));
  assert.ok(proof.includes(guardFixContract));
});

test("operator entrypoints use the canonical GitHub creation and budget contract", () => {
  for (const [name, source] of [["AGENTS.md", agents], ["CLAUDE.md", read("CLAUDE.md")]]) {
    assert.ok(source.includes("docs/workflows/github-work-tracking.md"),
      `${name} must link the canonical tracker/worktree procedure`);
    assert.doesNotMatch(source, /\bpnpm\s+beads:worktrees/);
    assert.doesNotMatch(source, /\bbd\s+(?:prime|ready|create|update|close|sync)\b/);
  }
  assert.match(workflow, /28 registered worktrees/);
  assert.match(workflow, /including its primary worktree/);
  assert.match(workflow, /obtain an attributed, scoped exception on the issue before creating another/);
  assert.match(workflow, /git worktree add --no-track -b <branch> \.worktrees\/<slug> origin\/main/);
  assert.ok(workflow.indexOf("git fetch origin main") < workflow.indexOf("git worktree add --no-track"));
  assert.match(skill, /Exceeding the budget never authorizes deletion/);
  assert.match(skill, /owner, reason, exact path, and expiry on the issue before creation/);
  assert.match(skill, /Raw Git does not enforce that budget/);
  assert.match(skill, /Do not manufacture lifecycle metadata/);
});

test("normative proof scopes remote deletion and uses exact expected OIDs", () => {
  const selection = section(
    proof,
    "## Select and record the execution profile",
    "## Required disposition",
  );
  assert.match(selection, /cleanup_profile/);
  assert.match(selection, /automatic[\s\S]*full_maintenance_gate_held/);
  assert.match(selection, /automatic[\s\S]*delete_remote=0/);
  assert.match(
    selection,
    /manual[\s\S]*current_maintainer_authorization_recorded[\s\S]*local_maintenance_lease_held/,
  );
  assert.match(selection, /remote_cleanup_authorized/);
  assert.match(selection, /Historical, standing, inferred, or unbounded/);
  assert.match(selection, /authorization evidence, not candidate-safety evidence/);
  assert.match(selection, /Manual\s+local-only authority retains remotes/);
  assert.match(selection, /exact\s+recorded candidate/);

  const exactTips = section(
    proof,
    "## Capture and prove exact tips",
    "Query the commit's cross-repository pull-request association connection",
  );
  assert.match(exactTips, /candidate_refs_are_unprotected\(\)/);
  assert.match(
    exactTips,
    /git ls-remote --symref "\$protected_remote_name" HEAD/,
  );
  assert.match(
    exactTips,
    /refs\/heads\/main\|refs\/heads\/__dolt_remote_info__\) return 1/,
  );
  assert.match(
    exactTips,
    /"\$protected_default_ref"\) return 1/,
  );
  assert.ok(
    exactTips.includes(
      `if ! candidate_refs_are_unprotected "$remote_name" "$local_ref" "$remote_ref"; then`,
    ),
    "candidate qualification does not execute the protected/tool-owned ref guard",
  );
  assert.match(exactTips, /audited_remote_main_ref=\$remote_main_ref/);
  assert.match(
    skill,
    /case "\$local_ref" in[\s\S]*refs\/heads\/main\|refs\/heads\/__dolt_remote_info__\)/,
  );
  assert.match(
    exactTips,
    /if test -n "\$audited_remote_oid" && test "\$delete_remote" -eq 1; then/,
  );
  assert.match(
    exactTips,
    /test "\$cleanup_profile" = manual[\s\S]*test "\$remote_cleanup_authorized" -eq 1/,
  );
  assert.match(exactTips, /server-authoritative ref-update timestamp/);
  assert.match(exactTips, /Commit age is never used as ref\s+recency/);
  assert.match(exactTips, /every observable[\s\S]*proof still runs/);

  const mutation = section(
    proof,
    "## Recheck, mutate, and verify in order",
    "Re-inventory refs and worktrees before reporting.",
  );
  assert.match(mutation, /An OID-only\s+refresh is insufficient/);
  assert.deepEqual(
    mutation.match(/^### Transaction \d+:[^\n]+$/gm),
    [
      "### Transaction 1: worktree removal",
      "### Transaction 2: local compare-and-delete",
      "### Transaction 3: remote deletion",
    ],
  );

  const worktreeTransaction = section(
    mutation,
    "### Transaction 1: worktree removal",
    "### Transaction 2: local compare-and-delete",
  );
  const localTransaction = section(
    mutation,
    "### Transaction 2: local compare-and-delete",
    "### Transaction 3: remote deletion",
  );
  const remoteHeading = "### Transaction 3: remote deletion";
  const remoteStart = mutation.indexOf(remoteHeading);
  assert.notEqual(remoteStart, -1, `missing heading: ${remoteHeading}`);
  const remoteTransaction = mutation.slice(remoteStart);
  const executableRefGuard =
    `if ! candidate_refs_are_unprotected "$remote_name" "$local_ref" "$remote_ref"; then`;
  for (const [name, transaction, destructiveSeam] of [
    ["worktree", worktreeTransaction, "node scripts/worktree-guard.mjs"],
    ["local", localTransaction, "git update-ref --no-deref -d"],
    ["remote", remoteTransaction, "git push --atomic"],
  ]) {
    const guardIndex = transaction.indexOf(executableRefGuard);
    assert.notEqual(
      guardIndex,
      -1,
      `${name} transaction omits executable protected/tool-owned ref guard`,
    );
    const seamIndex = transaction.indexOf(destructiveSeam);
    assert.notEqual(seamIndex, -1, `${name} transaction seam is missing`);
    assert.ok(
      guardIndex < seamIndex,
      `${name} transaction runs its ref guard after the destructive seam`,
    );
    assert.match(
      transaction.slice(guardIndex, seamIndex),
      /test "\$remote_main_ref" = "\$audited_remote_main_ref"/,
      `${name} transaction does not fail on default-ref drift`,
    );
  }

  for (const [name, transaction] of [
    ["worktree", worktreeTransaction],
    ["local", localTransaction],
    ["remote", remoteTransaction],
  ]) {
    assert.match(transaction, /freshly\s+reverify the selected profile\s+exclusion/i,
      `${name} transaction does not reverify its profile exclusion`);
    assert.match(
      transaction,
      /freshly\s+revalidate the selected profile\s+authority as\s+current, task-bounded,\s+candidate-exact, and scope-exact/i,
      `${name} transaction does not revalidate bounded profile authority`,
    );
    assert.match(transaction, /lease\s+ownership/,
      `${name} transaction does not reverify lease ownership`);
    for (const [evidenceClass, evidencePattern] of [
      ["GitHub issue/comment ownership", /GitHub\s+issue\/comment ownership/],
      ["legacy disposition", /legacy disposition/],
      ["GitHub PR and workflow", /GitHub\s+PR and\s+workflow/],
      ["process", /process/],
      ["worktree", /worktree/],
      ["ref, OID, and destination", /ref, OID, and\s+destination/],
      ["recency", /recency/],
      ["archive", /archive/],
      ["recovery and admin", /recovery and\s+admin/],
    ]) {
      assert.match(
        transaction,
        evidencePattern,
        `${name} transaction omits ${evidenceClass} evidence`,
      );
    }
    assert.match(transaction, /Any\s+query, proof, or recheck\s+failure/,
      `${name} transaction does not stop on recheck uncertainty`);
  }

  assert.match(worktreeTransaction, /audited_worktree_head_oid/);
  assert.match(worktreeTransaction, /canonical_worktree_path/);
  assert.match(
    worktreeTransaction,
    /current_worktree_head_oid=\$\(git_exact -C "\$worktree_path" rev-parse\s+\\\s+--verify 'HEAD\^\{commit\}'\)/,
  );
  assert.ok(
    worktreeTransaction.includes(
      `test "$current_worktree_head_oid" = "$audited_worktree_head_oid" ||`,
    ),
    "worktree HEAD is not compared with the audited expected OID",
  );
  assert.ok(
    worktreeTransaction.includes(
      `canonical_worktree_path=$(CDPATH= cd -- "$worktree_path" && pwd -P) ||`,
    ),
    "worktree path is not canonicalized into canonical_worktree_path",
  );
  assert.ok(
    worktreeTransaction.includes(
      `env -u WT_GUARD_BYPASS -u WT_GUARD_TEST_MODE -u WT_GUARD_TEST_LSOF_BIN node scripts/worktree-guard.mjs --strict-worktree-remove "$canonical_worktree_path" --expected-head "$audited_worktree_head_oid" "\${strict_guard_retention_args[@]}"`,
    ),
  );
  assert.match(worktreeTransaction, /--retained-by-github-pr origin "\$audited_gh_repo"/);
  assert.match(worktreeTransaction, /--retained-by-remote-branch/);
  assert.match(worktreeTransaction, /--expected-remote-oid/);
  assert.match(worktreeTransaction, /"\$audited_merged_pr_number"/);
  assert.match(worktreeTransaction, /--expected-base "\$audited_remote_main_branch"/);
  assert.match(worktreeTransaction, /queries\/fetches only the exact|queries\/fetches only|queries\/fetches/);
  assert.match(
    worktreeTransaction,
    /if env -u WT_GUARD_BYPASS -u WT_GUARD_TEST_MODE -u WT_GUARD_TEST_LSOF_BIN node scripts\/worktree-guard\.mjs --strict-worktree-remove[\s\S]*else[\s\S]*PRESERVE - strict worktree guard failed/,
  );
  assert.match(worktreeTransaction, /strict_guard_line_count/);
  assert.ok(
    worktreeTransaction.includes(
      `test "$strict_guard_line_count" -eq 1 ||`,
    ),
    "strict guard stdout is not required to contain exactly one line",
  );
  assert.ok(
    worktreeTransaction.includes(
      `keys == ["head", "mode", "ok", "path"]`,
    ),
  );
  assert.match(worktreeTransaction, /\.ok == true/);
  assert.match(worktreeTransaction, /\.mode == "strict-worktree-remove"/);
  assert.match(worktreeTransaction, /\.path == \$path/);
  assert.match(worktreeTransaction, /\.head == \$head/);
  assert.match(worktreeTransaction, /must not\s+set any bypass/);
  assert.ok(
    worktreeTransaction.includes(`test "$strict_guard_allowed" = true ||
    { printf 'PRESERVE - strict worktree guard result invalid\\n'; continue; }
  git worktree remove -- "$canonical_worktree_path" ||`),
    "an operation can intervene between the final guard validation and removal",
  );

  assert.match(
    localTransaction,
    /git update-ref --no-deref -d "\$local_ref" "\$audited_local_oid"/,
  );
  assert.doesNotMatch(
    localTransaction,
    /(?:^|\n)git update-ref -d "\$local_ref" "\$audited_local_oid"/,
  );
  assert.match(
    implementationPlan,
    /git update-ref --no-deref -d "\$local_ref" "\$audited_local_oid"/,
  );
  assert.doesNotMatch(
    implementationPlan,
    /(?:^|\n)git update-ref -d "\$local_ref" "\$audited_local_oid"/,
  );
  assert.match(
    localTransaction,
    /prior worktree path and registry absence/,
  );
  assert.match(
    localTransaction,
    /Reject newly\s+appearing\s+ownership, activity, worktree registration, refs, or destination\s+drift/,
  );
  assert.match(localTransaction, /local_absence_status[\s\S]*-eq 1/);
  assert.ok(
    remoteTransaction.includes(`  test "$current_fetch_url" = "$audited_fetch_url" &&
    test "$current_push_urls" = "$audited_push_urls" &&
    test "$current_push_urls" = "$current_fetch_url" ||`),
  );
  assert.ok(
    remoteTransaction.includes(`git push --atomic --force-with-lease="$remote_ref:$audited_remote_oid" \\
    "$remote_name" ":$remote_ref"`),
  );
  assert.match(remoteTransaction, /if test "\$delete_remote" -eq 1; then/);
  assert.match(
    remoteTransaction,
    /Automatic and manual-local-only profiles skip this\s+transaction and preserve or propose the existing remote ref/,
  );
  assert.match(remoteTransaction, /test -n "\$audited_remote_oid"/);
  assert.match(
    remoteTransaction,
    /freshly revalidate the\s+exact remote authorization/i,
  );
  assert.match(
    remoteTransaction,
    /prior local-ref absence and prior worktree path and registry absence/,
  );
  assert.match(
    remoteTransaction,
    /Reject newly\s+appearing\s+ownership, activity, worktree registration, refs, or destination\s+drift/,
  );
  assert.ok(
    remoteTransaction.includes(
      `test "$current_remote_ref" = "$remote_ref" &&
    test "$current_remote_oid" = "$audited_remote_oid" ||`,
    ),
    "remote transaction does not revalidate the exact observed remote ref and OID",
  );
  assert.match(remoteTransaction, /remote_delete_status[\s\S]*2\)/);
  assert.match(remoteTransaction, /remote_absence_status[\s\S]*-eq 2/);
});

test("operator docs preserve automatic gating, manual proof, and protected main", () => {
  for (const source of [agents, workflow, hygiene]) {
    assert.match(normalizeWhitespace(source),
      /removed and verified,? or intentionally preserved with an owner and reason/);
    assert.ok(source.includes("branch-curator/SKILL.md"));
  }
  assert.match(workflow, /explicit scope, exact current OIDs, clean state,\s+retention on a verified remote ref/);
  assert.match(workflow, /evidence that no live owner needs the\s+unit/);
  assert.match(workflow, /missing legacy maintenance planes are not made safe by changing trackers/);
  assert.match(workflow, /No GitHub issue comment replaces a runtime exclusion lock/);
  assert.match(skill, /legacy `retire-after-gate` note is a\s+classification, not authorization/);
  assert.match(skill, /missing metadata means uncertainty, not an\s+unowned unit/);
  assert.match(hygiene, /current bounded authorization, the local maintenance lease/);
  assert.match(hygiene, /unattended retirement still\s+requires the full maintenance gate/);
  assert.ok(
    normalizeWhitespace(automaticDesign).includes(
      "The separately specified [manual maintainer-authorized cleanup profile](2026-08-01-maintainer-authorized-branch-cleanup-design.md) does not enable automatic apply mode or remote deletion by automation. It is a bounded operator path with fresh proof and exact expected-OID mutations.",
    ),
    "automatic-retirement design does not link the bounded manual profile",
  );
  assert.match(agents, /(?:Do not|Never) push directly to `main`/);
});

test("evals cover every new authorization and race boundary", () => {
  const byId = new Map(evals.map((entry) => [entry.id, entry]));
  assert.deepEqual(
    evals.map((entry) => entry.id),
    Array.from({ length: 62 }, (_, index) => index + 1),
  );
  for (const id of [43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59]) {
    assert.ok(byId.has(id), `missing branch-curator eval ${id}`);
  }
  const eval2 = byId.get(2);
  assert.match(eval2.prompt, /current maintainer/i);
  assert.match(eval2.prompt, /both its local and recovery timestamps are older than 24h/);
  assert.match(
    eval2.prompt,
    /configuration-independent inspection finds no staged, unstaged, untracked, ignored, submodule, assume-unchanged, or skip-worktree state/,
  );
  assert.match(eval2.expected_output, /manual cleanup profile/i);
  assert.match(eval2.expected_output, /expected OID/i);

  const eval8 = byId.get(8);
  assert.match(eval8.prompt, /unattended cleanup job/i);
  assert.match(eval8.expected_output, /automatic retirement/i);
  assert.match(eval8.expected_output, /full repository-wide maintenance gate/i);
  assert.match(
    eval8.expected_output,
    /preserves the branch when the complete gate is unavailable/i,
  );

  const eval39 = byId.get(39);
  assert.match(eval39.prompt, /complete repository-wide gate/i);
  assert.match(eval39.prompt, /same-named remote/i);
  assert.match(eval39.expected_output, /may retire only proven local state/i);
  assert.match(
    eval39.expected_output,
    /preserves the same-named remote or only proposes it/i,
  );
  assert.match(eval39.expected_output, /never mutates the remote/i);
  assert.match(eval39.expected_output, /Commit age is not remote-ref recency/);

  assert.match(byId.get(43).expected_output, /28-worktree budget/i);
  assert.match(byId.get(43).expected_output, /issue-recorded owner\/reason\/expiry\/path exception/i);
  assert.match(byId.get(43).expected_output, /git worktree add --no-track/i);
  assert.match(byId.get(43).expected_output, /raw Git does not enforce the budget/i);
  assert.match(byId.get(43).expected_output, /Does not[\s\S]*promise automatic retirement/i);
  assert.match(byId.get(43).expected_output, /or delete any existing work/i);
  assert.match(byId.get(44).expected_output, /cleanup-ready patrol unit/i);
  assert.match(byId.get(44).expected_output, /reports any remote ref as a proposal rather than deleting it/i);
  assert.match(byId.get(45).expected_output, /gate-incomplete/i);
  assert.match(byId.get(45).expected_output, /missing Coven and GitHub enforcement planes/i);
  assert.match(byId.get(46).expected_output, /direct full local ref even without a worktree/i);
  assert.match(byId.get(46).expected_output, /complete maintenance transaction/i);
  assert.match(byId.get(47).expected_output, /keeps the recovery lane/i);
  assert.match(byId.get(48).expected_output, /at most three units/i);
  assert.match(byId.get(49).expected_output, /exact-OID compare fails/i);
  assert.match(byId.get(49).expected_output, /no remote mutation occurs/i);
  assert.match(byId.get(50).expected_output, /lost-gate partial failure/i);
  assert.match(byId.get(51).expected_output, /remote-deletion proposal/i);
  assert.match(byId.get(51).expected_output, /performs no remote ref mutation/i);

  assert.match(byId.get(52).expected_output, /manual cleanup profile/i);
  const eval53 = byId.get(53);
  assert.match(eval53.prompt, /current maintainer/i);
  assert.match(eval53.prompt, /exact local-only candidate/i);
  assert.match(eval53.prompt, /current task/i);
  assert.match(eval53.prompt, /both its local and recovery timestamps are older than 24h/);
  assert.match(
    eval53.prompt,
    /configuration-independent inspection finds no staged, unstaged, untracked, ignored, submodule, assume-unchanged, or skip-worktree state/,
  );
  assert.match(
    eval53.prompt,
    /no active process, session, claim, unresolved issue or legacy ownership, open-or-draft PR, or active workflow/,
  );
  assert.match(
    eval53.prompt,
    /local and recovery OIDs are stable and durably retained on refreshed main or an exact retained archive/,
  );
  assert.match(
    eval53.prompt,
    /Its same-named remote branch is redundant too, so delete that while you are here\./,
  );
  assert.match(eval53.expected_output, /freshly reverified local cleanup/i);
  assert.match(
    eval53.expected_output,
    /preserves the remote because local authorization does not imply remote deletion/i,
  );
  assert.match(eval53.expected_output, /fresh explicit remote scope/i);
  assert.match(byId.get(54).expected_output, /current task/i);
  assert.match(byId.get(55).prompt, /one untracked file and a current GitHub owner comment/i);
  assert.match(
    byId.get(55).expected_output,
    /dirty path and current owner remain unconditional live-work blockers/i,
  );
  assert.match(byId.get(56).expected_output, /expected OID/i);
  assert.match(byId.get(57).expected_output, /worktree-guard/i);
  assert.match(byId.get(58).expected_output, /protected.*main/i);
  assert.match(byId.get(59).expected_output, /origin fetch\/push destination/i);
  assert.match(byId.get(59).expected_output, /refs\/heads\/feature\/cave-remote:R/);
  assert.match(byId.get(59).expected_output, /:refs\/heads\/feature\/cave-remote/);
  assert.match(byId.get(59).expected_output, /destination or OID drift/i);
  assert.match(byId.get(59).expected_output, /status 2/i);
  assert.match(byId.get(60).expected_output, /ownership unknown/i);
  assert.match(byId.get(60).expected_output, /does not prove an idle owner or authorize takeover/i);
  assert.match(byId.get(61).expected_output, /not atomic execution leases/i);
  assert.match(byId.get(61).expected_output, /local maintenance lease/i);
  assert.match(byId.get(62).expected_output, /Rejects incomplete pagination/i);
  assert.match(byId.get(62).expected_output, /does not convert a successful API exit into owner clearance/i);
});

for (const state of ["empty", "nonempty", "directory", "symlink", "dangling", "lock", "merge", "unknown", "wrong-type", "admin-symlink", "shared-lock"]) {
  test(`documented MERGE_RR admin proof: ${state}`, {
    skip: process.platform === "win32" && ["symlink", "dangling", "admin-symlink"].includes(state),
  }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "curator-rerere-"));
    const admin = path.join(dir, "admin");
    fs.mkdirSync(admin);
    const rr = path.join(admin, "MERGE_RR");
    if (state === "directory") fs.mkdirSync(rr);
    else if (state === "symlink" || state === "dangling") {
      const target = path.join(dir, "empty");
      if (state === "symlink") fs.writeFileSync(target, "");
      fs.symlinkSync(target, rr);
    } else {
      fs.writeFileSync(rr, state === "nonempty" ? "pending" : "");
      if (state === "wrong-type") fs.mkdirSync(path.join(admin, "config.worktree"));
      if (state === "admin-symlink") fs.symlinkSync(rr, path.join(admin, "config.worktree"));
      if (state === "shared-lock") fs.writeFileSync(path.join(admin, "sharedindex.example.lock"), "");
      if (state === "unknown") fs.writeFileSync(path.join(admin, "UNKNOWN_RECOVERY"), "");
      if (state === "lock") fs.writeFileSync(`${rr}.lock`, "");
      if (state === "merge") fs.writeFileSync(path.join(admin, "MERGE_HEAD"), "");
    }
    const start = proof.indexOf("worktree_admin_safe=1");
    const end = proof.indexOf("\n```", start);
    assert.ok(start >= 0 && end > start);
    const result = spawnSync("bash", ["-c",
      `worktree_git_dir=$1\nprimary_checkout=$2\nfor candidate in one; do\n${proof.slice(start, end)}\nprintf 'SAFE\\n'\ndone`,
      "admin-proof", admin, fileURLToPath(new URL("..", import.meta.url))], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), state === "empty" ? "SAFE" : "PRESERVE - worktree admin recovery state");
  });
}
