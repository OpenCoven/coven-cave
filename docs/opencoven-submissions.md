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

## API Surface

- `GET /api/opencoven/submissions`: returns Runtime/Harness choices, catalog
  discovery entries, and an optional route when `?harness=` is provided.
- `POST /api/opencoven/submissions`: validates one package payload and, when
  `publish: true`, persists passing manifests into the OpenCoven catalog.
- `POST /api/opencoven/executions`: builds an `opencoven.execution.v1`
  execution-service plan for a selected harness/runtime pair. It resolves and
  returns the dispatch contract; uploaded artifacts are not executed directly by
  the submission UI.
