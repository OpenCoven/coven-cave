# X API Research and Familiar Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect one X account to Coven Cave, let explicitly authorized familiars save and use bounded X research sources, and let explicitly authorized Comms rooms publish one exact, text-only X post after human confirmation.

**Architecture:** Keep credentials and all X network access in server modules. Familiar Studio owns account state and per-familiar grants; Research Desk stores durable identity-only source records and materializes short-lived post files for an exact mission run; Comms freezes approved text behind a one-time preview token and records a durable receipt before one non-retried write. The work is divided into three review checkpoints: account/API foundation, Research Desk ingestion, and confirmed Comms publishing.

**Tech Stack:** TypeScript, React 19, Next.js App Router, Node.js HTTP and crypto APIs, Tauri 2 capabilities, the existing AES-GCM local vault, atomic JSON stores, Node test runner, Vitest, Rust/Tauri tests, and the Coven design-token system.

---

## Approved design and execution constraints

The binding design is
`docs/superpowers/specs/2026-07-27-x-api-research-and-publishing-design.md`.
Implementation must preserve these boundaries:

- One OpenCoven-owned Native X application in production. Users do not enter a
  production client ID or client secret.
- OAuth 2.0 Authorization Code with PKCE uses the system browser and the fixed
  callback `http://127.0.0.1:1456/x/oauth/callback`.
- `COVEN_CAVE_X_CLIENT_ID` is a development/staging override. The packaged
  production ID comes from the build variable
  `COVEN_CAVE_X_PRODUCTION_CLIENT_ID`.
- Tokens stay encrypted under `X_OAUTH_TOKEN_BUNDLE`; neither browser state nor
  familiar environments receive credentials.
- `xResearchEnabled` and `xPublishEnabled` are familiar-specific, default
  false, independent, and enforced on the server.
- Research reads are explicit: one post URL or one recent search capped at ten
  results. There is no polling, automatic pagination, or background search.
- Durable research state stores X identity, provenance, user notes, tags,
  mission links, and availability, but not post text, author display data,
  metrics, or raw API payloads.
- Mission post content exists only in a cache of at most 24 hours and in an
  exact run's `runtime/x/` directory. It is removed after that run settles.
- Publishing accepts one text body, freezes the exact preview for ten minutes,
  and sends only the preview token on confirmation. No media, location,
  replies, quotes, polls, scheduling, threads, or autonomous writes are added.
- A create-post call is dispatched at most once. A network-ambiguous result is
  recorded as `uncertain` and is never retried automatically.
- Existing `social` drafts remain local-only. The new external channel is
  explicitly `x`.
- No implementation commit, push, PR, or release is implicit in this planning
  document. Follow the active maintainer authorization at execution time.

## Execution preflight

- [ ] Read the complete binding design and UI contract before editing:

  ```bash
  sed -n '1,760p' docs/superpowers/specs/2026-07-27-x-api-research-and-publishing-design.md
  sed -n '1,760p' docs/coven-design-language.md
  ```

  Expected: the X design ends with the acceptance audit, and the design
  language includes the §9 shipping checklist and §10 copy contract.

- [ ] Refresh the branch and duplicate-work evidence without disturbing the
  primary checkout:

  ```bash
  git fetch origin
  git status --short --branch
  git log --oneline --decorate origin/main..HEAD
  gh api -X GET repos/OpenCoven/coven-cave/pulls \
    -f state=open -f per_page=100 \
    --jq '.[] | select((.title | ascii_downcase | contains("x api")) or (.title | ascii_downcase | contains("x research")) or (.head.ref == "feat/cave-8i8q5-x-api")) | {number,title,head:.head.ref,url:.html_url}'
  ```

  Expected: this worktree is on `feat/cave-8i8q5-x-api`, the approved design
  commit is the only intentional commit ahead of `origin/main`, and no separate
  open PR owns the same implementation. If another active owner or PR appears,
  stop and reconcile ownership before editing.

- [ ] Refresh Beads and confirm the exact issue remains assigned to this work:

  ```bash
  bd prime
  bd show cave-8i8q5 --json
  bd ready --json
  ```

  Expected: `cave-8i8q5` is `in_progress` for Val and names this branch/worktree.
  Do not claim a second bead. Record milestone notes in this bead without
  secrets, tokens, OAuth state, post text, or search text.

- [ ] Establish a clean implementation baseline and run the design auto-fixer
  before hand-editing any UI:

  ```bash
  pnpm codemod:design
  git diff --exit-code
  pnpm check:tests-wired
  ```

  Expected: the codemod is a no-op on the clean branch and test wiring passes.
  If the codemod changes unrelated files, stop and reconcile the drift instead
  of carrying it into this feature.

## File structure

### Shared X and account foundation

- `src/lib/x-api.ts`: normalized public types, URL parsing, canonical URLs,
  scopes, safe error codes, and status mapping.
- `src/lib/server/x-app-config.ts`: production/development client-ID selection,
  endpoints, redirect URI, scope sets, and release-safe configuration checks.
- `src/lib/server/x-credentials.ts`: strict encrypted token bundle,
  single-flight refresh, rotation, connection status, and disconnect.
- `src/lib/server/x-client.ts`: the only raw X HTTP caller; strict schemas for
  token exchange, refresh, account identity, reads, search, and create-post.
- `src/lib/server/x-oauth.ts`: one in-memory PKCE flow and fixed loopback
  listener.
- `src/lib/server/x-access.ts`: server-side familiar-grant enforcement,
  authenticated read/write preflight, and sanitized route errors.
- `src/lib/open-system-browser.ts`: desktop system-browser invocation with a
  local-browser fallback and remote/mobile refusal.
- `src/components/familiar-x-section.tsx`: Familiar Studio account and grant
  controls.

### Research Desk

- `src/lib/server/x-sources.ts`: familiar-scoped source identities, normalized
  cache, deduplication, availability, transient purge, and expiry sweep.
- `src/lib/server/x-mission-sources.ts`: exact-run X hydration, manifest
  writing, availability results, cleanup, and crash-residue sweep.
- `src/components/role-surfaces/research-x-sources.tsx`: URL lookup, bounded
  search, preview, save, refresh, and mission attachment in Resources.
- `src/lib/research-missions.ts`,
  `src/lib/research-artifact-contract.ts`,
  `src/lib/research-mission-flow.ts`, and
  `src/lib/server/research-mission-runner.ts`: identity-only X source
  contracts and lifecycle integration.
- `src/lib/server/automation-runner.ts`: scheduled Research Mission hydration
  and cleanup keyed by automation run.

### Confirmed publishing

- `src/lib/server/x-publishes.ts`: one-time exact previews, in-flight
  coordination, text hashes, and atomic per-familiar receipts.
- `src/components/role-surfaces/x-publish-dialog.tsx`: exact account/text
  confirmation modal.
- `src/components/role-surfaces/messenger-surface.tsx`: explicit `x` channel,
  approval revocation on edit, immutable published/uncertain drafts, and recent
  receipts.

### Local routes

- `src/app/api/x/connection/route.ts`
- `src/app/api/x/oauth/start/route.ts`
- `src/app/api/x/posts/lookup/route.ts`
- `src/app/api/x/posts/search/route.ts`
- `src/app/api/x/sources/route.ts`
- `src/app/api/x/publishes/route.ts`
- `src/app/api/x/publish-previews/route.ts`
- `src/app/api/x/posts/route.ts`

The loopback callback is intentionally not a Next route.

## Milestone A — account and API foundation

### Task 1: Pin normalized X contracts and URL handling

**Files:**

- Create: `src/lib/x-api.ts`
- Create: `src/lib/x-api.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing public-contract tests**

  Cover:

  - `x.com/<handle>/status/<numeric-id>` and
    `twitter.com/<handle>/status/<numeric-id>`;
  - query/hash removal and canonical `https://x.com/<handle>/status/<id>`;
  - a handle-free fallback of `https://x.com/i/web/status/<id>`;
  - rejection of credentials, non-HTTP protocols, non-X hosts, non-status
    paths, and non-numeric IDs;
  - the normalized post shape;
  - the complete safe error-code union and HTTP status mapping.

  Pin the public shapes:

  ```ts
  export type XScope =
    | "tweet.read"
    | "users.read"
    | "offline.access"
    | "tweet.write";

  export const MAX_X_JSON_BYTES = 256 * 1024;
  export const MAX_X_POST_TEXT_BYTES = 128 * 1024;

  export type NormalizedXPost = {
    id: string;
    canonicalUrl: string;
    text: string;
    author: { id: string; username: string; name?: string };
    createdAt: string;
  };

  export type XErrorCode =
    | "not-configured"
    | "not-connected"
    | "capability-disabled"
    | "missing-scope"
    | "unauthorized"
    | "billing-unavailable"
    | "rate-limited"
    | "not-found"
    | "invalid-request"
    | "upstream-unavailable"
    | "ambiguous-write"
    | "invalid-response"
    | "oauth-in-progress"
    | "oauth-port-in-use"
    | "oauth-expired";
  ```

