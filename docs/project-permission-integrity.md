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

A grant authorizes a project ID, and Chat's launch gate resolves the requested
root through symlinks. On its own, that let a familiar that can write to a
registered root's parent replace the folder with a symlink and carry the
project's grant to any directory (#6215).

Each project record therefore carries `rootRealpath`: the folder a person
pinned it to, as the root's realpath in on-disk letter case. The project store
computes it, and a request body can never supply one. Three local-only actions
set it:

- registering the folder (`POST /api/projects`);
- an applied root change (`PUT /api/projects/[id]` with `root`);
- **Confirm folder** in project settings (`PUT /api/projects/[id]` with
  `{ "confirmRoot": true }`, sent on its own).

`authorizeChatProjectLaunch` checks the pin after the grant, so a familiar
without a grant learns nothing about the folder:

- a project with no pin is refused with `409 project_root_unconfirmed`;
- a launch root that resolves outside the pin is refused with
  `409 project_root_moved`.

A `.worktrees/` checkout or Board task worktree sits inside its project's
folder, so it follows the same pin. The pin is never re-resolved at launch,
because that would follow a swapped symlink too. `project.root` is never
rewritten, so client stores keyed by root keep their keys.

### Upgrade behavior

Projects registered before pinning have no `rootRealpath`. Chat refuses them
until a person confirms each folder once in project settings. This was chosen
over trusting the first launch, which would silently pin a redirect already in
place. Typed Chat shows the server's message with an **Open projects** action.
Voice and Board chat surface the same codes, and iOS reopens project selection.
