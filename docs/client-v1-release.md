# Client v1 compatibility in a Cave release

Every Cave release is also a Client v1 compatibility release. External clients
(OpenCoven Chat, the iOS build, the SDK) read one unauthenticated route before
they pair, and everything they decide afterwards — whether they are too old,
which operations exist, which installation is answering — comes from that
answer. This page records what a release advertises, which gates prove it
before installers are built, and how those gates are run by hand.

It describes behaviour; the code is the authority. The contract lives in
`src/lib/server/client-v1/contract.ts` and is frozen into
`src/lib/server/client-v1/contract-fixture.json`; the route is
`src/app/api/client/v1/health/route.ts`. The full API is in
[`docs/api/client-v1.md`](api/client-v1.md).

## What a release advertises

`GET /api/client/v1/health` answers with the shared Client v1 envelope plus the
health record. A client must be able to learn it is incompatible before it
holds a credential, so the route returns no user data, no paths, and no
configuration values.

| Field | Source | Meaning |
| --- | --- | --- |
| `apiVersion` | `CLIENT_V1_API_VERSION` (`1.0`) | The contract major/minor. The route major stays `/api/client/v1`; additive fields are allowed, removal or semantic change of a required field is not. |
| `minimumClientVersion` | `CLIENT_V1_MIN_CLIENT_VERSION` (`0.0.1`) | The oldest client this Cave accepts. A client below it must refuse to pair and say so. |
| `capabilities` | `CLIENT_V1_CAPABILITIES` | Which surfaces this release serves, by name: `health`, `pairing`, `credentials`, `familiars`, `familiar-contract`, `familiar-analytics`, `projects`, `conversations`, `conversation-messages`, `cursors`. A client checks the capability it needs before it calls the route behind it. |
| `operations` | `clientV1OperationRecords()` | The live operation inventory, on every response. |
| `instanceId` | `clientV1InstanceId()` | Identifies an installation, never a person. Stable across restarts; a client uses it to notice it is talking to a different Cave. |
| `pairingRequired` | `CLIENT_V1_PAIRING_REQUIRED` (`true`) | A client cannot read anything without an approved pairing. |
| `releaseVersion` | `APP_VERSION` | The running release, exactly the version the tag and the stamped source agree on. |

The conformance-only compatibility preset (`CLIENT_V1_COMPATIBILITY_CONTROL_ENABLED`,
[`docs/api/client-v1.md`](api/client-v1.md#conformance-only-compatibility-controls))
can override `apiVersion` and `minimumClientVersion` for a protected conformance
run. A release build never enables it; the release smoke below would fail if it
did, because the answered version would no longer match the release.

### Choosing the minimum supported client

`minimumClientVersion` is a program decision, not a build artefact: raising it
is how a Cave release stops accepting a client that predates a required fix.
The Phase 7 plan lists "the minimum supported Cave and Coven releases must be
selected before compatibility metadata is finalized" as an external release
prerequisite. Until that selection is recorded, the constant stays at `0.0.1`
and the fixture check below refuses any change to it that is not committed
alongside the fixture.

## The release gates

Two gates run inside release validation — the `release-web-core` job of
`.github/workflows/release.yml` and the `frontend` job of
`.github/workflows/full-validation.yml` (release candidates) — immediately
after the production web bundle is built and before any installer, checksum,
or updater manifest job can start. `scripts/release-promotion-workflow.test.mjs`
pins that ordering and refuses a step-level `if:` or `continue-on-error` on
either gate.

### 1. Contract fixture matches source

```bash
node scripts/export-client-v1-contract.mjs --check
```

Re-derives the contract from `contract.ts` and compares it byte-for-byte with
the committed `contract-fixture.json`. A field added, removed, or renamed
without regenerating the fixture fails here. Consumers (the SDK's reviewed
baseline, Chat's contract canary) pin the fixture, so drift caught here is
drift that would otherwise reach them as a surprise.

Regenerate deliberately with `node scripts/export-client-v1-contract.mjs` and
commit the fixture with the source change.

### 2. Release smoke against the built server

```bash
COVEN_CAVE_E2E=1 COVEN_CAVE_PORT=3123 node server.mjs &
node scripts/client-v1-release-smoke.mjs --origin http://127.0.0.1:3123
```

Starts the **built** server (`server.mjs`, the same entry the packaged app
runs), waits for the health route, and probes it twice. The smoke checks that:

- the envelope carries `apiVersion`, `minimumClientVersion`, `capabilities`
  and `operations` exactly as the committed fixture says;
- `releaseVersion` equals the version in the checkout's `package.json`, which
  the `source-version` job has already proven equals the release tag;
- `instanceId` is present, well formed, and identical across the two probes;
- `pairingRequired` is `true`.

`COVEN_CAVE_E2E=1` makes the server daemon-less, which is what the release
validation runners have. The smoke deliberately covers only the credential-free
handshake; pair / read / revoke coverage against a real authority belongs to
the [real-authority conformance run](workflows/client-v1-conformance.md), which
a gate cannot substitute with unit tests.

## Running the gates by hand

Against a checkout:

```bash
pnpm build
node scripts/export-client-v1-contract.mjs --check
COVEN_CAVE_E2E=1 COVEN_CAVE_PORT=3123 node server.mjs &
node scripts/client-v1-release-smoke.mjs --origin http://127.0.0.1:3123
```

Against an installed release, the same smoke runs from a checkout of the
matching tag so the expected version and fixture are the release's own:

```bash
git archive v0.4.2 scripts/client-v1-release-smoke.mjs package.json \
  src/lib/server/client-v1/contract-fixture.json | tar -x -C /tmp/cave-v0.4.2
node /tmp/cave-v0.4.2/scripts/client-v1-release-smoke.mjs --origin http://127.0.0.1:3020
```

(`3020` is the packaged app's server port.) That second form is what the
Phase 7 acceptance record cites for the "Cave half" of the compatibility
release row on [#4781](https://github.com/OpenCoven/coven-cave/issues/4781).

## What these gates do not prove

- That a specific client version works end to end. That is the three-OS
  acceptance journey in [`workflows/release-acceptance.md`](workflows/release-acceptance.md).
- That pairing, reads, or revocation behave against a real authority. That is
  the conformance run above.
- That the prior release is a viable rollback target. That is the
  `rollback-readiness` job, documented in
  [`workflows/release-rollback-readiness.md`](workflows/release-rollback-readiness.md).
