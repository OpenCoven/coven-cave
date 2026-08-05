# Sidecar Startup Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make packaged non-Windows desktop startup tolerate realistic cold starts, isolate each launch's readiness evidence, and reap the Node child before a fatal startup exit.

**Architecture:** Add small sidecar lifecycle helpers rather than broad single-instance coordination. `sidecar_startup.rs` will own per-launch log naming and platform timeout selection; `SidecarState` will own failure cleanup and diagnostic composition; `tauri_setup.rs` will invoke that cleanup before `fatal_exit`.

**Tech Stack:** Rust 2021, Tauri 2, Node.js source-contract tests.

---

## File Map

- Modify `src-tauri/src/sidecar_startup.rs`: generate isolated log paths and use a 60-second non-Windows readiness timeout.
- Modify `src-tauri/src/sidecar_lifecycle.rs`: compose startup errors while stopping and reaping an owned child.
- Modify `src-tauri/src/tauri_setup.rs`: route synchronous startup failures through lifecycle cleanup before fatal exit.
- Modify `src-tauri/src/app_lifecycle_tests.rs`: cover log isolation, timeout selection, and failed-start child cleanup.
- Modify `scripts/desktop-reachability.test.mjs`: pin the cleanup-before-fatal source contract.

### Task 1: Isolate each launch log

**Files:**
- Modify: `src-tauri/src/sidecar_startup.rs:47-70,179-214`
- Test: `src-tauri/src/app_lifecycle_tests.rs:205-250`

- [ ] **Step 1: Write the failing log-path test**

Add this test before `sidecar_port_wait_is_cancellable_and_detects_readiness`:

```rust
#[test]
fn sidecar_log_paths_are_isolated_by_process_and_port() {
    let log_dir = std::env::temp_dir().join("covencave-sidecar-log-path-test");
    let first = sidecar_log_path(&log_dir, 41001);
    let second = sidecar_log_path(&log_dir, 41002);

    assert_ne!(first, second);
    let expected = format!("sidecar-{}-41001.log", std::process::id());
    assert_eq!(first.file_name().and_then(|name| name.to_str()), Some(expected.as_str()));
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib app_lifecycle_tests::sidecar_log_paths_are_isolated_by_process_and_port -- --exact --nocapture
```

Expected: compilation fails because `sidecar_log_path` is not defined.

- [ ] **Step 3: Add the log-path helper and use it**

In `src-tauri/src/sidecar_startup.rs`, add:

```rust
#[cfg(desktop)]
pub(super) fn sidecar_log_path(log_dir: &Path, port: u16) -> PathBuf {
    log_dir.join(format!(
        "sidecar-{}-{port}.log",
        std::process::id()
    ))
}
```

Replace:

```rust
let log_path = log_dir.join("sidecar.log");
```

with:

```rust
let log_path = sidecar_log_path(&log_dir, port);
```

Keep `File::create` so a retried launch with the same process and selected port
still starts from a fresh file.