- [ ] **Step 2: Register and prove the test is red**

  Add `src/lib/x-api.test.ts` beside the other public library tests in the
  `app` suite.

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/x-api.test.ts
  ```

  Expected: failure because `x-api.ts` and its exports do not exist.

- [ ] **Step 3: Implement the smallest pure contract**

  Export:

  ```ts
  parseXPostUrl(raw: string): { postId: string; username?: string; canonicalUrl: string }
  canonicalXPostUrl(postId: string, username?: string): string
  xErrorHttpStatus(code: XErrorCode): number
  xErrorLogCategory(error: unknown): XErrorCode | "internal"
  ```

  `XApiError` must expose only `code`, `safeMessage`, optional `status`,
  optional `retryAt`, and `dispatched`. It must never interpolate raw response
  bodies, tokens, search text, post text, or full user URLs.

  Every X JSON route uses `MAX_X_JSON_BYTES`. Preview creation additionally
  enforces `MAX_X_POST_TEXT_BYTES` by UTF-8 byte length; the displayed
  character count remains advisory and is not the acceptance rule.

- [ ] **Step 4: Run the focused test and wiring gate**

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/x-api.test.ts
  pnpm check:tests-wired
  ```

  Expected: both pass.

- [ ] **Step 5: Create the signed checkpoint when implementation commits are authorized**

  ```bash
  git add src/lib/x-api.ts src/lib/x-api.test.ts scripts/run-tests.mjs
  git diff --cached --check
  git commit -S -m "feat: define X integration contracts"
  ```

### Task 2: Make the OpenCoven X app configuration release-safe

**Files:**

- Create: `src/lib/server/x-app-config.ts`
- Create: `src/lib/server/x-app-config.test.ts`
- Create: `scripts/check-x-app-release.mjs`
- Create: `scripts/check-x-app-release.test.mjs`
- Modify: `next.config.ts`
- Modify: `.github/workflows/release.yml`
- Modify: `src-tauri/release-runtime.test.mjs`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing configuration and release tests**

  Assert these constants exactly:

  ```ts
  X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize"
  X_TOKEN_URL = "https://api.x.com/2/oauth2/token"
  X_API_BASE_URL = "https://api.x.com/2"
  X_OAUTH_REDIRECT_URI = "http://127.0.0.1:1456/x/oauth/callback"
  X_OAUTH_CALLBACK_PORT = 1456
  X_RESEARCH_SCOPES = ["tweet.read", "users.read", "offline.access"]
  X_PUBLISH_SCOPES = ["tweet.read", "users.read", "offline.access", "tweet.write"]
  ```

  Test client-ID precedence:

  1. trimmed `COVEN_CAVE_X_CLIENT_ID`;
  2. trimmed `COVEN_CAVE_X_PRODUCTION_CLIENT_ID`;
  3. typed `not-configured`.

  The release-check test must spawn the script once with no production ID
  (non-zero with a precise message) and once with
  `test-client-id-123` (zero without printing the value).

- [ ] **Step 2: Register and run the red tests**

  Add both new tests to the `app` suite.

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/server/x-app-config.test.ts
  node scripts/check-x-app-release.test.mjs
  ```

  Expected: both fail because the files and build wiring are absent.

- [ ] **Step 3: Implement build-time and runtime selection**

  In `next.config.ts`, add:

  ```ts
  env: {
    COVEN_CAVE_X_PRODUCTION_CLIENT_ID:
      process.env.COVEN_CAVE_X_PRODUCTION_CLIENT_ID?.trim() ?? "",
  },
  ```

  In the release workflow, put the public client ID on the `build` job so all
  macOS, Linux, and Windows legs inherit the same value:

  ```yaml
  env:
    COVEN_CAVE_X_PRODUCTION_CLIENT_ID: ${{ vars.COVEN_CAVE_X_PRODUCTION_CLIENT_ID }}
  ```

  Add a **Require OpenCoven X app configuration** step before platform builds:

  ```yaml
  - name: Require OpenCoven X app configuration
    run: node scripts/check-x-app-release.mjs
  ```

  The check validates only presence and a conservative public-client-ID
  character/length shape. It must not print the ID.

- [ ] **Step 4: Pin release workflow wiring**

  Extend `src-tauri/release-runtime.test.mjs` to assert that the build job has
  the repository variable and invokes the release check before a Tauri build.
  Do not require this variable in ordinary PR CI; mocked tests and builds must
  remain possible without live X configuration.

- [ ] **Step 5: Run focused and release contract tests**

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/server/x-app-config.test.ts
  node scripts/check-x-app-release.test.mjs
  node src-tauri/release-runtime.test.mjs
  pnpm check:tests-wired
  ```

  Expected: all pass. Live release remains blocked until the repository
  variable contains the actual OpenCoven Native App client ID.

- [ ] **Step 6: Create the signed checkpoint when authorized**

  ```bash
  git add src/lib/server/x-app-config.ts \
    src/lib/server/x-app-config.test.ts \
    scripts/check-x-app-release.mjs \
    scripts/check-x-app-release.test.mjs \
    next.config.ts .github/workflows/release.yml \
    src-tauri/release-runtime.test.mjs scripts/run-tests.mjs
  git diff --cached --check
  git commit -S -m "build: require OpenCoven X app configuration"
  ```

### Task 3: Encrypt, validate, refresh, and rotate one token bundle

**Files:**

- Create: `src/lib/server/x-credentials.ts`
- Create: `src/lib/server/x-credentials.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing credential-service tests**

  Use temporary `COVEN_CAVE_LOCAL_VAULT_FILE` and
  `COVEN_CAVE_LOCAL_VAULT_KEY_FILE` paths. Pin:

  - strict parsing of access token, refresh token, expiry, scopes, and minimal
    account identity;
  - encrypted persistence under `X_OAUTH_TOKEN_BUNDLE`;
  - no plaintext token in the vault file;
  - missing/malformed bundle fails closed as disconnected;
  - missing required scope returns `missing-scope`;
  - concurrent refresh callers invoke the injected refresh function once;
  - rotated refresh and access tokens replace the bundle atomically;
  - refresh failure leaves the last complete bundle untouched;
  - disconnect removes the secret and clears in-memory refresh state;
  - connection status never exposes either token.

  The stored bundle shape is:

  ```ts
  type XTokenBundle = {
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
    scopes: XScope[];
    account: { id: string; username: string; name: string };
  };
  ```

- [ ] **Step 2: Register and run the red test**

  Add the test to the `app` suite and `ALIAS_LOADER` only if its final import
  graph reaches `@/`.

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/server/x-credentials.test.ts
  ```

  Expected: failure because the credential service does not exist.

- [ ] **Step 3: Implement an injectable service and production singleton**

  Export a `createXCredentialService(deps)` factory for deterministic tests and
  a production singleton backed by:

  ```ts
  getLocalEncryptedSecret("X_OAUTH_TOKEN_BUNDLE")
  setLocalEncryptedSecret("X_OAUTH_TOKEN_BUNDLE", JSON.stringify(bundle))
  deleteLocalEncryptedSecret("X_OAUTH_TOKEN_BUNDLE")
  ```

  Public operations:

  ```ts
  getConnectionStatus(): XConnectionStatus
  replaceBundle(bundle: XTokenBundle): void
  getAccessToken(requiredScopes: XScope[], options?: { refreshIfExpiringWithinMs?: number }): Promise<string>
  forceRefresh(requiredScopes: XScope[]): Promise<string>
  disconnect(): void
  ```

  Use one module-level refresh promise. Persist the complete refreshed bundle
  before resolving waiters. Never persist a partial token response.

- [ ] **Step 4: Run focused tests**

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/server/x-credentials.test.ts
  pnpm check:tests-wired
  ```

  Expected: pass with no token text in test output.

- [ ] **Step 5: Create the signed checkpoint when authorized**

  ```bash
  git add src/lib/server/x-credentials.ts \
    src/lib/server/x-credentials.test.ts scripts/run-tests.mjs
  git diff --cached --check
  git commit -S -m "feat: store X credentials securely"
  ```

### Task 4: Implement the strict X HTTP client

**Files:**

- Create: `src/lib/server/x-client.ts`
- Create: `src/lib/server/x-client.test.ts`
- Modify: `src/lib/server/x-credentials.ts`
- Modify: `src/lib/server/x-credentials.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing client tests with an injected `fetch`**

  Cover:

  - PKCE code exchange and refresh form bodies;
  - `/2/users/me` strict account identity;
  - single-post lookup with `tweet.fields=created_at,author_id`,
    `expansions=author_id`, and `user.fields=id,name,username`;
  - recent search with `max_results=10`, no `next_token`, and no loop;
  - create-post body exactly equal to `{ "text": exactText }`;
  - normalized success records only;
  - 401, 402, 403, 404, 429 with parsed retry time, 400 safe validation,
    5xx, malformed JSON, missing expansions, and unexpected success shapes;
  - timeout/network failure on reads becomes `upstream-unavailable`;
  - timeout/network failure after invoking create-post becomes
    `ambiguous-write` with `dispatched: true`;
  - no automatic second create-post fetch under any failure.

