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

## Release information and browser recovery

The release manifest includes GitHub's release body as optional `notes`. The
native updater exposes this as `Update.body`; the fallback release API carries
it as optional `notes`. Existing releases without notes remain usable. Empty or
non-string fallback notes are omitted without changing update availability.

Available updates expose **Release notes** in the shell banner and Settings →
About. Notes are escaped plain text in a keyboard-accessible, scrollable
disclosure; Markdown and HTML are not executed. They belong to the reported
version and are replaced by a successful new check.

Updater release-page and installer actions open the operating system's default
browser. A failed native handoff or blocked browser popup shows a warning with
**Retry** and a selectable address under **Details**; it does not silently open
Cave's embedded Browser. After a signed-updater failure, recovery still uses the
canonical GitHub release page, never a metadata-derived direct installer link.
Download verification and explicit **Restart & install** consent are unchanged.

This change does not implement supervisor cooldown recovery, generation deletion,
MSI installation mode changes or declined-UAC recovery. Those remain under #5981
with their policy and real-Windows acceptance requirements. The automated browser
and IPC fixtures do not qualify the real Windows installer or default browser.
Rollback is a revert of this slice; no stored-data migration is required.
