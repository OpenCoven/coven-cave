# Research extraction verification

Verification snapshot for the Research extraction candidate. Delivery tracking: [#5997](https://github.com/OpenCoven/coven-cave/issues/5997).

The measurements below compare pre-removal Cave commit
`022a2408b3e628465c81e839f4419f8378691f9f` with the uncommitted extraction
candidate based on `fec9f7c42ce663beb16793b63ad34987b7b2ee9c`, using Research
commit `f322f27832c4ad13f31e8e943d495db93d21c4f1`. These measurements predate the final release pin and subsequent main integrations;
they are not measurements of the final merged Cave revision.

The working candidate has since been integrated with main
`1dd8185a5de325e99b568e6c799a9dd955731d3a`. The measurements above identify
the earlier build inputs; they are not measurements of this updated integration.
Scoped integration checks cover saved links, all 340 API contracts, optional
loading and authorization, and the retained iOS build contracts.
Full lint and typechecking pass on the integrated candidate. Protocol
conformance passes all nine files, including building and launching normal and
conformance Client v1 packaged artifacts. Two Windows shim checks and the
Windows home-migration check are explicitly skipped on this macOS host;
Windows CI must provide that platform evidence. The mobile suite also passes
all 106 files; its source/component checks are not native device, keyboard, or
VoiceOver acceptance.
The Automations release canary passes against pinned Coven 0.4.8: two daemon
starts, four mutations, three history entries/pages, checkpoint resumption
across restart, typed refusal, and unavailable reporting after daemon shutdown.

## Published package

[Research v0.1.0](https://github.com/OpenCoven/research/releases/tag/v0.1.0)
is published from merged commit `23e1c762c0b04c47d0c1e68fac5931d3b7a74aed`
under a verified signed tag. [Release CI](https://github.com/OpenCoven/research/actions/runs/38736956548)
passed before publishing the archive and `SHA256SUMS`.

Cave pins the versioned archive URL in `optionalDependencies` and its SHA-512
integrity in the lockfile. Dependency policy permits only that exact URL and
verified digest. Frozen-lockfile installation and dependency-policy checks pass.
The 1,470,698-byte archive has SHA-256
`54096b83ed069b2754e23c30955d528c53723563fc5e4cc0a33f23558d49caea`;
its extracted file contents exactly match the locally tested package archive.

## Compatibility evidence

- Physically absent, installed-disabled, and enabled production builds serve existing saved links
  with values exactly matching a fixture created by the pre-removal code.
- Enabled Research reopens that fixture's mission with exact value equality.
  Disabled Research returns `503` with `research-disabled`; physically absent
  Research returns `503` with `research-not-installed`.
- All three configurations reject foreign origins and requests missing the configured
  native sidecar credential. Tests configure `COVEN_CAVE_AUTH_TOKEN`; a mobile
  access token alone does not establish this native-route test condition.
- Executed-script coverage from enabled startup includes the Research runtime
  and media-worker implementation chunks. Those chunks are not evaluated in
  the disabled startup/read/rejection sequence. A small Turbopack lazy-import
  registration stub is loaded in both configurations.
- The absent and disabled UIs display their explicit unavailable states without
  browser errors. The enabled UI renders
  the actual prompt input and accepts text, with no browser errors. These
  browser tests fix host familiar/role discovery while using real capability
  and Research APIs. They do not establish human keyboard or VoiceOver acceptance.
- With the package physically absent, backup manifest, archive, resource restore,
  interrupted recovery, maintenance boundary, and privacy boundary tests pass.
  They cover real archive restoration, simulated crashes, cross-process locks,
  tombstones, malformed records, and linked-file refusal.
- All 39 Flow Copilot tests pass against the installed native supervisor on
  macOS, including descendant quiescence and containment after server crashes.

The app suite passes a clean run of all 1,442 files. After the published pin
and latest main integration, the API suite passes a clean run of all 516 files,
including dependency policy and branch capture. The earlier branch-capture
failure did not recur in that complete run; no production timeout or assertion
was weakened.

## Size and timing

The final installed build on base `1dd8185a5` passes typechecking and bundle
budgets and produces **470,755,538 bytes**, compared with
**469,669,213 bytes** before the removals. This configuration increases artifact
size by 1,086,325 bytes; moving source to a package does not remove its runtime
payload from an installed build. The physically absent build passes typechecking
and bundle budgets and produces **458,001,608 bytes**, a reduction of
**11,667,605 bytes** against the baseline. No package-named Research chunks
were found in that build or its executed-script coverage.

Three samples per installed configuration and two physically absent samples
used fresh production server processes and Chromium contexts. A third absent
run failed before listening because the worktree dependency directory disappeared;
its cause is unverified, and it is excluded from timing statistics. Samples waited for `cave:first-interactive` before opening
the command palette, settled for five seconds, then observed fifteen idle
seconds. They used an empty isolated local fixture without a daemon. OS caches
were not flushed and unrelated machine load was uncontrolled.

| Median metric | Before removals | Installed, disabled | Installed, enabled | Physically absent |
| --- | ---: | ---: | ---: | ---: |
| Process to TCP listen | 2,757 ms | 2,452 ms | 1,750 ms | 3,783 ms |
| Browser first-interactive mark | 2,389 ms | 2,059 ms | 1,220 ms | 2,479 ms |
| Navigation to visible palette | 5,233 ms | 5,618 ms | 3,498 ms | 7,368 ms |
| First Research missions API request | 68 ms | 26 ms (503) | 82 ms | 54 ms (503) |
| API requests per 15 idle seconds | 8 | 8 | 8 | 8 |
| Active browser intervals | 13 | 13 | 13 | 13 |

Timing ranges are wide and do not establish a confident responsiveness
improvement. The absent configuration is slower on these sample medians, with
wide ranges (1,601–5,966 ms to listen and 5,119–9,617 ms to visible palette).
A disabled or absent 503 response is not comparable to successful Research
work. API first use is also distinct from Research UI readiness. Idle request
and interval medians did not decrease.

Refreshed provisional checkout counts against the integrated tree show about
57,176 fewer production/tooling lines, 48,116 fewer test lines, and 246,280 fewer
marketplace payload lines (before this report-only wording update). Counts use UTF-8 `splitlines`, exclude binaries and
symlinks, and include existing tracked plus nonignored untracked files. Tests
include `.test.`/`.spec.` files, the `tests/` tree, and native `Tests`/`UITests`
directories. Marketplace paths form a separate category. These
categories distinguish source relocation from runtime reduction; they are not
claims that those lines were deleted across all repositories. Refresh counts
against the final integrated revision.

## Delivery tracking

Protected PR checks, review, merge evidence, and final worktree ownership and
disposition are recorded on #5997. The source inventory and runtime comparisons
above describe the specified candidate revisions and do not establish a latency
improvement or human accessibility acceptance.

Detailed execution receipts and measurement limitations are recorded on #5997.
Temporary local logs are supplementary evidence, not durable completion claims.
