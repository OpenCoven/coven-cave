# Cave #6356 local scoped-write evidence

Delivery authorization, 2026-11-01: the maintainer subsequently authorized committing, publishing, protected merging and bounded pruning of the two task units. Earlier local-only statements below describe the verification snapshot before that authorization. Current delivery and cleanup receipts are tracked on Cave #6356 and Coven #1646; runtime release, deployment and real familiar acceptance remain separate.

Status: verified local review candidate. Actual artifact qualification and final repository gates pass. No commit, push, PR, merge, release, real familiar settings/grant mutation, or worktree deletion is authorized or performed. This report does not close the GitHub issues or claim provider-backed Lucian acceptance.

## Implementation and authority

Cave derives an explicit version-1 scope from live project access and its own familiar workspace. Read-only projects do not become writable additional directories. Runtime resource roots are retained even beneath a writable root. Primary write access is mandatory. The runtime-access fingerprint binds permission mode and protected resources while preserving #6216 registered-spelling semantics; mode/grant changes replace stale native sessions. Same-spelling alias retargeting was separately qualified: the resumed native process drops the old additional directory and uses the current canonical target without retaining old write authority.

Coven owns the separate CLI `--write-scope` and API `writeScope` contract. Existing Full and Codex #713 behavior remain unchanged. Owner-local API transport is required; TCP cannot gain this authority through Host/Origin allowlists. Both direct native streaming and daemon launches use the same scope/profile/environment checks and hardlink guard. The health capability advertises parsing support, not executable qualification or a grant.

The admitted profile is macOS and Claude Code 2.1.316. Native `acceptEdits` receives only the canonical writable roots, explicit Read rules for read-only/protected roots, and Edit denials for protected/nested read-only roots. User/project settings sources and MCP configuration cannot broaden the scope. Inherited native permission/settings/add-directory overrides and background session kinds are refused rather than silently discarding possible administrator restrictions. Provider credentials and endpoint configuration remain available.

Writable objects are inventoried before launch. Hardlinks with names outside the writable set, unsupported filesystem objects, unsupported overlaps/native rule syntax, and audits exceeding 200000 entries are refused. The child tree inherits a macOS kernel no-hardlink guard. This is a qualified native edit boundary, not general shell confinement or confinement of concurrent external filesystem actors.

## Reproducible local evidence

Cave worktree: `.worktrees/issue-6356-write-authority`, branch `fix/issue-6356-write-authority`. Coven companion: `/Users/buns/Documents/GitHub/OpenCoven/coven/.worktrees/issue-1646-claude-scoped-write`, branch `fix/issue-1646-claude-scoped-write`. Exact bases and current source hashes are retained in `artifacts/issue-6356/reviewed-current-source.json`; live remote main OIDs matched both pinned bases at the final refresh.

The reviewed executable is frozen at `/private/tmp/coven-1646-reviewed-0yp_v_nt/coven`; its source/binary manifest, captured tracked patch, and new Rust module are retained in the same directory. This immutable executable prevents later Cargo builds from changing a probe's runtime. The installed Claude executable resolves to `/Users/buns/.local/share/claude/versions/2.1.316`; its exact binary identity is included in the final manifest.

`artifacts/issue-6356/qualify-reviewed.py` drives `probe-claude-permissions.py`, the actual Cave POST route, source Coven, and installed Claude. `verify-reviewed.py` independently reopens files and native tool results, checks exact synthetic content and denied-file absence, and verifies zero model requests on prelaunch refusals. Its result is `reviewed-verification.json`: 22 verified rows. Raw request bodies, route receipts, isolated homes, and synthetic files remain at the temporary paths recorded in each receipt. These are intentional local retention, not uploaded or immutable hosted artifacts.

All model frames came from a credential-isolated loopback fixture with a dummy key. The actual installed tool executor performed the file operations. Synthetic model/version/usage fields are not evidence of provider inference, model availability, token billing, or real familiar acceptance.

| Row | Observed result |
| --- | --- |
| New session | Primary, external write grant, writable child under read-only parent, and familiar deliverable created with exact expected content. |
| Same-authority resume | The same four locations remain writable. |
| Additional grant revoked | Primary/child/deliverable still writable; revoked external target absent. |
| Read mode after Full | No test write created. |
| Primary grant revoked | HTTP 403 before model launch. |
| Same-spelling alias retarget | Old target denied; newly granted canonical target written during resume. |
| Canonical symlink aliases | Writable alias written; protected and ungranted aliases denied. |
| Protected runtime resources | Correct Cave skill root and user Claude skill root remain unwritten. |
| Read preservation | Explicit read-only project and protected resources return the synthetic sentinel; ungranted Read is denied. |
| Simple Bash redirection | Four intended locations written; read-only, ungranted and protected targets absent. This does not qualify arbitrary shell commands. |
| Existing protected hardlink | Admission refused, zero model requests, protected sentinel unchanged. |
| Kernel link creation | Focused Rust test denies `ln` while ordinary writes still succeed. |
| Unqualified native version | 2.1.315 fixture refused before native execution/model request, with `write_scope_profile_unqualified`. |
| Conflicting nested grants | Pre-init refusal, zero model requests, safe `runtime_write_scope_unavailable` notice. |
| Literal backslash root | Refused as unsupported native rule syntax; no model request or file mutation. |
| Hostile user/project settings | The four intended writes succeed; denied targets remain absent. |
| Legacy Coven bypass environment | Scoped authority remains bounded; the four intended writes succeed. |
| Native relaunch/background/managed overrides | Each separately refused, zero model requests, `write_scope_environment_unsupported`. |
| Real daemon owner-local socket | Granted targets written; read-only, ungranted and protected targets absent; isolated daemon stopped afterward. |