- [ ] **Step 2: Register and prove the client test is red**

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/server/x-client.test.ts
  ```

  Expected: failure because the client does not exist.

- [ ] **Step 3: Implement one raw HTTP boundary**

  Export:

  ```ts
  exchangeXAuthorizationCode(input): Promise<XTokenResponse>
  refreshXToken(input): Promise<XTokenResponse>
  fetchXAccount(accessToken: string): Promise<XAccount>
  lookupXPost(accessToken: string, postId: string): Promise<NormalizedXPost>
  searchRecentXPosts(accessToken: string, query: string): Promise<NormalizedXPost[]>
  createXPost(accessToken: string, text: string): Promise<{ id: string }>
  ```

  Requirements:

  - one abort timeout per outbound request;
  - manual runtime schema checks without exporting raw response objects;
  - URL construction through `URL`/`URLSearchParams`;
  - no logging of tokens, text, query, response bodies, or full user URLs;
  - search query trimmed, non-empty, and capped at 512 Unicode code points;
  - result array hard-capped at ten even if an invalid upstream response
    contains more;
  - create-post calls `fetch` exactly once.

  Wire `x-credentials.ts` to the client's refresh operation through its
  production dependency while retaining injected refresh in tests.

- [ ] **Step 4: Run client and credential tests**

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/server/x-client.test.ts
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/server/x-credentials.test.ts
  ```

  Expected: both pass.

- [ ] **Step 5: Create the signed checkpoint when authorized**

  ```bash
  git add src/lib/server/x-client.ts src/lib/server/x-client.test.ts \
    src/lib/server/x-credentials.ts src/lib/server/x-credentials.test.ts \
    scripts/run-tests.mjs
  git diff --cached --check
  git commit -S -m "feat: add strict X API client"
  ```

### Task 5: Complete PKCE through the fixed loopback listener

**Files:**

- Create: `src/lib/server/x-oauth.ts`
- Create: `src/lib/server/x-oauth.test.ts`
- Create: `src/app/api/x/connection/route.ts`
- Create: `src/app/api/x/oauth/start/route.ts`
- Create: `src/app/api/x/account-routes.test.ts`
- Modify: `src/app/api/api-contracts.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing PKCE and loopback tests**

  Use an injected clock, randomness source, HTTP-listen function, exchange
  function, account fetcher, and credential service. Cover:

  - 32-byte verifier entropy and S256 base64url challenge;
  - one active flow at a time;
  - ten-minute state/verifier expiry;
  - exact `GET /x/oauth/callback` acceptance;
  - method, path, missing code, state mismatch, replay, and expired rejection;
  - token replacement only after exchange and `/2/users/me` validation;
  - failed scope upgrade preserves the previous bundle;
  - listener closes after success, failure, cancellation, or expiry;
  - a held test port yields `oauth-port-in-use`;
  - the error copy includes
    `lsof -nP -iTCP:1456 -sTCP:LISTEN` and never kills the holder;
  - callback HTML contains only a return-to-Cave success/failure message.

- [ ] **Step 2: Write failing route contract tests**

  Pin:

  - `GET` and `DELETE /api/x/connection`;
  - `POST /api/x/oauth/start` with body
    `{ capability: "research" | "publish" }`;
  - `rejectNonLocalRequest` on every method;
  - `readJsonBody` on OAuth start;
  - no token fields in connection responses;
  - disconnect cancels OAuth and deletes the encrypted bundle;
  - X route entries are alphabetic in `api-contracts.test.ts`.

- [ ] **Step 3: Register and run the red tests**

  Add the OAuth and route tests to the `api` suite. Add the alias loader only
  for a test whose final import graph requires it.

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/server/x-oauth.test.ts
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/app/api/x/account-routes.test.ts
  ```

  Expected: both fail on missing implementation.

- [ ] **Step 4: Implement the coordinator and process-wide singleton**

  `x-oauth.ts` owns a `createXOAuthService(deps)` factory and one production
  instance stored under
  `Symbol.for("opencoven.cave.x-oauth-service")` on `globalThis`, so Next
  development reloads do not start competing listeners.

  The start result is sanitized:

  ```ts
  type XOAuthStartResult = {
    authorizationUrl: string;
    expiresAt: string;
    requestedScopes: XScope[];
  };
  ```

  The listener binds only `127.0.0.1`, accepts the exact callback once, and
  never probes or terminates an unknown process. The authorization URL includes
  `response_type=code`, public `client_id`, fixed `redirect_uri`, requested
  scopes, state, `code_challenge`, and `code_challenge_method=S256`.

- [ ] **Step 5: Implement guarded account routes**

  `GET /api/x/connection` returns configured/connected/account/scopes/expiry
  and active-flow state only.

  `DELETE /api/x/connection`:

  1. rejects non-local requests;
  2. cancels an active OAuth flow;
  3. deletes the token bundle;
  4. returns `{ ok: true }`.

  Transient X cache/runtime purge is added after the source store exists in
  Task 7.

- [ ] **Step 6: Run focused API tests**

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/server/x-oauth.test.ts
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/app/api/x/account-routes.test.ts
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/app/api/api-contracts.test.ts
  pnpm check:tests-wired
  ```

  Expected: all pass.

- [ ] **Step 7: Create the signed checkpoint when authorized**

  ```bash
  git add src/lib/server/x-oauth.ts src/lib/server/x-oauth.test.ts \
    src/app/api/x/connection/route.ts \
    src/app/api/x/oauth/start/route.ts \
    src/app/api/x/account-routes.test.ts \
    src/app/api/api-contracts.test.ts scripts/run-tests.mjs
  git diff --cached --check
  git commit -S -m "feat: connect X with PKCE"
  ```

### Task 6: Enforce familiar grants and expose connection controls in Studio

**Files:**

- Create: `src/lib/server/x-access.ts`
- Create: `src/lib/server/x-access.test.ts`
- Create: `src/lib/open-system-browser.ts`
- Create: `src/lib/open-system-browser.test.ts`
- Create: `src/components/familiar-x-section.tsx`
- Create: `src/components/familiar-x-section.test.ts`
- Create: `src/styles/familiar-x-section.css`
- Create: `src-tauri/capabilities/loopback-x-oauth.json`
- Modify: `src/lib/cave-config.ts`
- Modify: `src/lib/cave-config.test.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/app/api/familiars/route.ts`
- Modify: `src/components/familiar-studio-brain-tab.tsx`
- Modify: `src/components/familiar-studio-brain-tab.test.ts`
- Modify: `src-tauri/permissions/desktop-permissions.test.mjs`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Re-run the design auto-fixer before UI edits**

  ```bash
  pnpm codemod:design
  git diff --exit-code
  ```

  Expected: no baseline diff.

- [ ] **Step 2: Write failing grant tests**

  Add:

  ```ts
  xResearchEnabled?: boolean;
  xPublishEnabled?: boolean;
  ```

  Tests must prove:

  - missing fields resolve to false;
  - app defaults do not implicitly grant either capability;
  - only the exact familiar config entry can grant a capability;
  - research and publish remain independent;
  - invalid familiar IDs fail before config access;
  - capability failures map to `capability-disabled`;
  - authenticated reads refresh once on 401;
  - write preflight may refresh before dispatch but never repeats a dispatched
    create-post operation.

- [ ] **Step 3: Write failing browser/capability/UI contracts**

  Pin:

  - local desktop Tauri uses `invoke("shell_open", { url })`;
  - a plain browser on a loopback hostname synchronously reserves a blank
    window from the click, clears `opener`, and navigates it only after the
    guarded start route returns the authorization URL;
  - Tauri mobile and non-loopback web origins return an actionable desktop
    requirement;
  - `loopback-x-oauth.json` grants only `allow-shell-open` to `main` for
    localhost, `127.0.0.1`, and IPv6 loopback;
  - Familiar Studio renders `FamiliarXSection` beside the Asana section;
  - connection/scopes are sanitized;
  - grant switches use `role="switch"`, `.focus-ring`, and true/null config
    patches;
  - disconnect uses the existing armed-confirm convention;
  - publish enablement starts publish-scope OAuth when `tweet.write` is absent;
  - polling exists only while the user-started OAuth attempt is active and
    stops at completion, failure, unmount, or ten minutes.

- [ ] **Step 4: Register and prove tests are red**

  Add new tests to the `app` suite. Add `x-access.test.ts` to `ALIAS_LOADER`
  only if needed.

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/server/x-access.test.ts
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/open-system-browser.test.ts
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/components/familiar-x-section.test.ts
  node src-tauri/permissions/desktop-permissions.test.mjs
  ```

  Expected: failures on absent grants, helper, section, and capability.

