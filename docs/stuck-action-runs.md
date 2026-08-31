# Stuck Actions runs — the four from July 2026

Four Actions runs have sat in `queued` since 2026-07-25. They are obsolete
CI/CodeQL history on pull requests long since handled, but they are still
counts against the queue and every inventory of repo state re-derives them.
This page is the one record of what has been tried and what it returned, so
the next retry starts from evidence instead of from the issue thread
([#4905](https://github.com/OpenCoven/coven-cave/issues/4905), bead
`cave-88pe8`, dependency `cave-zsxpd`).

## The runs

| Run ID | Workflow | Event | Created (UTC) |
|---|---|---|---|
| [30158074443](https://github.com/OpenCoven/coven-cave/actions/runs/30158074443) | CodeQL Advanced | pull_request | 2026-07-25T12:29:59Z |
| [30158074458](https://github.com/OpenCoven/coven-cave/actions/runs/30158074458) | CI | pull_request | 2026-07-25T12:29:59Z |
| [30158095776](https://github.com/OpenCoven/coven-cave/actions/runs/30158095776) | CI | pull_request | 2026-07-25T12:30:38Z |
| [30158095786](https://github.com/OpenCoven/coven-cave/actions/runs/30158095786) | CodeQL Advanced | pull_request | 2026-07-25T12:30:38Z |

## Do not delete workflow history

**Never delete these runs or their workflow history to make them go away.**
The runs are records; deletion destroys the audit trail to tidy a cosmetic
queue state. The only acceptable exit is for each run to report
`completed` with a `cancelled` (or other terminal) conclusion, at which point
maintainers can close #4905. PRs must reference the issue with `Refs #4905`,
never `Closes #4905` — only maintainers close it, after the close condition
is actually met.

## History

- **2026-07-25** — the four runs are created and enter `queued`. They never
  start.
- **2026-07-25 through 2026-08-10** — both REST cancellation endpoints,
  `POST /repos/OpenCoven/coven-cave/actions/runs/<id>/cancel` and
  `POST .../force-cancel`, consistently return **HTTP 500** with adequate API
  quota. A fresh retry on 2026-08-10 still returned 500. The backend, not the
  caller, was wedged.

## 2026-08-30 retry — verbatim results

Retried both endpoints for each run, per the issue's next step:

```
gh api -X POST /repos/OpenCoven/coven-cave/actions/runs/<id>/cancel
gh api -X POST /repos/OpenCoven/coven-cave/actions/runs/<id>/force-cancel
```

All eight POSTs returned the same status line:

```
HTTP/2.0 403 Forbidden
```

with this response body (identical for both endpoints across all four runs):

```json
{"message":"Resource not accessible by personal access token","documentation_url":"https://docs.github.com/rest/actions/workflow-runs#cancel-a-workflow-run","status":"403"}
```

The decisive response header, absent during the 500 era:

```
X-Accepted-Github-Permissions: actions=write
```

Polling each run afterwards
(`gh api /repos/OpenCoven/coven-cave/actions/runs/<id> --jq '.status,.conclusion'`)
returned `queued` and `null` for all four — the 500 wall is gone, but the
authenticated identity (the `CompleteDotTech` fine-grained PAT) lacks
`actions:write` on this repository, so the endpoints refuse it before the
backend state is ever reached. **The next retry should run under a token
that holds `actions:write`.**

The same results through the retry tooling, which is the durable form of the
commands above:

```
$ node scripts/cancel-stuck-action-runs.mjs --retries 0
run 30158074443: status=queued conclusion=none
run 30158074458: status=queued conclusion=none
run 30158095776: status=queued conclusion=none
run 30158095786: status=queued conclusion=none

Per-attempt record:
RUN ID        ENDPOINT      ATTEMPT  HTTP
30158074443   cancel        1        403
30158074443   force-cancel  1        403
30158074458   cancel        1        403
30158074458   force-cancel  1        403
30158095776   cancel        1        403
30158095776   force-cancel  1        403
30158095786   cancel        1        403
30158095786   force-cancel  1        403

Resulting status:
RUN ID        ENDPOINT      HTTP  STATUS        CONCLUSION
30158074443   force-cancel  403   queued        none
30158074458   force-cancel  403   queued        none
30158095776   force-cancel  403   queued        none
30158095786   force-cancel  403   queued        none

4 of 4 run(s) remain queued: 30158074443, 30158074458, 30158095776, 30158095786
$ echo $?
1
```

Close condition not met as of 2026-08-30: all four remain `queued`.

## Retrying

`scripts/cancel-stuck-action-runs.mjs` takes run IDs as arguments (defaulting
to these four), tries `/cancel` then `/force-cancel` per run with retries and
a doubling backoff on transient failures (HTTP 5xx, 429, or no exchange at
all — a 4xx is deterministic and falls through to the next endpoint instead),
polls each run's resulting status, and exits non-zero while any run remains
queued:

```bash
node scripts/cancel-stuck-action-runs.mjs                # the four runs above
node scripts/cancel-stuck-action-runs.mjs 12345678901    # any other run
node scripts/cancel-stuck-action-runs.mjs --retries 3 --backoff-ms 5000
```

This is manual tooling and is deliberately not wired into CI. It never
deletes workflow history.
