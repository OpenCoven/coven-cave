# Process and endpoint boundary proof implementation plan

> Execute inline, with failing-first tests for each change. No commit, push or merge is authorized by this plan.

**Goal:** Complete every original acceptance criterion in [#6303](https://github.com/OpenCoven/coven-cave/issues/6303), under #6119.

**Spec:** The issue body and the user's attached execution goal are authoritative. This document records implementation choices, not a narrower replacement scope.

**Architecture:** Separate discovery, contract review and executed platform evidence. Discover JavaScript/TypeScript capabilities using the TypeScript AST, with import aliases, namespace access, dynamic imports, require, destructuring, reassignment and indirect escapes represented. Treat foreign-language executable sources conservatively as whole-file review obligations until their individual boundaries have a proven parser/inventory. Hash source and evidence bindings so an inventory acknowledgment cannot masquerade as a verified contract after code changes. No new process runner.

**Tech stack:** Existing Node/TypeScript compiler, Node test runner, existing process-execution contracts, Rust and the Windows native CI lane.

## Constraints

- Preserve #6305 and all foreign worktrees, claims and paused operations.
- No real-user data, credential/trust changes, daemon changes, release or destructive cleanup.
- Source enumeration, policy correctness and executed platform proof are separate gates. Pending rows are not verified.
- Read-only enumeration must not execute source programs or follow repository symlinks outside the authorized roots.
- Any unsupported syntax or source kind must become a visible review obligation, not silently disappear.

## Review focus

- Aliases, computed access and wrappers must not bypass the denominator.
- Unsupported languages and extensionless scripts must stay visible.
- Removal, source edits and stale evidence must invalidate recorded coverage.
- Synthetic or source-pattern tests cannot certify OS permissions, pipe ownership or descendant cleanup.
- Long-running children and unrelated process/socket owners must be preserved during testing.

## Tasks

### 1. Discovery and drift enforcement

- [ ] Add failing tests for renamed imports, namespace/require/dynamic imports, multi-hop aliases, computed methods, escaping capabilities, foreign sources, symlinks and deterministic inventory.
- [x] Implement `discoverBoundaries(root)` and `compareInventory(discovered, recorded)` in scripts/process-boundary-inventory.mjs. Use source hashes and stable locations, and retain explicit unsupported-source obligations.
- [ ] Add reviewed inventory data with pending/verified/not-applicable states; validate required dimensions and exact evidence references separately from registration. Schema and pending catalogue exist; per-boundary review is not complete.
- [x] Wire discovery drift checks and scanner tests into the existing CI/test runner without claiming pending contracts passed. The proposed CI proof gate deliberately fails every unresolved row; this candidate is not ready to publish or merge.

### 2. Per-boundary contract review and repairs

- [ ] Inspect each discovered boundary and indirect wrapper. Record environment, arguments, deadlines, output bounds, cancellation/tree cleanup, permissions and path compatibility, including justified non-applicability.
- [ ] For each missing guarantee, write a behavioral regression, preserve its failing result, repair the existing boundary and verify the regression plus affected suites.
- [ ] Replace foreign whole-file obligations with individually enumerated contracts and tests that prove discovery completeness for the language's supported constructs.

### 3. Windows named-pipe proof

- [ ] Inventory native and library-backed pipe creation/connection, authentication, ACL/ownership, name collision, cancellation and path behavior.
- [ ] Add failing-first Windows behavioral tests and wire them into the existing Windows lane with exact test-count checks.
- [ ] Run the supported lane under explicit hosted-execution authority; retain exact OS/source/build identities and first failures. Non-Windows results remain supporting evidence only.

### 4. Documentation, verification and close-out

- [ ] Update the connectivity inventory and residual register with generated denominator, per-row evidence and every remaining unverified dimension.
- [ ] Run scanner tests, drift check, existing process tests, wiring, clock checks, lint/typecheck and relevant native/full regression gates on the final candidate.
- [ ] Audit all four original acceptance criteria. Preserve incomplete rows rather than removing “exhaustiveness unproven” prematurely.
- [ ] Record exact worktree disposition and a concrete review-ready result; request publication/delivery authority only after the result is concrete.

## Execution ledger

2026-10-29: worktree created at `.worktrees/issue-6303-boundary-contracts`, branch `security/issue-6303-boundary-contracts`, base `10974d4c4a034101726111ba4035c0b684cd39e8`. Existing 21 units preserved; new total 22, budget 28. Dependencies restored locally using the frozen lockfile and offline store; no cross-worktree node_modules symlink. Initial search found 289 files with process/socket-capability references, not a proven exhaustive count.

First repair: onboarding SSH preflight. Initial behavior-test run failed because the CommonJS fixture read the old exports object; corrected before product changes. The bounded pre-repair run then recorded four failures, one cancellation timeout and one passing invalid-host case. An earlier unbounded cancellation test was explicitly terminated as this session's own process and retained as a harness failure. Product changes reuse bounded output and owned-tree termination, preserve fixed SSH arguments/scoped environment, handle abort, fence close during timeout cleanup and redact path-bearing spawn errors. All six behavioral cases and the original source contract pass. Existing process-execution behavior tests pass six cases, including real POSIX descendant cleanup.

Discovery: JavaScript/TypeScript alias, loader, constructor, promisify, listener-handle and escape cases pass; Python uses a bounded isolated AST parser and never executes target code. Twenty-four scanner tests pass after review hardening. The compact catalogue records 21,672 obligations, all unverified, with exact source hashes. Registration drift is clean; `--require-proof` intentionally exits 1. No exhaustiveness or platform proof is claimed. Rust, shell, PowerShell and C individual discovery remain open.

Verification: typecheck, changed-source ESLint, test wiring (2,169 files after the platform test was added), clock consistency and docs index pass. The first docs-index invocation used a nonexistent script name and failed before running a check; the correct `node --test scripts/docs-index.test.mjs` passed. API run 1 passed 275 files then failed in an unchanged Codex fixture: the chosen temporary HOME produced a 112-byte Unix socket path and `listen EINVAL` on macOS. The same focused test passed with a short `/tmp` HOME; the full short-HOME rerun remains separately tracked. First failure and retry logs are retained under `/tmp/6303-*`; no product assertion was weakened.

Windows decision input: the direct daemon IPC path explicitly lacks connected-pipe owner inspection. Historical #4780 names the SDK/native security-provider design problem. Asked whether an approved native binding exists or a native-binding design should be prepared; no answer or new authority is inferred. Independent discovery and contract work continues while that decision is pending. No commit, push, PR, merge, release, private-state mutation or retirement has occurred.

Platform coverage increment: three real OS occupancy cases pass on macOS (no protocol bytes, connection teardown, parallel probes, preserved listener and missing endpoint). The first parallel case used a snapshot of close promises before all server accepts were observed and failed with one live fixture connection; the corrected test waits for explicit accept/close events and uses no sleep. Windows case aliases are exercised by the same file on Windows only. The Windows workflow now selects the file and requires exactly three passing, zero failed/cancelled/skipped TAP cases; actionlint passes. No Windows execution or ACL/owner proof is claimed.

Native recommendation: `2026-10-29-windows-pipe-identity-proposal.md` binds the current SDK security interface to commit 89685543a62008533237478c31ecce565798ddf6 and verified Git blob f6738c0d606ca4cf1c52c9990f1fb6fb6782259f. Val answered that they did not know of a binding; this is not native-dependency approval. The recommendation is to use the canonical SDK policy with a native-owned connected handle and qualify zero pre-validation writes, owner/ACL and freshness/race checks before integration. No SDK or daemon source was changed.

Review checkpoint: a fresh read-only reviewer reproduced three silent-loss defects (relative wrapper consumers, capability containers and executable HTML), then a dynamic local-import variant. Failing-first regressions now retain explicit source-review obligations for static/dynamic/require/import-equals delegation, JS/Python storage and returns, executable HTML/configuration and unclassified source units. The reviewer rechecked the original/dynamic cases and confirmed caller edits invalidate the source binding and unresolved records cannot be marked verified. This closes those silent-loss defects through fail-closed accounting; it does not implement the missing individual call graph. Root server.ts is now inventoried as an authoritative source entrypoint.

API rerun completed: 555 files passed with the short isolated HOME, preserving the 275-file first-run failure. The runner loaded before the new platform test was registered, so its three cases were executed separately and passed on macOS; do not report the 555-file run as including that file. Full lint, latest typecheck, targeted new-test lint, exact test wiring, clock checks, actionlint and docs index passed. No build, Windows execution, hosted validation or release acceptance is claimed. The proposed proof gate remains red with 21,672 unverified obligations; registration drift is clean. Current origin/main advanced separately to bc940dc68e9575928afc8f31866b8939317c4732 while this unit remains based on 10974d4c4a034101726111ba4035c0b684cd39e8. Integrate and requalify before eventual delivery; do not imply exact-current-main acceptance.
