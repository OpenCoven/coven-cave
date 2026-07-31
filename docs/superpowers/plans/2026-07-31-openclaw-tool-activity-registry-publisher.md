# OpenClaw Compatibility Registry Publisher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish and deploy the signed OpenClaw compatibility profile from `OpenCoven/coven-runtimes`, then configure Cave's public release trust anchors.

**Architecture:** Extend the existing protected compatibility-registry publisher with a third runtime. The source contract stays unsigned in Git, the protected GitHub Actions environment supplies a distinct Ed25519 private key, Pages publishes immutable sequence files plus `current.json`, and Cave receives only the public URL, public key, and checkpoint.

**Tech Stack:** Node.js 24, GitHub Actions, GitHub Pages, Ed25519 signatures, JSON compatibility contracts, GitHub CLI.

---

## File Map

In a separate `OpenCoven/coven-runtimes` worktree:

- Create `registry/compatibility/openclaw/1.json`: unsigned sequence-one source matching Cave's built-in payload.
- Modify `scripts/compatibility-registry.mjs`: accept runtime `openclaw` and `profiles`.
- Modify `scripts/build-compatibility-registry-site.mjs`: sign/publish OpenClaw and emit its checkpoint.
- Modify `scripts/compatibility-registry.test.mjs`: source, signature, site, leak, workflow, and runbook tests.
- Modify `.github/workflows/publish-compatibility-registry.yml`: consume the protected OpenClaw private key.
- Modify `docs/compatibility-registry-publisher.md`: endpoint, secret custody, and Cave handoff.
- Modify `.github/workflows/ci.yml` only if its path allowlist explicitly names the two existing runtimes.

### Task 1: Add the unsigned OpenClaw sequence-one source

**Files:**
- Create: `registry/compatibility/openclaw/1.json`
- Modify: `scripts/compatibility-registry.test.mjs`

- [ ] **Step 1: Create an isolated publisher worktree**

```bash
gh repo clone OpenCoven/coven-runtimes ../coven-runtimes-openclaw
cd ../coven-runtimes-openclaw
git fetch origin main
git switch -c feat/openclaw-compatibility-registry origin/main
```

Expected: clean branch based on current `origin/main`.

- [ ] **Step 2: Write the failing source-contract test**

Add:

```js
const openclaw = readSource("registry/compatibility/openclaw/1.json");
assertUnsignedSource(openclaw, "openclaw");
assert.ok(Array.isArray(openclaw.profiles) && openclaw.profiles.length === 1);
assert.equal(openclaw.profiles[0].requires.agentEventSchemaHash, "ed68832d5ecbc52de7ad5394933cb2a0df7b0f0b6f7a880127f688becbd76bd2");
assert.deepEqual(openclaw.profiles[0].eventNames, ["agent", "session.tool"]);
```

Update `assertUnsignedSource` to accept `schemas` or `profiles` according to
runtime.

- [ ] **Step 3: Run the test to verify it fails**

```bash
node scripts/compatibility-registry.test.mjs
```

Expected: FAIL because the OpenClaw source is missing.

- [ ] **Step 4: Add the exact source contract**

Copy the final `BUILTIN_OPENCLAW_SCHEMA_BUNDLE` unsigned payload from the Cave
implementation into `registry/compatibility/openclaw/1.json`. Verify:

```bash
node -e 'const value=require("./registry/compatibility/openclaw/1.json"); if (value.runtime !== "openclaw" || value.sequence !== 1 || value.signature) process.exit(1)'
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add registry/compatibility/openclaw/1.json scripts/compatibility-registry.test.mjs
git commit -S -m "test(registry): add OpenClaw compatibility source"
```

### Task 2: Extend signing and Pages publication

**Files:**
- Modify: `scripts/compatibility-registry.mjs`
- Modify: `scripts/build-compatibility-registry-site.mjs`
- Modify: `scripts/compatibility-registry.test.mjs`
- Modify: `.github/workflows/publish-compatibility-registry.yml`

- [ ] **Step 1: Add failing signing/site tests**

Generate a third test key and assert:

```js
const openclawKey = generateKeyPairSync("ed25519").privateKey
  .export({ type: "pkcs8", format: "pem" }).toString();
const checkpoints = buildCompatibilityRegistrySite({
  root,
  output,
  opencodePrivateKeyPem: privateKeyPem,
  grokPrivateKeyPem: grokKey,
  openclawPrivateKeyPem: openclawKey,
});
assert.match(checkpoints.openclaw.payloadHash, /^[a-f0-9]{64}$/);
assert.equal(
  await readFile(path.join(output, "openclaw/current.json"), "utf8"),
  await readFile(latestSequencePath(path.join(output, "openclaw")), "utf8"),
);
```