- [ ] **Step 5: Implement exact server-side capability checks**

  `requireXCapability(familiarId, capability)` must validate with
  `isValidFamiliarId`, load config, and read only:

  ```ts
  config.familiars[familiarId]?.xResearchEnabled === true
  config.familiars[familiarId]?.xPublishEnabled === true
  ```

  Export separate helpers for:

  - read operations: credential acquisition plus one 401 refresh/retry;
  - write preflight: capability/scope validation and a fresh token before the
    one dispatched write;
  - safe `NextResponse` conversion.

- [ ] **Step 6: Implement Familiar Studio account and grant UX**

  `FamiliarXSection` imports its own stylesheet and uses shared `Button`,
  `ErrorState`, `Skeleton`, switch, armed-confirm, and announcer patterns.
  Turning a grant on writes `true`; turning it off writes `null`, because
  absence is false. Research and Comms surfaces will deep-link back with:

  ```ts
  openFamiliarStudioSettingsTab("brain", familiar.id)
  ```

  A publish toggle without `tweet.write` starts publish-scope OAuth, opens the
  system browser, observes sanitized connection state, and writes the grant
  only after the returned scopes contain `tweet.write`.

  In a plain loopback browser, reserve the blank window synchronously in the
  click handler so popup blocking cannot strand a server-side OAuth flow; close
  it on start failure. Desktop Tauri needs no reserved window.

- [ ] **Step 7: Add the narrow Tauri capability**

  `loopback-x-oauth.json` must be structurally independent from
  `loopback-browser.json`:

  ```json
  {
    "$schema": "../gen/schemas/desktop-schema.json",
    "identifier": "loopback-x-oauth",
    "description": "allows only the trusted main loopback webview to open X OAuth in the system browser",
    "webviews": ["main"],
    "remote": {
      "urls": [
        "http://localhost:*/*",
        "http://127.0.0.1:*/*",
        "http://[\\:\\:1]:*/*"
      ]
    },
    "permissions": ["allow-shell-open"]
  }
  ```

  Extend the permission test to prove it grants no PTY, embedded-browser,
  updater, speech, filesystem, or process authority.

- [ ] **Step 8: Run focused tests and design checks**

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/server/x-access.test.ts
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/open-system-browser.test.ts
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/components/familiar-x-section.test.ts
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/cave-config.test.ts
  node src-tauri/permissions/desktop-permissions.test.mjs
  pnpm codemod:design:check
  pnpm typecheck
  ```

  Expected: all pass.

- [ ] **Step 9: Create the signed checkpoint when authorized**

  ```bash
  git add src/lib/server/x-access.ts src/lib/server/x-access.test.ts \
    src/lib/open-system-browser.ts src/lib/open-system-browser.test.ts \
    src/components/familiar-x-section.tsx \
    src/components/familiar-x-section.test.ts \
    src/styles/familiar-x-section.css \
    src-tauri/capabilities/loopback-x-oauth.json \
    src/lib/cave-config.ts src/lib/cave-config.test.ts src/lib/types.ts \
    src/app/api/familiars/route.ts \
    src/components/familiar-studio-brain-tab.tsx \
    src/components/familiar-studio-brain-tab.test.ts \
    src-tauri/permissions/desktop-permissions.test.mjs \
    scripts/run-tests.mjs
  git diff --cached --check
  git commit -S -m "feat: grant familiars scoped X access"
  ```

### Milestone A verification

- [ ] Run the account-foundation gate:

  ```bash
  pnpm check:tests-wired
  pnpm typecheck
  pnpm lint
  pnpm codemod:design:check
  node --experimental-strip-types src/lib/design-token-drift.test.ts
  pnpm test:api
  ```

  Expected: all pass. The raw token-drift command intentionally has no CSS
  source hook.

- [ ] Record evidence without closing the Bead:

  ```bash
  bd update cave-8i8q5 --notes \
    "Milestone A complete on feat/cave-8i8q5-x-api: PKCE account foundation, encrypted token refresh, strict X client, per-familiar grants, and native system-browser capability verified. No tokens or post/query text recorded. Research and publishing milestones remain."
  ```

## Milestone B — Research Desk ingestion and mission use

### Task 7: Persist identity-only sources and a bounded normalized cache

**Files:**

- Create: `src/lib/server/x-sources.ts`
- Create: `src/lib/server/x-sources.test.ts`
- Modify: `src/lib/server/x-access.ts`
- Modify: `src/app/api/x/connection/route.ts`
- Modify: `src/app/api/x/oauth/start/route.ts`
- Modify: `src/app/api/x/account-routes.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing store and retention tests**

  Use temporary `COVEN_X_SOURCES_DIR` and `COVEN_X_CACHE_DIR` overrides. Pin:

  ```ts
  type SavedXSource = {
    id: string;
    familiarId: string;
    postId: string;
    canonicalUrl: string;
    originalUrl: string;
    note: string;
    tags: string[];
    addedAt: string;
    updatedAt: string;
    attachedMissionIds: string[];
    availability: "available" | "unavailable" | "deleted";
  };

  type XPostCacheEntry = {
    postId: string;
    canonicalUrl: string;
    text: string;
    authorId: string;
    authorUsername: string;
    createdAt: string;
    fetchedAt: string;
    expiresAt: string;
  };
  ```

  Cover:

  - per-familiar path and familiar-ID validation;
  - same familiar/post deduplication with stable `id` and merged user fields;
  - no post text, author, metrics, or raw payload in the source file;
  - cache entries containing exactly the pinned fields above, with no author
    display name or engagement metrics;
  - expiry no later than 24 hours;
  - expired entries never returned and are swept;
  - malformed files are preserved with `corruptAsidePath`;
  - non-`ENOENT` read failures surface rather than causing an empty overwrite;
  - atomic/mutex-protected updates;
  - not-found removes cached content and marks matching sources;
  - disconnect purge removes cached content but retains source records, notes,
    tags, mission IDs, and later publish receipts. Exact mission-runtime purge
    is added with the runtime store in Task 10.

- [ ] **Step 2: Register and run the red test**

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/server/x-sources.test.ts
  ```

  Expected: failure because the store is absent.

- [ ] **Step 3: Implement the store using existing persistence conventions**

  Reuse `caveHome`, `writeJsonAtomic`, `corruptAsidePath`, and the
  `research-links.ts` read/modify/write mutex pattern. Export:

  ```ts
  listSavedXSources(familiarId: string): Promise<SavedXSource[]>
  upsertSavedXSource(input): Promise<{ source: SavedXSource; created: boolean }>
  removeSavedXSource(familiarId: string, sourceId: string): Promise<boolean>
  setXSourceMissionAttached(familiarId: string, sourceId: string, missionId: string): Promise<void>
  cacheNormalizedXPosts(posts: NormalizedXPost[], now?: Date): Promise<void>
  getCachedXPost(postId: string, now?: Date): Promise<NormalizedXPost | null>
  markXPostAvailability(postId: string, availability): Promise<void>
  sweepExpiredXCache(now?: Date): Promise<number>
  purgeXSourceCache(): Promise<void>
  ```

  Bound notes to 2,000 characters, tags to 25 unique values of 64 characters,
  and source files to 500 records per familiar.

- [ ] **Step 4: Run source and account tests**

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/server/x-sources.test.ts
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/app/api/x/account-routes.test.ts
  ```

  Expected: pass, including connection `DELETE` purging transient data.

- [ ] **Step 5: Create the signed checkpoint when authorized**

  ```bash
  git add src/lib/server/x-sources.ts src/lib/server/x-sources.test.ts \
    src/lib/server/x-access.ts \
    src/app/api/x/connection/route.ts \
    src/app/api/x/oauth/start/route.ts \
    src/app/api/x/account-routes.test.ts scripts/run-tests.mjs
  git diff --cached --check
  git commit -S -m "feat: persist bounded X research sources"
  ```

### Task 8: Add explicit lookup, recent search, and source routes

**Files:**

- Create: `src/app/api/x/posts/lookup/route.ts`
- Create: `src/app/api/x/posts/search/route.ts`
- Create: `src/app/api/x/sources/route.ts`
- Create: `src/app/api/x/research-routes.test.ts`
- Modify: `src/lib/server/x-access.ts`
- Modify: `src/app/api/api-contracts.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing route tests**

  Pin request and response contracts:

  ```ts
  POST /api/x/posts/lookup
  { familiarId, url }
  -> { ok: true, post: NormalizedXPost }

  POST /api/x/posts/search
  { familiarId, query }
  -> { ok: true, posts: NormalizedXPost[] } // length <= 10

  GET /api/x/sources?familiarId=<id>
  -> { ok: true, sources: Array<SavedXSource & { preview?: NormalizedXPost }> }

  POST /api/x/sources
  { action: "save", familiarId, postId, originalUrl, note, tags }
  { action: "attach", familiarId, sourceId, missionId }
  { action: "refresh", familiarId, sourceId }

  DELETE /api/x/sources
  { familiarId, sourceId }
  ```

  Every method must:

  - call `rejectNonLocalRequest`;
  - use `readJsonBody` for JSON;
  - validate familiar IDs;
  - require the research grant server-side;
  - invoke an expired-cache sweep at route entry;
  - map safe typed failures;
  - avoid echoing invalid raw URLs and search text.

  Lookup parses locally before X. Search invokes exactly one recent-search
  request. Lookup/search cache normalized successes. A 404 purges cached and
  runtime content and updates availability.

- [ ] **Step 2: Register routes alphabetically and prove red**

  Add these contracts with `localOriginGuard: true` and guarded JSON:

  ```ts
  /x/posts/lookup
  /x/posts/search
  /x/sources
  ```

  Add the route test to the `api` suite and alias loader if needed.

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types \
    --import ./scripts/test-alias-register.mjs \
    src/app/api/x/research-routes.test.ts
  ```

  Expected: failure because the routes are absent.

