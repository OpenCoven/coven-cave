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

## Adding or changing an upstream call

1. Add the host and the calling file to the matching entry in
   `src/lib/server/upstream-api-registry.ts`, or add an entry. A host that
   appears only as a link or User-Agent string goes in `LINK_ONLY_HOSTS`
   with its reason. Loopback services carry `loopback: true`; callers that
   fetch an operator-supplied URL carry `userSupplied: true`.
2. Add `route.upstream-anomalies.test.ts` beside the route (or
   `<module>.upstream-anomalies.test.ts` beside a library module). Copy the
   shape of `src/app/api/github/pat/route.upstream-anomalies.test.ts`:
   isolate the Cave home, set the credential in `process.env`, install the
   harness, import the module, register the healthy handler, run
   `runUpstreamAnomalyMatrix` with per-anomaly expectations derived from the
   code. Pass `secrets` so the token can never leak. Use `mayThrow` for a
   library whose contract is a typed error.
3. Where the caller caches, stub `Date.now` and step the clock in
   `beforeEach`/`beforeHeal` so the healed call is reachable, and add an
   explicit test that a failure is not served past its documented hold.
4. Wire the file into the `api` suite in `scripts/run-tests.mjs` (and into
   `ALIAS_LOADER` when it imports anything that resolves `@/`). Run
   `node scripts/check-tests-wired.mjs`.

## What the matrix does not claim

The harness answers at the fetch boundary. It does not exercise DNS, TLS,
proxies, or the native daemon, and a `timeout` injected against a caller with
no deadline rejects at the harness ceiling rather than hanging — the call
record's `hasDeadline` says whether the caller bounded the request itself.
The matrix proves graceful degradation and immediate recovery; it does not
prove retry policy, which each caller documents for itself.
