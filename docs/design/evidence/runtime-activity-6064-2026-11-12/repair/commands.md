# Qualification commands

Run from an owned worktree with independent frozen dependencies. These are portable equivalents of the retained `/private/tmp/nova6064-20261112/run.mjs` commands. The browser configuration serves an already-built production bundle and inherits the canonical synthetic API credentials/state; it never attaches to an existing server. Choose an unused explicit port and retain separate output paths for every invocation.

```sh
C6064_STATE=$(mktemp -d /private/tmp/c6064-XXXXXX)
mkdir -p "$C6064_STATE/home" "$C6064_STATE/coven" "$C6064_STATE/cave" "$C6064_STATE/tmp"
qrun() {
  env HOME="$C6064_STATE/home" USERPROFILE="$C6064_STATE/home" COVEN_HOME="$C6064_STATE/coven" COVEN_CAVE_HOME="$C6064_STATE/cave" COVEN_SOCKET="$C6064_STATE/daemon.sock" COVEN_CAVE_ENV_FILE="$C6064_STATE/no.env" COVEN_VAULT_FILE="$C6064_STATE/vault.yaml" COVEN_GITHUB_SUBSCRIPTIONS_PATH="$C6064_STATE/subscriptions.json" COVEN_RESEARCH_ENABLED=0 COVEN_CAVE_PORT=3164 TMPDIR="$C6064_STATE/tmp" TMP="$C6064_STATE/tmp" TEMP="$C6064_STATE/tmp" CI=true NEXT_TELEMETRY_DISABLED=1 "$@"
}
qunit() {
  env -u COVEN_HOME -u COVEN_CAVE_HOME -u COVEN_CAVE_PORT -u COVEN_CAVE_ENV_FILE -u COVEN_VAULT_FILE -u COVEN_GITHUB_SUBSCRIPTIONS_PATH -u COVEN_SOCKET -u COVEN_RESEARCH_ENABLED HOME="$C6064_STATE/home" USERPROFILE="$C6064_STATE/home" TMPDIR="$C6064_STATE/tmp" TMP="$C6064_STATE/tmp" TEMP="$C6064_STATE/tmp" CI=true NEXT_TELEMETRY_DISABLED=1 "$@"
}
qrun corepack pnpm install --frozen-lockfile
qrun pnpm build
qunit node scripts/run-tests.mjs app api mobile
qunit pnpm typecheck
qunit pnpm lint
qunit pnpm check:tests-wired
qrun env C6064_REPORT_PATH="$C6064_STATE/browser.json" pnpm exec playwright test --config docs/design/evidence/runtime-activity-6064-2026-11-12/repair/qualification.playwright.ts
qrun env C6064_REPORT_PATH="$C6064_STATE/webkit-repeats.json" pnpm exec playwright test --config docs/design/evidence/runtime-activity-6064-2026-11-12/repair/qualification.playwright.ts --project webkit-6064 --grep 'lazy output|stationary press' --repeat-each 10
qrun env NOVA6064_HEAD="$(git rev-parse HEAD)" C6064_REPORT_PATH="$C6064_STATE/real-server.json" node --experimental-strip-types --import ./scripts/test-alias-register.mjs docs/design/evidence/runtime-activity-6064-2026-11-12/repair/live-server-probe.mjs
```

The unit launcher deliberately leaves home and port selection to tests that vary those settings; pinning the application override made otherwise valid tests fail. Browser dependencies must already be installed for the executing account, or `PLAYWRIGHT_BROWSERS_PATH` must point to its known local browser cache. The original run used Chromium 1234 and WebKit 2336 from the host cache. Never share another worktree's `node_modules` by symlink.

The ABBA measurement uses the same `--grep 'large trace production measurements'` command on the ac704 source archive and candidate, in baseline/candidate/candidate/baseline order, with ports 3166/3164/3164/3166 and a distinct JSON report per invocation. Both source trees use the identical acceptance spec hash recorded in `matched-trace-measurements.json`; only production application source differs. Build each tree before measuring. The original source archive had an independent APFS dependency clone and was not a competing Git worktree.

Native resource generation used `pnpm mobile:ios:xcodegen`. The exact selected Debug command is below; the simulator ID is the existing Nova-owned unit, not permission to reuse any other device. Retain a new result path per invocation. The first unsigned attempt failed Keychain entitlement checks; ad-hoc signing was used thereafter without weakening app storage or tests.

```sh
xcodebuild test -project apps/ios/CovenCave/CovenCave.xcodeproj -scheme CovenCave -destination 'platform=iOS Simulator,id=64878DF0-DB73-45A9-8D68-3F22393F7D64' -derivedDataPath /private/tmp/nova6064-20261112/derived-data -resultBundlePath /private/tmp/nova6064-20261112/native-output-byte-exact-final.xcresult -parallel-testing-enabled NO -only-testing:CovenCaveTests/ToolOutputTests -only-testing:CovenCaveUITests/AgentActivityUITests/testToolOutputCanBeOpenedAndDismissed -only-testing:CovenCaveUITests/AgentActivityUITests/testDeniedToolOutputNeverShowsServerErrorBody -only-testing:CovenCaveUITests/AgentActivityUITests/testToolOutputClearsWhenBackgroundedAndCanBeLoadedAgain -only-testing:CovenCaveUITests/AgentActivityUITests/testOversizedToolOutputIsExplicitlyWithheldAndSheetRemainsResponsive -only-testing:CovenCaveUITests/AgentActivityUITests/testDeepToolOutputEnvelopeIsWithheldAndSheetRemainsResponsive -only-testing:CovenCaveUITests/AgentActivityUITests/testAtLimitDeepToolOutputRendersVerbatimAndSheetRemainsResponsive CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-
xcrun xcresulttool get test-results summary --path /private/tmp/nova6064-20261112/native-output-byte-exact-final.xcresult --compact
xcrun xcresulttool export attachments --path /private/tmp/nova6064-20261112/native-output-byte-exact-final.xcresult --output-path /private/tmp/nova6064-20261112/native-output-byte-exact-final-attachments
```

Release render/scroll journeys use the `CovenCavePerformance` scheme and selectors `CovenCaveUITests/PerformanceBaselineUITests/testRetainedRichChronologicalTimelineRenderJourney` and `CovenCaveUITests/PerformanceBaselineUITests/testRetainedRichTimelinePreservesEarlierToolThroughScrolling`. That scheme enables the existing offline performance fixture, not a real provider. Actual app recorder exports, source hashes and executable/dylib hashes accompany the native receipts. The Debug-only output transport fixture does not qualify a physical Release device or live provider.

The local package was built with the alternate qualification config, ad-hoc identity, preserved Rust toolchain cache and scratch app homes. Its exact original command was `pnpm exec tauri build --bundles app --config artifacts/nova6064/tauri.qualify.json`; the durable equivalent config is [tauri.qualify.json](tauri.qualify.json). `build.devUrl` is explicitly null and updater endpoints/artifact creation are disabled. The first Debug startup mistake and controller stdin EIO are retained; the exact owned processes and scratch roots were cleaned up. The package build and HTTP probe do not bypass the unresolved Computer Use app permission or establish rendered UI acceptance.