- [ ] **Step 3: Implement authenticated reads without write-style retry**

  Lookup and search use the read helper that may refresh once on a first 401,
  then issue one user-visible operation. No other status is retried.

  `sources` attach must:

  1. load the saved source;
  2. load the mission and prove the mission belongs to the same familiar;
  3. call the existing `attach-source` runner action with:

     ```ts
     {
       id: source.id,
       title: source.canonicalUrl,
       url: source.canonicalUrl,
       sourceType: "x-post",
       provider: "x",
       externalId: source.postId,
       availability: source.availability,
       note: source.note,
       status: "candidate"
     }
     ```

  4. update `attachedMissionIds` after the mission action succeeds.

  `GET` reconciles stored `attachedMissionIds` against the familiar's mission
  ledgers so an interrupted cross-file update converges on the next load.

- [ ] **Step 4: Run route, store, and contract tests**

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types \
    --import ./scripts/test-alias-register.mjs \
    src/app/api/x/research-routes.test.ts
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/server/x-sources.test.ts
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/app/api/api-contracts.test.ts
  pnpm check:tests-wired
  ```

  Expected: all pass.

- [ ] **Step 5: Create the signed checkpoint when authorized**

  ```bash
  git add src/app/api/x/posts/lookup/route.ts \
    src/app/api/x/posts/search/route.ts \
    src/app/api/x/sources/route.ts \
    src/app/api/x/research-routes.test.ts \
    src/lib/server/x-access.ts src/app/api/api-contracts.test.ts \
    scripts/run-tests.mjs
  git diff --cached --check
  git commit -S -m "feat: expose bounded X research reads"
  ```

### Task 9: Extend the existing Resources tab with Grab from X

**Files:**

- Create: `src/components/role-surfaces/research-x-sources.tsx`
- Create: `src/components/role-surfaces/research-x-sources.test.tsx`
- Modify: `src/components/role-surfaces/research-tab-resources.tsx`
- Modify: `src/components/role-surfaces/research-tab-resources.test.ts`
- Modify: `src/styles/globals/surface-research-resources.css`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Re-run the design auto-fixer before UI edits**

  ```bash
  pnpm codemod:design
  git diff --exit-code
  ```

  Expected: no baseline diff.

- [ ] **Step 2: Write failing interaction tests**

  Add the new TSX test to the `app` suite and `VITEST_TESTS`. Cover:

  - no sixth Research Desk tab;
  - missing connection and missing grant are distinct and deep-link to the
    current familiar's Brain tab;
  - URL validation happens before fetch;
  - **Grab post** performs one lookup only on submit;
  - `Search X posts…` performs one search only on submit;
  - typing, focus, mount, mission polling, and result selection do not fetch;
  - at most ten search previews;
  - preview author/text/time/canonical URL and no metrics;
  - **Save source** deduplication and announcement;
  - **Attach to mission** disabled without a selected mission;
  - attach uses the server route backed by `attach-source`;
  - explicit refresh for expired cached content;
  - rate limit retry time, deleted, unavailable, loading, empty, and error
    states;
  - every successful or failed mutation calls `useAnnouncer`.

- [ ] **Step 3: Run the red tests**

  ```bash
  pnpm exec vitest run \
    src/components/role-surfaces/research-x-sources.test.tsx
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types \
    src/components/role-surfaces/research-tab-resources.test.ts
  ```

  Expected: failures because the Grab from X region is absent.

- [ ] **Step 4: Implement the inline Resources region**

  Mount one `ResearchXSources` section inside `ResearchTabResources`; retain the
  existing five-tab host, saved-link shelves, and layout preference.

  Reuse `Button`, `SearchInput`, `EmptyState`, `ErrorState`, `Skeleton`,
  `RelativeTime`, and existing result-card patterns. Use persistent labels,
  exact copy, `.focus-ring`, token-only CSS, container queries, and a
  reduced-motion rule for any transition.

  Search results remain in component state until explicitly saved. Saved
  identities load per familiar. A source without eligible cache content
  remains visible with **Refresh post**.

- [ ] **Step 5: Run UI and design tests**

  ```bash
  pnpm exec vitest run \
    src/components/role-surfaces/research-x-sources.test.tsx
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types \
    src/components/role-surfaces/research-tab-resources.test.ts
  pnpm codemod:design:check
  pnpm lint
  ```

  Expected: pass with no raw render colors, off-scale type, static inline
  styles, or new tab.

- [ ] **Step 6: Create the signed checkpoint when authorized**

  ```bash
  git add src/components/role-surfaces/research-x-sources.tsx \
    src/components/role-surfaces/research-x-sources.test.tsx \
    src/components/role-surfaces/research-tab-resources.tsx \
    src/components/role-surfaces/research-tab-resources.test.ts \
    src/styles/globals/surface-research-resources.css scripts/run-tests.mjs
  git diff --cached --check
  git commit -S -m "feat: grab X sources in Research Desk"
  ```

### Task 10: Add identity-only mission contracts and exact-run hydration

**Files:**

- Create: `src/lib/server/x-mission-sources.ts`
- Create: `src/lib/server/x-mission-sources.test.ts`
- Modify: `src/lib/research-missions.ts`
- Modify: `src/lib/research-missions.test.ts`
- Modify: `src/lib/research-artifact-contract.ts`
- Modify: `src/lib/research-artifact-contract.test.ts`
- Modify: `src/app/api/x/connection/route.ts`
- Modify: `src/app/api/x/posts/lookup/route.ts`
- Modify: `src/app/api/x/account-routes.test.ts`
- Modify: `src/app/api/x/research-routes.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing source-contract and hydration tests**

  Extend `ResearchSourceRef`:

  ```ts
  provider?: "x";
  externalId?: string;
  availability?: "available" | "unavailable" | "deleted";
  ```

  Test that:

  - `provider: "x"` requires numeric `externalId`, an X canonical URL, and
    `sourceType: "x-post"`;
  - legacy sources parse unchanged;
  - public `update-source` cannot replace protected provider/identity fields;
  - persistent `sources.json` never receives post text;
  - one run key writes under
    `<mission>/runtime/x/<run-key>/`;
  - each available post writes one normalized Markdown file and
    `manifest.json`;
  - the manifest contains identity, canonical URL, availability, relative file
    path, and safe unavailable reason, but not a duplicate post body;
  - hydration revalidates or fetches each attached source and never exposes
    tokens;
  - 404 deletes cache/runtime content and reports `deleted`;
  - temporary upstream failure reports `unavailable` and allows an honest run;
  - cleanup removes only the validated run-key directory;
  - stale run directories older than 24 hours are swept;
  - traversal, symlink, invalid mission ID, and invalid run key fail closed.

- [ ] **Step 2: Register and run red tests**

  Add the new server test to the `app` suite and alias loader if required.

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types \
    --import ./scripts/test-alias-register.mjs \
    src/lib/server/x-mission-sources.test.ts
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/research-artifact-contract.test.ts
  ```

  Expected: failures on missing fields and hydrator.

- [ ] **Step 3: Implement validated runtime materialization**

  Export:

  ```ts
  prepareXMissionRuntime(mission: ResearchMission, runKey: string): Promise<{
    relativeDirectory: string;
    availablePostIds: string[];
    unavailable: Array<{ postId: string; availability: "unavailable" | "deleted"; reason: string }>;
    sourceAvailability: Record<string, "available" | "unavailable" | "deleted">;
  }>
  cleanupXMissionRuntime(missionId: string, runKey: string): Promise<void>
  sweepStaleXMissionRuntime(now?: Date): Promise<number>
  purgeXPostRuntimeFiles(postId: string): Promise<void>
  purgeAllXMissionRuntime(): Promise<void>
  ```

  Runtime Markdown includes canonical URL, author handle and optional live
  display name, created time, and text. It explicitly labels the file
  ephemeral. No content is written to source ledgers, global search, vectors,
  memory, Grimoire, or Beads.

  Use `COVEN_RESEARCH_MISSIONS_DIR` for isolated runtime tests. Wire lookup 404
  to `purgeXPostRuntimeFiles(postId)` and account disconnect to
  `purgeAllXMissionRuntime()`. Both retain identity-only source records, notes,
  mission links, and publish receipts.

- [ ] **Step 4: Run focused contract and hydration tests**

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types \
    --import ./scripts/test-alias-register.mjs \
    src/lib/server/x-mission-sources.test.ts
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/research-missions.test.ts
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/research-artifact-contract.test.ts
  ```

  Expected: all pass.

