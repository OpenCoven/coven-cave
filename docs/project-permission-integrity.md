# Project permission integrity

## Why this exists

Project access is authorized by a registered project ID. Older local state can
contain direct grants, access-group grants, or pending proposals for a project
that has since been removed from the registry. Those records are no longer a
valid authority boundary and must not be silently treated as access.

## Detection and repair

`GET /api/project-grants` includes a read-only `integrity` report with counts
for stale direct grants, group grants, proposals, and their orphan project IDs.
The Chat → Projects screen presents a repair action only when that report is
non-empty.

Repair requires an explicit local human confirmation. `POST /api/project-grants`
with `{ "repairOrphans": true }` removes only records whose project ID is no
longer registered. It never creates a project, grants a permission, or changes
a valid record. The permission store writes a timestamped repair-audit entry,
so the operation is reviewable and safe to retry after interruption.

## Upgrade behavior

No startup migration runs automatically. On upgrade, existing permission data
is inspected without mutation. If stale records are present, an authorized
person can review the count in Projects and choose **Repair stale permissions**.
If no action is taken, server-side chat launch remains fail-closed: a session
still cannot start without an authorized, registered project root.

## Pinned project folders

Each project carries `rootRealpath`, the directory identity saved at registration, a root edit, or an explicit **Confirm folder** action (#6215). Request bodies cannot supply this pin. `project.root` and client stores keyed by it are preserved.

The shared typed/voice/Board launch gate checks the familiar’s grant first, then refuses an unconfirmed project with `409 project_root_unconfirmed` or a changed registered directory with `409 project_root_moved`. The registered directory must still equal its saved realpath; legitimate worktrees may run inside that unchanged directory. Canonical project lookup uses the saved pin, including for resumed and hidden-generation turns. Forwarded grants use confirmed canonical roots, and launch rechecks those roots before dispatch, spawn, and retries.

Confirmation uses `PUT /api/projects/[id]` with `{ "confirmRoot": true }` on its own. It rejects familiar-relayed approval fields and mobile ingress, including a paired phone allowed to mutate ordinary grants. On macOS it invokes the bundled LocalAuthentication helper for a fresh Touch ID or Mac-password ceremony naming the project and resolved directory. No approval boolean, reusable token, environment override, or localhost request can replace that ceremony. A concurrent folder or registry change invalidates the approval before the pin is saved under the registry lock. Root edits (`PATCH`, or the existing `PUT` contract with `root`) require the same authentication so they cannot bypass confirmation by re-pinning.

The helper is built by `pnpm build` and included in the standalone server’s project-route trace. It does not compile code at runtime. Missing helpers, failed/cancelled authentication, and unsupported operating systems fail closed. Native confirmation on Windows and Linux is not implemented by this change; those platforms cannot confirm legacy records or edit roots until an equivalent native authenticator is supplied. Existing pinned registrations remain launchable there when their directory and grant checks pass.

Projects from before pinning remain unconfirmed until a person completes this action. No startup migration or first-use adoption writes a pin. Chat offers **Open projects**, voice returns the same launch codes, and iOS reopens project selection. Human visual acceptance, actual authentication, and packaged-app qualification are recorded separately from automated tests.
