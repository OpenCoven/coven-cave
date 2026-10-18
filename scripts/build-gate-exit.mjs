// The exit status of a deterministic build-gate failure (#6087).
//
// CI, full validation and the release build retry `pnpm build` for Turbopack
// flakes (scripts/build-with-retry.mjs). A gate that measures the build output
// fails the same way on every attempt, so it exits with this status instead of
// 1 and the retry stops at once. The gates are the instrumentation-trace leak
// guard (scripts/next-build.mjs), bundle-budget and standalone-budget. A gate
// that could not read or measure the output still exits 1: that can be a flaky
// build, and a retry may succeed.
//
// 78 is EX_CONFIG in sysexits(3). Node, `next build` and pnpm never exit with
// it on their own, and pnpm passes a script's status through unchanged.
export const BUILD_GATE_EXIT_CODE = 78;