Assert no OpenClaw private key text appears in the output and the workflow
references `COMPATIBILITY_OPENCLAW_PRIVATE_KEY_PEM`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
node scripts/compatibility-registry.test.mjs
```

Expected: FAIL because only OpenCode/Grok are accepted and published.

- [ ] **Step 3: Generalize unsigned source validation**

Allow:

```js
const RUNTIME_PAYLOAD_FIELD = {
  opencode: "schemas",
  "grok-build": "schemas",
  openclaw: "profiles",
};
```

Keep the top-level field allowlist closed. For OpenClaw permit
`retiredProfileIds`; for the two existing runtimes retain
`retiredSchemaIds`. Reject a payload that supplies both.

- [ ] **Step 4: Add the publisher runtime entry**

```js
const RUNTIMES = [
  { name: "opencode", source: "opencode", key: "opencodePrivateKeyPem" },
  { name: "grok", source: "grok", key: "grokPrivateKeyPem" },
  { name: "openclaw", source: "openclaw", key: "openclawPrivateKeyPem" },
];
```

Pass `process.env.COMPATIBILITY_OPENCLAW_PRIVATE_KEY_PEM` from the CLI entry.

- [ ] **Step 5: Add the protected workflow secret**

```yaml
env:
  COMPATIBILITY_OPENCODE_PRIVATE_KEY_PEM: ${{ secrets.COMPATIBILITY_OPENCODE_PRIVATE_KEY_PEM }}
  COMPATIBILITY_GROK_PRIVATE_KEY_PEM: ${{ secrets.COMPATIBILITY_GROK_PRIVATE_KEY_PEM }}
  COMPATIBILITY_OPENCLAW_PRIVATE_KEY_PEM: ${{ secrets.COMPATIBILITY_OPENCLAW_PRIVATE_KEY_PEM }}
```

Do not add workflow inputs or caller-selected refs.

- [ ] **Step 6: Run publisher tests**

```bash
node scripts/compatibility-registry.test.mjs
```

Expected: PASS for all three runtimes.

- [ ] **Step 7: Commit**

```bash
git add scripts/compatibility-registry.mjs scripts/build-compatibility-registry-site.mjs scripts/compatibility-registry.test.mjs .github/workflows/publish-compatibility-registry.yml
git commit -S -m "feat(registry): publish OpenClaw compatibility"
```

### Task 3: Update publisher documentation and repository CI

**Files:**
- Modify: `docs/compatibility-registry-publisher.md`
- Modify: `.github/workflows/ci.yml` if required by explicit test wiring
- Modify: `scripts/compatibility-registry.test.mjs`

- [ ] **Step 1: Add failing runbook assertions**

```js
assert.match(runbook, /opencoven\.github\.io\/coven-runtimes\/openclaw\/current\.json/);
assert.match(runbook, /COMPATIBILITY_OPENCLAW_PRIVATE_KEY_PEM/);
assert.match(runbook, /OPENCLAW_SCHEMA_REGISTRY_CHECKPOINT/);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node scripts/compatibility-registry.test.mjs
```

Expected: FAIL because the runbook names only two runtimes.

- [ ] **Step 3: Document OpenClaw custody and handoff**

Add:

- public endpoint;
- distinct private key requirement;
- source contract review against Cave's built-in payload;
- `OPENCLAW_SCHEMA_REGISTRY_URL`;
- `OPENCLAW_SCHEMA_REGISTRY_PUBLIC_KEY` or rotation keyring;
- `OPENCLAW_SCHEMA_REGISTRY_CHECKPOINT`;
- immutable sequence publication;
- no private keys in Cave, logs, issues, or PR bodies.

- [ ] **Step 4: Run all publisher repository gates**

```bash
node scripts/compatibility-registry.test.mjs
cargo fmt --all --check
cargo test --workspace --locked
cargo clippy --workspace --all-targets -- -D warnings
cargo deny check
git diff --check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/compatibility-registry-publisher.md .github/workflows/ci.yml scripts/compatibility-registry.test.mjs
git commit -S -m "docs(registry): add OpenClaw release handoff"
```

Omit `.github/workflows/ci.yml` from `git add` when it required no change.

### Task 4: Merge, provision, deploy, and configure Cave

**Files:** External repository/environment settings only.

- [ ] **Step 1: Push and open the publisher PR**

```bash
git push -u origin feat/openclaw-compatibility-registry
gh pr create --repo OpenCoven/coven-runtimes --base main --head feat/openclaw-compatibility-registry \
  --title "feat(registry): publish OpenClaw compatibility" \
  --body "Adds the source-reviewed OpenClaw sequence-one compatibility profile, protected Ed25519 signing, immutable Pages publication, tests, and Cave release handoff."