- [ ] **Step 5: Create the signed checkpoint when authorized**

  ```bash
  git add src/lib/server/x-mission-sources.ts \
    src/lib/server/x-mission-sources.test.ts \
    src/lib/research-missions.ts src/lib/research-missions.test.ts \
    src/lib/research-artifact-contract.ts \
    src/lib/research-artifact-contract.test.ts \
    src/app/api/x/connection/route.ts \
    src/app/api/x/posts/lookup/route.ts \
    src/app/api/x/account-routes.test.ts \
    src/app/api/x/research-routes.test.ts scripts/run-tests.mjs
  git diff --cached --check
  git commit -S -m "feat: hydrate X mission sources temporarily"
  ```

### Task 11: Keep manual mission files for the asynchronous run lifecycle

**Files:**

- Create: `src/lib/server/research-mission-runner-x-sources.test.ts`
- Modify: `src/lib/research-mission-flow.ts`
- Modify: `src/lib/research-mission-flow.test.ts`
- Modify: `src/lib/server/research-mission-runner.ts`
- Modify: `src/lib/server/research-mission-runner-lifecycle-actions.test.ts`
- Modify: `src/lib/server/research-mission-runner-concurrency-terminal.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing lifecycle tests**

  Pin a single `launchIteration` path used by initial start, continue/refine,
  and retry. For deterministic run keys `iteration-<number>`, prove:

  - hydration completes before `startFlow`;
  - every Flow node receives the runtime directory and unavailable-source
    summary in its context;
  - the prompt says the files are user-requested, ephemeral, and forbidden
    from full-body persistence in `sources.json`, global indexes, memory, or
    Grimoire;
  - files remain after `startFlow` returns a running session;
  - failed start removes files immediately;
  - completed, checkpointed, failed, gone-session, and cancelled iterations
    remove their directory exactly once;
  - cancel kills the session before cleanup;
  - cleanup failure is recorded safely but does not rewrite a settled mission
    back to running;
  - no unrelated iteration directory is removed.

- [ ] **Step 2: Register and run the red tests**

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types \
    --import ./scripts/test-alias-register.mjs \
    src/lib/server/research-mission-runner-x-sources.test.ts
  ```

  Expected: failure because the runner has no X lifecycle dependencies.

- [ ] **Step 3: Add explicit runner dependencies and central launch**

  Extend `ResearchMissionRunnerDeps`:

  ```ts
  prepareXRuntime(mission: ResearchMission, runKey: string): Promise<XRuntimePreparation>
  cleanupXRuntime(missionId: string, runKey: string): Promise<void>
  ```

  Replace the three direct `startFlow` call sites with one helper that:

  1. prepares `iteration-<number>`;
  2. applies returned availability to protected X source fields;
  3. saves the updated mission;
  4. builds the flow with the runtime context;
  5. starts the asynchronous flow;
  6. cleans immediately only when launch itself fails.

  Add a single reconcile wrapper that detects an active-to-settled iteration
  transition and cleans that iteration's deterministic runtime directory.
  Explicitly clean the current active key after cancellation.

- [ ] **Step 4: Run all affected mission tests**

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types \
    --import ./scripts/test-alias-register.mjs \
    src/lib/server/research-mission-runner-x-sources.test.ts
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types \
    --import ./scripts/test-alias-register.mjs \
    src/lib/server/research-mission-runner-lifecycle-actions.test.ts
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types \
    --import ./scripts/test-alias-register.mjs \
    src/lib/server/research-mission-runner-concurrency-terminal.test.ts
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/research-mission-flow.test.ts
  ```

  Expected: all pass.

- [ ] **Step 5: Create the signed checkpoint when authorized**

  ```bash
  git add src/lib/server/research-mission-runner-x-sources.test.ts \
    src/lib/research-mission-flow.ts src/lib/research-mission-flow.test.ts \
    src/lib/server/research-mission-runner.ts \
    src/lib/server/research-mission-runner-lifecycle-actions.test.ts \
    src/lib/server/research-mission-runner-concurrency-terminal.test.ts \
    scripts/run-tests.mjs
  git diff --cached --check
  git commit -S -m "feat: scope X sources to research runs"
  ```

### Task 12: Hydrate scheduled AutoResearch runs and sweep crash residue

**Files:**

- Create: `src/lib/server/automation-runner-x-sources.test.ts`
- Modify: `src/lib/server/automation-runner.ts`
- Modify: `src/lib/server/automation-runner.test.ts`
- Modify: `instrumentation.ts`
- Modify: `src/app/root-shell-startup.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing automation lifecycle tests**

  Cover:

  - only an automation with exactly one `research-mission:<id>` tag is
    eligible;
  - the mission familiar must equal `auto.familiars[0]`;
  - the run record exists before hydration so the key is
    `automation-<run.id>`;
  - preparation occurs before spawn;
  - the exact runtime directory/unavailable summary is appended to stdin, not
    the environment;
  - `harnessSpawnEnv()` remains credential-free;
  - child `error`, child `close`, synchronous spawn throw, and preparation
    failure all perform one cleanup;
  - non-research automations are unchanged;
  - startup calls cache/runtime sweeps without awaiting them in route
    registration.

- [ ] **Step 2: Register and run the red test**

  Add the new test to the `app` suite and `ALIAS_LOADER`.

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types \
    --import ./scripts/test-alias-register.mjs \
    src/lib/server/automation-runner-x-sources.test.ts
  ```

  Expected: failure because automations do not prepare X runtime files.

- [ ] **Step 3: Refactor the fire-and-forget runner safely**

  Preserve the existing immediate `running` record contract. After recording
  the run, inspect the research tag, prepare the exact runtime directory, and
  build the invocation with an appended prompt. Use one idempotent cleanup
  closure shared by `error`, `close`, and catch paths. Never put X content,
  tokens, or source paths in the child environment.

- [ ] **Step 4: Add non-blocking startup maintenance**

  In `instrumentation.ts`, dynamically import X source maintenance and launch:

  ```ts
  void Promise.all([
    xSources.sweepExpiredXCache(),
    xMissionSources.sweepStaleXMissionRuntime(),
  ]).catch((error) => {
    console.warn("[instrumentation] X transient sweep failed:", xErrorLogCategory(error));
  });
  ```

  The log must contain a category only, never an error object that could carry
  a URL/query/text. `register()` must not await the sweep.

- [ ] **Step 5: Run automation and startup tests**

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types \
    --import ./scripts/test-alias-register.mjs \
    src/lib/server/automation-runner-x-sources.test.ts
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types \
    --import ./scripts/test-alias-register.mjs \
    src/lib/server/automation-runner.test.ts
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/app/root-shell-startup.test.ts
  ```

  Expected: all pass.

- [ ] **Step 6: Create the signed checkpoint when authorized**

  ```bash
  git add src/lib/server/automation-runner-x-sources.test.ts \
    src/lib/server/automation-runner.ts \
    src/lib/server/automation-runner.test.ts \
    instrumentation.ts src/app/root-shell-startup.test.ts \
    scripts/run-tests.mjs
  git diff --cached --check
  git commit -S -m "feat: hydrate X sources for AutoResearch"
  ```

### Milestone B verification

- [ ] Run the Research Desk gate:

  ```bash
  pnpm check:tests-wired
  pnpm typecheck
  pnpm lint
  pnpm codemod:design:check
  node --experimental-strip-types src/lib/design-token-drift.test.ts
  pnpm test:app
  pnpm test:api
  ```

  Expected: all pass. Inspect temporary test roots to prove post text exists
  only in eligible cache/runtime files and is absent from source and mission
  ledgers after cleanup.

- [ ] Record evidence without closing the Bead:

  ```bash
  bd update cave-8i8q5 --notes \
    "Milestone B complete: explicit lookup/recent search, familiar-scoped identity-only saves, mission attachment, exact-run hydration, manual/AutoResearch cleanup, and startup sweeps verified. Publishing remains."
  ```

## Milestone C — exact-preview Comms publishing

### Task 13: Freeze exact previews and persist non-text receipts

**Files:**

