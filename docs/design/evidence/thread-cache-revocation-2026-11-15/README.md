# Thread-cache revocation evidence, 2026-11-15

Issue: #6487. On the dedicated iPhone 18 Pro Simulator `cave-6487-revocation-20261115` (`B27A835C-42C9-46DB-8BC6-4AD7356FF55F`, iOS 27.2), the final native unit suite executed and passed all 1,228 tests, including 17 `ThreadSnapshotStoreTests`, with no failures, skips, expected failures or quarantine deferrals. Xcode 27.2 build 27B52; Node 24.22.0. The machine-readable receipt is [verification.json](verification.json).

The first test-only run reproduced the missing purge: the original store class ran 11 tests, with the two new cases failing six assertions while the nine existing tests passed. The revoked snapshot, its transcript sentinel and its restored thread survived the 403 and subsequent flush. Results: `/tmp/cave-6487-red.xcresult` and `/tmp/cave-6487-red-status.xcresult`.

Review then identified send-denial and session-rebinding paths. Their regressions failed before repair in `/tmp/cave-6487-review-red.xcresult`. A further managed-device gateway case failed before its repair in `/tmp/cave-6487-managed-red.xcresult`. These first failures are retained; no gate was weakened or retried without a code change.

The final tests drive the real `AppModel` and `CaveClient` through a synthetic `URLProtocol`. They verify selective disk removal on conversation access denial, including send and managed-device refusal; preserve unrelated snapshots field for field; exclude stale writes even after session rebinding; exclude affected unsaved threads; handle group and flow references; complete the purge despite caller cancellation; and reject old-client invalidation after connection replacement. Transient server errors, missing conversations, write-only refusals, flow refusals and harness refusals retain their caches. Recovery without a known conversation does not guess from its run ID.

Relaunch durability is exercised by constructing a fresh `AppModel` and store against the same file after refusal and stale flush: only the unrelated thread hydrates, and the revoked transcript sentinel is absent from `cave-threads.json`. The in-memory refusal fence lasts until a fresh app launch; a revoked local thread cannot recache its old transcript by acquiring a new session binding during that lifetime.

The full suite uses the canonical native transport harness with its own scratch `COVEN_HOME`, real built Cave server and Coven daemon, dynamic loopback port, and synthetic external Hermes provider. The fixture verifies HTTP ingress refusal, actual native transport recovery and persisted history alongside the entire native unit suite. Source fingerprints match before and after the run. Its server, daemon, provider and scratch home were cleaned up by the harness; unrelated Simulators, private threads and port 3000 were untouched.

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs \
  scripts/runtime-activity-native-transport.mjs --execute --unit-suite \
  --destination B27A835C-42C9-46DB-8BC6-4AD7356FF55F \
  --derived-data /tmp/cave-6487-derived --evidence /tmp/cave-6487-native-final
node scripts/ios-xctest-summary.mjs \
  --result-bundle /tmp/cave-6487-native-final/native-transport.xcresult \
  --tests-dir apps/ios/CovenCave/CovenCaveTests --xcodebuild-outcome success
```

Raw final evidence: `/tmp/cave-6487-native-final/result.json`, `/tmp/cave-6487-native-final/native-transport.xcresult`, `/tmp/cave-6487-native-final/native-transport.log` and `/tmp/cave-6487-native-final-summary.txt`. Other passing local gates: production build with an isolated build home, typecheck, lint, test wiring (2,262 files), the mobile suite (107 files), and the thread-persistence/project source contracts.

This records Simulator unit and transport behavior. Physical-device verification remains open. It does not establish managed-device end-to-end pairing, remote HTTPS, human VoiceOver or real-provider acceptance; managed-device refusal is a synthetic response matching the gateway's production envelope and header.
