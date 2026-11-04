# Upstream API anomaly suite

Every third-party API the Cave server calls is declared once, in
`src/lib/server/upstream-api-registry.ts`, and proven three ways (#6359):

- **Relevant.** `src/lib/server/upstream-api-registry.test.ts` scans the server
  source for every file that both calls `fetch` and names an external host.
  A call site the registry does not credit fails the scan; so does a registry
  caller that no longer fetches, a host no caller names, and a stale
  link-only allowlist entry. The fix is always a one-line registry edit.
- **Adaptive.** `src/lib/testing/upstream-anomaly-fetch.ts` replaces
  `globalThis.fetch` with a router keyed by the registry. A test registers one
  healthy handler per upstream and switches that upstream into a fault mode
  live, between calls, with `inject`. A request to a host the registry does
  not declare is refused like a dead socket and recorded, so a route that
  quietly grows a dependency fails its own matrix test through
  `assertAllDeclared`. Nothing resolves a hostname.
- **Self-healing.** `src/lib/testing/upstream-anomaly-matrix.ts` drives a
  caller through the standard matrix — `http-500`, `http-502`,
  `auth-revoked`, `rate-limit`, `timeout`, `network`, `malformed-json`,
  `empty-body`, `schema-drift` — and asserts, per anomaly, that the caller
  answers instead of throwing, that no credential appears in the answer or
  the error, and that the very next call after the upstream heals reaches it
  again and meets the healthy contract. A failure remembered past the outage
  fails the matrix.

## The live half: `upstreamFetch`

Every registry caller reaches its upstream through
`src/lib/server/upstream-fetch.ts`, and the relevance scan fails when one
does not. `upstreamFetch(id, url, init, options)` is a drop-in for `fetch`
that acts on each answer the moment it arrives:

- every call carries a deadline (10 s by default, merged with the caller's
  own signal, raised with `timeoutMs` for long downloads and streams), so a
  stalled socket ends as a `TimeoutError`;
- an idempotent read that meets a 5xx, a timeout, a dead socket, or a rate
  limit with a short `Retry-After` is retried once after a jittered wait, so a
  single bad answer heals inside the call; writes are never retried, and a
  periodic poller such as the GitHub watcher passes `retries: 0` because its
  next tick is the retry;
- a rate limit with a long `Retry-After` (or a GitHub primary rate limit)
  opens a per-host cooldown in which calls are answered at once with a
  synthesised 429 carrying the remaining `Retry-After` and the
  `x-coven-upstream-cooldown` header, so each caller's own rate-limit branch
  still applies and nothing is sent to a host that asked to be left alone;
- three timeouts or dead sockets in a row open a short cooldown in which
  calls throw an `UpstreamCooldownError` (a `TypeError`, so every
  "unreachable" branch already handles it); a host answering 5xx is
  reachable, so it is marked degraded but not cut off;
- both cooldowns are half-open: the first call after the window goes
  through, and a success closes it instantly;
- the per-host ledger (`upstreamHealth(id)`, `upstreamHealthSnapshot()`)
  records anomaly classes, counters and cooldown windows — never a URL,
  header, body or token — and `GET /api/daemon/diagnostics` publishes it as
  `upstreams`.

Body-format anomalies (torn JSON, an empty body, a drifted schema) remain the caller's contract. The ledger additionally observes transport errors while a caller consumes a native Response body. A post-header timeout or socket reset marks the host degraded without buffering the stream or dispatching a retry. Consumer cancellation remains distinct from provider downtime.

A matrix case with `expectLiveDetection: true` also asserts the ledger saw
each status or transport anomaly as it happened, reads healthy after the
heal, and that every call carried a deadline. The harness starts a fresh
ledger episode for a host on every `inject` and `heal`. A unit test that
drives a caller with its own fake fetch should call `resetUpstreamHealth()`
per case, so a 429 in one case cannot leave the host cooling for the next.

Two callers stay on plain `fetch` by design, each named with its reason in
the scan: `src/lib/voice/openai-realtime.ts` and `src/lib/voice/elevenlabs.ts`
ship to the browser through the voice registry, so the server ledger stays
out of the client bundle. Their calls hold their own `AbortSignal.timeout`
instead. A matrix call's `hasDeadline` is true only for a signal from
`upstreamFetch`, because a bare signal has no timer to prove; these two callers
assert `hasSignal`.

## Adding or changing an upstream call

1. Add the host and the calling file to the matching entry in
   `src/lib/server/upstream-api-registry.ts`, or add an entry. A host that
   appears only as a link or User-Agent string goes in `LINK_ONLY_HOSTS`
   with its reason. Loopback services carry `loopback: true`; callers that
   fetch an operator-supplied URL carry `userSupplied: true`.
2. Call the upstream through `upstreamFetch(id, url, init)` rather than
   `fetch`; the scan refuses a raw fetch in a registry caller.
3. Add `route.upstream-anomalies.test.ts` beside the route (or
   `<module>.upstream-anomalies.test.ts` beside a library module). Copy the
   shape of `src/app/api/github/pat/route.upstream-anomalies.test.ts`:
   isolate the Cave home, set the credential in `process.env`, install the
   harness, import the module, register the healthy handler, run
   `runUpstreamAnomalyMatrix` with per-anomaly expectations derived from the
   code. Pass `secrets` so the token can never leak and
   `expectLiveDetection: true` so the ledger is checked. Use `mayThrow` for a
   library whose contract is a typed error.
4. Where the caller caches, stub `Date.now` and step the clock in
   `beforeEach`/`beforeHeal` so the healed call is reachable, and add an
   explicit healthy → fault → healed test without clearing route caches or
   advancing the route clock between fault and recovery.
5. Wire the file into the `api` suite in `scripts/run-tests.mjs` (and into
   `ALIAS_LOADER` when it imports anything that resolves `@/`). Run
   `node scripts/check-tests-wired.mjs`.

## What the matrix does not claim

The harness answers at the fetch boundary. It does not exercise DNS, TLS,
proxies, or the native daemon. The matrix proves graceful degradation and
immediate recovery per caller; the retry and cooldown policy is proven once,
in `upstream-fetch.test.ts`, and the matrix runner treats a cooldown window
as elapsed before each heal so the two contracts stay separate.

## Unconfirmed GitHub writes

A GitHub write can land before its answer is lost. Routes return `ambiguous-write` unless the request provably never left, and the clients in `src/lib/github-write-answer.ts` treat the same way an unreadable answer from Cave, including a torn 200. In each case the UI asks the user to check on GitHub before sending again and never retries on its own.

## Provider retry windows

Explicit provider retry windows are retained through their requested expiry, including waits longer than an hour. Only transport-failure backoff uses the short cooldown cap. No long timer is allocated: the next call compares the recorded retry timestamp with the current clock. The long-window regression covers numeric and HTTP-date `Retry-After`, GitHub primary-limit resets, no early dispatch, and successful recovery after expiry.

## GitHub write response validation

The proposal, composer and Coding Desk PR actions validate Cave's write envelope before displaying its fields or confirming success. `ok` must be boolean; optional `error` and `code` fields must be strings. Invalid envelopes remain unconfirmed instead of exposing malformed values to React or offering an ordinary retry. Rendered component regressions prove that an uncertain card links to GitHub, an uncertain review preserves its draft, and refresh does not resend the write. These fixtures do not prove live GitHub or native-device acceptance.


## Cache, audio and provider-error recovery

Home Tweets retains its last good timeline when a 200 lacks a complete RSS/Atom envelope. A valid empty feed remains cacheable. RSS marks unreadable sources as failed and caches an aggregate only when every source is healthy. The feed guard recognizes envelope completion and balanced item/entry boundaries; it does not provide general XML validation.

Skills search caches only non-empty live entries. Failed, empty or non-text SKILL.md previews remain retryable. Dedicated regressions drive every standard anomaly through feed, search and preview callers and prove the next healed call reaches the provider without resetting route caches or advancing their clocks. The shared provider cooldown is reset by the harness to separate route-cache behavior from Retry-After policy; it remains qualified independently.

Voice preview accepts MP3 response types before reading and caching bytes. ElevenLabs validates the requested MP3 or PCM response type, requires a first non-empty chunk, and then streams with backpressure and cancellation. Missing or non-audio types, empty audio and initial stream failures return an actionable 502. A later streaming failure remains a stream error after headers have been sent; no successful complete-audio claim is made. Provider messages retain useful context while the shared redactor removes the exact configured credential and recognized secret formats. Both real audio route handlers have echoed-toy-credential regressions.

The intentional projects/icon precharged cooldown remains unchanged. Salem's old fallback rows are superseded by the separately owned #6399/#6408 no-egress retirement contract after that work lands; this class does not implement a replacement assistant. These are synthetic server-handler checks, without live provider calls, native audio playback, packaged builds or human acceptance.

The feed-envelope guard advances a single cursor through tags, quoted attributes, comments, processing instructions, CDATA and inert declarations. It rejects mismatched/truncated structure and nesting deeper than 256 without resolving entities. It does not validate the full XML grammar. A bounded child-process regression rejects large malformed tag/comment prefixes without leaving the API test runner stuck. The original regex-based malformed-feed timeout and hosted CodeQL failure are retained for comparison; security acceptance requires the repaired head's scan.


## Retained acceptance regressions

A dispatched GitHub merge requires a boolean `merged` verdict. A readable 200 with a missing or drifted verdict remains `ambiguous-write`; explicit `merged: false` remains a definite refusal. Reviewed-head callers retain the atomic SHA guard, and uncertain answers trigger neither automatic retry nor branch cleanup.

Response-body observation preserves status, headers, redirect URL/type metadata, clone behavior, backpressure and cancellation. It records transport classes without error messages, URLs or credentials. The ledger can observe only the stream errors that consumption exposes; it does not validate JSON/schema or claim completed native playback from headers.

The relevance inventory now parses call expressions independently of inline host literals, including named/renamed Node HTTP imports and simple aliases. Mutation regressions prove that both imported-URL and destructured-request callers fail without registration. Existing internal or separate-contract dynamic calls carry exact argument/count boundaries with reasons. A changed or stale boundary fails; these entries do not grant blanket file exemptions. This source-level inventory is not an interprocedural call-graph proof: indirect callbacks, runtime-computed imports and separately qualified runtime/artifact transports remain explicit coverage limits, not provider-matrix acceptance.

A header-only 200 is provisional for body-failure streaks: three sequential body timeouts enter the existing transport cooldown, and completed healthy consumption closes it. A failed status and its failed body count as one attempt. A body failure cannot shorten an explicit provider retry window. These cases are qualified separately from schema parsing and caller cancellation.
