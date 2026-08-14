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

Ordinary permission-store loads recognize only exact historical v1 and
pre-generation v2 schemas. They atomically rewrite either valid shape to the
current v2 format, preserving v1 binary grants and proposals as `write`
authority and assigning one durable visibility generation. This works after a
restart or a cave-home move by another process; concurrent readers serialize
through the authorization lock and observe the same persisted generation.

Malformed historical shapes are never repaired automatically and fail closed
without changing their bytes. Best-effort normalization is reserved for an
explicit **recover legacy** resolution, which is the only recovery authority
that permits it. Separately, stale records remain inspectable without mutation:
an authorized person can review them in Projects and choose **Repair stale
permissions**. If no action is taken, server-side chat launch remains
fail-closed: a session still cannot start without an authorized, registered
project root.
