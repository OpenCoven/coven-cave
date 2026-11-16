# Marker collection after XCTest simulator shutdown — #6064

Nova repaired an evidence-collection defect found in hosted run [43834925406](https://github.com/OpenCoven/coven-cave/actions/runs/43834925406), published source `5d0ff404508441429f623932b4ab90758dc23e20` and tested merge `d2855c8e18dea865bd03c0eeec9fd03b506ca40a`. The exact selected/result simulator was shut down after XCTest; the original `simctl spawn` query failed 149 in 1.584 seconds. This packet preserves that failure, a locally proved offline channel, the actual helper, contracts and review findings. It does not establish final #6064 acceptance.

## Implemented boundary

[The helper](../../../../../../scripts/ios-scroll-marker.py) discovers exactly one selected UUID. Booted retains the original live query. Shutdown reads only the selected device's exact unredirected `data/var/db/diagnostics` store through the host macOS log reader. It rejects uncertain metadata, another UUID, data-directory aliases, substituted stores and symlink escapes before reading. Both discovery and reading remain inside the original 15-second command plus 5/5/5-second shutdown envelope. The fixed CovenCave/marker predicate, 70-minute lookback, 108-minute job, one-minute reserve, native test bytes, gestures, assertions, deadlines and routing remain unchanged.

| Evidence | Observed result | Limit |
| --- | --- | --- |
| Hosted original collector | Exit 149, not timed out, selected/result device not booted | No independent writer-error query completed |
| Disposable normal-signature probe | One marker emitted; live query found it; original post-shutdown query failed 149; offline reader recovered exact marker and PID | Local iOS 27.2/24B8117, not hosted iOS 26.5/23F77 |
| Actual fixed workflow shell, owner and helper | Exit 0 against the owned Shutdown simulator, exact store/command retained; probe's different process is excluded | Empty application query is not proof of writer-error absence |
| Existing and added contracts | RED 8 passed/1 failed before implementation; GREEN 9 passed/0 failed/skipped | Only external xcrun is mocked; real shell, owner and helper execute |
| Reviewer path finding | Actual workflow reproduced substituted-store acceptance; exact-data/store repair passes all 9 contracts | First review and RED result retained |
| Final local checks | 1,529 app and 107 mobile file executions; hygiene, wiring, lint and typecheck exit 0 | Recorded host exclusions remain; not hosted/native-device acceptance |

The installed app stub and Debug implementation still match the retained pre-probe build identities and pass normal signature verification. The standalone fixture did not install or launch the candidate app. The first probe used a temporary executable path that was absent after the simulator lifecycle; launch failed 111 before emission. That failure remains retained, and the corrected control uses the same retained signed host binary. The selected simulator was left Shutdown and the probe PID was absent.

## Hosted native diagnostic and retained first failures

Both hosted archive digests/sizes and all 1,869 frozen result files plus nine logs/receipts were verified, with empty global and per-bundle issue lists. Debug has 60 unique cases and 61 executions: delayed-history opening first failed the original five-second “Scroll to latest” disappearance check, then its configured retry passed. Strict completed exactly seven methods × three intentional repetitions, 21 passes without retries/skips. Release passed its two methods on first runs. This is the bounded observer revision; the original uninstrumented e946 strict 20/21 and local Release long-trace 1/3 failures remain unresolved.

All three small-drag iterations issued nine synthesis activities, but outer-pan begin/end pairs are 9/8/8. Passing iterations two and three omit return-event callbacks #9 and #7 while subsequent polling continues. Initial invalid-bounds records and bounded ancestry depth remain explicit. Neither callback absence, hit testing nor instrumented passes prove actual touch delivery, a product cause or universal stability. The independent writer query failed in this hosted run, so no writer-error-free conclusion follows.

[The delayed-history PNG](debug-delayed-history-precheck.png) is an unedited XCTest attachment. The first and retried landing captures share the same payload, but both precede the later control-disappearance check. The retained automatic recording and traces do not establish final UI state or an application cause. No assertion was weakened to make the retry pass.

`xcresulttool` adds `database.sqlite3` while reading a bundle. The first file-set audit failure is retained; a fresh extraction and one summary query proved only that cache was added, with all original files unchanged. Integrity verification uses the original archive bytes and frozen files, separately from generated read caches. Raw ZIPs, complete xcresults, activity JSON, recordings and full terminal logs remain retained in the owned qualification directory; this packet contains selected reviewable evidence.

## Source and review binding

[Final source identities](final-review-source-identities.json) bind the five implementation/contract/design files on local base `0557dff29063aa64311352fcd882cb1d3e5fe7eb`. The full local check source count/fingerprint is in [the verification summary](local-checks-summary.json). This evidence directory was assembled after executable checks and is not presented as part of their runtime snapshot. The original native UI tests and Swift observer source were unchanged by this collector repair. The initial and follow-up reviewer reports are fresh source reads by a sub-agent in the same account; they are not independent human or execution acceptance.

[The artifact index](artifact-index.json) records original and published SHA-256 separately. Only absolute owned paths in textual receipts/logs are tokenized. Whitespace-sensitive failure-log and trace text is stored as JSON strings, preserving all line breaks, blank delimiters and trailing spaces. The PNG bytes and decoded trace records are unchanged; raw originals remain retained. [SHA256SUMS](SHA256SUMS) covers every other file in this packet. No physical-device inventory, environment dump, live provider credentials or installed user-app data is included.

Current packaged visual/frame, native frame/main-thread cost, physical-device and human accessibility acceptance, delayed-history/root-cause attribution and parent-owner/Val admission remain open. Normal signed follow-up publication and its actual hosted collector result are separate gates. No merge, release, deployment, protection change or issue closure is claimed.