- Create: `src/lib/server/x-publishes.ts`
- Create: `src/lib/server/x-publishes.test.ts`
- Modify: `instrumentation.ts`
- Modify: `src/app/root-shell-startup.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing preview/receipt tests**

  Use a temporary `COVEN_X_PUBLISHES_DIR`. Cover:

  - random opaque preview tokens;
  - exact text preserved byte-for-byte;
  - advisory Unicode code-point count only;
  - ten-minute expiry;
  - one-time consumption;
  - account, familiar, draft, and request identity frozen with the preview;
  - maximum 100 live previews with expired-entry eviction;
  - SHA-256 text hash in receipts and no body copy;
  - receipt path per familiar, strict parse, corrupt-aside, atomic writes, and
    a 500-record bound;
  - `publishing` written before the dispatch callback;
  - concurrent use of one token shares one in-flight promise and dispatches
    once;
  - a pre-existing durable receipt with the same `requestId` is returned
    without another dispatch;
  - success records post ID/URL;
  - deterministic rejection records `failed`;
  - a dispatched timeout/network close records `uncertain`;
  - pre-dispatch auth/scope failure creates no misleading dispatched receipt;
  - stale `publishing` receipts become `uncertain` on startup and are never
    replayed.

  Pin the durable shape:

  ```ts
  type XPublishReceipt = {
    id: string;
    familiarId: string;
    draftId: string;
    requestId: string;
    textSha256: string;
    status: "publishing" | "published" | "failed" | "uncertain";
    postId?: string;
    canonicalUrl?: string;
    attemptedAt: string;
    publishedAt?: string;
    errorCategory?: string;
  };
  ```

- [ ] **Step 2: Register and run the red test**

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/server/x-publishes.test.ts
  ```

  Expected: failure because the coordinator/store does not exist.

- [ ] **Step 3: Implement preview and receipt coordination**

  The in-memory preview record may contain exact text; the durable receipt may
  not. Export:

  ```ts
  createXPublishPreview(input): XPublishPreview
  runXPublishOnce(token, preflight, dispatch): Promise<XPublishOutcome>
  listXPublishReceipts(familiarId: string): Promise<XPublishReceipt[]>
  markStaleXPublishingReceipts(now?: Date): Promise<number>
  ```

  `runXPublishOnce` consumes the token, performs credential/scope preflight
  before recording dispatch, writes `publishing`, calls dispatch once, and
  transitions the same receipt to `published`, `failed`, or `uncertain`. Before
  writing a receipt or dispatching, it checks the durable `requestId` index and
  returns any existing receipt for that request.

- [ ] **Step 4: Extend startup maintenance**

  Invoke `markStaleXPublishingReceipts()` only during application startup, not
  on every X route, so a live in-process publish cannot be mistaken for stale.
  Keep startup non-blocking and sanitized.

- [ ] **Step 5: Run focused and startup tests**

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/server/x-publishes.test.ts
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/app/root-shell-startup.test.ts
  ```

  Expected: pass.

- [ ] **Step 6: Create the signed checkpoint when authorized**

  ```bash
  git add src/lib/server/x-publishes.ts \
    src/lib/server/x-publishes.test.ts \
    instrumentation.ts src/app/root-shell-startup.test.ts \
    scripts/run-tests.mjs
  git diff --cached --check
  git commit -S -m "feat: coordinate exact X publish receipts"
  ```

### Task 14: Add exact-preview and one-shot publish routes

**Files:**

- Create: `src/app/api/x/publish-previews/route.ts`
- Create: `src/app/api/x/posts/route.ts`
- Create: `src/app/api/x/publishes/route.ts`
- Create: `src/app/api/x/publish-routes.test.ts`
- Modify: `src/app/api/api-contracts.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing route tests**

  Pin:

  ```ts
  POST /api/x/publish-previews
  { familiarId, draftId, text }
  -> {
    ok: true,
    previewToken,
    exactText,
    account: { id, username, name },
    advisoryCharacterCount,
    expiresAt
  }

  POST /api/x/posts
  { previewToken }
  -> { ok: true, receipt }

  GET /api/x/publishes?familiarId=<id>
  -> { ok: true, receipts }
  ```

  Assert:

  - all routes use local-origin guards;
  - JSON routes use the bounded reader;
  - every route invokes the expired X cache sweep at entry;
  - preview and receipt list require the exact familiar publish grant;
  - preview requires connected `tweet.write`;
  - post body rejects every key other than `previewToken`;
  - the posts route never reads `text`, `geo`, `media`, `reply`, `quote`,
    `poll`, or schedule values;
  - write preflight refreshes before dispatch if needed;
  - `createXPost` receives the frozen exact text once;
  - a double click returns the same receipt/outcome;
  - ambiguous write returns the uncertain receipt and manual-check copy;
  - deterministic rejection does not silently retry;
  - no route response contains tokens or a durable body copy.

- [ ] **Step 2: Register final X routes alphabetically and prove red**

  The final X block in `api-contracts.test.ts` is:

  ```text
  /x/connection
  /x/oauth/start
  /x/posts
  /x/posts/lookup
  /x/posts/search
  /x/publish-previews
  /x/publishes
  /x/sources
  ```

  Add the publish route test to the `api` suite and alias loader.

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types \
    --import ./scripts/test-alias-register.mjs \
    src/app/api/x/publish-routes.test.ts
  ```

  Expected: failure because the publish routes are absent.

- [ ] **Step 3: Implement exact preview and one dispatch**

  Preview validates non-empty text and a maximum encoded request size, but
  does not reject solely because a naive JavaScript count exceeds 280.

  The posts route:

  1. accepts only a preview token;
  2. resolves the frozen preview;
  3. rechecks familiar grant and write scope before dispatch;
  4. obtains a fresh access token without sending a post;
  5. writes `publishing`;
  6. invokes `createXPost(accessToken, exactText)` once;
  7. derives the canonical URL from the connected username and returned ID;
  8. returns the persisted receipt.

- [ ] **Step 4: Run publish, client, and API contracts**

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types \
    --import ./scripts/test-alias-register.mjs \
    src/app/api/x/publish-routes.test.ts
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/server/x-publishes.test.ts
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/lib/server/x-client.test.ts
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types src/app/api/api-contracts.test.ts
  pnpm check:tests-wired
  ```

  Expected: all pass with one create-post call in every write test.

- [ ] **Step 5: Create the signed checkpoint when authorized**

  ```bash
  git add src/app/api/x/publish-previews/route.ts \
    src/app/api/x/posts/route.ts \
    src/app/api/x/publishes/route.ts \
    src/app/api/x/publish-routes.test.ts \
    src/app/api/api-contracts.test.ts scripts/run-tests.mjs
  git diff --cached --check
  git commit -S -m "feat: publish exact confirmed X posts"
  ```

### Task 15: Add the explicit X channel and confirmation modal

**Files:**

