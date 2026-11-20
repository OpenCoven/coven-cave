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

Confirmation uses `PUT /api/projects/[id]` with `{ "confirmRoot": true }` on its own. It rejects familiar-relayed approval fields and mobile ingress, including a paired phone allowed to mutate ordinary grants. On macOS it invokes the bundled LocalAuthentication helper for a fresh Touch ID-only ceremony naming the project and resolved directory. No password or Apple Watch fallback, approval boolean, reusable token, environment override, or localhost request can replace that ceremony. Confirmation applies the same boundary as registration: if the folder now resolves to the home folder itself or the top of a drive, it is refused with `403 PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE` before any prompt, and that check repeats under the registry lock. A concurrent folder or registry change invalidates the approval before the pin is saved under the registry lock. Root edits (`PATCH`, or the existing `PUT` contract with `root`) require the same authentication so they cannot bypass confirmation by re-pinning.

The helper is built by `pnpm build`, and `scripts/sidecar-bundle.sh` copies it to `resources/server/native/confirm-project-folder` in the packaged app. It does not compile code at runtime. Declined or timed-out authentication returns `403 project_folder_authentication_required`, which asks the person to retry. When no prompt can appear (not macOS, no bundled helper, or no usable Touch ID), the request returns `409 project_folder_authentication_unavailable` and says so, instead of asking for a retry. Both fail closed. Native confirmation on Windows and Linux is not implemented; those platforms, and Macs without Touch ID, cannot confirm legacy records or edit roots until an equivalent native authenticator is supplied. A project removed and added again is pinned at registration. Existing pinned registrations remain launchable there when their directory and grant checks pass.

Projects from before pinning remain unconfirmed until a person completes this action. No startup migration or first-use adoption writes a pin. Chat offers **Open projects**, voice returns the same launch codes, and iOS reopens project selection. Human visual acceptance, actual authentication, and packaged-app qualification are recorded separately from automated tests.
## Folders that hold Cave's private state

Cave keeps each Claude turn's authority files in `claude-authority` inside
Cave's home, beside the grants file. These are scope files and MCP configs,
which can hold server credentials. A familiar can't get Write access to a
folder that holds that folder or sits inside it (#6451). Write there would let
it change its own grants or read another turn's credentials.

- The grants store refuses new Write access to such a project with 409
  `cave_private_state_write`. That covers direct grants, access-group grants,
  adding a member to a group that holds such a grant, and Supreme's proposals
  and their acceptance. The bootstrap grant gives Read instead.
- Read access, downgrades, removals and unrelated group edits still work.
  Folders elsewhere in Cave's home, such as Research Missions, aren't affected.
- Paths are compared on disk, through links and letter case, the same way a
  Claude turn compares them. A link whose target doesn't exist yet is followed
  to where it points: the private state folder isn't created until the first
  Claude turn. A folder behind links that can't be resolved counts as
  overlapping.
- `PUT /api/projects/[id]` refuses, with the same 409, a root change that
  would move a project onto the private state while anyone can write to it:
  a direct Write grant, an access group's Write grant, or an accepted Write
  request still inside its undo window. Narrow that access to Read first.
- Each grant change reads the project registry and saves the grants under one
  lock (registry, then grants), and a root change takes the same lock. A
  folder can't move between a check and the write that relied on it.
- A request accepted before this rule, whose undo window has passed, was
  already a Write grant on every read. It stays one and is flagged like any
  other existing grant. Finalizing a request doesn't check the folder again.
- The supreme familiar gets no project access beyond its real grants, and
  Projects shows and changes those like any other familiar's (#6473).
- `GET /api/project-grants` lists such projects in `privateStateProjectIds`.
  Projects and Access groups flag a Write grant made before this rule. Nothing
  changes that grant automatically.
- A Claude turn in Full access that could write to such a folder is refused
  with 409 `scoped_write_unavailable` and `reason: "cave_private_state_overlap"`.
  Its `overlap` names the project and folder, and says whether the access comes
  from the familiar's own grant, access groups, its workspace or the chat's
  folder. Chat shows that message and offers **Open projects**, which opens
  the Access pane for the chat's familiar with the project in view. Projects
  replaces the chat, so the refused message goes back in the composer;
  attachments aren't carried.
- Other harnesses aren't checked when a turn starts. An existing Write grant
  can still reach Codex and the others through `--add-dir`, so narrow it in
  Projects.
