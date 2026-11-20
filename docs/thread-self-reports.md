# Thread self-reports

**Living.** The self-report write boundary is owned by
[`POST /api/familiars/[id]/self-report`](../src/app/api/familiars/[id]/self-report/route.ts).
Reports remain append-only JSONL under the familiar workspace. No migration is
required for ownership and automatic duplicate admission (#5917).

The request supplies a session ID, `auto`, `manual`, or `periodic` trigger,
and raw report payload. Cave resolves the local conversation's familiar first,
then its persisted `sessionFamiliar` mapping if local ownership is absent.
Missing or different ownership returns HTTP 403 before report persistence or
archive operations. Daemon metadata alone is not ownership evidence.

Automatic writes check for any existing report for the same familiar and
session under the same process-intent lock used by every report writer.
An existing report returns HTTP 409 with
`{ "ok": false, "error": "duplicate_auto_report" }` and produces no report,
metric snapshot, or archive action. An unreadable ledger prevents automatic
admission; ordinary listing retains its tolerant historical-file behavior.
Manual and periodic reports remain repeatable. In a manual/automatic race,
lock order determines whether the automatic report is admitted; the manual
report remains allowed.

Before starting automatic model generation, Chat checks
`GET /api/familiars/[id]/self-reports/[sessionId]`. A matching persisted report
skips generation. Missing reports and failed lookups fall through to the
normal best-effort reflection path. Server admission remains authoritative.
This lookup does not reserve generation: two clients can both generate before
either saves, but only one automatic report can be admitted.

Accepted reports retain existing redaction, metric-snapshot and best-effort
archive behavior. Archive policy still runs inside the shared atomic mutators;
a failed archive does not undo a persisted report. A code rollback requires no
data rewrite. Reverting admission restores the earlier ownership/duplicate
risk and should be treated accordingly.

Regression coverage lives in `familiar-self-reports.test.ts`,
`familiar-self-report-admission.test.ts`, `auto-thread-reflection.test.ts`, and
`familiar-self-report-route.test.ts`, wired into `pnpm test:app`. It includes
scratch-store cross-process contention; it does not claim paid-provider or
physical-device acceptance.
