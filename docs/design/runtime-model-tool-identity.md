# Runtime identity and tool disclosure

Implementation notes for [#5761](https://github.com/OpenCoven/coven-cave/issues/5761).
This working slice does not complete the typed activity contract in #5762 or
the complete runtime/path verification matrix in #5763.

## Current-main curation qualification, 2026-10-04

The [curation integration packet](evidence/runtime-activity-curation-integration-2026-10-04.json)
records the separate candidate based on `2900102`, including auth recovery
#5796. It preserves both conflicting Codex contracts and registers the Hermes
model test with the existing alias loader. The original Cave and Runtimes
worktrees remain owner-preserved.

Production build `IFGFiVoWYV_PGLEcgui1h` passes actual Claude and Copilot
Read-only turns through the Dia browser composer. Both show the reported
runtime/model, successful tool and saved marker output before and after reload.
History and replay retain the same identities without an extra send. These are
browser accessibility-tree observations, not exported visual captures or human
accessibility acceptance. Copilot also ran a read-only `find` inside the fixture;
the result does not prove exactly one tool invocation. Claude's parent checker
reported a teardown race; fresh independent checks verified its service and
daemon had exited. Both original reports remain retained.

Verification passes 1,501 app, 507 API, 106 mobile and 17 conformance files,
lint, test wiring and the production build. The unchanged arcade timing test
failed in the first app run; its isolated retry and the full rerun pass without
code changes. Native Debug compilation succeeds. Across ten selected simulator
suites, 204 tests pass and one opt-in TCP case is skipped. The initial unsigned
run failed Keychain access; all 14 tool-output tests pass with simulator ad-hoc
signing and unchanged source. The owned simulator is shut down.

The [subsequent review packet](evidence/runtime-activity-curation-review-2026-10-04.json)
records a native retry fix: resetting a response now clears the previous
attempt's identity and reasoning summaries. The regression fails before the
fix; 30 focused simulator tests and all 106 mobile contract files pass after it,
including restoration of the original reply when retry authority is revoked.
The Codex fixture also waits for stdout to flush before exiting, preserving
seven-byte framing and terminal assertions. Its local integration test passes;
the Linux hosted API failure still requires confirmation on the updated head.

Desktop startup isolation, packaged clients, physical-device and human
accessibility acceptance, the remaining providers and signed admission gates
remain open. Prior evidence below retains its own build and limitations.

## Prior qualification, 2026-10-04

The [path matrix](evidence/runtime-activity-qualification-matrix-2026-10-04.json)
separates adapter capability from collected evidence, with explicit version,
model, protocol, client and next gate for each path. Historical packets below
retain their original candidate and omissions; they are not current-build passes.

The preceding build, `jWUpxykRXSyNo49w4GE3-`, includes the
[web verification follow-up](evidence/runtime-activity-web-providers-2026-10-04.json).
The real Claude browser composer on the preceding build showed `2.1.288`,
`claude-opus-5-5`, successful `Read` and its saved marker output. Reload retained
the same history/replay identities without another send. An initial checker
field error was retained and corrected before the passing run.

That run exposed a narrow-layout defect: the activity rail first mounted after
its width effect had already run against an absent node. The fix measures on
the empty-to-tool transition and preserves resize/unmount behavior. Three
regressions fail before the fix and pass afterward. All 1,496 app test files,
typecheck, focused lint and the production build pass on the final source.
The rebuilt layout has not
yet been captured in the browser.

Copilot's actual menu also exposed Opus 4.8 fast beside Opus 5.5. Fast mode now
shares the Claude family, so the newer release removes that older choice. A
current-build production inventory check against installed Copilot proves the
upstream still reports both while Cave returns only Opus 5.5 for the family.
The browser Copilot provider turn remains incomplete: user activity interrupted
the prepared draft, and the bounded canary expired with only its initial HTTP
conversation. All seven test service/daemon PIDs are absent and temporary
connection files are removed. No standalone browser screenshots were exported.

The desktop check is unrun. A distinct app identifier does not isolate the
global LaunchAgent cleanup in native startup; the installed user agent and app
remain untouched. Establish safe startup isolation before desktop verification.
These limitations do not promote earlier native or provider packets to the
current build. The current and recovered Runtimes worktrees remain preserved;
the separately released old checkout has no resumed dependency in this session.

The preceding build, `kv8FenOX2f9mApbjXkoMk`, added
[Hermes alias filtering](evidence/runtime-model-hermes-aliases-2026-10-04.json).
Hermes model discovery supplies route aliases as `id` and their configured model
as `root`. Cave now preserves a validated `configuredModelId`, applies the newest
family policy to that value, and labels the alias with its configured model.
The original alias remains the launch ID. This inventory metadata does not
confirm which model ultimately serves a turn. Unknown custom roots remain
available; invalid roots do not enter labels or filtering.

The regression failed before the fix and passes afterward. An isolated instance
of the installed Hermes API server at `830165473e0920c2baf8c2a6863976edb0c52943`
also passes discovery through the production Cave endpoint: older aliases are
omitted and the current alias/model pairing survives. Typecheck, focused model,
inventory, hook, API and served-identity tests, lint and the production build pass.
This is actual inventory code with explicit test routes, not a provider turn or
new native UI run. The 45 changed iOS files match the previous native checkpoint.

At that installed Hermes revision, Responses still echoes the requested model
alias without a terminal served-model report, and Cave's Read-only refusal
remains. ACP imports successfully, but its edit-approval modes do not establish
Cave's Read-only contract. No installed configuration, provider, permission or
producer contract changed. The actual Hermes turn remains unqualified.

| Path | Collected evidence | Remaining gate |
| --- | --- | --- |
| Claude local Coven | Built HTTP and native Debug composer/relaunch: `2.1.288`, `claude-opus-5-5`, saved `Read` output | Packaged-client provider acceptance |
| Copilot direct | Built HTTP and native Debug composer/relaunch: `1.0.88`, `claude-sonnet-5`, saved `view` output | Packaged-client provider acceptance |
| Copilot Flow | Recorded supervised/direct fixtures | Real-provider Flow and optional native supervisor lifecycle |
| Codex / Grok direct | Recorded native CLI captures and signed test fixtures | Canonical signed admission and stock-trust Cave acceptance |
| OpenCode | Recorded `1.17.16` probe; Read-only HTTP 501 | Existing unanswered Full-access approval |
| Hermes API | Native TCP fixture, real daemon, live composer send/interruption, restart and normal foreground recovery | Actual API producer |
| OpenClaw Gateway | Recorded negotiated-protocol fixtures | Actual producer; separate #4892 gate |
| Quiet CLI / unverified relay / SSH | Explicit unsupported or unknown detail states | Producer and protocol evidence for that exact path |

The [fresh provider packet](evidence/runtime-activity-current-canaries-2026-10-04.json)
uses production build `v1THgZr1dvmIVuJQomLJ5`. Claude and Copilot retain matching
identity, tool activity and marker output through replay and history. Copilot
retains both a failed `bash` marker-read attempt and a successful `view`; this
does not prove a one-invocation counter or protected effects. Claude summaries
remain unknown; Copilot summaries remain unsupported by its adapter.

The first Copilot run failed the exact-version assertion. Fresh local diagnostics
identified two installs: cold preflight selected Homebrew `1.0.82`, while normal
server PATH warm-up selected NVM `1.0.88`. The checker now uses that same warm-up
and records its resolved command; exact-version equality still applies. The
corrected canary passes. That canary checkpoint changed only the opt-in checker.
The later native recovery fix below was compiled and verified separately; the
web server artifacts, timeout, permissions, runtime installations and trust
remain unchanged.
The later [native provider packet](evidence/runtime-activity-native-providers-2026-10-04.json)
qualifies actual Claude and Copilot responses through the native Debug composer.
Each run first observes the provider through built HTTP, then sends one distinct
native Read-only turn. The app shows matching reported runtime/version/model and
the successful tool, opens its real saved output, and retains the same message,
run, session and tool IDs after termination and ordinary snapshot hydration.
The saved server transcript and replay match the phone's identity and tool.
Exactly two conversations remain per run; relaunch creates no extra conversation.
This count is not a tool-invocation or protected-effect receipt.

Both first attempts pass. The opt-in fixture selects an isolated read-granted
project and sends the existing `permissionMode: read` API field. Ordinary native
sends continue to omit that optional field. The fixture requires an explicit
Debug launch flag, literal loopback origin and per-run credentials, with no
saved connection credentials. No provider response is injected into the phone.

The same source passes 28 native request-contract tests, all 106 mobile test
files, focused checker lint, and the synthetic accepted-queue regression
(two native TCP tests and one rendered recovery test). Release compilation
passes and checked fixture strings are present in Debug and absent from Release.
This adds compile/exclusion evidence, not a new Release UI journey. All eight
recorded server/daemon PIDs are absent and the owned simulator is shut down.

Original-resolution live and hydrated captures show the reported identity and
successful tool; output sheets show the literal marker. The live captures occur
after tool completion and do not prove a visible Running phase for these real
providers. Completed answer text follows normal Markdown rendering, including
emphasis from marker underscores. Claude summary support remains unknown and
Copilot summary support remains unsupported.

All owned canary servers and daemons stopped. These simulator Debug results do
not establish remote HTTPS, managed pairing, packaged release, physical-device
or human accessibility acceptance. The overall goal remains incomplete and the
uncommitted worktrees are intentionally preserved.

## Current-main integration

The [integration evidence](evidence/runtime-activity-main-integration-2026-10-03.json)
qualifies the local candidate based on `18f6e327addc63707736c91040524bdc734a323c`.
It preserves main's concurrent-turn admission and Stop behavior. OpenClaw's early
shared Gateway/CLI replay buffer now reuses or creates its admission owner before
Gateway events can arrive; a first-turn behavioral regression failed before the
fix and passed afterward. Two source assertions were updated to the resulting
two-buffer design. The original locked recovery checkout remains preserved.

Typecheck, lint, test wiring, 1,492 app files, 504 API files, 106 mobile files,
17 conformance files, and the production build passed. The native run passed
100 unit tests and one Activity UI test. The packet retains first failures,
source fingerprints, test-only changes during earlier runs, and Windows skips.
At that checkpoint, no production source changed after the passing build;
subsequent edits refined only the opt-in canary and its evidence.

Production build `uU2a0itiYsBuLIip74vff` passed real Claude and Copilot HTTP
canaries. Claude reported `2.1.288` / `claude-opus-5-5`; the final Copilot run
reported `1.0.82` / `claude-sonnet-5`, matching Cave's canonical launch probe.
Both retained the controlled tool output and identity in saved history and
matched live/replay answers and tools. Missing/invalid forwarded credentials
were refused, and each owned server and daemon stopped.

The first Copilot checks failed raw answer equality: one leading message-boundary
newline is intentionally trimmed by the existing structured-path persistence
policy. Diagnostics proved that exact difference. The corrected checker retains
raw equality in its report, requires saved text to equal the trimmed live answer,
and still requires exact live/replay equality. It also checks the saved tool's
marker output and compares Copilot's reported version with the canonical launch
probe rather than assuming the shell inventory selected the same installation.

These are local, read-only HTTP and native-fixture results. Canonical signed
Codex admission, remaining runtime/path qualification, packaged-client acceptance,
human accessibility, and protected-effect evidence remain open. No commit, push,
PR, merge, publication, or trust change is included.

The later [native reported-identity check](evidence/runtime-identity-native-reported-2026-10-03.json)
adds a DEBUG-only reported-response fixture and two UI cases. The normal
[capture](evidence/runtime-identity-native-reported-2026-10-03.png) shows the
exact runtime/model, separate requested model, and explicit supported/unverified
activity states. The [largest-text capture](evidence/runtime-identity-native-large-text-2026-10-03.png)
shows the full runtime and wrapped model after scrolling. All 100 selected unit
tests, three UI cases, and 106 mobile files passed; the final large-text case was
rerun after tightening its visible-position assertion. Background/foreground
preserved the same response report. This is native fixture and accessibility-tree
evidence, not human VoiceOver, history reload, native network or Release acceptance.

Native tool rows now open an on-demand, full-height
[output sheet](evidence/runtime-tool-output-native-2026-10-03.png). It reads the
existing projected-output endpoint with fresh authentication, no shared cache,
strict target/response matching, and a 256 KiB UTF-8 display limit. Output stays
selectable plain text in transient sheet state. Denied, ambiguous, missing and
malformed responses have fixed messages; a [denied read](evidence/runtime-tool-output-native-denied-2026-10-03.png)
never exposes its server error body. Closing or backgrounding clears the result
and cancels its read. A sheet-local privacy shield covers the complete detail.

Each message retains a `ToolOutputReference` from its actual stream or history
request: the conversation and desktop endpoint, without URL credentials. An old
tool cannot follow a replacement thread session, even when both conversations
reuse a tool ID. A different desktop cannot supply its output. Legacy messages
without that reference require a history refresh. Full results stay out of
message snapshots; duplicates retain the original reference.

The [native tool-output packet](evidence/runtime-tool-output-native-2026-10-03.json)
records the failing regressions and their verification. The final Debug run
passes 120 selected unit tests and all seven Activity UI cases, including
conversation replacement, denial, close/reopen and background/foreground.
All 106 mobile test files pass. The fixed sheet header avoids the nested
navigation-bar ownership crash reproduced while backgrounding a sheet.
The same final source builds in Release and passes the warm-journey UI smoke
test; its wall-clock test duration is not a performance measurement.
These are native fixture, request-construction and accessibility-tree checks.
Real-provider native transport, physical-device performance, human VoiceOver,
and the full output/theme/text-size/reconnect matrix remain separate acceptance
work. The broader runtime goal remains incomplete.

Web lazy tool reads now bind their target to the history request that supplied
the tool. They recheck the existing endpoint on each disclosure open; successful
results no longer stay in a shared fetch cache. Closing or changing the target
aborts the read and clears its local text. Replacing a history record also
invalidates the result when its conversation/tool IDs are unchanged. Late replies
cannot refill a closed or superseded card. Legacy missing bindings ask for a
history reload. Empty results complete normally instead of showing a spinner.

The [web output packet](evidence/runtime-tool-output-web-2026-10-03.json) retains
three reproduced failures and the scoped verification. Reads remain same-origin,
refuse redirects, enforce the same 256 KiB output bound as native, and use fixed
errors. Normal inline transcript output and input highlighting remain unchanged.
The pre-refinement checkpoint passed all 1,492 app and 505 API files, full lint,
typecheck and test registration. The final history-object refinement passed
16 focused checks, focused lint, and the production build with both budgets.
The packet records those separate source fingerprints. React hook checks are
not production-browser or human accessibility acceptance.

## Model menus

Model choices come from the selected runtime's supported inventory. The menu
keeps the newest numeric release within each recognized provider, family, and
variant. It preserves distinct variants and custom deployments whose release
ordering is unknown. Discovery remains the authority for support; a name alone
does not prove that a model is supported.

Codex uses its app-server initialization and `model/list` control protocol.
Claude uses stream-json initialization and the returned `resolvedModel` values.
Neither query sends a prompt or starts a model turn. Queries have bounded time,
output, concurrency, and cache lifetime. Other runtimes retain their existing
discovery adapters. See [the catalog pipeline](../model-catalog-pipeline.md).

Built-in catalog entries are historical metadata, not fallback menu choices.
Fresh configurations and missing/invalid defaults defer to the runtime rather
than injecting a historical model ID. Explicit saved global, familiar, and
session selections retain their existing precedence.
Unavailable discovery leaves the runtime-default choice available and reports
the missing inventory. Previously selected IDs remain visible without being
reintroduced as selectable supported models. Web and iOS preserve full IDs,
including provider namespaces.

## Reported identity

`ChatResponseMetadata.runtimeIdentity` is an additive version 1 record:

```ts
{ schemaVersion: 1, harness: string, version: string | null, model: string | null }
```

The version comes from the probed launch capability when available. The model
comes only from a recognized native identity field. Requested/forwarded model
settings remain separate. Successful process exit does not establish a model
report. Null means unavailable; legacy metadata is not upgraded into a new
report. Conversation reads retain validated server-owned reports, while client
transcript writes cannot mint them.

The additive `response_metadata` stream event carries the same identity before
the response and whenever a native report changes it. Web and iOS retain it
through the existing live state and replay paths. Retry attempts clear the
previous process's reported model until the new process provides its own.

The exact-ID validator rejects the native `unknown` sentinel, including a
provider-prefixed or uppercase form. A later explicit unavailable report clears
the earlier model; a frame without a model field leaves the last report intact.
Copilot chat and Flow accept this evidence only from the selected protocol's
assistant-message field, never from a delta, tool frame, or result lookalike.
The requested/forwarded model remains separate. Shared TypeScript/Swift corpus
cases cover the sentinel across live, history, and native snapshot decoding;
the imported chat-route fixture covers ordered updates, replay, and history,
and Flow covers both supervised and direct execution. These are deterministic
regression fixtures, not new provider or packaged-app qualification.
The [model-report evidence](evidence/runtime-model-reports-2026-10-03.json)
retains the reproduced failures, source fingerprints, and pinned Grok audit.
Grok's ACP projector drops response-start identity; its aggregate usage can
omit a response without marking the ledger incomplete, and the Messages
projector can substitute a session model. Those source findings do not justify
turning `modelUsage` or a fallback field into primary response identity.

The debug pane's per-turn summary also uses validated `runtimeIdentity`, never
legacy `confirmedModel` or requested `model`. It shows the exact runtime/version
and model together, with explicit missing-record/report labels. The full summary
and usage breakdown remain in the compact row's tooltip. User turns cannot supply
native identity. Logic and component-contract tests cover this; rendered debug
pane and human accessibility acceptance remain outstanding.

The settled web header, response tooltip, and context meter now use the same
validated response report. Neither session settings nor today's familiar model
can fill an older response's missing identity. Requested/selected/recorded
values remain explicitly labeled in the response's separate model-status trail.
A pending response with no report does not inherit its predecessor's identity,
and selecting the latest settled response no longer requires token/cost/duration
metadata. Regression coverage includes legacy intent, null native models,
future/mismatched reports, and the shared header/context selection. The corrected
candidate builds successfully; rendered acceptance remains unverified.

| Runtime/path | Identity evidence in this slice | Existing tool path and remaining limit |
| --- | --- | --- |
| Codex direct | Probed CLI version; JSONL does not provide a model identity field in the selected schema | Version-gated item events through the shared tracker |
| Claude through Coven | Probed CLI version; compatible assistant `message.model`; relay init echoes are not evidence | Validated stream-json tool-use/results plus hook reconciliation |
| Copilot direct | Probed CLI version; compatible assistant-message `data.model`, updated by later reports | Assistant requests remain requested; native execution-start advances the same call to running |
| Copilot Flow/workflow, supervised or direct fallback | Version from the local probe selecting the executable; compatible assistant-message `data.model`, updated by later reports | Shared tool observations and projected saved history; this path persists at completion and does not provide live chat SSE |
| OpenCode direct | Probed CLI version; model forwarding remains unconfirmed | Selected compatibility schema; unrecognized protocols retain plain chat with a notice |
| Grok direct | Probed CLI version; successful completion does not confirm the selected model | Selected signed schema; plain fallback explicitly lacks tool activity |
| Hermes Responses API | Terminal `response.runtime.model` when supplied; echoed `response.model` never confirms identity; server version unavailable | Typed function-call/results, Hermes execution extensions, and completed native summary items; partial values withheld |
| Hermes quiet CLI | Harness identity only | Text-only compatibility path; needs an upstream structured protocol or the configured API transport |
| OpenClaw bridge | Accepted Gateway turn's negotiated version; model unavailable; CLI fallback has no version report | Existing authenticated bridge negotiation and supported tool projection |
| SSH/Coven relay | Remote binding retained; no local binary version or inventory substituted | Existing relay compatibility; remote producer/version proof remains outstanding |

These are producer mappings, not live-provider acceptance claims. Missing
identity or tool evidence must remain visible as unavailable. CLI capability
profiles and tool events are not approval or effect-commit receipts.

`runtimeIdentity.activity` is an optional version 1 description of the selected
Cave display adapter. It records the actual path plus independent tool/summary
states: supported, partial, unsupported, unknown, or disabled. Supported means
the adapter can project that detail; it does not promise an event or authorize
execution. Absent legacy metadata is labeled not recorded. Web and iOS retain
the report through existing identity events, completion, and history.

| Selected path | Tool detail state | Reasoning summary state |
| --- | --- | --- |
| Codex direct | Selected schema's tool item list | Supported only for the parser's admitted summary schemas |
| Claude local Coven relay | Supported with an accepted envelope profile; partial when only local hooks remain | Unknown: accepted profiles do not declare the thinking display representation; disabled when the envelope decoder is quarantined |
| Copilot direct, including Flow | Supported; partial after a protocol-detail diagnostic | Unsupported by the current Cave Copilot adapter |
| OpenCode/Grok direct | Supported only when the selected structured schema introduces named tool calls; unsupported for text-only schemas or plain mode; disabled after protocol quarantine | Unsupported by the current Cave adapters |
| Hermes API / quiet CLI | Supported / unsupported | Supported / unsupported |
| OpenClaw negotiated Gateway / CLI bridge | Selected negotiation / unsupported; a rejected tool protocol becomes disabled | Unsupported by the current bridge projection |
| SSH or unverified Coven relay | Unknown; never borrowed from a local probe | Unknown |

Structured framing alone does not prove tool support. Grok's builtin text/end
schema has no tool-call events, so it reports tool details unsupported even
when selected for structured chat. A signed fixture with named call events
retains supported status. Progress/end aliases alone cannot introduce a call.
The real route regression covers both schema choices and persisted availability.
The [built HTTP fixture](evidence/runtime-activity-grok-text-http-2026-10-03.json)
also confirms the bundled text schema's unsupported tool state in responses and
history. Its first attempt incorrectly expected development registry keys to be
admitted in production; production ignored those overrides as intended. The
revised fixture keeps that boundary intact and qualifies only the bundled text
schema. Signed tool-schema and installed Grok qualification remain separate.

Availability updates replace metadata objects so earlier replay entries do not
change. A retry clears an observed summary claim until its own adapter/native
report supports it; a quarantined decoder stays disabled. An explicit native
Claude `redacted_thinking` item separately records `provider-withheld` on that
summary block. Local interruption and disclosure filtering cannot manufacture
that reason. No opaque bytes enter the reason or the fixed UI labels. These
states describe presentation only; they do not change launch permission,
approval, cancellation, or continuation behavior.

Hermes's [API contract](https://github.com/NousResearch/hermes-agent/blob/2b52acc2d8ceea37d06945a8bbc7deddaa30de63/website/docs/user-guide/features/api-server.md#per-request-model-selection)
distinguishes the echoed request `model` from the served `runtime.model` after
fallback. At inspected revision `2b52acc2d8ceea37d06945a8bbc7deddaa30de63`,
the [Responses SSE writer](https://github.com/NousResearch/hermes-agent/blob/2b52acc2d8ceea37d06945a8bbc7deddaa30de63/gateway/platforms/api_server_openai_routes.py#L256)
does not put `runtime` in its terminal envelope. Cave keeps model identity null
on that path. The documented terminal-report fixture tests conditional support;
it does not prove the inspected producer emits it. Early routing metadata,
nested `runtime.requested` and top-level lookalike fields cannot confirm a model.

## Payload boundary

`server/chat-display-projection.ts` is the shared complete-unit projection for
tracked tool names/arguments/results, typed summaries, and send-route application
progress labels/details. The server selects the classification; payload fields
cannot grant disclosure. Unknown classifications, incomplete units and oversized
units withhold text. Existing credential redaction is combined with common email,
phone/identifier, signed-URL and opaque-provider-field handling. Projection
precedes display caps, SSE, replay retention and these saved presentation fields.
This is not a comprehensive PII classifier or an authority/role policy engine.

Empty-response diagnostics in the general send route and OpenClaw CLI bridge
retain only whether process diagnostics were present. Raw stderr/stdout tails
remain private recovery inputs and cannot become answer text, replay content,
or saved chat diagnostics. Empty output does not establish an authentication
failure; the fixed explanation directs the user to `/doctor`. Local route
fixtures cover live/replay/history equality with private diagnostic sentinels.

Native IDs containing unsafe display material use a reserved hash namespace.
Raw native IDs/names remain private correlation keys so projected names cannot
merge parallel calls. The same display ID and projected name survive hooks,
late results, replay, reasoning settlement and history. This mapping does not
create a session identity, approval or execution lease.

Tool progress preserves lifecycle metadata but withholds preview output: the
current adapters do not establish a complete-unit contract for it. Complete tool
results remain inspectable. Hermes argument deltas likewise remain private until
a complete JSON snapshot arrives. Unknown tool-result content block kinds no
longer fall back to raw JSON serialization. Codex MCP results select documented
text/structured-result fields and omit provider metadata and opaque block kinds.
Codex no longer truncates results ahead of the shared disclosure projection;
a signing parameter beyond the old preview cap still withholds the URL.

The OpenClaw Gateway and Hermes routes preserve the shared result decoder's
withheld result; neither re-serializes an unknown array or typed object afterward.
Known text blocks and ordinary structured results still display. A negotiated
Gateway fixture verifies live/replay/history equality for opaque and mixed
content, partial progress and a result observed before its start. Replay does
not submit another Gateway turn. These are local protocol fixtures, not live
OpenClaw execution or committed-effect receipts.

OpenClaw opens one turn buffer before Gateway dispatch because the dispatcher
may drain accepted events before returning. Gateway and CLI fallback then bind
their existing detach/stop hooks to that buffer; no fallback replaces prior
cursors. Launch identity precedes those early events. Close finishes the buffer
even on an early failure. The route fixture verifies a cursor on every early
tool event and replay both from zero and after the first event.

The hermetic Hermes route fixture covers split output bytes, private native
names/IDs, argument deltas, common PII, signed URLs and opaque fields across live
SSE, replay, saved tools and ordinary console diagnostics. It is not live-provider
qualification.

Conversation GET and its lazy tool-output endpoint now share a read-only
historical display projection. It selects the existing tool field schema,
reprojects names/arguments/completed outputs and progress diagnostics, and
withholds unfinished output, opaque sibling fields and unclassified legacy
`reasoning` strings. Ordinary answer text and code examples remain intact.
Validated typed summaries are reprojected without upgrading legacy provenance.
Already projected IDs remain stable on reload; lazy output lookup compares
original IDs and outputs before redaction so ambiguity cannot disappear when
private values redact to the same text. Reads do not rewrite stored execution
records. This cannot reconstruct context lost to old payload truncation.

The send route also projects legacy `<thinking>`/`<reasoning>` blocks before
SSE serialization and replay retention in both its OpenClaw and general runtime
emitters. Fragmented tags remain pending until disambiguated; nested/unclosed
blocks withhold content. Literal code examples and question attributes retain
their text. Private Markdown cannot change the visible answer's code context.
Authoritative answer replacements recompute corrections against displayed text,
retries clear the prior private parser state, and interrupted turns keep pending
tag fragments withheld. Saved tool offsets refer to the projected answer.

Persistence, conversation GET, and the Client v1 message projection use the same
legacy filter. Client v1 retains its existing counts-only tool/attachment contract
and does not expose additional harness fields. User-authored text stays intact.
Tagged text
cannot become persisted reasoning, an attention request, an attachment request,
or a reported PR link through those paths. The Hermes send fixture verifies
fragmented tags, literal code, projected offsets and matching live/replay/history
without redispatch. This is a grammar-based legacy filter, not classification of
arbitrary answer text or a provider-summary provenance claim.

The Flow transcript endpoint uses a separate display resolver: persisted Cave
assistant messages and OpenClaw JSONL text pass through the same history
projection. Unclassified daemon PTY output is never its display fallback.
Missing or wholly withheld assistant text returns an explicit unavailable
state, which the execution viewer distinguishes from an unreported output
claim. The existing execution resolver retains its original transcripts,
ownership gates and paginated daemon reads for control-marker reconciliation;
display reads do not rewrite stored records. Actual route fixtures cover Cave
and JSONL records, interrupted tags, literal code, missing display content and
unchanged execution input. React fixtures cover unavailable state and refresh;
they are not native/browser or human accessibility acceptance.

The HFR trace exporter uses the same stored-tool projection before optional
field clipping and the same legacy assistant filter. Native runtime identity
stays attached to each assistant/tool hook; its `model` field comes only from
the turn's validated native report. The conversation header's old model value
is `recorded_model` context, never a model confirmation for every turn. Unit and
CLI fixtures cover runtime switches, unknown/invalid reports, secret/PII/signed-URL
and opaque-state sentinels, interrupted tools, and source immutability. These
tests do not qualify HFR's downstream normalizer or make execution receipts.

Other historical export/read paths, raw stderr/error text,
remaining adapter contracts, authoritative bindings and
complete native acceptance still require work under #5762–#5767.
The separate owned-session events endpoint now projects daemon rows before
trace/debug clients receive or cache them. The source mapping is pinned to
Coven commit `6473024e132eaefb2d6eebca3c977fb7df8b9b20`:
[event writer](https://github.com/OpenCoven/coven/blob/6473024e132eaefb2d6eebca3c977fb7df8b9b20/crates/coven-cli/src/event_writer.rs),
[event API](https://github.com/OpenCoven/coven/blob/6473024e132eaefb2d6eebca3c977fb7df8b9b20/crates/coven-cli/src/api.rs),
[store](https://github.com/OpenCoven/coven/blob/6473024e132eaefb2d6eebca3c977fb7df8b9b20/crates/coven-cli/src/store.rs),
and [privacy policy](https://github.com/OpenCoven/coven/blob/6473024e132eaefb2d6eebca3c977fb7df8b9b20/crates/coven-cli/src/privacy.rs).
Coven redacts stored JSON and legacy rows, but its `output` records contain
arbitrary PTY fragments, not classified complete display units. Cave therefore
withholds their content, including apparent summaries/tools and caller-supplied
disclosure/receipt fields. Input, transcript text, kill payloads, and unknown
event kinds receive the same explicit unavailable-detail projection. Accepted
kind names are fixed, non-UUID event IDs are hashed, and timestamps are validated.
Native sequence cursors and the already-authorized daemon session ID remain.

Only the known `exit` status/nullable integer code and `output_truncated`
nonnegative integer counts are selected from payloads; arbitrary siblings never
survive. A process exit is an observation, not a tool-effect receipt. Invalid,
out-of-order, oversized, or cross-session pages are refused whole rather than
silently dropping rows and stranding pagination. Daemon error text is withheld.
This does not change Coven storage, execution parsing, or the typed chat
activity stream. Detailed native event admission still needs producer contracts.

The route regression uses an isolated store and fixture daemon socket with the
real ownership check, transport, projection, and trace/debug formatters. It
covers response-byte sentinel absence, split signed URLs, forged disclosure,
positive lifecycle fields, invalid pages, cursor retention, rejected requests
that never contact the daemon, and unchanged conversation history. These are
local route tests, not a built HTTP server, live Coven run, rendered UI, or human
accessibility qualification. Debug event exports fed by this route receive its
projection; this is not a blanket qualification of every debug-bundle field.
The encrypted backup path remains a separate local restore artifact.

## Tool outcomes

The shared display status is now `requested | running | ok | error | rejected | unknown`.
Assistant function-call declarations and pre-tool hooks report requests. They
do not prove authorization or execution. Recognized execution-start/progress
frames can advance the same stable call ID to running; native results establish
ok/error. A Codex command's native `declined` status establishes a rejected
request, not a failed execution. The pinned [Rust producer contract](https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/exec/src/exec_events.rs)
declares this command-only status even though its TypeScript SDK declaration
omits it. The adapter rejects unrecognized status values instead of treating
an unknown completion as success. A rejection alone supplies no execution-start
timestamp, authorization receipt, or committed-effect receipt.

Rejected requests remain terminal across duplicate frames, reordered results,
late hooks, live replay, and history. Web and iOS show separate rejection labels
and counts; verification and HFR projections cannot turn a rejection into a
completed execution. Confirmed per-tool cancellation still needs a supported
native producer contract; local stop requests remain unknown.

OpenCode pending snapshots remain requests. Hermes Responses function
call completion is still a request until its execution extension or result is
observed.

OpenCode's explicit nonterminal state takes precedence over an output/error
preview. An undeclared status is quarantined; malformed status types and an
end frame carrying nonterminal state also supply no outcome or continuation
token. Selected schema terminal/error mappings remain authoritative, including
renamed signed-protocol fields. The route fixture checks requested/running/ok
and running/unknown sequences, value-free diagnostics, preserved answer text,
native resume identity and replay without another CLI invocation.

The inspected OpenCode [native state union](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/schema/src/v1/session.ts#L259)
defines pending/running/completed/error. Its [JSON CLI](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/opencode/src/cli/cmd/run.ts#L724)
emits terminal tool items. The broader cancellation/error aliases in Cave's
existing compatibility descriptors still need reconciliation with the canonical
Runtimes owner; this parser change does not rewrite signed profile semantics or
claim confirmed per-tool cancellation. Nonterminal fixtures test the defensive
boundary and do not claim the inspected CLI streams execution starts.

Hermes output-item dispatch checks the native `item.type` before interpreting
IDs or status. Message and reasoning items cannot settle a tool with the same
ID. An added function-call output must carry completed status; unsupported
terminal status values, including cancellation/incomplete labels, leave the
call unresolved for normal turn settlement. They do not fabricate failure or
a confirmed cancellation receipt.

The pinned Hermes [Responses producer](https://github.com/NousResearch/hermes-agent/blob/2b52acc2d8ceea37d06945a8bbc7deddaa30de63/gateway/platforms/api_server_openai_routes.py#L323)
emits a separate reasoning item for each summary burst. Cave shows a metadata-only
running block, then projects only `summary_text` fields from the completed
`reasoning` item. Intermediate text/part events, raw text, signatures and opaque
state never enter the summary display. Malformed summary shapes remain withheld;
interrupted items settle unavailable. The shared tracker handles duplicate
completion, independent blocks, disclosure, replay and history. The route fixture
uses the producer's paired function-call-output added/done events and verifies
that duplicate results do not change the first outcome. Producer/session binding
and live Hermes acceptance remain unverified. Unknown result content blocks stay
withheld instead of entering a JSON fallback; a completed tool can therefore
retain its outcome while its output text is unavailable.

Turn completion, cancellation requests, transport loss, and unfinished saved
records yield unknown outcomes. They cannot establish tool failure, confirmed
cancellation, or committed side effects. Observed duration spans the first
request/start through the result and must not be treated as execution-only
timing. A late result can resolve unknown; late requests, starts, or conflicting
results cannot rewrite the first known outcome. Hook/envelope reconciliation
retains stable identity with bounded windows.

Web and iOS use the same monotonic rule, including replay and history loading.
Requested and unknown counts are visible; neither becomes a successful tool,
verified check result, or synthesized terminal event in HFR export. The new
statuses remain observations, not approval receipts. The typed reasoning and disclosure policy in #5762 remain open.

## Typed reasoning summaries

The additive `reasoning` stream event carries a version 1 block with stable
attempt-scoped identity, explicit representation, running/complete/unavailable
phase, disclosure state, and observation metadata. Reasoning receipt is separate
from tool execution status. Application correlation does not establish a daemon
session/familiar-revision binding; that field remains unavailable.

Codex's pinned [0.145.0 SDK](https://github.com/openai/codex/blob/rust-v0.145.0/sdk/typescript/src/items.ts)
and [0.144.2 SDK](https://github.com/openai/codex/blob/rust-v0.144.2/sdk/typescript/src/items.ts)
designate native `reasoning.text` as a summary. Those admitted profile IDs
allow the completed text. Parser support also exists for the inactive 0.160.0
proposal described below; it does not activate that runtime version.
Starts/updates carry metadata only; the unknown/text-only
profile withholds content. Claude's accepted tool-envelope profiles do not
declare its thinking display representation. Cave retains unavailable block
metadata and explicit native provider-withheld markers; model names cannot
authorize summary text. Documented thinking/redacted-thinking siblings do not
disable tool decoding. Provider continuation objects remain unchanged.

The [Claude display contract](https://platform.claude.com/docs/en/build-with-claude/thinking#reading-thinking-output)
uses the same `thinking` field for summaries, omitted content, and progress
updates depending on the selected display mode. A model version therefore does
not distinguish these representations. Before enabling Claude text, the canonical
Runtimes contract must identify the representation from an accepted descriptor
and actual launch/negotiation evidence, with summary and progress fixtures for
the same model. The `source.repo` on Cave's signed tool profiles does not itself
declare summary support. Live Runtimes `main` was verified at
`2be31ec0b38e1248f75641607f78780e8e8c08e6` on 2026-10-03; its compatibility tree
publishes OpenCode and Grok descriptors, with no Claude display descriptor.
No signature, registry source, or trust gate is changed by this correction.

`ReasoningBlockTracker` projects complete units before SSE, replay, and saved
presentation payloads. It redacts credentials and common email, phone, and
identifier patterns before truncation. Unclassified representations and oversized
units default to metadata-only. This is not a comprehensive PII policy. Required
provider continuation state stays in the existing runtime boundary.

Web and iOS retain multiple blocks and monotonic completion through replay and
history. Provider summary text renders as plain text, so embedded Markdown,
images, or control markers cannot become links, requests, or approval actions.
Web keeps its existing visibility preference; the new native disclosure opens
by default and persists the reader's choice. Existing tagged/legacy web content
is labeled unverified rather than upgraded into a provider summary.

Remaining gaps: relay paths without an admitted native summary contract, other
provider adapters, full tool/legacy-text disclosure policy, verification of the
availability matrix across all real launch paths, full rendering/accessibility acceptance,
and authoritative producer/session binding. Legacy tags are now withheld by the
send/history projection; they never establish provider-summary provenance.

## Tool observation provenance

New send-route tool events carry an optional version 1 `activity` projection.
It records the logical call ID, a Cave-generated observation run ID, a distinct
attempt ID for each launched retry, the display phase, reported source, selected
protocol/profile, available runtime version, and observation timestamps. The
client send token is not used as this identity. Timestamps describe when Cave
observed a request/start/result; a result alone does not invent a start time.
Clock regressions cannot move an existing observation backward.

Sources distinguish runtime reports, local hook reports, and Cave's own
unfinished-outcome settlement. Late frames cannot replace the first known
terminal source or timing. Live SSE, cursor replay, and persisted tools retain
the same projected record. Replaying retained events does not dispatch a turn.
Web and iOS validate call/status association, preserve terminal observations,
and drop mismatched or unknown metadata versions while retaining plain tools.
A client-side disconnect may settle the display to unknown, but cannot attach
producer provenance to that local inference. Legacy tools have no invented
source. Expanded details identify the available report and missing evidence.

The run/attempt IDs are presentation correlation, not daemon execution leases.
Authoritative session/familiar-revision binding, approval, and committed-effect
evidence are explicitly `unavailable`. Raw frames cannot supply these fields;
client transcript writes continue to strip assistant tool telemetry entirely.
Those receipts must come from the existing Coven/Threads ownership boundary;
this change creates no authority ledger.

The separate Flow Copilot path now supplies the shared tracker with a fresh
observation run/attempt, the selected protocol, and the local probed version.
Native execution starts advance requests to running; unresolved calls settle
unknown. Completed history retains those observations and the native model
report separately from requested/forwarded intent. No process exit confirms a
model, and no workflow permission flag becomes an approval receipt. Legacy
tagged text is filtered before persistence and attention/control extraction,
with tool offsets rebased to displayed text. Visible control markers and user
input remain intact. Local CLI fixtures cover both the native-supervisor wire
fixture and degraded direct spawn, with and without a model/version report,
reordered and conflicting results, and private sentinels. The unchanged
process-ownership tests retain two optional native-provider skips when no exact
provider binary is supplied. No live Flow activity stream or real-provider
qualification is claimed.

## Verification boundaries

The versioned shared corpus is
`apps/ios/CovenCave/CovenCaveTests/Fixtures/runtime-activity-v1.json`.
`src/lib/chat-activity-corpus.test.ts` and native `ActivityCorpusTests` consume
that same file: 17 identity cases, six tool sequences, and four summary
sequences. It covers exact native reports, missing/mismatched harness context,
selection aliases, invalid optional fields, historical model preservation,
parallel same-name calls, reordered/duplicate terminal events, rejection,
unknown outcomes, replay, and summary ordering/withholding. XcodeGen includes
the JSON as a unit-test resource; production app resources are unchanged.

The corpus exposed a native validation mismatch: iOS previously accepted a
model-selection alias and malformed version as reported identity. Native live
metadata and restored history now require matching harness context and the same
version/model rules as web. Malformed optional fields remain unavailable while
the transcript stays readable. The native response footer also identifies
missing runtime/version/model evidence explicitly.

These shared checks qualify display decoding, folding and serialization. They
do not yet cover every golden scenario, producer normalization, authenticated
server paths, real-provider execution, rendered UI, or human accessibility.
Those remain separate acceptance evidence; the corpus is not a completion claim.

The additional [native TCP evidence](evidence/runtime-activity-native-transport-2026-10-03.json)
uses the real Swift `CaveClient` against a production Cave build. The shared
`runtime-activity-http-v1.json` scenario supplies only the external Hermes API
frames; Cave's authentication, disclosure, stream buffer, persistence, and
native networking remain in the exercised path. The TypeScript corpus test
also decodes those provider frames across seven-byte UTF-8/SSE boundaries.

The opt-in native test disconnects after observing a running tool, resumes
from its cursor, reopens saved history, replays the completed run twice, and
loads saved tool output. It compares exact identity, tool observations, and
completed summaries across these paths. Replacing the credential denies a
subsequent output read, and the test checks restoration of the simulator's
prior credential state. The fixture ledger must contain exactly one provider
request and one marker-file read; skipped native tests cannot satisfy that gate.

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs scripts/runtime-activity-native-transport.mjs --execute --destination <owned-simulator-uuid> --derived-data <absolute-directory> --evidence <new-absolute-directory>
```

This qualifies one synthetic-provider scenario over loopback HTTP with
forwarded-peer headers. It does not establish remote HTTPS, managed-device
pairing, real Hermes execution, rendered UI, accessibility, physical-device
performance, or protected-effect receipts. The API fixture supplies a model
report but no runtime version; the native identity retains that unavailable
version. Both owned worktrees remain uncommitted and preserved.

The [native restart qualification](evidence/runtime-activity-native-restart-2026-10-04.json)
extends that same production TCP path on build `v1THgZr1dvmIVuJQomLJ5`. After
the turn is persisted, the fixture stops the owned server, verifies its exit and
closed port, and starts a new server at the same origin and store. The Swift
client receives `NoResumableRun` for both old replay keys, then reads identical
answer, identity, tools, summaries and output from saved history twice. A replaced
credential still denies the next output read. The durable fixture ledger retains
one provider request, one marker read and one server restart.

Both native tests passed without skips on the first run; the production build,
TypeScript and bundle budgets, focused harness lint and teardown checks passed.
This proves explicit client recovery after a completed turn's server restart.
It does not qualify automatic rendered recovery, interrupted persistence,
in-flight tool termination, remote HTTPS or a real Hermes provider.

The [native saved-turn recovery packet](evidence/runtime-activity-native-recovery-2026-10-04.json)
adds the actual `ChatThread.replayQueued` path and rendered ChatView. It exposed
a recovery bug: saved text and identity were adopted, but only the interrupted
local tool prefix was settled; saved tools and summaries were omitted. Adoption
now reconstructs activity from the saved reply and validates its saved summaries,
using the same projection as ordinary history restoration. Four assertions
failed before the fix, covering empty and partially received phone state.

The final gate passes two native TCP tests and one native UI test with no skips.
After real server restart, the exact accepted run is adopted without sending
again. The [recovered timeline](evidence/runtime-activity-native-recovery-2026-10-04.png),
[background/foreground capture](evidence/runtime-activity-native-recovery-background-2026-10-04.png)
and [saved tool output](evidence/runtime-activity-native-recovery-output-2026-10-04.png)
retain ordered summaries, prose, the succeeded tool and reported runtime/model.
The fixture ledger remains one provider request and one marker-file read.

The full native suite passes 988 tests and skips one opt-in transport test; that
transport test passes separately in the fixture gate above. All 106 mobile files
and focused harness lint pass. The Release simulator app builds with the DEBUG
recovery fixture excluded. The packet retains earlier harness/assertion failures
and the original early screenshot. An [original-resolution review](evidence/runtime-activity-capture-review-2026-10-04.json)
corrects the earlier missing-row assessment: the PNG contains the complete timeline.
The resized review preview was misleading; no app rendering defect was established.

This fixture seeds an accepted queued delivery and invokes production recovery;
it does not prove the AppModel supervisor's automatic reconnect trigger, a live
app network interruption, managed pairing or an actual Hermes producer. The
external provider is synthetic and reports no runtime version. Remote HTTPS,
human VoiceOver, physical-device performance and protected-effect receipts remain
separate gates. Both owned worktrees remain uncommitted and preserved.

The later [scene-supervisor packet](evidence/runtime-activity-native-supervisor-2026-10-04.json)
removes the fixture's direct replay call. The real app lifecycle now detects a
stopped server, retains the accepted queued turn, and recovers after the server
is restored while the app is backgrounded. Foreground recovery uses normal
discovery, access refresh and queued-message handling. The DEBUG fixture supplies
only isolated cached phone state and an ephemeral credential; it refuses any
saved credential and does not change Keychain or the production supervisor.

The first attempt failed before XCTest connected. After restarting only the
owned simulator, the test reached a real fixture omission: native discovery
returned `503 daemon offline`. The harness now starts a real Coven daemon in its
temporary home and verifies its familiar roster before running. The corrected
gate passes two TCP tests and one UI test, retaining one provider request and
one marker read across both server restarts. This qualifies the normal foreground
recovery trigger for this accepted-snapshot scenario, not a live UI send interruption
or actual Hermes provider execution.

The [recovered transcript](evidence/runtime-activity-native-supervisor-2026-10-04.png),
[later background/foreground view](evidence/runtime-activity-native-supervisor-background-2026-10-04.png)
and [output sheet](evidence/runtime-activity-native-supervisor-output-2026-10-04.png)
retain the reported identity and activity. The [original offline capture](evidence/runtime-activity-native-supervisor-offline-2026-10-04.png)
shows the queued message, reconnect pill and composer intact. Original-resolution
inspection supersedes the earlier obscured-frame assessment from a resized review
preview. This qualifies the captured frame, not continuous visual stability. Full
native tests pass with the separately exercised opt-in skip, and Release compilation
excludes the DEBUG fixture.
Daemon/server teardown, source fingerprints and retained first failures are in
the packet. Remote HTTPS, pairing, real-provider native coverage and human
accessibility remain unqualified.

The optional `--live-ui-send` mode uses the actual composer from an empty isolated
thread. The controller verifies its persisted in-flight run before termination;
the server completes the controlled read and restarts, then ordinary phone
snapshot hydration and saved-turn recovery restore the reply.

The [launch-handoff evidence](evidence/runtime-activity-native-launch-handoff-2026-10-04.json)
resolves the captured startup failure. LLDB observed the app with no fixture
arguments, while simulator logs showed a leftover Live Activity ending during
installation and launching that same PID in the background. The harness now
installs the owned app before each XCTest stage, separating that wakeup from
fixture launch and app-hosted test injection. Production startup, auth and
recovery code remain unchanged. The UI test dismisses the notification prompt
and verifies the running tool is hittable before capture.

Two successive live-send runs pass with the same UI-stage fix. Final source
`c9c026277240a003f65658b9209cc86670474edbbd017251edb9cecae8f8b3b0` also passes
live send and the accepted-queue baseline (two TCP tests and one UI test),
with zero failures/skips. Each run makes one provider request and one marker
read. Stable local message IDs, queued-state settlement, saved summaries,
reported model and fetched output survive termination/restart/hydration.
The [running capture](evidence/runtime-activity-native-live-send-running-2026-10-04.png)
and [hydrated transcript](evidence/runtime-activity-native-live-send-hydrated-2026-10-04.png)
are unobscured at original resolution. Earlier failures, diagnostic attempts,
the interrupted baseline launch and rejected simulator setting remain recorded;
the [earlier live-send packet](evidence/runtime-activity-native-live-send-2026-10-04.json)
is retained as historical evidence.

All 106 mobile files pass on the unchanged app/UI-test source; final harness
lint passes. The previous Release compile/exclusion and full-unit results remain
historical: the only subsequent source changes are in the harness and UI test,
and 26 changed application files match the prior archived Release checkpoint.
Owned fixture processes stop and the simulator is Shutdown. Worktrees remain
uncommitted and preserved. This qualifies the controlled provider fixture;
actual-provider native execution, remote HTTPS/pairing, packaged clients,
protected effects and human accessibility remain separate gates.

The [production-browser evidence](evidence/runtime-activity-browser-2026-10-03.json)
reuses this external provider scenario in headed Dia, with a production Cave
server, isolated Coven daemon, and separate browser profile. The actual model
menu retains only the newest known family members from a synthetic inventory,
plus its custom deployment ID. This verifies the menu policy, not current
provider availability. The single send and repeated history reads retain one
provider request and one fixture marker read.

This run reproduced reasoning hidden behind the collapsed Activity container
despite the default-on preference. Main Chat now supplies reasoning separately
from lazy activity details. The browser verifies the live summary, two saved
summaries after reload, saved opt-in/opt-out, and keyboard disclosure. Frame
sampling observed no preference inversion for those history reloads. Expanded
tool details show the safe marker output and unavailable approval/effect
evidence. The [history view](evidence/runtime-activity-browser-2026-10-03.png)
and [narrow viewport](evidence/runtime-activity-browser-narrow-2026-10-03.png)
are retained. Chronological interleaving, the full golden matrix, light and
alternate themes, native desktop, human accessibility, and comparative
performance remain unqualified; this is not full #5765 or #5767 acceptance.

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs scripts/runtime-activity-browser-fixture.mjs --execute <new-absolute-evidence-directory>
```

The opt-in launcher emits its private browser connection file after readiness.
Keep its terminal attached: `release` completes the controlled provider stream;
`finish` verifies the invocation counts, saves history evidence, and stops the
owned stack. Browser assertions are recorded separately from fixture success.

The [display-order evidence](evidence/runtime-activity-chronology-2026-10-03.json)
adds the data required for interleaving. New structured chat turns share one
Cave-owned first-observation counter between tool activity and reasoning
blocks, including retry attempts. `activity.sequence` and
`observation.sequence` are optional nonnegative safe integers. Updates keep
the first sequence; timestamps and provider IDs do not determine order.
This is display observation order, not runtime execution or authority evidence.

A reasoning block also carries an optional first-observation `textOffset`,
measured in UTF-16 units of the answer stream after legacy-text projection.
Legacy private tags are
removed before an offset crosses the stream/history boundary. Authoritative
answer corrections rebase tool and reasoning anchors; discarded retry prose
resets prior-attempt anchors to the beginning while retaining their identities
and sequence. Native decoding, coalesced tool folding, snapshots, replay and
history retain the same additive fields. Older records keep missing positions;
invalid supplied sequence/summary offsets cannot become trusted display data.

The shared fixtures cover tied clocks, updates, retries, correction rebasing,
invalid values, legacy private-text projection and serialized positions. The
native TCP fixture verifies summary/tool/summary sequence 0/1/2 and UTF-16
positions 0/20/20, including the emoji and trailing newline in the answer
prefix, across live, reconnect, replay, snapshot and saved history. It still
executes exactly one provider request and one controlled marker-file read.
The subsequent [web timeline qualification](evidence/runtime-activity-timeline-2026-10-04.json)
consumes those positions in the existing Main Chat renderer. Stable keyed
tool and summary rows alternate with prose; existing Markdown, rich-card,
tool inspection and disclosure components still own their content. Fences,
paired markers, adjacent questions and grouped image decks stay intact.
Missing or inconsistent positions retain the legacy layout. Persistence maps
positions through attachment/attention cleanup, retaining no offset when the
pure projection cannot reproduce the actual saved text.

The production-browser run verifies summary → prose → tool → summary → final
answer live and after history reload. User-opened tool/summary nodes and focus
survive completion. Saved default-on, opt-out and opt-in remain in force;
sampled reload frames show no preference inversion. The newly arriving summary
stays folded under opt-out while a locally expanded earlier summary stays open.
The [Coven light transcript](evidence/runtime-activity-timeline-light-2026-10-04.png),
[Tide dark transcript](evidence/runtime-activity-timeline-tide-2026-10-04.png) and
[narrow reduced-motion view](evidence/runtime-activity-timeline-narrow-2026-10-04.png)
are retained. Keyboard Enter/Space operates disclosures with visible focus.
The short, recent marker output is included by the existing history policy;
this scenario does not prove lazy network loading of older, larger results.

The app and API suites pass 1,495 and 506 test files respectively; typecheck,
lint, wiring and the production build pass. Native TCP requalification retains
the same sequence and UTF-16 offsets with one provider request and one marker
read. The browser fixture now rejects a closed control input instead of waiting
for its deadline; use an attached PTY (`tty=true` in the execution tool).
All results remain local and uncommitted. The fuller parallel/retry/error/
approval matrix, comparative large-trace performance, native chronological UI,
native desktop, remote HTTPS and human accessibility acceptance were still open
at that checkpoint.

The [native timeline qualification](evidence/runtime-activity-timeline-native-2026-10-04.json)
now renders the same observation order in SwiftUI. A shared corpus of 17
scenarios checks Unicode offsets, code and marker boundaries, grouped content,
same-name tools, retained attempts and legacy fallback in both TypeScript and
Swift. Each stable prose span owns its WebView height; full-response actions
retain their original scope. Native tool rows keep the existing projected
output sheet and source/authority labels.

Summary disclosure choices are stored per message/block separately from the
existing default-on preference. An explicit global change resets local choices.
The simulator verifies chronological rendering, opt-out on newly arriving
blocks, retained expansion through background/foreground and completion,
visible failures, and output-sheet loading/dismissal. Screenshot review caught
and corrected undersized targets and truncated/crowded summary headers at the
largest accessibility text size. The final title bounds and whole tool label
are checked below the sticky date header; human VoiceOver remains unverified.

The final source passes 133 selected native unit tests, all 12 Activity UI
tests, 106 mobile test files and a Release warm-journey smoke test. The smoke
run is not comparative performance evidence. These UI cases use isolated
DEBUG fixtures; they do not establish live-provider or remote HTTPS UI
qualification. The broader rich-content/theme/reduced-motion matrix, large
parallel traces, physical-device performance and human accessibility remain
open. The full goal and issue remain incomplete and uncommitted.

The [rich-content and projection measurements](evidence/runtime-activity-timeline-rich-performance-2026-10-04.json)
extend the shared corpus to 22 scenarios. The installed Markdown parser displays
reference-style links and footnotes literally even in an unsplit response;
chronological sections preserve that text and its definitions. Ordinary inline
links and fenced examples retain the baseline renderer semantics in TypeScript
and the packaged native WebKit bundle. This does not add Markdown syntax support.

Native projection now uses ordered code-range scans and a safe-boundary sweep,
plus binary lookup for each event offset. In the same Release simulator workload,
the median for 1,000 fenced tool events falls from 25.071 ms to 12.700 ms; the
120-event case falls from 1.495 ms to 1.275 ms. Both sets retain two excluded
priming runs and seven measured samples, with exact source and tool-order checks.
Other shapes include neutral/slower samples; all raw results are retained. The
1,000-event case is stress beyond native's current 120-step retention limit.
These timings measure the pure projection, not WebKit creation, layout, scrolling,
memory or physical-device performance. Release unit tests enable testability;
no timing assertion or performance gate was introduced.

That projection checkpoint passes 22 selected native unit tests, three chronological
Activity UI regressions, 106 mobile files, the TypeScript corpus, typecheck and
focused lint. All four UI screenshots were inspected. Complete native rendering
and memory measurements, runtime/path qualification and human VoiceOver acceptance
remain open; this checkpoint is local and uncommitted.

The [native renderer study](evidence/runtime-activity-native-render-budget-2026-10-04.json)
adds opt-in, offline Release journeys at 12 and 120 tools. Completed plain
paragraphs in chronological replies now use selectable native Text. Markdown,
multiline or ambiguous whitespace, code and streaming prose keep the packaged
WebView. Forty shared cases verify selection; the installed TypeScript parser
and packaged WebKit renderer verify the six eligible cases, including Unicode
and emoji joiners. Reader actions still open the full response.

In the mixed 120-tool fixture, attached WebViews fall from 121 to 13. The final
rendered-tail capture reports 195.3 MiB of app-process footprint versus 247.2 MiB
in the baseline, and a maximum first-rich-render span of 3.23 s versus 18.02 s.
Same-process reopening retains the expanded tool and reports 13 attached WebViews
and 222.5 MiB. All raw captures, including earlier candidate results, are retained.
These single-journey observations exclude separate WebKit process memory and
frame/hitch distributions; host load was not controlled. Reopening is navigation,
not history reload or transport qualification. At that checkpoint, all-rich
spans still required a WebView each; the subsequent study below addresses that
cost without imposing a fixed renderer-count budget.

Verification found and corrected a test compile error, an emoji-joiner rejection,
a wrapped reasoning label reporting insufficient height, and clipped reader and
authority text. The [largest-text layout](evidence/runtime-activity-native-plain-ax-2026-10-04.png)
and [retained expanded tool](evidence/runtime-activity-native-retained-2026-10-04.png)
were inspected. Seventy-four selected native unit tests and all twelve Activity
UI cases pass before the final authority-label wrapping correction; the final
source passes two affected UI journeys, the Release 120-tool journey with a
font-based no-truncation assertion, and all 106 mobile files. The evidence records
each tested revision and failed attempt. Physical-device performance, human
VoiceOver and the broader runtime/transport/theme/retry matrix remain incomplete.

The [all-rich renderer study](evidence/runtime-activity-native-rich-rendering-2026-10-04.json)
adds a retained 120-tool workload with 121 rich prose spans. Timeline rows and
their geometry stay mounted. Earlier prose creates WebViews within one viewport
of the visible region and unloads them outside it, retaining measured height.
The existing loading placeholder holds that space until a fresh renderer reports
its height. The tail, streaming prose and VoiceOver retain rich rendering.
Tool expansion remains in the existing app-owned state; reader actions still
open the full response.

In this Release simulator journey, the rendered-tail capture has 10 attached
WebViews versus 121 in the eager baseline, 204.0 versus 248.1 MiB of app-process
footprint, and a maximum first-rich-render span of 3.28 versus 21.38 seconds.
Reopening retains the expanded last tool and reports nine attached WebViews.
The mixed-content journey also retains the expanded tool after reopening and
reports two attached WebViews. These are individual observations with uncontrolled
host load, excluding WebKit process memory and frame/hitch distributions. Renderer
counts depend on content and viewport; the measured span is not complete-transcript
latency. All baseline and candidate captures are retained.

An earlier nested-lazy-stack candidate reduced renderer counts but left a blank
timeline area on mixed-content reopening. A diagnostic
run reproduced the missing tool detail through a ten-second wait. That candidate
was rejected; the evidence keeps its screenshots, failed checks and measurements.

The [earlier expanded tool](evidence/runtime-activity-native-rich-middle-2026-10-04.png)
and [reopened rich tail](evidence/runtime-activity-native-rich-reopened-2026-10-04.png)
were inspected. The scroll journey reaches tool 60, expands it, returns to the
tail and revisits it with both rich WebKit text and expansion intact. Its five
captures contain 10–17 attached WebViews, with no reported renderer failures.
The final source passes 89 selected native unit tests, all twelve Activity UI
cases, the mixed and all-rich Release journeys, the earlier-tool scroll journey,
both shrink/repeated-open recovery cases, and all 106 mobile test files.
Same-process navigation does not establish history reload, remote transport or
provider qualification. Physical-device performance and human VoiceOver acceptance
remain open.

The [recovered native verification](evidence/runtime-activity-recovery-2026-10-03.json)
passes 100 selected unit tests and the running-app Activity UI test. The UI
fixture checks the three-tool summary, failure count, expanded arguments and
failure reason, expansion retention, and missing runtime/model/activity evidence
in the combined accessibility label. It reproduced a footer whose generic
`Model application status` override hid those details; removing that override
lets SwiftUI combine the actual status text. The captured fixture screen is
[retained here](evidence/runtime-activity-ios-2026-10-03.png). This proves the
fixture's rendered and accessibility-tree behavior, not human VoiceOver use,
live native transport, or the complete device/theme matrix.

### Installed-runtime canaries

The [passive probe packet](evidence/runtime-activity-passive-probes-2026-10-03.json)
records Grok 1.0.5 in plain mode and an unavailable bounded OpenCode capability
probe; a separate version-only command returned OpenCode 1.17.16. Grok's help
describes its current `streaming-json` format as native ACP updates, which does
not establish compatibility with Cave's older text/end schema. These observations
do not qualify either installed tool protocol. The canonical Grok descriptor and
native fixtures remain necessary before claiming support.

A later [OpenCode retry](evidence/runtime-activity-opencode-admission-2026-10-03.json)
completed the canonical bounded probe with version `1.17.16`, JSON format and
explicit model/session options. Passive schema selection returns
`opencode-run-json-v1`. The built HTTP canary still fails qualification: missing
and invalid forwarded credentials return 401, and the authenticated Read-only
send returns 501. The existing route refuses OpenCode Read-only mode because
its one-shot CLI lacks an enforceable read-only sandbox. The canary preserves
that refusal and never changes to Full access. Both owned processes stopped.
This establishes launch capability and admission behavior, not successful
provider execution or native tool visibility.

`scripts/runtime-activity-canary.mjs` is an explicit opt-in check using a real
installed CLI and provider account. Run it from this checkout with Node 24:

```sh
node --experimental-strip-types --import ./scripts/test-alias-register.mjs scripts/runtime-activity-canary.mjs --harness claude --execute
node --experimental-strip-types --import ./scripts/test-alias-register.mjs scripts/runtime-activity-canary.mjs --harness codex --execute
node --experimental-strip-types --import ./scripts/test-alias-register.mjs scripts/runtime-activity-canary.mjs --harness copilot --execute --http
# OpenCode records the current Read-only refusal; positive qualification remains unavailable.
node --experimental-strip-types --import ./scripts/test-alias-register.mjs scripts/runtime-activity-canary.mjs --harness opencode --execute --http
```

After `pnpm build`, add `--http` to drive the built server instead of importing
the send handler. That mode reuses the existing conformance server lifecycle,
creates a per-run sidecar credential, checks that missing and invalid credentials
on simulated forwarded requests are refused, and uses HTTP for send, replay,
history, and deadline Stop. It records the build ID and server/send-entry hashes,
then verifies server and daemon teardown. Forwarding headers simulate the
remote-peer classification on loopback; this is not physical remote-client or
packaged UI acceptance.

The script creates a temporary project, familiar, Cave store and Coven daemon,
then requests one read-only tool call against an unpredictable marker file.
It compares live events, the retained replay buffer and saved history, records
the exact native identity when supplied, and verifies its daemon PID is gone.
It retains a content-minimized `report.json` in the printed temporary root.
No `--execute` means no runtime launch. This manual canary is not a CI default.
Copilot version discovery and execution disable automatic CLI updates. The
checker applies both `assistant_chunk` and `assistant_replace`, compares exact
live/replay/history answers and replayed identity, and requires the marker in a
successful native tool result. A refused send records its bounded error code
before stopping; arbitrary error response bodies are not retained.

The observed local results on 2026-10-03 are retained in the
[sanitized evidence packet](evidence/runtime-activity-canaries-2026-10-03.json):

| Runtime | Selected path | Observed result |
| --- | --- | --- |
| Claude Code 2.1.288 through Coven v0.4.7-1-gc8fd9e84 (engine 0.8.0) | Accepted `claude-stream-json-v2` | Native `claude-opus-5-5` report; one Read call requested then successful; marker and identity retained through replay/history |
| Codex CLI 0.160.0 through the same Coven installation | `unsupported-version` fallback | Answer contains the marker, but no tool events reach Cave; runtime version/model remain unreported on this relay path. Tool-visibility qualification fails |

Codex's checked-in schema ranges currently admit 0.144.2 and 0.145.x. The
installed 0.160.0 needs an accepted compatibility update before direct tool
projection can be qualified. Its upstream [item contract](https://github.com/openai/codex/blob/rust-v0.160.0/sdk/typescript/src/items.ts)
was read at blob `8fd3b2c7ff5b47da5f64b16828e03c75c5e60961`; source inspection
does not replace the required reviewed/signed registry fixture or live route proof.

A separate direct capture from the installed 0.160.0 binary did emit one native
`command_execution` start/completion pair, with the unpredictable marker in its
output and final answer. The process exited successfully and its owned process
group was verified gone. The sanitized eight-event fixture and pinned Rust/SDK
source provenance are in [the Codex fixture notes](../../src/lib/fixtures/codex/README.md).
The Rust contract supplies collaboration tools and command rejection status
missing from the SDK listing. A bounded, unsigned schema proposal qualifies
decoding without changing bootstrap ranges, registry keys, or active caches.
The recorded turn supplies no reasoning item or native model identity; summary
classification is tested separately against the source contract. Native capture
success does not change the failed Cave route qualification above.

The publisher audit at Runtimes main `2be31ec0b38e1248f75641607f78780e8e8c08e6`
found only OpenCode/Grok publication. Its open [PR #46](https://github.com/OpenCoven/coven-runtimes/pull/46)
adds OpenClaw and preservation of signed history. A separate local Runtimes
draft, recovered on `fix/issue-5761-codex-recovery`, prepares an offline Codex document
adapter and unsigned example without modifying that active publisher. Generated
test signatures pass Cave's real verifier/cache/resolver and recorded fixture;
stock trust still rejects those test keys. Codex uses a different signed envelope,
and Cave's current configured-URL allowlist accepts the canonical raw-GitHub
repository, not the existing publisher's Pages endpoint. Canonical review must
therefore settle the publisher integration, endpoint, key binding, and immutable
checkpoint together before stock activation. No production key custody or
publisher approval is inferred from these local tests.

The original temporary Runtimes checkout and temporary check logs were lost
during an environment reset. Its six-file draft was recovered from this
session's original patches into a durable isolated worktree. Fresh document,
existing-publisher, and real Cave verifier/cache/fixture checks pass. The Cave
source and recorded fixtures survived; interrupted native/typecheck runs were
rerun with durable logs instead of being treated as successful. The recovery
packet records the new evidence and its remaining admission/acceptance limits.

The recorded module-mode canaries import the real send-route module and contact
a real isolated daemon. They do not exercise a built HTTP server, its authentication middleware,
packaged web/desktop/iOS UI, or human accessibility. Provider authentication and
CLI configuration use the existing account; HOME is not isolated. This read-only
scenario does not qualify protected-effect receipts or a durable side-effect
counter. The native result is one requested-to-successful call, not a separately
observed execution-start event. The complete acceptance matrix remains open.

The later [Claude HTTP canary](evidence/runtime-activity-http-canary-2026-10-03.json)
passed against production build `OMC3GInbK_Gxr6xBnPS1b`. `pnpm build` completed
TypeScript, static generation, server bundling, and both bundle budgets. Missing
and invalid sidecar credentials on simulated forwarded POST requests to
`/api/chat/send` both returned 401. With its per-run credential, the real Claude
turn reported CLI 2.1.288 and `claude-opus-5-5`; one Read request completed with
the unpredictable marker. Live SSE, HTTP cursor replay, and conversation GET
retained matching tool activity, answer, and identity. The server's listener and
owned daemon PID were verified stopped; the changed-source fingerprint remained
unchanged. This closes the imported-handler-only evidence gap for that one
Claude path. It does not qualify the other runtimes, physical remote ingress,
negative authorization on every read/export endpoint, packaged client rendering,
human accessibility, or protected-effect receipts.

The earlier [Copilot HTTP attempts](evidence/runtime-activity-http-copilot-2026-10-03.json)
were **unqualified**. With auto-update disabled, both the canary probe and the
successful native turn reported CLI 1.0.82, despite an earlier ordinary version
inventory reporting 1.0.91. Under `copilot-jsonl-v1`, the second attempt reported
`claude-sonnet-5`, a failed `bash` call, and a successful `view` call containing
the marker; live/replayed tool events matched and saved history retained the
model and answer. Its checker incorrectly ignored `assistant_replace`, so that
attempt did not establish full answer equivalence. The first attempt returned
HTTP 501 before streaming; its refusal code was not captured. After correcting
the checker, the third attempt timed out with no acknowledged Stop. The server
listener and owned daemon were verified stopped after all three attempts.
High host load was observed afterward, but its role in the timeout is unproven.
These failures remain retained. The current-main integration above supplies the
later passing check without widening timeouts or relaxing Read-only.

The later [identity/display HTTP fixture](evidence/runtime-identity-display-http-2026-10-03.json)
qualifies production build `99Q7s--vuhUR7g5J6csDU` after the legacy web-header
correction. Compilation, TypeScript and bundle/standalone budgets passed with
an unchanged source fingerprint. A real built server with an isolated store
and fixture daemon refused missing/invalid forwarded credentials before daemon
access; projected event bytes, lifecycle metadata, cursor reads, malformed scope
refusal, safe errors and historical identity reads passed. Both servers stopped.
The preceding build was stopped for the reproduced source defect and is not
passing evidence. The default-browser fixture reached a server session but
concurrent browser-window activity prevented rendered acceptance; its isolated
servers were also stopped. No private browser content is retained as evidence.
This packet does not upgrade fixture results into real-provider, native-client,
human accessibility, or protected-effect qualification.

Focused CLI protocol fixtures cover bounded discovery, pagination, caching,
failure, and newest-family selection. Real send-route fixtures cover Grok and
OpenCode unconfirmed model intent, Hermes echoed intent versus terminal runtime reports, split-secret
arguments, and matching persisted tool projections. Conversation route fixtures
cover report reload and rejected client-forged identity. The Hermes route fixture
also compares tool observations and identity across live SSE, retained cursor replay,
and saved history. Two explicit turns cover a terminal report and its absence;
neither replay makes a provider request. Adversarial metadata fixtures reject
forged authority, call/status mismatch, invalid timestamps, and future versions.
Native Activity tests cover the same live/replay/history and local-disconnect
rules; this does not establish authoritative producer binding.

Native `ChatResponseControlsTests` cover model inventory authority, historical
selection preservation, and identity decoding/restoration. These tests do not
constitute rendered web/desktop review, VoiceOver acceptance, a real-provider
canary, or complete daemon/native transport verification.

An isolated browser fixture renders the actual React runtime picker with
deterministic inventories. It verifies the disabled saved selection, open menu
after a runtime switch, exact selected model label, and a 375px viewport with
no horizontal overflow. This is component evidence, not full application or
human accessibility acceptance.

The later [Grok ACP qualification](evidence/runtime-activity-grok-acp-2026-10-03.json)
records xAI's HTTP 426 refusal of installed Grok 1.0.5, its native stable upgrade
to 1.0.46 with a retained rollback binary, and a successful direct read-only
marker canary. The captured read_file lifecycle is pending, location update
without status, then completed. Cave's qualified decoder and signed route
fixture preserve requested/result activity and saved history without inventing
running, model identity, or displayable reasoning. Multiline help and short
aliases now probe correctly; advertised ACP requires an exact-version schema.
An unsigned descriptor is mirrored in Runtimes with an offline test of its
existing signer against Cave's verifier/cache/decoder. This does not publish a
bundle or install trust keys. Canonical signed admission and stock-trust live
Cave/Grok acceptance remain pending; source/binary reproducibility is unproven.
