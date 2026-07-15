# Windows update preparation and first launch

The desktop updater separates preparation from installation:

1. `Update.download()` downloads the signed updater artifact while the current app remains usable.
2. The updater verifies the artifact signature before the promise resolves. The UI reports this as a separate verification phase and does not show the update as ready beforehand.
3. The user explicitly selects **Restart & install**. On Windows, the updater starts `msiexec`, exits CovenCave, and the MSI relaunches the new version.
4. The new version immediately paints the bundled `startup.html` page. Runtime verification/extraction and sidecar startup run on a worker thread. The page reports preparation, service startup, readiness, diagnostics, cancellation where safe, and retry.

Prepared sidecar caches are reused by the existing archive marker checks. A failed or cancelled startup leaves a complete prepared cache intact, and stale-cache cleanup still retains the previous complete runtime for rollback.

## Updater constraints

Tauri updater 2.10.1 keeps the downloaded MSI in a native in-memory resource. It does not expose its bytes or a network abort handle to application JavaScript. The MSI is also opaque until installation. Therefore:

- cancellation during download is cooperative: the current app stays usable, the request is allowed to settle, and the native bytes are released without installing;
- CovenCave cannot safely pre-extract the next sidecar from the MSI before restart;
- true cross-version sidecar prewarming would require publishing a separately signed runtime asset and is intentionally outside this independently mergeable change.

The first-launch page permits cancellation only after the non-interruptible archive operation completes. Cancelling during sidecar readiness stops and reaps the process tree. Retry reuses any complete prepared cache.

## Verification

The release-runtime test asserts that Windows creates the local startup window before dispatching background preparation. Rust unit tests cover progress serialization, duplicate-worker prevention, cancellation reset, loopback-only quick chat navigation, and cancellable readiness polling. The update test uses a mocked native updater to verify that preparation never installs, signature verification remains distinct from download progress, and cancellation releases the prepared resource exactly once.
