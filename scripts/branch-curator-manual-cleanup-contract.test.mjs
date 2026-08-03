import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

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
const workflow = read("docs/workflows/beads-familiars.md");
const automaticDesign = read(
  "docs/superpowers/specs/2026-07-31-automatic-local-branch-retirement-design.md",
);
const implementationPlan = read(
  "docs/superpowers/plans/2026-08-01-maintainer-authorized-branch-cleanup.md",
);
const evals = JSON.parse(
  read(".agents/skills/branch-curator/evals/evals.json"),
).evals;

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
the owning Bead. Never silently fall from the automatic profile into the manual
profile.`),
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
local-only or local-and-remote scope, Bead, session, branch, worktree, and
audited default-branch OID before mutation. Historical, standing, inferred, or
unbounded permission is insufficient, and local cleanup authority does not
imply remote deletion.`),
  );
  assert.match(manual, /does not\s+imply remote deletion/);
  assert.ok(
    manual.includes(`It still must acquire and
retain the local maintenance lease, rerun every Beads, GitHub, process,
worktree, ref, recency, archive, and recovery check immediately before each
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
      ["Beads", /Beads/],
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

test("operator docs preserve automatic gating and protected main", () => {
  assert.ok(
    normalizeWhitespace(agents).includes(
      "Run `pnpm beads:worktrees` before closing PR-backed work. Record each local worktree as removed and verified or intentionally preserved with an owner and reason; `retire-after-gate` is a classification, not automatic deletion authority. Automatic retirement requires the full maintenance gate. Explicit maintainer authorization in the current task may activate Branch Curator's bounded manual deletion proof.",
    ),
    "AGENTS.md does not preserve the exact automatic-versus-manual deletion boundary",
  );
  assert.ok(
    normalizeWhitespace(workflow).includes(
      "`retire-after-gate` — old, clean, landed work is cleanup-ready. Automatic retirement still requires the full repository-wide maintenance gate; explicit maintainer authorization in the current task may instead activate Branch Curator's bounded manual deletion proof.",
    ),
    "familiar workflow does not preserve the exact retire-after-gate boundary",
  );
  assert.ok(
    normalizeWhitespace(automaticDesign).includes(
      "The separately specified [manual maintainer-authorized cleanup profile](2026-08-01-maintainer-authorized-branch-cleanup-design.md) does not enable automatic apply mode or remote deletion by automation. It is a bounded operator path with fresh proof and exact expected-OID mutations.",
    ),
    "automatic-retirement design does not link the bounded manual profile",
  );
  assert.match(agents, /Do not push directly to `main`/);
});

test("evals cover every new authorization and race boundary", () => {
  const byId = new Map(evals.map((entry) => [entry.id, entry]));
  assert.deepEqual(
    evals.map((entry) => entry.id),
    Array.from({ length: 59 }, (_, index) => index + 1),
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

  assert.match(byId.get(43).expected_output, /12-worktree budget/i);
  assert.match(byId.get(43).expected_output, /exception that would be admitted/i);
  assert.match(byId.get(43).expected_output, /never be retired/i);
  assert.match(byId.get(43).expected_output, /does not delete any existing work/i);
  assert.match(byId.get(44).expected_output, /cleanup-ready patrol unit/i);
  assert.match(byId.get(44).expected_output, /reports any remote ref as a proposal rather than deleting it/i);
  assert.match(byId.get(45).expected_output, /gate-incomplete/i);
  assert.match(byId.get(45).expected_output, /missing Coven, Beads, and GitHub enforcement planes/i);
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
    /no active process, session, claim, non-closed Bead, open-or-draft PR, or active workflow/,
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
  assert.match(byId.get(55).prompt, /one untracked file and an active Bead claim/i);
  assert.match(
    byId.get(55).expected_output,
    /dirty path and active Bead claim remain unconditional live-work blockers/i,
  );
  assert.match(byId.get(56).expected_output, /expected OID/i);
  assert.match(byId.get(57).expected_output, /worktree-guard/i);
  assert.match(byId.get(58).expected_output, /protected.*main/i);
  assert.match(byId.get(59).expected_output, /origin fetch\/push destination/i);
  assert.match(byId.get(59).expected_output, /refs\/heads\/feature\/cave-remote:R/);
  assert.match(byId.get(59).expected_output, /:refs\/heads\/feature\/cave-remote/);
  assert.match(byId.get(59).expected_output, /destination or OID drift/i);
  assert.match(byId.get(59).expected_output, /status 2/i);
});
