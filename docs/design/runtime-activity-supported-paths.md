# Runtime Activity release qualification

Issue [#5767](https://github.com/OpenCoven/coven-cave/issues/5767) owns the release
packet. A passing fixture is evidence for its named adapter, launch path, client,
and candidate. It does not admit a provider, protected action, or another client.
The original 114 requirements and 17 golden scenarios remain the inventory in
[evidence/runtime-activity-acceptance-2026-10-05.json](evidence/runtime-activity-acceptance-2026-10-05.json).

## Candidate and diagnostic contract

Build once, then freeze `.next/BUILD_ID`, `server.mjs`, the bundled server and
packaged executable. Run each lane against those bytes. Record the Git source
OID separately from harness revisions. A harness-only edit does not rebuild the
product, but must have its own digest. A product edit requires a new candidate
and rerunning the affected qualification; never combine passes across builds.
Run build-producing conformance suites before freezing the candidate: they can
replace or remove `.next`. Serialize them against qualification, or use an
independent output tree. The client and native harnesses reject a changed build ID.
Retain the first failed attempt, retries, command, platform, runtime versions,
source digests, actual counter checkpoints and cleanup result.

`runtime-activity-effect-recovery.mjs` records content-minimized first-activity,
controlled-tool and terminal latency, and the existing `harness-start`,
`resume-gap` and `save-transcript` progress identifiers/status/duration. The
client fixture records provider dispatch/result latency and actual chat HTTP
request paths. These are local qualification diagnostics, not an additional
telemetry service or evidence that a particular tool caused the answer.
Renderer observations and performance measurements require their own receipt;
server latency is not rendering cost. Never retain credentials, raw provider
continuation state, real conversations or arbitrary error payloads in the packet.

## Paths and capability gates

| Path | Current gate | Release qualification |
| --- | --- | --- |
| Hermes Responses API | `hermes-responses-v1`; model identity comes from the served response, not the requested alias | Controlled-provider daemon/client lanes; actual service requires an authorized canary |
| Codex direct JSONL | Installed help capabilities plus a selected reviewed schema in `codex-routing.ts` | An unknown version uses the existing Coven fallback; it is not admitted as a direct structured path |
| Codex · Ollama / Codex · LM Studio, direct | Local endpoint, installed tool-capable model and existing Codex schema admission; no cloud fallback | Launch/preflight fixtures from #6088 do not qualify activity end to end. Local-model reasoning/tool exposure through live UI, replay and history remains unverified under #5763 / #6071 |
| Codex · Ollama / Codex · LM Studio, Coven fallback | Existing local adapter manifest when the Codex version lacks direct admission; custom endpoints remain refused on this path | A successful launch or local inventory is not tool/reasoning evidence. Qualify this transport separately under #5763 / #6071; do not inherit direct-path receipts |
| OpenCode run JSON | Verified launch-file/help/version contract and `opencode-compatibility.ts` | Read-only execution remains refused with 501; never switch to Full access to turn a failed canary green |
| Grok direct CLI | Capability probe and reviewed schema in `grok-compatibility.ts` | No compatible schema means plain output; structured tools/reasoning remain unqualified |
| Coven relay / SSH | Existing authenticated launch and environment boundary | A direct/API fixture does not qualify relay or remote transport |
| Native iOS | Shared decoder corpus plus real native transport/rendering and device acceptance | Simulator/source checks cannot replace human VoiceOver or physical-device performance |

The local Codex paths above were added by [#6088](https://github.com/OpenCoven/coven-cave/pull/6088), after the frozen 2026-10-18 packet. Their presence in the application does not extend that packet's supported activity claims. The merged local inventory deliberately retains every installed tool-capable model, including older releases; cloud inventories continue to apply the newest-supported-release-per-family filter. This is the existing local-inventory exception, not a new policy change or evidence that a selected model exposes reasoning. See `src/lib/server/runtime-model-options.ts` and its local-backend tests.

Refresh installed versions with `scripts/runtime-activity-runtime-matrix.mjs`.
It runs bounded help/version probes with credential-bearing environment variables
removed, scratch Coven state and registry network refresh disabled. It does not
start a provider conversation or publish trust. Record its result beside the
exact-candidate evidence, not as a timeless support table.

Rollout uses these existing capability gates and the instance's reviewed runtime
configuration. Enable a claimed path only after its exact-candidate receipts are
accepted. `runtimeActivityForAdapter` reports supported/partial/unsupported/
unknown/disabled from the selected adapter; a model name cannot enable a
capability. Preserve the default-on reasoning preference and explicit opt-out
from #5454. Preference changes are presentation only, never authorization.

Rollback returns to the last accepted application/adapter configuration or
withdraws the unsupported capability through the existing reviewed schema
mechanism. It must retain server disclosure, request-time access checks and
protected-action refusal. Do not relax schema signatures, select Full access,
clear revocations or trust a model marker to recover presentation. Registry
publication and release rollout are separate maintainer operations; this packet
does not execute them. Existing bundle/performance budgets continue to apply.
No batching or virtualization change is introduced by these harnesses; pending
approvals and critical failures retain their existing immediate presentation.

The issue body's separate #4892 release-gate clause is obsolete. The correction
is recorded in a comment on #5767; the original body is intentionally preserved.

## Written deferrals and approval boundaries

Golden 09/10 require an authoritative producer for Permit/Degrade/Reject and
revocation/revision/replay-safe approval. Runtime reports and synthetic tool
results cannot provide that authority. Keep approval/change controls unavailable
on these paths. Val [signed off on this bounded deferral](https://github.com/OpenCoven/coven-cave/issues/5767#issuecomment-6247610128)
on 2026-10-18. It covers golden 09/10 only; it does not authorize canaries or
qualify another approval path.

Real-provider canaries require Val's explicit authorization for the named runtime
and read-only operation. Missing credentials, unsupported admission and unavailable
providers are unverified. Do not infer authorization from old issue comments.
Human VoiceOver and physical-device passes remain Val-only. Source tests, browser
automation, AX trees and simulator screenshots must keep their narrower labels.

Managed-device access probes use a controlled external Tailscale inventory with
the real gateway and persisted approval/revocation store. They prove pending and
revoked device refusal, active-stream termination and request-time denial on
replay/history/detail. They do not prove physical tailnet ingress or per-project
multi-principal delegation. Local desktop access retains the existing single-owner
trust boundary; guessed IDs are not an authorization mechanism.

Every unqualified inventory entry needs its exact missing evidence, responsible
owner and imperative next step in the candidate packet. Never silently mark a
technical gap as a human deferral. Keep #5767 open until Val accepts the packet;
closing it and creating deferred-work follow-ups belong to the separately
specified follow-up goal.

## Controlled execution

All daemon invocations use private scratch `COVEN_HOME`, `COVEN_SOCKET` and
`COVEN_CAVE_HOME`. Never operate on the installed daemon or mutate `~/.coven`.
The packaged fixture uses a unique app identifier, so it does not adopt or modify
the installed app's LaunchAgent. Keep UI assertions separate from backend checks.

```sh
node --experimental-strip-types --import ./scripts/test-alias-register.mjs \
  scripts/runtime-activity-effect-recovery.mjs \
  --execute --evidence /absolute/new/cancel-evidence --cancel-after-effect

node --experimental-strip-types --import ./scripts/test-alias-register.mjs \
  scripts/runtime-activity-client-fixture.mjs \
  --execute /absolute/new/client-evidence reconnect
```

The client fixture accepts `release`, `drop`, `complete`, `snapshot`, `finish`,
and `abort` on its attached terminal or as newline-delimited commands appended to
`<evidence>/control.txt`. Use the control file when the process launcher closes
stdin. Send through the real composer first.
`release` executes one fresh fsynced counter process; `drop` cuts the downstream
SSE while draining the real upstream; `complete` releases the final provider
frames. Inspect the real client, then record `snapshot`, reopen its history and
`finish`. Finish requires a real replay request in reconnect mode and a separate
counter control that detects a second actual invocation.

For cancellation, use `cancel`, release the effect and click the client's Stop
button before snapshot/history checks. For hostile content, use `hostile`, open
the tool detail and inspect the untrusted HTML/URL/forged-receipt text. The fixture
checks for zero callbacks and unchanged invocation count; the UI receipt must
also establish that no trusted approval or committed-effect chrome appeared.
The optional final argument is the absolute executable inside the alternate-ID
packaged Release app. A packaged fixture checks its sidecar port is closed before
removing scratch state; failed teardown preserves the root for investigation.

## 2026-10-18 packet

The [packet](evidence/runtime-activity-2026-10-18/README.md) identifies main source
`64c5658ebf4fcb381fc7270fc15fae379a1fec76` and build
`ZhCtRUET5IWsZpj-I_ycz`. Goldens 05, 06, 11 and 12 pass within their stated
controlled-provider boundaries. All 114 inventory entries have scoped decisions;
48 remain explicitly deferred. In particular, the native live-composer lane
failed a tool visibility assertion after dismissing output. That failure remains
assigned to #5766 even though the separate native recovery lane passes.

The renderer comparison uses four alternating measured samples per cohort after
two warmups, with the same one-tool/two-summary fixture. Median history readiness
was 325 ms baseline and 333 ms candidate. Both cohorts use identical application
bytes because this change adds harnesses and documentation. This establishes a
repeatable comparison, not a performance improvement or a long-trace benchmark.
