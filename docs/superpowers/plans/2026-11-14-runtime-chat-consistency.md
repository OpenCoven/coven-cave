# Port 3000 runtime and Chat context consistency

User scope: repair the runtime failure on port 3000 and make Chat's project/familiar switches match the other pages. One additional worktree is explicitly approved. Val subsequently authorized commit, push and protected merge to main on 2026-11-14; release and installed-app replacement remain outside scope. Issues: #6493 and #6495.

Implementation choice: finish runtime binary discovery before bounded adapter/version probes start. Probe the cached PATH first, refresh it asynchronously once when any optional binary is absent, and share the refreshed answer across all missing binaries. Keep the existing preflight deadlines and credential boundaries. This avoids both synchronous refresh starvation and synchronous consumers encountering an invalidated cache during a concurrent refresh.

Implementation choice: use the existing workspace project and familiar scope for Chat's existing shared controls. Preserve the active conversation and draft; browsing another scope must not silently rebind or replace that conversation. Use the same project crew and loading/error rules as the other pages, with server authorization unchanged.

Checkbox state is not evidence of completion. Verification receipts and observed results determine completion.

- [x] Reproduce the runtime discovery failure with a real bounded adapter subprocess while optional runtimes are missing.
- [x] Replace repeated blocking refreshes with one asynchronous discovery phase; verify late-installed CLI recovery and absent-CLI reporting.
- [x] Reproduce Chat/Tasks selection divergence and wire both to the same workspace state, preserving established conversation identity and draft.
- [x] Run focused app contracts, type/lint/token gates, browser checks for desktop/narrow/themes/keyboard, and test wiring.
- [x] Serve the qualified worktree on port 3000 and verify its live Codex availability without a provider call; preserve the original shared checkout and installed app.
