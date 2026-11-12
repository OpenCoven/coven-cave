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
  Claude turn compares them.
- `GET /api/project-grants` lists such projects in `privateStateProjectIds`.
  Projects and Access groups flag a Write grant made before this rule. Nothing
  changes that grant automatically.
- A Claude turn in Full access that could write to such a folder is refused
  with 409 `scoped_write_unavailable` and `reason: "cave_private_state_overlap"`.
  Its `overlap` names the project and folder, and says whether the access comes
  from the familiar's own grant, access groups, its workspace or the chat's
  folder. Chat shows that message and offers **Open projects**.
- Other harnesses aren't checked when a turn starts. An existing Write grant
  can still reach Codex and the others through `--add-dir`, so narrow it in
  Projects.
