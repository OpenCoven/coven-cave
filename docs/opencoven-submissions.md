# OpenCoven Runtime and Harness Submissions

OpenCoven owns runtime and harness submission end to end:

1. Submit one package to OpenCoven.
2. Validate the package against OpenCoven contracts.
3. Publish passing submissions into the OpenCoven catalog.
4. Route execution through OpenCoven execution services.

This is separate from the plugin marketplace. Authors do not publish runtimes or
harnesses through another product, and they do not write bespoke platform
integration code.

## Package Shape

A package contains one manifest plus its artifact file entries and optional
examples/tests. In Cave's JSON bundle form, this is represented as:

- `manifest`: the OpenCoven manifest
- `artifacts`: the uploaded package paths
- `files`: package file entries keyed by path, with content or size/hash metadata

The manifest declares the shared fields OpenCoven needs to discover, validate,
route, and execute the submission:

- `name`
- `version`
- `description`
- `type`: `runtime` or `harness`
- `capabilities`
- `requiredServices`
- `permissions`
- `entrypoints`
- `artifacts`
- optional `examples`, `tests`, and `docs`

Runtime submissions include a `runtime` contract with a runtime id, invocation
method, supported protocols, exposed capabilities, config/env requirements,
health check, and sandbox/policy declarations.

Harness submissions include a `harness` contract with a harness id, compatible
runtime capability requirements, config schema, lifecycle hooks, execution mode,
and output/event contract.

## Validation

OpenCoven validation returns one status:

- `pass`: publishable.
- `warning`: usable but needs attention.
- `fail`: not publishable.
- `review-required`: not publishable until OpenCoven review clears the policy.

Validation covers manifest shape, required fields, artifact structure, package
file entries, runtime/harness compatibility, safety/policy declarations,
example/test presence, and JSON example/test validity when examples/tests are
declared.

## Catalog and Routing

The OpenCoven catalog groups submissions by type and id, tracks versions,
capabilities, compatibility, validation status, and examples/docs. Passing
harnesses are enabled only when a compatible runtime is available.

Execution routing resolves:

- selected harness to required capabilities to a compatible runtime
- selected runtime to its invocation adapter and platform services

Latest compatible version wins. Newer incompatible or review-required versions do
not blindly replace a compatible publishable version.

## Optional in the build

Submissions is left out of a default build. `pnpm build` aliases its runtime and
page to small stubs in `scripts/submissions-build-config.mjs`, so the validator,
routing, execution planner and form aren't in the artifact.
`COVEN_CAVE_INCLUDE_SUBMISSIONS=1 pnpm build` includes them. Rolling back is a
rebuild with that flag, or the previous artifact; neither changes saved data.

The routes stay in every build and answer through
`src/lib/server/opencoven-submissions-host.ts`. Each refusal is a 503 with a
stable `code`, after the proxy's usual authorization:

| Code | Meaning |
| --- | --- |
| `submissions-not-installed` | This build has no implementation. |
| `submissions-disabled` | `COVEN_CAVE_SUBMISSIONS_DISABLED=1`. Refused before the implementation loads. |
| `submissions-load-failed` | The implementation is in the build but couldn't load. Retrying is safe. |
| `submissions-incompatible` | The implementation's contract version isn't the one this host supports. |

A saved `/?mode=submissions` link opens a page that says the feature isn't
included. Saved submissions stay in `opencoven-submissions.json`, in the Cave
home and in backups, whichever build runs. Nothing is rewritten or migrated, and
reinstalling reopens them unchanged. Submissions has no background jobs. A
refused request starts nothing and an acknowledged publish is durable, so there
is no accepted work to drain or replay.

`node scripts/qualify-submissions-absence.mjs` qualifies built artifacts. Its
receipt keeps failures, and it does not cover the signed native bundle.

## API Surface

- `GET /api/opencoven/submissions`: returns Runtime/Harness choices, catalog
  discovery entries, and an optional route when `?harness=` is provided.
- `POST /api/opencoven/submissions`: validates one package payload and, when
  `publish: true`, persists passing manifests into the OpenCoven catalog.
- `POST /api/opencoven/executions`: builds an `opencoven.execution.v1`
  execution-service plan for a selected harness/runtime pair. It resolves and
  returns the dispatch contract; uploaded artifacts are not executed directly by
  the submission UI.
- `GET /api/opencoven/submissions/retained`: in every build, reports whether
  saved submissions exist and how many. `?download=1` exports the file byte for
  byte.
- `DELETE /api/opencoven/submissions/retained?confirm=delete`: deletes the saved
  file. It works without the implementation and requires the confirmation.
