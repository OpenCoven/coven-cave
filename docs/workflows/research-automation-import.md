# Explicit Research automation import

Research scheduling, reconciliation and cancellation use Coven definitions. A missing legacy definition produces `research-automation-import-required`; ordinary operations never read the legacy directory. The core local-only `POST /api/research-automation-import` endpoint provides a selected-source migration for a complete, unambiguous existing mission link. It does not repair deprecated-only or conflicting links, start a job, or change a mission's ID.

Send a preview request with the original automation ID, existing mission ID and explicitly chosen IANA timezone:

```json
{"action":"preview","id":"original-automation-id","missionId":"existing-mission-id","timezone":"America/Chicago"}
```

Preview reads only the selected `~/.codex/automations/<id>/automation.toml`, parses it strictly, and persists a private review plan under Cave's home. Review the returned `input`, source status, timezone and deliberately `PAUSED` target. It preserves name, prompt, one cwd, one familiar, model and tags. The source must have exactly one matching `research-mission:<missionId>` tag. Only daily or weekly schedules with explicit hours and weekly days are mapped; minute zero is equivalent to Coven's on-hour schedule. Unknown fields, unsupported execution options, multiple bindings, malformed data and source links are refused. Preview does not dispatch a daemon command.

After reviewing that exact plan, apply only its returned ID:

```json
{"action":"apply","planId":"<64-character SHA256 plan ID>"}
```

Apply rechecks the source digest and plan integrity, then uses the typed SDK to create the original ID and revise it into a paused definition. It records source provenance through `provenance.importedFrom`; this is a definition creation, not a producer `definition.imported` event. Existing or tombstoned IDs cannot be overwritten. Source bytes remain unchanged. If the response is uncertain, retry the same saved plan; do not invent another identity. Changed source requires a fresh preview and review.

Once the original ID exists in Coven, Research reconciliation refreshes the existing complete mission link from its canonical status, schedule and revision. Cancellation of an already-paused import sends no redundant pause command. Activation remains a separate explicit action with a reviewed revision. The package path requires Research host contract v2 and a published compatible package; fixture or canary success does not establish released-package consumption.