- [ ] **Step 4: Run the isolated-log and readiness tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib app_lifecycle_tests::sidecar_ -- --nocapture
```

Expected: the new path test and the existing exact-marker/listening-port test pass.

### Task 2: Allow a realistic non-Windows cold start

**Files:**
- Modify: `src-tauri/src/sidecar_startup.rs:356-362`
- Test: `src-tauri/src/app_lifecycle_tests.rs`

- [ ] **Step 1: Write the failing timeout test**

Add:

```rust
#[cfg(not(target_os = "windows"))]
#[test]
fn packaged_sidecar_start_timeout_allows_slow_cold_start() {
    assert_eq!(sidecar_start_timeout(), Duration::from_secs(60));
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib app_lifecycle_tests::packaged_sidecar_start_timeout_allows_slow_cold_start -- --exact --nocapture
```

Expected: compilation fails because `sidecar_start_timeout` is not defined.

- [ ] **Step 3: Extract platform timeout selection**

Add to `src-tauri/src/sidecar_startup.rs`:

```rust
#[cfg(desktop)]
pub(super) fn sidecar_start_timeout() -> Duration {
    if cfg!(target_os = "windows") {
        Duration::from_secs(90)
    } else {
        Duration::from_secs(60)
    }
}
```

Replace the inline conditional with:

```rust
let sidecar_start_timeout = sidecar_start_timeout();
```

- [ ] **Step 4: Run the timeout and readiness tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib app_lifecycle_tests::sidecar_ -- --nocapture
```

Expected: all matching lifecycle tests pass; the readiness check still requires
both the exact log marker and a successful loopback connection.

### Task 3: Reap a child before fatal startup exit

**Files:**
- Modify: `src-tauri/src/sidecar_lifecycle.rs:228-251`
- Modify: `src-tauri/src/tauri_setup.rs:357-365`
- Test: `src-tauri/src/app_lifecycle_tests.rs:404-432`
- Test: `scripts/desktop-reachability.test.mjs:120-165`

- [ ] **Step 1: Write the failing lifecycle test**

Add beside the existing cleanup-guard test:

```rust
#[cfg(not(target_os = "windows"))]
#[test]
fn startup_failure_stops_and_reaps_owned_sidecar() {
    let child = Command::new("sleep")
        .arg("30")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn startup failure fixture");
    let slot = Arc::new(Mutex::new(Some(SidecarProcess::new(child))));
    let state = SidecarState(Arc::clone(&slot));

    let message = state.stop_after_startup_error("startup timed out".to_string());

    assert_eq!(message, "startup timed out");
    assert!(slot.lock().expect("sidecar slot").is_none());
}
```

- [ ] **Step 2: Add the failing source-contract assertion**

In `scripts/desktop-reachability.test.mjs`, add:

```ts
assert.match(
  setup,
  /stop_after_startup_error\(error\)[\s\S]*fatal_exit\(&error\)/,
  "Non-Windows startup failure should reap the owned sidecar before fatal exit",
);
```

- [ ] **Step 3: Run both tests and confirm they fail**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib app_lifecycle_tests::startup_failure_stops_and_reaps_owned_sidecar -- --exact --nocapture
node scripts/desktop-reachability.test.mjs
```

Expected: Rust compilation fails because `stop_after_startup_error` is missing,
and the source-contract test fails because `tauri_setup.rs` calls `fatal_exit`
directly.

- [ ] **Step 4: Implement lifecycle-owned failure cleanup**

Add to `impl SidecarState` in `src-tauri/src/sidecar_lifecycle.rs`:

```rust
pub(super) fn stop_after_startup_error(&self, error: String) -> String {
    match self.stop() {
        Ok(()) => error,
        Err(cleanup_error) => {
            format!("{error}\n\nSidecar cleanup also failed: {cleanup_error}")
        }
    }
}
```

This keeps the startup failure primary and appends cleanup evidence without
silently discarding it.

- [ ] **Step 5: Use cleanup before non-Windows fatal exit**

Change the synchronous non-Windows branch in `src-tauri/src/tauri_setup.rs` to:

```rust
let sidecar_url = match start_sidecar_runtime(app.handle(), |_| {}, || false) {
    Ok(url) => url,
    Err(SidecarStartError::Cancelled) => {
        let error = app
            .state::<SidecarState>()
            .stop_after_startup_error("sidecar startup was cancelled".to_string());
        fatal_exit(&error)
    }
    Err(SidecarStartError::Failed(error)) => {
        let error = app
            .state::<SidecarState>()
            .stop_after_startup_error(error);
        fatal_exit(&error)
    }
};
```

- [ ] **Step 6: Run focused cleanup tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib app_lifecycle_tests::startup_failure_stops_and_reaps_owned_sidecar -- --exact --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib app_lifecycle_tests::dropping_application_cleanup_guard_stops_and_reaps_sidecar -- --exact --nocapture
node scripts/desktop-reachability.test.mjs
```

Expected: all three commands pass.

### Task 4: Validate the integrated startup behavior

**Files:**
- Verify: `src-tauri/src/sidecar_startup.rs`
- Verify: `src-tauri/src/sidecar_lifecycle.rs`
- Verify: `src-tauri/src/tauri_setup.rs`
- Verify: `src-tauri/src/app_lifecycle_tests.rs`
- Verify: `scripts/desktop-reachability.test.mjs`
- Verify: `docs/superpowers/specs/2026-08-05-sidecar-startup-recovery-design.md`

- [ ] **Step 1: Format Rust changes**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

If it reports formatting differences, run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
```

Then rerun the check. Expected: success with no output.

- [ ] **Step 2: Run the complete Rust lifecycle test module**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib app_lifecycle_tests -- --nocapture
```

Expected: all platform-applicable lifecycle tests pass.

- [ ] **Step 3: Run sidecar source-contract tests**

Run:

```bash
node scripts/desktop-reachability.test.mjs
```

Expected: the command exits successfully.

- [ ] **Step 4: Run the Rust compile gate**

Run:

```bash
cargo check --manifest-path src-tauri/Cargo.toml --locked
```

Expected: compilation succeeds.

- [ ] **Step 5: Inspect the scoped diff**

Run:

```bash
git status --short
git --no-pager diff --check
git --no-pager diff -- src-tauri/src/sidecar_startup.rs src-tauri/src/sidecar_lifecycle.rs src-tauri/src/tauri_setup.rs src-tauri/src/app_lifecycle_tests.rs scripts/desktop-reachability.test.mjs docs/superpowers/specs/2026-08-05-sidecar-startup-recovery-design.md docs/superpowers/plans/2026-08-05-sidecar-startup-recovery.md
```

Expected: only the planned files are changed and `git diff --check` reports no
whitespace errors.

## Repository Handoff

Do not commit or push without explicit authority under the repository's
conservative Beads profile. Record the branch, worktree, session, and validation
evidence on `cave-vw6jo` before handoff.
