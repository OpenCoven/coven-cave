# Managed Node npm Verification Timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give managed npm verification a Windows-safe cold-start deadline
without slowing the Node executable probe.

**Architecture:** `probeManagedNodeToolchain` continues to run the Node and npm
checks concurrently. Named constants make their intentionally different
deadlines explicit and regression-testable.

**Tech Stack:** TypeScript, Node.js `execFile`, Node test runner

---

### Task 1: Pin and implement separate probe deadlines

**Files:**
- Modify: `src/lib/server/managed-node-toolchain.test.ts`
- Modify: `src/lib/server/managed-node-toolchain.ts`

- [ ] **Step 1: Write the failing test**

Create a temporary managed toolchain layout, inject an exec function, and
assert that `node --version` receives `1_500` ms while
`npm-cli.js --version` receives `10_000` ms.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  src/lib/server/managed-node-toolchain.test.ts
```

Expected: the new test fails because both calls currently receive `1500`.

- [ ] **Step 3: Add named timeout constants**

Define a 1,500 ms Node probe timeout and a 10,000 ms npm probe timeout, then
pass each constant to its corresponding concurrent `execFile` call.

- [ ] **Step 4: Run the targeted test**

Run the command from Step 2.

Expected: all managed Node toolchain tests pass.

- [ ] **Step 5: Run relevant repository checks**

Run:

```bash
pnpm typecheck
pnpm test:api
```

Expected: this change introduces no new failures. Pre-existing failures on the base branch are acceptable until addressed separately.

- [ ] **Step 6: Commit and open the PR**

Create a signed-off commit, push the issue branch, and open a PR that closes
GitHub issue #4355.
