# Native transport command ownership: #6195

Nova's scoped candidate repairs finite-command lifetime and teardown in the native transport harness. The old root-only signal path could report success after a deadline when a descendant retained stdout. A live private POSIX anchor now retains group identity across command-root exit, preserves output and keeps timeout/cancellation/unknown cleanup as failures. Unknown cleanup preserves fixture data and the test plan.

The default execution allowance remains 600000 ms, followed by the full existing 5000 ms graceful-shutdown window. A separate maximum 1000 ms terminal-observation phase replaces the former unbounded post-kill wait; it cannot admit successful work after timeout. The anchor signals only its own currently held group. Deliberately escaped output is incomplete failure, with no unproven PID signal.

## Verification

| Evidence | Result |
| --- | --- |
| Original production-boundary regression | 100 ms deadline falsely succeeded after 7122.951 ms; formal RED retained |
| Final runner and existing teardown contracts | 23 passed, zero local skips |
| Existing mobile process-ownership contracts | 22 passed |
| Native owner CI path classification | 15 passed; JS/Python/test changes select native and frontend validation |
| Final app lane | 1528 file executions passed |
| Test wiring | 2269 files registered |
| Lint, syntax, TypeScript and ordinary production build | Passed; bundle gates included |
| Full native unit transport | 1229 unique passes; zero failed/skipped/expected failures/duplicate case nodes |
| Real ingress, roster and restart | Existing assertions passed; provider request 1 and tool invocation 1 |
| Command/service/state/source cleanup | All flags true; owned Simulator shut down and retained |
| Normal signature and installed-copy comparison | Deep signature verification passed; three post-execution binary hashes match |

The final native runtime used ordinary build `AcfOY-OjhoIhAGKqMOhkt`, Xcode 27.2/27B52 and an owned iPhone 17 Simulator running iOS 27.0/24A434. [source-manifest.json](source-manifest.json) binds the qualified runtime files to current bytes. The later CI-routing-only delta, plan annotation and static fixture argument refactor were separately tested, then included in the final app lane. [proof-summary.json](proof-summary.json) records counts, hashes, toolchain and limitations; [commands.txt](commands.txt) records invocation shapes. The eventual signed head/tree and PR are recorded on the canonical issue rather than embedded circularly in this packet.

Fixture programs use static source text with paths and options passed as argument data. This addresses three hosted code-scanning construction findings without suppressing the scanner or claiming a demonstrated production exploit. The affected real-process contracts and full app lane passed after the refactor; current hosted status belongs to the exact-head checkpoint on the canonical issue.

## First failures and limits

A first successful native generation preceded the correction for libproc returning zero with errno on inventory failure. Its raw 1229-pass result and seven exact source files are retained separately. The corrected generation was qualified again, with 5062 raw bundle files (61645440 bytes) frozen after canonical verification and before independent summary/tree queries. Queries used the frozen copy; the indexed original bytes remain unchanged. Fifteen ATS warnings for the `cave.test` fixture are retained.

Fresh shared-account review reproduced a shortened graceful window and incorrect EFBIG output-completeness metadata. Both received failing regressions before correction. A later direct boundary audit reproduced zero/EPERM falsely certifying empty membership, then corrected it without changing permissions. Native CI selection also received a failing behavioral test before owner-only paths were wired. The original subprocess-census/fixture failures, plan disclaimer failure and every RED receipt remain under `/private/tmp/nova6195-20261117/`; large raw artifacts stay local.

The historical `collectSimulatorDiagnostics`/`simCtlDiagnose` cause remains unproven. Old raw sample paths are unavailable; all 15 comments on the explicitly referenced #6177 were checked and preserve local path references rather than recovering those samples. The current host/Xcode differ from the historical profile. A current passing suite does not erase the original timeouts. Keep #6195 open and obtain the original failing sample/xcresult or capture a supported future failure before attributing a cause. Physical-device, rendered UI, human, merge and release acceptance remain separate.

## Retention

Retain `.worktrees/issue-6195-native-teardown-nova` on `fix/issue-6195-native-teardown-nova`, owned by Nova for draft PR review and the unresolved investigation. The single extra worktree exception was explicitly granted and recorded before creation. Owned Simulator `4AD47D27-9F91-4ECB-B7EE-016DF2ABF17D`, DerivedData and raw evidence are retained. #6064/PR6469, #6482's uncommitted candidate, installed user apps, foreign units and `~/.coven` were preserved.

The local index is `/private/tmp/nova6195-20261117/active-checkpoint.json`; corrected qualification lives in `census-final/`. Provider traffic used the controlled Hermes fixture with real Cave/daemon/Swift transport and scratch state. HOME stayed unchanged; inherited execution environments excluded provider credentials. No merge, release, deployment, protection change or issue closure was performed.