- Create: `src/components/role-surfaces/x-publish-dialog.tsx`
- Create: `src/components/role-surfaces/x-publish-dialog.test.tsx`
- Create: `src/styles/x-publish-dialog.css`
- Create: `src/components/role-surfaces/x-room-interactions.test.tsx`
- Modify: `src/components/role-surfaces/messenger-surface.tsx`
- Modify: `src/components/role-surfaces/messenger-surface.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Re-run the design auto-fixer before UI edits**

  ```bash
  pnpm codemod:design
  git diff --exit-code
  ```

  Expected: no baseline diff.

- [ ] **Step 2: Write failing modal and room interaction tests**

  Add both TSX tests to the `app` suite and `VITEST_TESTS`. Cover:

  - `MessageChannel` includes `x` while `social` remains unchanged/local-only;
  - X convention is text-only and its count is advisory;
  - lifecycle copy is exactly **Request approval**, **Review for X**,
    **Publish to X**, **Publishing…**, and **Published**;
  - editing body or channel after approval resets status to `draft`;
  - **Review for X** exists only for an approved X draft;
  - missing connection/grant/scope deep-links to Familiar Studio without
    silently starting a publish;
  - preview request sends familiar ID, draft ID, and exact body;
  - modal renders the server-returned account and exact text, not current local
    draft state;
  - modal states **No location will be added.**;
  - confirmation request body is exactly `{ previewToken }`;
  - **Publish to X** disables immediately and double click dispatches once;
  - modal traps focus, Escape/backdrop are disabled while publishing, and
    focus returns after close;
  - published result shows post ID/URL and announces **Published**;
  - deterministic failure returns the draft to approved and requires a new
    preview;
  - uncertain result becomes immutable and says to check X manually;
  - published and uncertain drafts can be duplicated but not edited;
  - recent sends render receipt state without a duplicate body;
  - legacy non-X approval continues to say it awaits an integration.

- [ ] **Step 3: Register and run red tests**

  ```bash
  pnpm exec vitest run \
    src/components/role-surfaces/x-publish-dialog.test.tsx \
    src/components/role-surfaces/x-room-interactions.test.tsx
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types \
    src/components/role-surfaces/messenger-surface.test.ts
  ```

  Expected: failures because the X channel and dialog are absent.

- [ ] **Step 4: Implement the lifecycle and modal**

  Extend status to:

  ```ts
  type DraftStatus =
    | "draft"
    | "needs-approval"
    | "approved"
    | "publishing"
    | "published"
    | "uncertain";
  ```

  Store only receipt identity/URL on a draft, not another body copy. An
  approved X draft opens `XPublishDialog`; the dialog imports its own
  token-only stylesheet and uses shared `Modal`/`Button` plus
  `useAnnouncer()`.

  Hide the generic **To** field for X. The connected account comes from the
  preview response. The modal's visible count is advisory. Disable dismissal
  during the mutation and never initiate a retry automatically.

- [ ] **Step 5: Run UI, accessibility, and design checks**

  ```bash
  pnpm exec vitest run \
    src/components/role-surfaces/x-publish-dialog.test.tsx \
    src/components/role-surfaces/x-room-interactions.test.tsx
  node --require ./scripts/css-source-contract-hook.cjs \
    --experimental-strip-types \
    src/components/role-surfaces/messenger-surface.test.ts
  pnpm codemod:design:check
  pnpm lint
  ```

  Expected: all pass.

- [ ] **Step 6: Create the signed checkpoint when authorized**

  ```bash
  git add src/components/role-surfaces/x-publish-dialog.tsx \
    src/components/role-surfaces/x-publish-dialog.test.tsx \
    src/styles/x-publish-dialog.css \
    src/components/role-surfaces/x-room-interactions.test.tsx \
    src/components/role-surfaces/messenger-surface.tsx \
    src/components/role-surfaces/messenger-surface.test.ts \
    scripts/run-tests.mjs
  git diff --cached --check
  git commit -S -m "feat: confirm X publishing in Comms"
  ```

### Task 16: Run the full acceptance and packaging audit

**Files inspected or modified only if a measured gate requires it:**

- `src/app/api/api-contracts.test.ts`
- `scripts/run-tests.mjs`
- `scripts/sidecar-runtime-closure.mjs`
- `scripts/sidecar-runtime-smoke.mjs`
- `scripts/sidecar-bundle-deps.test.mjs`
- `scripts/sidecar-runtime-closure.test.mjs`
- `src-tauri/src/sidecar_archive_manifest.rs`
- Bead `cave-8i8q5`

- [ ] **Step 1: Audit final scope and forbidden persistence**

  ```bash
  rg -n 'twitter\\.com|x\\.com|X_OAUTH_TOKEN_BUNDLE|tweet\\.write|xResearchEnabled|xPublishEnabled' \
    src scripts instrumentation.ts next.config.ts .github/workflows/release.yml
  rg -n 'media|geo|reply|quote|poll|schedule|next_token' \
    src/app/api/x src/lib/server/x-client.ts \
    src/components/role-surfaces/x-publish-dialog.tsx
  git diff --check
  ```

  Expected:

  - all X network calls live in `x-client.ts`;
  - no raw token, client secret, fixture credential, automatic pagination, or
    write retry exists;
  - logs contain no OAuth state/verifier, query, post text, or full
    user-provided URL;
  - create-post constructs only `{ text }`;
  - durable sources and receipts have no post body field;
  - the legacy `social` channel remains local-only;
  - all eight Next routes are present and guarded.

- [ ] **Step 2: Run every static and behavioral repository gate**

  ```bash
  pnpm check:tests-wired
  pnpm typecheck
  pnpm lint
  pnpm codemod:design:check
  node --experimental-strip-types src/lib/design-token-drift.test.ts
  pnpm test:app
  pnpm test:api
  pnpm test:mobile
  pnpm build
  ```

  Expected: all pass. The raw design-token drift suite is deliberately run
  without `css-source-contract-hook.cjs`.

- [ ] **Step 3: Verify Tauri and sidecar packaging**

  ```bash
  node src-tauri/permissions/desktop-permissions.test.mjs
  cargo test --manifest-path src-tauri/Cargo.toml --locked shell_open
  cargo test --manifest-path src-tauri/Cargo.toml --locked sidecar_archive
  bash scripts/sidecar-bundle.sh
  pnpm test:sidecar-runtime
  ```

  Expected: all pass on the current platform.

  The live sidecar file-count ceiling is currently `5_730`. Do not copy an
  older value. If Linux and Windows packaged-sidecar CI both remain at or below
  `5_730`, do not modify a budget. If the measured cross-platform maximum is
  `M > 5_730`, set the limit to `M + 10` in exactly these five files, retain
  the current unpacked-byte ceiling, and add a dated measurement comment:

  - `scripts/sidecar-runtime-closure.mjs`
  - `scripts/sidecar-runtime-smoke.mjs`
  - `scripts/sidecar-bundle-deps.test.mjs`
  - `scripts/sidecar-runtime-closure.test.mjs`
  - `src-tauri/src/sidecar_archive_manifest.rs`

- [ ] **Step 4: Launch the native app in the foreground**

  ```bash
  bash scripts/dev-app.sh
  ```

  Expected early evidence:

  ```text
  [dev:app] port 3001 is free
  [dev:app] starting dev server on 3001
  > Ready on http://127.0.0.1:3001
  Running DevCommand (`cargo run --no-default-features --color always --`)
  ```

  Port `3001` is an example; the wrapper may select any free port in
  `3000..3010`. Keep the terminal attached. In the real Tauri window verify:

  - system-browser OAuth opens outside Cave;
  - Research Resources and Comms render at wide and narrow panes;
  - keyboard-only controls, visible focus, modal trap/return, announcements,
    and reduced motion;
  - Coven light, Coven dark, and one non-default palette;
  - `/aesthetic` token rendering plus automated theme tests cover all 21
    palettes in both modes.

  Stop with `Ctrl-C` and confirm the wrapper removes its Next/Tauri processes.

- [ ] **Step 5: Run live X smoke only with external prerequisites**

  Required external state:

  - actual OpenCoven Native App;
  - registered exact loopback redirect URI;
  - repository/build client ID;
  - test account;
  - sufficient X API credits.

  Smoke sequence:

  1. connect with research scopes;
  2. refresh an expiring token and confirm rotation;
  3. look up one known X URL;
  4. run one recent search and confirm at most ten results;
  5. save/attach, run one mission iteration, and prove runtime cleanup;
  6. reconnect for `tweet.write`;
  7. preview and publish one benign text-only post;
  8. confirm returned post ID/URL and receipt hash;
  9. simulate an ambiguous client-side outcome in the test harness and confirm
     no second dispatch;
  10. disconnect and confirm credentials/cache/runtime purge while
      notes/mission links/receipts remain.

  If any prerequisite is unavailable, mocked verification may remain green,
  but record the exact missing live evidence and keep release acceptance and
  the Bead open.

- [ ] **Step 6: Walk the design-language shipping checklist**

  Check every item in `docs/coven-design-language.md` §9 against Familiar
  Studio, Research Resources, and Comms:

  - token-only styling and 4px spacing grid;
  - shared primitives;
  - all state/copy vocabulary;
  - color-independent status;
  - focus, keyboard, announcer, and reduced-motion behavior;
  - compact native-pane layout;
  - no sixth Research tab and no excess room-header action.

- [ ] **Step 7: Record final evidence and commit only authorized changes**

  ```bash
  git status --short --branch
  git diff --stat origin/main...HEAD
  git log --show-signature --format='%h %G? %s' origin/main..HEAD
  ```

  If implementation commits are authorized and measured sidecar growth changed
  the five tracked budget files:

  ```bash
  git add scripts/sidecar-runtime-closure.mjs \
    scripts/sidecar-runtime-smoke.mjs \
    scripts/sidecar-bundle-deps.test.mjs \
    scripts/sidecar-runtime-closure.test.mjs \
    src-tauri/src/sidecar_archive_manifest.rs
  git diff --cached --check
  git commit -S -m "test: verify X integration release gates"
  ```

  Never use a broad `git add .`. If signing fails, stop and restore the active
  signing agent rather than making an unsigned commit.

- [ ] **Step 8: Update Beads truthfully**

  With all local gates and live smoke complete:

  ```bash
  bd update cave-8i8q5 --notes \
    "Implementation verified: include exact focused/full commands, native Tauri evidence, live lookup/search/refresh/publish receipt evidence, branch, worktree, and commit SHAs. No secrets or post/query text."
  ```

  Close `cave-8i8q5` only after the authorized delivery/merge criterion is
  satisfied. If live smoke or delivery is pending, leave it `in_progress` and
  name the exact blocker.

## Final acceptance

- [ ] Production build receives the OpenCoven public X client ID and requires
  no end-user developer setup or secret.
- [ ] PKCE, exact loopback callback, encrypted tokens, single-flight refresh,
  and disconnect pass.
- [ ] Both familiar grants default false and every corresponding route enforces
  them server-side.
- [ ] URL lookup and one bounded recent search return strict normalized
  previews without polling or pagination.
- [ ] Saved sources survive restart with identity/notes/mission links but no
  permanent post body.
- [ ] Manual and scheduled mission runs receive exact-run files and remove
  them on every terminal path.
- [ ] Approved X drafts show the exact server-frozen text and
  **No location will be added.**
- [ ] Confirmation sends only the preview token; X receives only `{ text }`.
- [ ] Success records ID/URL, deterministic failure is repairable, and
  ambiguous write is uncertain with no retry.
- [ ] API inventory, test wiring, design gates, app/API/mobile suites, build,
  Tauri permissions, sidecar packaging, native UI, and live X smoke pass.
- [ ] The Bead contains branch/worktree/verification/delivery evidence and no
  secrets or X content.