The table groups some checks; the verifier emits 22 machine-readable rows plus the primary-revocation and kernel-test assertions. Capability absence/older Coven is also covered by the registered real-route fake-runtime regression, which proves no child launch rather than qualifying a native permission implementation.

## First failures, retries and corrections

The original omitted-mode case returned exit zero while creating no files. Direct `acceptEdits` restored intended writes but also wrote a nested protected skill directory. Read-only project roots were initially over-forwarded by Cave; mode/resource changes were absent from the resume fingerprint. Those true failing regressions are retained alongside the repair tests.

The independent hardlink review disproved a pathname-only protection claim. The local candidate now audits object aliases and guards new hardlinks. Later real launch probes caught the stream builder skipping profile/guard qualification and the daemon comparing normalized version output against the wrong string. Both builders now share qualification, and the exact-version regression passes. A Read-tool probe then caught missing explicit read authority; the final matrix verifies Read rules without writable-directory promotion.

The fresh-context final review found native environment widening, a literal-backslash rule rewrite bypass, missing actionable pre-init scope notices, and missing/mislabeled acceptance rows. All important findings received a focused fix/evidence pass. Original unsafe receipts remain retained. Earlier Cave rows named `COVEN_HOME/skills` as protected although the resolver uses `COVEN_CAVE_HOME/skills`; those earlier rows prove ungranted-path denial only. The final matrix uses the correct protected root; the `.claude/skills` rows were correctly targeted throughout.

Fixture/setup failures are retained separately: invalid initial MCP shape, isolated not-logged-in attempt with no provider request, a patch-anchor failure before mutation, missing TUI run-session arguments, an omitted synthetic familiar roster, continuation turn-detection mistakes, missing shell deliverable parent directory, and verifier newline-escaping mistakes. These are not product acceptance passes. The initial broad Cave suites stopped at old fake-runtime help fixtures; those fixtures now advertise scoped support while dedicated unsupported-capability regressions remain fail-closed. Rust's initial workspace run caught a health-test normalization expectation that omitted the new owner-only field. The documentation guard and its count test were updated for the eighteenth capability, preserving their initial failures.

## Review rulings and remaining limits

Ruling: native pathname rules alone are insufficient. Existing external hardlinks are refused and new links guarded; the cost is refusing unsupported shared-object layouts, including possible package-store links. Concurrent external filesystem actors remain outside this child-runtime contract, and this must not be represented as object isolation against such actors.

Ruling: qualify only macOS/Claude 2.1.316 and reject ambiguous roots, syntax, inherited authority sources, and oversized audits. The cost is reduced runtime/layout availability until additional profiles have independent evidence. Refusing an inherited settings source preserves a possible administrator restriction; silently stripping it could weaken that restriction.

Ruling: preserve #6216 spelling semantics because the actual retarget probe demonstrates current native additional-directory replacement without stale write authority. The cost if this assumption drifts is obsolete resume authority; a runtime upgrade requires renewed qualification.

Final: Ruling: general shell confinement is outside this contract; only the named tools/simple redirection were qualified. Cost if overstated: untested commands could exceed the claimed boundary.

Final: Ruling: concurrent external filesystem actors are outside this child-runtime boundary. Cost if ignored: they could race the admission inventory; do not claim their containment.

Final: Ruling: malicious owner-local executable substitution/version spoofing remains outside this contract's trusted executable-selection boundary. Cost if ignored: a replacement executable could lie about enforcement.

Final: Ruling: other operating systems/versions are refused rather than assumed equivalent. Cost: availability requires later qualification.

Final: Ruling: provider-backed Lucian behavior and real billing remain unverified. Cost if conflated: synthetic evidence would be mistaken for production acceptance.

Final: Ruling: merge/publication/release/deployment are outside current authority. Cost: these changes remain local and unavailable to other clients until separately authorized delivery.

Deferred minors: none reported by the fresh reviewer. No second review was substituted for the required failing-first fixes and current-source verification.

## Gate results

The current-source app suite passed all 1507 files. The current Rust workspace command passed 5518 tests across 70 result blocks, with zero failures and 9 existing ignores. Clippy with warnings denied, formatting, explicit-file privacy (17 files), secrets, focused ESLint, TypeScript checking, all 2179 test files wired, and 118 documentation-guard tests passed. The current-source API suite passed all 557 files. Exact commands, final process exit receipts and source hashes are retained in artifacts/issue-6356 and the /private/tmp/coven-1646-*.log files.

Both worktrees and local evidence are intentionally preserved for review under the existing owner, with no cleanup authority inferred. Canonical issues are Cave #6356 and Coven #1646; their continuity comments distinguish local progress from delivery and acceptance.

Rust ignores retained: adoption-gate subprocess child helper; three installed-Claude scoped-read relay/service tests requiring COVEN_TEST_RELAY_BIN; theme contrast reporting helper; TUI benchmark metrics helper; truecolor preview helper; two explicitly ignored Codex detached stream JSON tests. No skip was converted into acceptance. The app suite also retains two native process-supervisor acceptance skips because COVEN_PROCESS_SUPERVISOR_NATIVE is not supplied. The API suite retains 8 internal skips: two Windows startup/device acceptance checks, three Windows ACL/DACL/inheritance checks, and three enabled-conformance-build preset checks. These are not macOS scoped-write acceptance results.
