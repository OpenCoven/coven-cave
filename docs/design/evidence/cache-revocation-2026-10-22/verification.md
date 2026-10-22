# Verification commands and attempt history

Run from the issue-owned worktree. Runtime receipts use isolated fixture homes and sockets; do not point these commands at an installed daemon or real user storage.

Focused tests use `nodeArgsFor(file)` exported by `scripts/run-tests.mjs`, executed with `spawnSync(process.execPath, nodeArgsFor(file), {stdio: "inherit", env: process.env})`; preserve the child exit status. This retains the repository alias/CSS hooks required by individual files.

The ordinary gates are `pnpm check:tests-wired`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test:app` and `pnpm test:api`. Production browser qualification uses `CI=true COVEN_CAVE_PORT=49900 pnpm exec playwright test tests/chat-activity-acceptance.spec.ts --project=desktop --workers=1 --retries=0 --reporter=line`, with scratch `COVEN_HOME`, `COVEN_SOCKET` and `COVEN_CAVE_HOME`. Its configured web server rebuilds the production app before serving it.

The app suite first stopped because a fixed `COVEN_CAVE_HOME` overrode a fixture's own `COVEN_HOME`; that override was removed. Attempt two exposed the existing deletion source assertion, which was updated to require both cache and access invalidation. Attempt three exposed shared scratch travel-queue state; the unchanged travel test passed in fresh scratch. Attempt four used the hook below to isolate each test process's storage while keeping every test, assertion, argument and exit status. It then stopped after 634 passing files on ChatView source assertions expecting the old chunk/catch layout. Those assertions now require the revocation guard and preserve coalescing order and bounded error checks; they pass in the focused run. Attempt five included that correction and passed 1282 files before the cave-config fixture expected its own HOME-derived state path. That test explicitly creates a temporary HOME before importing product modules, but inherited COVEN_HOME took precedence. The verification hook now removes COVEN_HOME only for that fixture, preserving its existing isolation contract; the unchanged fixture passed in isolation. Attempt six used that correction and reached 1283 files before the next HOME-owned config compatibility fixture exposed the same override. A source audit of the remaining suites identified 14 temporary-HOME fixtures, including config, familiar-contract, voice and memory tests. All 14 passed unchanged when their own HOME-derived storage was honored; the explicit list is in the hook below. Attempt seven uses the audited environment.

The API suite first rejected a scratch socket name lacking the established `.coven/coven.sock` convention. Attempt two, with that convention, stopped after 280 passing files on `ENOTEMPTY` while an OpenClaw integration fixture removed its temporary directory. That unchanged test passed in isolation. Attempt three uses the same per-child isolation as the app suite; this does not establish a causal fix for the fixture cleanup race. Attempt three passed the OpenClaw fixture and stopped after 356 files when the board fs.watch integration did not report its event within its existing 400ms assertion. The unchanged test passed in isolation. Attempt four runs after production build/browser qualification has finished; no sleep or automatic test retry was added. Attempt four passed the watcher and stopped after 367 files on the familiar-contract fixture, which has the same temporary-HOME contract. It passed in the 14-fixture audit; attempt five uses that audited environment.

Final review added the durable-only 404 repair: after a window restart, authoritative absence now blocks and purges the durable copy while preserving the shared network promise and unsaved live owner. The controlled IPC test first needed complete browser perf globals and an explicit purge-completion signal. The corrected test was then run against the pre-repair adapter and failed on the retained durable payload; the repaired adapter passes all four source cases. These are IPC-controlled assertions, not packaged native restart proof.

History-loader and adapter lint restrictions were preserved by injecting the invalidation subscription from ChatView. The initial failing lint runs are retained. No gate was suppressed and no test sleep or retry was added. The separately added policy-publisher integration assertion passes against unchanged production source.

For broad suites, save the following hook in the worktree's ignored evidence directory and set `NODE_OPTIONS="${NODE_OPTIONS:-} --require=$PWD/.tmp/issue-5764-evidence/isolate-suite-state.cjs"`, along with a scratch `COVEN_HOME` and conventional scratch socket, before `pnpm test:app` or `pnpm test:api`. It modifies only runner child environments; fixtures that set their own homes retain that control. `HOME` stays unchanged.

```javascript
// Verification-only storage isolation. Preserve every selected test, argument,
// assertion and exit status; give each runner child its own scratch store.
const path = require('node:path');
if (process.argv[1] && path.basename(process.argv[1]) === 'run-tests.mjs') {
  const fs = require('node:fs');
  const cp = require('node:child_process');
  const original = cp.spawnSync;
  const root = path.resolve('.tmp/issue-5764-suite-state');
  fs.mkdirSync(root, { recursive: true });
  cp.spawnSync = function(command, args, options = {}) {
    const taskRoot = fs.mkdtempSync(path.join(root, 'case-'));
    const covenRoot = path.join(taskRoot, '.coven');
    fs.mkdirSync(covenRoot);
    const env = { ...(options.env || process.env), COVEN_HOME: covenRoot, COVEN_SOCKET: path.join(covenRoot, 'coven.sock') };
    // Tests that nominate their own COVEN_HOME must retain the normal derived
    // caveHome contract. Effective Cave storage remains inside scratch state.
    delete env.COVEN_CAVE_HOME;
    // Audited fixtures create a temporary HOME before importing storage modules.
    // Do not override that existing isolation contract with COVEN_HOME.
    const ownsTemporaryHome = new Set([
      "src/lib/cave-config.test.ts",
      "src/lib/cave-config-compatibility.test.ts",
      "src/lib/cave-config-state-race.test.ts",
      "src/lib/cave-config-write-race.test.ts",
      "src/lib/cave-board-schedule.test.ts",
      "src/lib/server/familiar-contract-context.test.ts",
      "src/lib/voice/hydrate-instructions.test.ts",
      "src/lib/voice/append-voice-turn.test.ts",
      "src/app/api/voice/session/route.test.ts",
      "src/app/api/voice/preview/route.test.ts",
      "src/app/api/voice/transcript/route.test.ts",
      "src/lib/server/memory-file-inventory.test.ts",
      "src/app/api/memory-coven-workspaces.test.ts",
      "src/app/api/memory-mutation-routes.test.ts"
]);
    if (args.some(file => ownsTemporaryHome.has(file))) delete env.COVEN_HOME;
    fs.appendFileSync(path.join(root, 'invocations.jsonl'), JSON.stringify({ command, args, covenRoot }) + '\n');
    return original.call(this, command, args, { ...options, env });
  };
  require('node:module').syncBuiltinESMExports();
}
```

Real-client recovery runs `node --experimental-strip-types --import ./scripts/test-alias-register.mjs scripts/runtime-activity-client-fixture.mjs --execute <new-absolute-evidence-directory> reconnect`; the separate browser receipt records one send and the release/drop/complete/snapshot/finish sequence. Managed-device revocation and replay expiry use `node --experimental-strip-types --import ./scripts/test-alias-register.mjs scripts/runtime-activity-effect-recovery.mjs --execute --evidence <new-absolute-evidence-directory> --include-expiry`. The configured expiry wait is scenario behavior, not a test retry.

[Attempt hashes](attempt-log-hashes.json) identify retained local failures and diagnostic logs. Sanitized scenario receipts and the qualification manifest distinguish exact production-build evidence from test-only updates and incomplete gates.

Final aggregate results: app attempt seven passed all 1,476 files; API attempt five passed all 538 files. Both used the audited wrapper above. The final production source/build was unchanged throughout these runs.
