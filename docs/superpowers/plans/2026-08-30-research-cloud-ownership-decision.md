# Research Cloud ownership decision record (Gate C0)

> **PROPOSED — not ratified.** Bead `cave-6sles.13` is **blocked** on
> `cave-6sles.8` (A7 — Local Research Retrieval UX) and `cave-6sles.12`
> (Unit 3 — Mission v2 and Research Run Gateway), per the program delivery
> graph in
> [`2026-08-16-externalized-research-desk-program.md`](2026-08-16-externalized-research-desk-program.md)
> §11 and the dependency edges on the bead itself.
>
> **Hard gate, restated from the program (§11):** *No cloud resource is
> provisioned and no hosted endpoint is enabled before this decision is
> ratified.* Nothing in this document authorizes provisioning, and
> `caveResearchHostedRuns()` stays fail-closed
> (`src/lib/feature-flags.ts`) until a server-only Gate C0 authority can
> prove the approved account, repository, bindings, and authentication
> policy (`2026-08-26-research-resource-contracts-and-flags.md`).

**Bead:** `cave-6sles.13` (Gate C0, parent `cave-6sles`) — GitHub mirror:
[OpenCoven/coven-cave#4898](https://github.com/OpenCoven/coven-cave/issues/4898).
**Kind:** decision record (documentation only). **No code, workflow, or
infrastructure changes belong to this unit.**

---

## 1. Purpose and inputs

The umbrella program makes the hosted release boundary conditional on an
explicit written decision (§1, §11): *"Research Cloud public retrieval and
Cave Device Executor work begin only after an explicit
repository/account/operations decision."* This document is that written
decision, in PROPOSED form. Every proposal below is grounded in what the
repository already establishes; where the repository gives no basis, the
section records an **Open question** instead of inventing infrastructure.

Inputs read for this record:

| Source | What it establishes |
| --- | --- |
| `docs/superpowers/plans/2026-08-16-externalized-research-desk-program.md` (§1, §2, §9, §10–§13) | Gate C0 required-decision list; trust boundaries; flag authority; delivery graph |
| `docs/superpowers/specs/2026-08-15-externalized-research-desk-implementation-design.md` (§13–§14, §16.2, §17–§19, §21–§22, §24) | Cloudflare deployment binding; tenant isolation; data placement and retention; rollout sequence |
| `docs/superpowers/plans/2026-08-26-research-resource-contracts-and-flags.md` | Hosted-flag fail-closed contract and the C0 server-only replacement condition |
| `docs/superpowers/plans/2026-08-27-research-resource-recovery-rollout.md` | "Hosted runs remain fail-closed until a server-only Gate C0 authority exists" |
| `src/lib/feature-flags.ts` | `caveResearchHostedRuns()` returns `false` unconditionally today |
| `docs/superpowers/plans/2026-08-27-local-research-retrieval-ux.md` | Identity of `cave-6sles.8` as program unit A7 |
| GitHub issue #4898 (bead mirror) | Bead id, blocked status, dependency edges, authoritative owner |
| `OpenCoven/chat` `docs/` (read-only check, 2026-08-30) | No research-cloud program plan of record there; the coven-cave docs above are the program of record |

Decision areas required by the program (§11): hosted repository and
ownership; Cloudflare account/environment; authentication and tenant
authority; D1/R2/Queue/Workflow/Durable Object/Vectorize/Workers AI
bindings; budgets, quotas, retention, alerting, and operator
responsibility; staging and deletion-test tenants. Each is a section below.

### Decision index

| # | Decision area | State |
| --- | --- | --- |
| D1 | Hosted repository and ownership | PROPOSED |
| D2 | Cloudflare account and environments | PROPOSED |
| D3 | Cloudflare bindings | PROPOSED |
| D4 | Authentication and tenant authority | PROPOSED |
| D5 | Budgets and quotas | PROPOSED |
| D6 | Retention | PROPOSED |
| D7 | Alerts | PROPOSED |
| D8 | Operators | PROPOSED |
| D9 | Staging tenants | PROPOSED |
| D10 | Deletion-test tenants | PROPOSED |

---

## D1 — Hosted repository and ownership

**PROPOSED:** The Research Cloud is a **separate repository under the
OpenCoven GitHub organization** (the organization that owns `coven-cave`
and `chat`), not a package inside `coven-cave`. The proposed name is
`OpenCoven/research-cloud`, subject to confirmation at ratification.

Basis:

- The approved design gives the hosted service its own logical module map
  (`src/api/**`, `src/auth/**`, `src/agents/research-run-coordinator.ts`,
  `src/workflows/research-run-workflow.ts`, `src/retrieval/**`,
  `src/model-tasks/**`, `src/artifacts/**`, `src/retention/**`,
  `src/observability/**`, `src/protocol/**`) — a distinct codebase, not a
  Cave package (`2026-08-15-...-implementation-design.md` §16.2).
- The program requires a "hosted repository and ownership" decision as a
  Gate C0 deliverable (§11), and treats the delivery graph as one Bead per
  unit with its own branch, PR, and merge evidence (§12) — a separate
  repository keeps the hosted units' evidence chain out of the app
  repository's history.
- The repo already operates a multi-repository OpenCoven org (`coven-cave`,
  `chat`), so a sibling repository follows the existing pattern.

Ownership rules carried over from this repository's conventions: DCO
sign-off and focused PRs (`CONTRIBUTING.md`), no direct pushes to the
default branch, and branch protection with required checks on the hosted
repository from its first commit.

**Open questions (must be answered at ratification):**

1. The exact repository name. The approved design states "the hosted
   repository name and deployment account are operational choices, not
   protocol fields" (§16.2) — the repo deliberately does not fix a name,
   and this record does not either; `OpenCoven/research-cloud` is a
   placeholder until an owner confirms it.
2. Write access to the hosted repository for agent sessions. The current
   agent protocol for this program writes to `coven-cave` only and reads
   `chat`/`sdk` read-only; ratification must state explicitly whether the
   hosted repository follows the same scope and which identities may push.

---

## D2 — Cloudflare account and environments

**PROPOSED:** A **dedicated OpenCoven-owned Cloudflare account** — never a
personal account — with **two isolated Workers environments**,
`staging` and `production`, each owning its own D1 databases, R2 buckets,
Queues, Workflows, Durable Object namespaces, Vectorize indexes, and
secrets. The account id itself is recorded at ratification in the
operational secret store, not in this public repository.

Basis:

- The initial adapter is Cloudflare, with Worker, Workflow,
  Agents SDK/Durable Object, D1, R2, Vectorize, and Queue as the bound
  runtimes (`2026-08-15-...-implementation-design.md` §13.1).
- The rollout sequence requires staging before any hosted exposure:
  "Enable hosted staging for internal tenants" precedes "Enable hosted
  beta per account" (§22 steps 7–8), and Unit 5's exit criteria run
  "Units 0-4 conformance scenarios pass against staging" (§21). Two
  isolated environments are the minimum that makes that sequence real.
- Tenant isolation requires per-environment resource separation:
  R2 buckets are not public and R2 object keys are tenant-prefixed
  (§13.5), which a shared bucket across environments would weaken.

**Open questions (must be answered at ratification):**

1. The Cloudflare account identity. No account is named anywhere in the
   repository; the approved design leaves the deployment account as an
   operational choice (§16.2). Ratification must name the account (by
   reference to the secret store, not inline) and the identities that hold
   administrator access.
2. Whether the "shared OpenCoven Cloud control plane" the design mentions
   as a possible alternative durable runtime (§13.1) exists yet. This
   record assumes it does not, and binds the initial adapter to
   Cloudflare exactly as §13.1 specifies; a later runtime change must
   implement the same protocol and conformance suite.

---

## D3 — Cloudflare bindings

**PROPOSED:** The hosted service binds the seven runtime classes fixed by
the approved design (§13.1), in both environments:

| Binding class | Role (from §13.1) |
| --- | --- |
| Worker | HTTP API, authentication, quotas, tenant policy |
| Workflows | Durable research phases, retries, waits, checkpoints, cancellation |
| Durable Objects (Agents SDK) | Per-run coordination, task leases, connected devices, ordered event sequencing, broadcast |
| D1 | Tenant, run, policy, device, idempotency, and artifact metadata |
| R2 | Immutable public-source snapshots; opted-in artifact content only; never public |
| Vectorize | Public or explicitly remote-approved content only |
| Queue (+ dead-letter queue) | Ingestion/indexing with retries; poison messages reach the DLQ without blocking a run (§20.4) |

Workers AI is **not** a required binding at C0: semantic retrieval through
Workers AI/Vectorize is "optional and revision-gated" (program §11, Unit
5), and Vectorize stores "a tenant-scoped D1 chunk id and bounded filter
metadata, not raw content or an externally usable R2 key" (program §10).
Vectorize is bound for the optional semantic path only; D1 FTS5 lexical
retrieval is independently useful without it.

Constraints that travel with the bindings:

- Binding **names and ids remain private adapter details** (§13.1). This
  public record fixes the binding classes and their roles; the concrete
  wrangler names and resource ids live in the hosted repository's private
  configuration. The wire schemas stay cloud-neutral — "no provider/cloud
  implementation names appear in wire schemas" (§21 Unit 0 exit criteria).
- Tenant predicates are re-applied at every D1, R2, Vectorize, coordinator,
  event, and artifact boundary (program §2.7); every persisted row and
  object carries `tenant_id`; Durable Object names are an HMAC of tenant
  and run id (spec §13.5).

**Open question:** none for the binding classes (the design fixes them).
The concrete names/ids are deliberately out of scope here per §13.1 and
are recorded privately at provisioning time.

---

## D4 — Authentication and tenant authority

**PROPOSED:** The Worker derives tenant identity **solely from validated
authentication**; no tenant id supplied in a request payload is trusted.
Device identity follows the Unit 4 contract: per-device keypairs in the
Cave keychain (a dedicated Research Cloud keychain namespace), registration
and revocation through `POST /v1/devices` and `DELETE /v1/devices/:id`,
and device tokens that are audience-, tenant-, device-, and scope-bound.
Task leases bind tenant, run, task, attempt, device, input digest, and
expiry. All mutations carry an `Idempotency-Key` scoped to
`tenant + method + canonical route`.

Basis (all from the approved design unless noted):

- "API derives tenant from auth" and the full tenant-isolation list —
  tenant predicates in D1 access, HMAC Durable Object names,
  tenant-prefixed R2 keys behind authenticated Workers only, tenant/project
  filters on every vector query, bound device tokens and leases — §13.5.
- "Tenant identity comes from authentication and is re-applied at every
  D1, R2, Vectorize, coordinator, event, and artifact boundary" — program
  §2.7.
- Device registration/revocation endpoints — §13.3; the device-credential
  and keychain-namespace contracts — §16.1, §21 Unit 4.
- Idempotency-key scope and mutation coverage — §13.3.
- Cross-tenant tests are release blockers (§13.5), and "cross-tenant tests
  produce zero unauthorized reads or writes" is program acceptance (§13).

**Open questions (must be answered at ratification):**

1. The identity provider that issues tenant sessions. The design requires
   that tenant identity come from validated authentication but does not
   name the issuer. Ratification must name it (or name "cloud-issued
   device-agnostic session tokens minted by the Worker" if that is the
   choice) and state the enrollment path for internal staging tenants
   before beta.
2. The tenant registry of record (which store assigns and lists tenant
   ids). D1 is the runtime home for tenant rows (§13.1), but the
   administrative source that creates a tenant is an operational choice
   the repo does not settle.

---

## D5 — Budgets and quotas

**PROPOSED (shape, not numbers):** Four budget controls, all fail-closed:

1. **Rate limits** per user, tenant, device, connector, and run at the
   Worker boundary (spec §17, control 13).
2. **Byte and item limits** on requests, responses, events, and artifacts
   (spec §17, control 5), matching the bounded-reader discipline the local
   stores already enforce.
3. **A hard monthly spend ceiling** on the Cloudflare account. Reaching it
   must disable hosted run *creation* (fail closed) rather than degrade
   tenant isolation or retention jobs. This mirrors the flag contract: the
   hosted gate may only enable when the account, repository, bindings, and
   auth policy are proven (`2026-08-26-research-resource-contracts-and-flags.md`),
   and "waiting is not running" — quota exhaustion produces a typed
   waiting/paused state, never false progress (program §2.8; the local
   ingest path already treats `paused_quota` as resumable without consuming
   a retry).
4. **Semantic-path spend** (Workers AI, Vectorize) exists only while the
   optional semantic path is enabled, and stays revision-gated so
   Vectorize lag or failure can never hide lexically ready content
   (program §10–§11).

Provider-model spend is already out of scope for the cloud: a hosted run
uses the user's Cave-selected model **without sending provider credentials
to Research Cloud** (program §13; spec §23 criterion 11), and provider
quota/auth failures pause the run for attention in Cave, never in the
cloud UI (spec §18).

**Open questions (must be answered at ratification):**

1. The dollar/usage numbers: no budget figure exists anywhere in the
   repository. Ratification must set the monthly ceiling, the per-tenant
   default quotas, and the staging spend cap, each with an owner.
2. Who receives and acts on budget-breach signals (see D7/D8).

---

## D6 — Retention

**PROPOSED:** Adopt the approved design's §14 data-placement and retention
contract verbatim as the C0 retention policy baseline:

- **Policies:** `run-only` (delete content after terminal state plus a
  24-hour recovery window; retain minimized audit metadata for 30 days),
  `7-days` (delete content seven days after terminal state), and
  `project` (retain until project deletion or explicit retention change).
- **Deletion receipts:** a deletion job emits `content.deleted` with
  object counts and manifest status — never deleted content. Retention
  deletions must complete within the declared policy window (Unit 5 exit
  criteria, §21); partial failures retry object deletion while the
  manifest stays `deletion_pending` (§18).
- **Ordering rules:** cancellation does not shorten retention
  automatically; changing to a shorter policy schedules deletion; changing
  to a longer policy requires fresh consent; legal or operational policy
  may shorten retention but must not silently lengthen it (§14).
- **Data placement boundaries** travel with retention: raw sessions and
  memory, private attachments, full assembled prompts, and provider
  credentials stay Cave-only (not supported remotely in v1); redacted
  Context Pack blobs stay Cave-only until a separate content-preview
  consent; public evidence snapshots, sanitized queries, minimized
  structured Model Task outputs, artifact digests/manifests, run events,
  and deletion receipts are the cloud-resident set (§14).
- Cancellation, retention, deletion, and artifact-content synchronization
  remain distinct operations (program §2.6; spec §23 criterion 18).

This is the one decision area the repository already fixes completely; the
proposal is adoption, not invention. Ratification only confirms the
default policy applied to *new* hosted tenants (the design does not name
which of the three is the default) — **Open question:** which policy is
the tenant default at beta (`run-only` is the conservative proposal,
consistent with the 24-hour recovery window being the shortest exposure).

---

## D7 — Alerts

**PROPOSED:** The minimum alert set, each derived from an existing metric
or release blocker in the design (§19.1, §13.5, §20.4):

| Alert | Trigger | Source |
| --- | --- | --- |
| Overdue deletion | deletion overdue count > 0 beyond policy window | §19.1 product metrics; Unit 5 exit criteria |
| Cross-tenant authorization denial | any occurrence | §13.5 "cross-tenant tests are release blockers"; §19.1 reliability metrics |
| Dead-letter depth | poison messages in the research Queue DLQ | §13.1 Queue; §20.4 |
| API reliability breach | latency/error-rate SLO breach by operation | §19.1 reliability metrics |
| Lease anomalies | task lease expiry/replay-conflict spike | §19.1 |
| Storage-layer errors | D1, R2, Vectorize, Queue error rates | §19.1 |
| Denied SSRF targets | retrieval failures with denied private/loopback/metadata targets | §19.1; §13.4 connector denial |

Every alert payload carries only the allowed observability fields — opaque
ids, schema version, phase/status/error code, counts, digests, latency —
never raw prompts, pack text, excerpts, credentials, model output, private
filenames, local paths, or chain-of-thought (§19.2). Trace and log
forbidden-content rules apply to alert enrichment too.

**Open questions (must be answered at ratification):** the delivery
channel (email/chat/page) and the thresholds that separate warning from
page. The repository documents no on-call infrastructure, so the channel
is an operational choice to be recorded at ratification; the metric set
above is not.

---

## D8 — Operators

**PROPOSED:** The **accountable owner** of the Research Cloud deployment
is the authoritative owner of bead `cave-6sles.13` (`BunsDev`,
`68980965+BunsDev@users.noreply.github.com`, per the GitHub issue mirror) —
the same owner already accountable for the program's Gate C0 unit.
Named operators are humans granted Cloudflare account access at
ratification; agent sessions hold **no** Cloudflare credentials and cannot
provision resources. Operator responsibilities:

1. Provision the D2 account/environments and D3 bindings *only after this
   record is ratified* (program §11 hard gate).
2. Hold the secret store entries: Cloudflare account id, binding names and
   ids (private adapter details, §13.1), API tokens, and the staging/
   production separation.
3. Enforce D5 budgets and respond to D7 alerts.
4. Verify deletion receipts complete within the declared policy window
   (Unit 5 exit criteria) and keep the audit trail required by §17
   control 14 (audit records for device registration/revocation, run
   control, retention changes, and deletion).
5. Keep the hosted repository's branch protection and DCO conventions
   identical to this repository's (`CONTRIBUTING.md`).

**Open question:** the named operator roster (beyond the accountable
owner) and their access tiers. The repository names no operators; this
record proposes the accountability chain and leaves the roster to
ratification.

---

## D9 — Staging tenants

**PROPOSED:** The `staging` environment (D2) hosts **internal tenants
only** — the design's rollout sequence is "Enable hosted staging for
internal tenants" before "Enable hosted beta per account" (§22 steps
7–8). Concretely:

- One dedicated internal conformance tenant runs the Units 0–4 protocol
  conformance, chaos, and cross-tenant suites against staging before any
  production exposure (§21 Unit 5 exit criteria).
- Staging tenants never contain real user data: private pack blobs and
  provider credentials cannot reach the cloud in the first place (§14, §17),
  and staging fixtures use synthetic content.
- Until staging exists, the Cave side runs on the **Unit 3 fake hosted
  adapter**; Unit 4 (Cave Device Executor) uses that same fake until Unit 5
  staging is available (program §11). No real endpoint is implied before
  ratification.

**Open question:** the staging enrollment path for additional internal
tenants beyond the conformance tenant (who approves, via which registry —
ties into D4's tenant-registry open question).

---

## D10 — Deletion-test tenants

**PROPOSED:** Dedicated **disposable tenants used solely to exercise
deletion and isolation**: retention-job deletion with `content.deleted`
receipt validation, partial-deletion retry (§18), cross-tenant
authorization probes (§20.4), and lease/cancellation interactions with
retention. Constraints:

- Deletion-test tenants contain no real content and are recreated per test
  cycle rather than retained.
- Deletion receipts from these tenants must complete within the declared
  policy window exactly as production receipts must (Unit 5 exit
  criteria); a receipt that does not complete is a release blocker, not a
  test-environment footnote.
- They are excluded from budget baselines and D7 paging thresholds so test
  deletions cannot mask overdue production deletions (or vice versa).
- Cross-tenant probes run from a deletion-test tenant must produce zero
  unauthorized reads or writes against every storage and retrieval path
  (§23 criterion 17).

**Open question:** the provisioning/teardown mechanism for these tenants
(manual operator runbook vs. automated harness). The repository specifies
the test obligations but no tenant lifecycle automation; that mechanism is
part of Unit 5's build, and ratification should record which shape is
committed to.

---

## 2. Ratification checklist

This record becomes **ratified** — and only then does the Gate C0 blocker
lift — when all of the following hold:

- [ ] `cave-6sles.8` (A7) and `cave-6sles.12` (Unit 3) are merged, matching
      the program's delivery graph (§11), so the bead is no longer blocked.
- [ ] Every **Open question** in D1–D10 has a dated answer and a named
      owner recorded in this document; each section flips from PROPOSED to
      RATIFIED in the decision index.
- [ ] The account, repository, bindings, and authentication policy named
      above are provable by a server-only authority, which is the
      documented precondition for replacing the fail-closed
      `caveResearchHostedRuns()` implementation
      (`2026-08-26-research-resource-contracts-and-flags.md`).
- [ ] Provisioning begins only after all of the above: no cloud resource
      and no hosted endpoint before ratification (program §11).

Until then, the enforceable state is the one already in the tree:
`caveResearchHostedRuns()` returns `false` unconditionally
(`src/lib/feature-flags.ts`), and hosted flags "cannot enable without
configured cloud account, repository, bindings, and auth policy"
(program §9).

## 3. Non-goals

- No code, schema, workflow, or infrastructure changes in this unit; this
  is a decision record only (bead `cave-6sles.13`).
- This document ratifies nothing by itself and provisions nothing.
- Provider-credential delegation, remote raw-session upload, cross-device
  pack sync, and the other items on the design's deferred list (§24) stay
  deferred and are not decided here.
