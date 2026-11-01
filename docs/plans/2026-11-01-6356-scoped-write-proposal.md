# #6356 scoped-write design proposal

Delivery authorization, 2026-11-01: the maintainer subsequently authorized committing, publishing, protected merging and bounded pruning of the two task units. Earlier local-only statements below describe the verification snapshot before that authorization. Current delivery and cleanup receipts are tracked on Cave #6356 and Coven #1646; runtime release, deployment and real familiar acceptance remain separate.

Status: separate scoped-write contract approved by the user on 2026-11-01. Existing Full and #713 semantics remain unchanged. Execution is local-only; commit/push/merge/release/deletion remain unauthorized.

## Verified facts

At Cave base ee0c65a8407fd834548a71de98f316cfc1a3d700, full mode omits permission intent; the installed Coven v0.4.10 leaves Claude Code 2.1.316 in default mode. A synthetic loopback model drove the actual installed CLI and actual Write tool: default denied all seven writes and returned exit zero. The same production Coven run path also denied every write. Real provider inference was not exercised; synthetic usage/cost fields are not actual provider billing.

Direct acceptEdits allowed primary, additional writable root, and writable child beneath an ungranted read-only parent. It denied external ungranted/skill roots, but allowed a nested skill directory inside the primary root. Therefore acceptEdits alone is insufficient to meet this goal. Existing Coven Permission::Full maps Claude to bypassPermissions, which must not be used as a workaround. The #713 launchPolicy is restricted to Codex nonInteractive and must retain that contract.

Cave runtimeGrantDirs also forwarded read-only accessible projects because it accepted no access-level map. The local prerequisite repair filters by an explicit write level when a map is supplied. The resume fingerprint now includes mode and protected-resource roots, version 2, so a changed mode or protection set refreshes the native session once. Existing canonical grant spelling behavior is retained.

## Approaches

1. Recommended: add a separate daemon-owned scoped-write launch contract for the Claude streamed path, capability-gated in Cave. Preserve existing Full and #713 behavior. Carry canonical writable and protected roots explicitly, qualify their effective native enforcement, and refuse unsupported profiles before dispatch. Use acceptEdits only as the native edit-approval mechanism within that checked contract.
2. Change existing Coven Full semantics from bypassPermissions to acceptEdits and add protections there. This changes behavior for every CLI/API consumer of Full and requires a broader compatibility review. It is not the recommended scope for this repair.

A direct Claude transport in Cave is excluded because it would move authority around the daemon rather than repair the current launch path.

## Proposed contract and invariants

The new mode is distinct from unrestricted Full and read-only. Its final wire name must explicitly advertise scoped writes, for example workspace-write, and old CLI/daemon/harness profiles must fail closed rather than omit it or substitute Full. Existing #713 Codex-only validation remains unchanged; shared internals may be reused without changing that public contract.

Cave derives authority from the live project grant store, not prompt text or a model report. Only the primary writable root, explicitly writable additional project roots, and authorized familiar output workspace receive write authority. Runtime resources remain protected even when nested within a writable root. Read-only roots remain readable and never become writable via --add-dir. A writable child of a read-only parent must work without granting its parent. Canonical aliases must preserve the same effective authority. Revocation, mode change, protected-root change, and grant change must replace stale resumed-session authority with bounded transcript replay.

The implementation must select a concrete native enforcement mechanism and demonstrate these invariants before enabling the mode. Permission flags and argv alone are not proof. Native Edit deny rules may protect supported nested paths, but overlaps, aliases and shell-based writes must be tested; unqualified combinations are refused explicitly. No broad permission bypass, user settings edit, prompt-only boundary, or post-hoc sentinel is an acceptable substitute. Unsupported runtime copy names the missing scoped-write support and tells the user to update or use read-only; it must not offer an unrestricted bypass as the fix.

Permission-denial result records must produce a bounded, actionable notice rather than an apparently successful artifact claim. Avoid exposing private filesystem paths or raw diagnostics beyond existing client authority.

## Verification sequence

1. Preserve failing-first writable-grant and resume-mode regressions and the current isolated real-tool reproduction.
2. Establish the smallest existing-owner-compatible Coven issue/worktree for the new mode, following that repository's claim and lifecycle procedure. Do not take over #857/#1603 or other active runtime authority work.
3. Add failing-first CLI/API/harness mapping and unsupported-profile tests. Preserve existing Full, read-only and #713 tests.
4. Drive the actual Cave route through Coven and the real installed Claude tool executor against a loopback synthetic model. Check file content and absence, not exit status alone. Cover primary and additional writes; read-only, ungranted and protected-root denial; writable-child/read-only-parent; aliases; new/resumed chats; mode/grant/revocation changes; unsupported versions. Include shell-mediated attempts before asserting shell confinement.
5. Run the repository gates appropriate to each changed surface, retain first failures/retries/skips and exact source/binary identities, and prepare a reviewable local patch and evidence report. A provider-backed Lucian acceptance run remains distinct from synthetic inference evidence.

Additional qualification: native Edit deny rules prevented both Write and shell-redirection writes to the nested protected directory while retaining intended writes in this isolated matrix. This is evidence for the proposed mechanism, not a universal confinement guarantee. The installed old Coven rejects a scoped-write mode rather than silently accepting it.

## Current disposition

The feature worktree is .worktrees/issue-6356-write-authority on fix/issue-6356-write-authority, base ee0c65a8407fd834548a71de98f316cfc1a3d700. It contains local Cave implementation and tests. The companion Rust implementation is local in Coven .worktrees/issue-1646-claude-scoped-write, issue #1646. No commit, push, merge, release, or worktree deletion has occurred. Isolated fixtures and logs are preserved in artifacts/issue-6356. The local implementation and verification are complete; provider-backed acceptance and protected delivery remain separate and unverified.

## Qualification rulings and open evidence

Ruling: native pathname deny rules alone do not protect filesystem objects. An independently confirmed hardlink counterexample changed a protected inode through a writable alias. The contract therefore audits existing writable objects and refuses out-of-scope hardlinks; admitted child trees must inherit a macOS no-hardlink guard. This is not general shell containment. If this judgment is wrong, a protected object could be mutated through an alias, so actual launch-path guard qualification is required before acceptance.

Ruling: v1 is enabled only for the qualified macOS profile and Claude 2.1.316. Other platforms and versions fail closed. The cost is reduced platform/version availability until those profiles have their own real-tool evidence. This exact-version gate does not make caller-controlled executables trustworthy; owner-local launch authority remains the trust boundary.

Ruling: unavailable-Coven/Claude diagnostics take precedence over missing scoped-write capability. Older capability is refused as an SSE launch error before a model process starts, preserving the existing route's availability diagnostics. No broad Full fallback is permitted.

Current evidence: synthetic loopback inference drove actual Cave POST, source Coven and installed Claude tools. New/resumed allowed writes, extra-grant revocation, read mode and primary revocation have file-content/absence receipts. Canonical symlink targets preserve the tested writable/denied paths. Hardlink admission refuses before inference. The subsequent daemon/profile probes found a missing guard/profile check in the direct stream builder and a normalized-version comparison error; both were repaired and qualified through actual direct/daemon runs. Fresh review then found native environment widening, a literal-backslash rule rewrite bypass, and lost pre-init scope notices. The reviewed candidate repairs/refuses each case, with true failing receipts and 22 passing final artifact/result rows. The corrected matrix includes read-only/protected subdirectories beneath writable roots, Read preservation and same-spelling alias retarget. Final broad repository gates pass, with existing skips explicitly retained; earlier matrices retain only their exact narrower claims.