```

- [ ] **Step 2: Merge only after required checks and review threads are clear**

```bash
PR_NUMBER=$(gh pr view --repo OpenCoven/coven-runtimes --json number --jq .number)
gh pr checks --repo OpenCoven/coven-runtimes "$PR_NUMBER" --watch
gh pr merge --repo OpenCoven/coven-runtimes "$PR_NUMBER" --squash --delete-branch
```

Expected: merged PR on current main.

- [ ] **Step 3: Generate and retain the signing key securely**

On a trusted maintainer machine:

```bash
openssl genpkey -algorithm Ed25519 -out openclaw-compatibility-private.pem
openssl pkey -in openclaw-compatibility-private.pem -pubout -out openclaw-compatibility-public.pem
```

Store the private PEM in the organization-controlled secret manager. Add it
only to the protected `compatibility-registry-publisher` environment as
`COMPATIBILITY_OPENCLAW_PRIVATE_KEY_PEM`. Delete the local private-key file
after confirming secret-manager recovery; never place it in shell history,
issue text, or Git.

- [ ] **Step 4: Dispatch and verify Pages publication**

```bash
gh workflow run publish-compatibility-registry.yml --repo OpenCoven/coven-runtimes --ref main
RUN_ID=$(gh run list --repo OpenCoven/coven-runtimes --workflow publish-compatibility-registry.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch --repo OpenCoven/coven-runtimes "$RUN_ID" --exit-status
curl --fail --proto '=https' --max-redirs 0 \
  https://opencoven.github.io/coven-runtimes/openclaw/current.json \
  -o /tmp/openclaw-current.json
curl --fail --proto '=https' --max-redirs 0 \
  https://opencoven.github.io/coven-runtimes/checkpoints.json \
  -o /tmp/compatibility-checkpoints.json
```

Expected: signed OpenClaw bundle and an `openclaw` checkpoint.

- [ ] **Step 5: Verify signature and payload hash locally**

Use Cave's exported verifier from the completed Cave branch:

```bash
node --experimental-strip-types -e '
import { readFile } from "node:fs/promises";
import {
  openClawSchemaBundlePayloadHash,
  verifyOpenClawSchemaBundle,
} from "./src/lib/openclaw-compatibility.ts";
const bundle = JSON.parse(await readFile("/tmp/openclaw-current.json", "utf8"));
const publicKey = await readFile("/secure/path/openclaw-compatibility-public.pem", "utf8");
const checkpoints = JSON.parse(await readFile("/tmp/compatibility-checkpoints.json", "utf8"));
if (!verifyOpenClawSchemaBundle(bundle, publicKey)) process.exit(1);
if (openClawSchemaBundlePayloadHash(bundle) !== checkpoints.openclaw.payloadHash) process.exit(2);
if (bundle.sequence !== checkpoints.openclaw.sequence) process.exit(3);
'
```

Expected: exit 0.

- [ ] **Step 6: Configure Cave public release secrets**

```bash
gh secret set OPENCLAW_SCHEMA_REGISTRY_URL --repo OpenCoven/coven-cave \
  --body "https://opencoven.github.io/coven-runtimes/openclaw/current.json"
gh secret set OPENCLAW_SCHEMA_REGISTRY_PUBLIC_KEY --repo OpenCoven/coven-cave \
  < /secure/path/openclaw-compatibility-public.pem
gh secret set OPENCLAW_SCHEMA_REGISTRY_CHECKPOINT --repo OpenCoven/coven-cave \
  --body "$(jq -c '.openclaw' /tmp/compatibility-checkpoints.json)"
```

For a future key rotation, set `OPENCLAW_SCHEMA_REGISTRY_PUBLIC_KEYS` instead
of the single key and retain one to four named active/retiring public keys.

- [ ] **Step 7: Run Cave's release guard with the deployed values**

```bash
NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_URL="https://opencoven.github.io/coven-runtimes/openclaw/current.json" \
NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_PUBLIC_KEY="$(cat /secure/path/openclaw-compatibility-public.pem)" \
NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_CHECKPOINT="$(jq -c '.openclaw' /tmp/compatibility-checkpoints.json)" \
node scripts/check-openclaw-registry-release.mjs
```

Expected: exit 0 and no secret material printed.

- [ ] **Step 8: Record deployment evidence in the bead**

```bash
bd update cave-53iko --append-notes "REGISTRY DEPLOYED: record coven-runtimes PR/merge SHA, Pages workflow run URL, canonical OpenClaw endpoint, public-key fingerprint, sequence, payload hash, Cave secret names configured, and release-guard result. Do not include private key material."
```

The bead may close only after the Cave PR is merged and a release or explicit
completion gate proves the packaged trust anchors.
