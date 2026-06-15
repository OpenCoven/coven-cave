# Hermes Install Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the buffered one-shot install POST with server-side install jobs the onboarding UI polls, giving the Install Hermes button live output, elapsed time, per-target busy state, refresh survival, and a `hermes setup` next-step row.

**Architecture:** The install route keeps a `globalThis` job registry (one job per target). POST spawns the installer and returns `202` immediately; a new GET returns job status with an ANSI-stripped output tail. The onboarding overlay swaps its single `installBusy` flag for a per-target job map fed by a ~2s polling effect that also re-attaches after page refresh.

**Tech Stack:** Next.js route handlers (nodejs runtime), React 19 client component, node:child_process spawn, source-level regex tests run with `node --experimental-strip-types`.

**Spec:** `docs/superpowers/specs/2026-06-12-hermes-install-button-design.md`

**Repo rules that apply to every commit in this plan:**
- Work in a dedicated worktree (Task 1), never the primary checkout.
- Every commit MUST be signed: `git commit -S`. Before the first push run
  `git log origin/<branch>..HEAD --pretty='%H %G?' | awk '$2 != "G" {print "UNSIGNED:", $0}'` — empty output required.
- Tests run with `node --experimental-strip-types <file>` (NOT tsx). The
  `MODULE_TYPELESS_PACKAGE_JSON` warning is noise; "ok" on the last line is the pass signal.

---

## File Structure

| File | Role |
| --- | --- |
| `src/app/api/onboarding/install/route.ts` (modify) | Job registry, POST→202 spawn, new GET status endpoint |
| `src/app/api/onboarding/install/route.test.ts` (modify) | Source-level assertions for job model + security invariants (existing style) |
| `src/components/onboarding-overlay.tsx` (modify) | Per-target job state, polling, button/progress UI, hermes next-step |
| `src/components/onboarding-guided-steps.test.ts` (modify) | Source-level assertions for the new UI behavior |

No new files: both surfaces follow this repo's pattern of colocated large components/routes, and every piece (job registry, polling hook, tail rendering) is only used here.

---

### Task 1: Worktree setup

**Files:** none (environment)

- [ ] **Step 1: Create the worktree and branch** (repo convention: `.worktrees/<branch>` off `origin/main`)

```bash
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave fetch origin
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave worktree add -b feat/onboarding-install-jobs .worktrees/feat-onboarding-install-jobs origin/main
pnpm --dir /Users/buns/Documents/GitHub/OpenCoven/coven-cave/.worktrees/feat-onboarding-install-jobs install
```

Expected: worktree created, `pnpm install` finishes in ~10s (CAS store).

- [ ] **Step 2: Verify signing is configured** (required before any commit)

```bash
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave/.worktrees/feat-onboarding-install-jobs config --get user.signingkey
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave/.worktrees/feat-onboarding-install-jobs config --get gpg.format
```

Expected: both print a value. If `user.signingkey` is empty, STOP and surface to the user.

All later paths in this plan are relative to the worktree root
`/Users/buns/Documents/GitHub/OpenCoven/coven-cave/.worktrees/feat-onboarding-install-jobs/`.

---

### Task 2: Server — job registry, POST 202, GET status

**Files:**
- Modify: `src/app/api/onboarding/install/route.ts`
- Test: `src/app/api/onboarding/install/route.test.ts`

- [ ] **Step 1: Append failing assertions to `route.test.ts`**

Append before the final `console.log` line:

```ts
// ── Background install jobs ─────────────────────────────────────────────────
// POST starts the installer and returns immediately; GET polls job status.

assert.match(
  source,
  /__covenInstallJobs/,
  "job registry lives on globalThis so dev HMR cannot orphan running jobs",
);

assert.match(
  source,
  /export async function GET/,
  "a GET status endpoint exists for the client to poll",
);

assert.match(
  source,
  /\{ status: 202 \}/,
  "POST registers the job and returns 202 without awaiting the installer",
);

assert.match(
  source,
  /existing\?\.status === "running"/,
  "re-POST while a target is running is idempotent — no duplicate spawn",
);

assert.match(
  source,
  /other\.kind === "npm"/,
  "npm-kind installs are mutually exclusive (global npm tree races)",
);

assert.match(
  source,
  /\{ status: 409 \}/,
  "a conflicting npm install is rejected with 409, not queued",
);

assert.match(
  source,
  /stripAnsi\(job\.output\)/,
  "the polled tail is ANSI-stripped",
);

assert.match(
  source,
  /slice\(-OUTPUT_CAP\)/,
  "job output is capped, not unbounded",
);
```

- [ ] **Step 2: Run the test to verify the new assertions fail**

```bash
node --experimental-strip-types src/app/api/onboarding/install/route.test.ts
```

Expected: FAIL — `AssertionError ... job registry lives on globalThis ...`

- [ ] **Step 3: Rework `route.ts`**

Keep everything from the top of the file through `spawnPlanFor` unchanged
(imports, `INSTALL_TARGETS`, `nodeInstallHint`, `commandPath`,
`isInstallTarget`, `SpawnPlan`, `spawnPlanFor`). The existing assertions pin
those. Replace everything from `export async function POST` to the end of the
file with:

```ts
type InstallJob = {
  status: "running" | "done";
  kind: "npm" | "script";
  startedAt: number;
  finishedAt?: number;
  /** Raw interleaved stdout+stderr, capped to OUTPUT_CAP. */
  output: string;
  ok?: boolean;
  code?: number | null;
  binaryPath?: string | null;
  error?: string;
};

/** Last ~8 KB of installer output is plenty for a progress tail and keeps
 *  long installs (Hermes bootstraps a Python toolchain) from growing
 *  unbounded in memory. */
const OUTPUT_CAP = 8_192;

// Next dev re-evaluates this module on HMR; a plain module-level Map would
// orphan running jobs. globalThis survives re-evaluation.
const globalScope = globalThis as unknown as {
  __covenInstallJobs?: Map<InstallTarget, InstallJob>;
};
const jobs: Map<InstallTarget, InstallJob> = (globalScope.__covenInstallJobs ??=
  new Map());

function appendOutput(job: InstallJob, chunk: string) {
  job.output = (job.output + chunk).slice(-OUTPUT_CAP);
}

function jobView(job: InstallJob) {
  const tail = stripAnsi(job.output).slice(-2000);
  const elapsedMs = (job.finishedAt ?? Date.now()) - job.startedAt;
  if (job.status === "running") {
    return { status: "running" as const, elapsedMs, tail };
  }
  return {
    status: "done" as const,
    elapsedMs,
    tail,
    ok: job.ok ?? false,
    code: job.code ?? null,
    binaryPath: job.binaryPath ?? null,
    ...(job.error ? { error: job.error } : {}),
  };
}

export async function GET(req: Request) {
  const target = new URL(req.url).searchParams.get("target");
  if (!isInstallTarget(target)) {
    return NextResponse.json(
      { ok: false, error: "unknown install target" },
      { status: 400 },
    );
  }
  const job = jobs.get(target);
  if (!job) return NextResponse.json({ status: "idle" });
  return NextResponse.json(jobView(job));
}

export async function POST(req: Request) {
  let body: { target?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid json body" },
      { status: 400 },
    );
  }

  if (!isInstallTarget(body.target)) {
    return NextResponse.json(
      { ok: false, error: "unknown install target" },
      { status: 400 },
    );
  }
  const targetName = body.target;
  const target = INSTALL_TARGETS[targetName];

  // Idempotent re-POST: same body shape as GET, no duplicate spawn.
  const existing = jobs.get(targetName);
  if (existing?.status === "running") {
    return NextResponse.json(jobView(existing));
  }

  // Concurrent `npm install -g` calls race the global tree; script installers
  // (Hermes) are independent and may run alongside anything.
  if (target.kind === "npm") {
    for (const [otherName, other] of jobs) {
      if (other.status === "running" && other.kind === "npm") {
        return NextResponse.json(
          {
            ok: false,
            error: `wait for ${INSTALL_TARGETS[otherName].label} to finish`,
          },
          { status: 409 },
        );
      }
    }
  }

  const plan = await spawnPlanFor(target);
  if (plan && "npmMissing" in plan) {
    return NextResponse.json(
      {
        ok: false,
        npmMissing: true,
        error: "npm is not available on PATH",
        hint: nodeInstallHint(),
      },
      { status: 422 },
    );
  }
  if (!plan) {
    return NextResponse.json(
      { ok: false, error: "no install plan for this platform" },
      { status: 500 },
    );
  }

  const job: InstallJob = {
    status: "running",
    kind: target.kind,
    startedAt: Date.now(),
    output: "",
  };
  jobs.set(targetName, job);

  const child = spawn(plan.command, plan.args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: covenSpawnEnv(),
    shell: plan.shell,
  });
  child.stdout.on("data", (d) => appendOutput(job, d.toString()));
  child.stderr.on("data", (d) => appendOutput(job, d.toString()));
  const timer = setTimeout(() => {
    job.error = `install timed out after ${target.timeoutMs / 1000}s`;
    child.kill("SIGTERM");
  }, target.timeoutMs);
  child.on("error", (e) => {
    clearTimeout(timer);
    job.status = "done";
    job.finishedAt = Date.now();
    job.ok = false;
    job.error = e.message;
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    void (async () => {
      const installedPath = await commandPath(target.binary);
      const ok = code === 0 && !!installedPath && !job.error;
      job.status = "done";
      job.finishedAt = Date.now();
      job.ok = ok;
      job.code = code;
      job.binaryPath = installedPath;
      if (!ok && !job.error) {
        job.error =
          code === 0
            ? `${target.binary} still is not on PATH after install — open a new terminal or restart Cave, then re-check.`
            : `installer exited with code ${code}`;
      }
    })();
  });

  return NextResponse.json(
    { started: true, target: targetName },
    { status: 202 },
  );
}
```

Note: `execFile`/`promisify` imports stay (still used by `commandPath`).

- [ ] **Step 4: Run the route test — all assertions (old and new) pass**

```bash
node --experimental-strip-types src/app/api/onboarding/install/route.test.ts
```

Expected: `onboarding install route.test.ts: ok`

- [ ] **Step 5: Typecheck**

```bash
pnpm exec tsc --noEmit
```

Expected: exit 0. (If the repo's tsconfig surfaces pre-existing unrelated errors, confirm none mention `route.ts`.)

- [ ] **Step 6: Commit (signed)**

```bash
git add src/app/api/onboarding/install/route.ts src/app/api/onboarding/install/route.test.ts
git commit -S -m "$(cat <<'EOF'
feat(onboarding): background install jobs with pollable status

One-click installs spawned a child and buffered its whole run inside the
POST — up to 10 minutes with zero feedback, and a refresh forgot the job.
POST now registers a per-target job (globalThis registry, HMR-proof),
returns 202 immediately, and a new GET reports status, elapsed time, and
an ANSI-stripped output tail. npm-kind targets stay mutually exclusive
(global tree races); script-kind (Hermes) runs alongside. Allowlist and
spawn-plan security invariants unchanged.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature | head -5
```

Expected: commit created; signature block shows `Good "ssh" signature` (or the configured format).

---

### Task 3: Client — per-target job state, polling, re-attach

**Files:**
- Modify: `src/components/onboarding-overlay.tsx`
- Test: `src/components/onboarding-guided-steps.test.ts`

- [ ] **Step 1: Append failing assertions to `onboarding-guided-steps.test.ts`**

Append before the final `console.log` line:

```ts
// ── Background install jobs (client) ────────────────────────────────────────

assert.match(
  source,
  /installJobs/,
  "per-target install jobs replace the single global busy flag",
);

assert.doesNotMatch(
  source,
  /disabled=\{installBusy !== null\}/,
  "one running install must not disable every other install button",
);

assert.match(
  source,
  /api\/onboarding\/install\?target=/,
  "the client polls the job status endpoint",
);

assert.match(
  source,
  /NPM_INSTALL_TARGETS/,
  "npm-kind targets share a busy lock (mirrors the server's 409)",
);
```

- [ ] **Step 2: Run to verify failure**

```bash
node --experimental-strip-types src/components/onboarding-guided-steps.test.ts
```

Expected: FAIL — `per-target install jobs replace the single global busy flag`

- [ ] **Step 3: Add job types/constants in `onboarding-overlay.tsx`**

Directly under the existing `type InstallResult = {...}` block (near line 67):

```ts
type InstallJobView = {
  status: "running" | "done";
  elapsedMs: number;
  tail: string;
  ok?: boolean;
  binaryPath?: string | null;
  error?: string;
};

/** Mirrors the server's npm-kind mutual exclusion (route returns 409). */
const NPM_INSTALL_TARGETS: InstallTarget[] = [
  "coven-cli",
  "codex",
  "claude",
  "openclaw",
];

const ALL_INSTALL_TARGETS: InstallTarget[] = [...NPM_INSTALL_TARGETS, "hermes"];
```

- [ ] **Step 4: Replace the `installBusy` state with a job map**

Find (near line 285):

```ts
const [installBusy, setInstallBusy] = useState<InstallTarget | null>(null);
```

Replace with:

```ts
const [installJobs, setInstallJobs] = useState<
  Partial<Record<InstallTarget, InstallJobView>>
>({});
```

- [ ] **Step 5: Rework `runInstall` to start a job instead of awaiting it**

Replace the whole `runInstall` function (currently `const runInstall = async (target: InstallTarget) => { ... }`, ~lines 466–530, ending with the `finally { setInstallBusy(null); }` block) with:

```ts
const runInstall = async (target: InstallTarget) => {
  setSetupError(null);
  setNodeHint(null);
  setInstallResults((prev) => {
    const next = { ...prev };
    delete next[target];
    return next;
  });
  try {
    const res = await fetch("/api/onboarding/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      started?: boolean;
      status?: string;
      npmMissing?: boolean;
      hint?: string;
      error?: string;
    };
    if (json.npmMissing) {
      setNodeHint(
        json.hint ??
          "Install Node.js LTS from https://nodejs.org, then try again.",
      );
      setInstallResults((prev) => ({
        ...prev,
        [target]: {
          ok: false,
          detail: "npm not found — Node.js setup needed first.",
        },
      }));
      return;
    }
    if (!res.ok) {
      // 409 (another npm install running) and hard start failures land here.
      setInstallResults((prev) => ({
        ...prev,
        [target]: {
          ok: false,
          detail: json.error ?? "install failed to start",
        },
      }));
      return;
    }
    // 202 started (or idempotent 200 for an already-running job): hand off
    // to the polling effect.
    setInstallJobs((prev) => ({
      ...prev,
      [target]: { status: "running", elapsedMs: 0, tail: "" },
    }));
  } catch (err) {
    setInstallResults((prev) => ({
      ...prev,
      [target]: {
        ok: false,
        detail: err instanceof Error ? err.message : "install failed",
      },
    }));
  }
};
```

- [ ] **Step 6: Add the polling + re-attach effects**

Insert immediately after the `runInstall` function. The component already
imports `useEffect` and defines `refresh` and `loadHarnesses` (the functions
`runInstall` previously awaited inline):

```ts
// Poll running install jobs every 2s. The interval is recreated whenever a
// poll updates state — net effect is still one poll per running job per ~2s.
useEffect(() => {
  const running = (
    Object.entries(installJobs) as [InstallTarget, InstallJobView][]
  )
    .filter(([, job]) => job.status === "running")
    .map(([target]) => target);
  if (running.length === 0) return;
  let cancelled = false;
  const tick = async () => {
    for (const target of running) {
      try {
        const res = await fetch(
          `/api/onboarding/install?target=${encodeURIComponent(target)}`,
        );
        if (!res.ok || cancelled) continue;
        const json = (await res.json()) as
          | { status: "idle" }
          | InstallJobView;
        if (cancelled) return;
        if (json.status === "idle") {
          // Server restarted mid-install: the job is gone; let the harness
          // refresh tell the truth about whether the binary landed.
          setInstallJobs((prev) => {
            const next = { ...prev };
            delete next[target];
            return next;
          });
          void refresh();
          continue;
        }
        setInstallJobs((prev) => ({ ...prev, [target]: json }));
        if (json.status === "done") {
          setInstallResults((prev) => ({
            ...prev,
            [target]: json.ok
              ? {
                  ok: true,
                  detail: json.binaryPath
                    ? `installed at ${json.binaryPath}`
                    : "installed",
                }
              : { ok: false, detail: json.error ?? "install failed" },
          }));
          await refresh();
          await loadHarnesses();
        }
      } catch {
        // Transient poll failure — next tick retries.
      }
    }
  };
  void tick();
  const id = setInterval(() => void tick(), 2000);
  return () => {
    cancelled = true;
    clearInterval(id);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [installJobs]);

// Re-attach to server-side jobs after a page refresh: one probe per target
// on mount; only still-running jobs are adopted.
useEffect(() => {
  void (async () => {
    const entries = await Promise.all(
      ALL_INSTALL_TARGETS.map(async (target) => {
        try {
          const res = await fetch(
            `/api/onboarding/install?target=${encodeURIComponent(target)}`,
          );
          if (!res.ok) return null;
          const json = (await res.json()) as { status: string };
          return json.status === "running"
            ? ([target, json as InstallJobView] as const)
            : null;
        } catch {
          return null;
        }
      }),
    );
    const running = Object.fromEntries(
      entries.filter((entry): entry is NonNullable<typeof entry> => !!entry),
    );
    if (Object.keys(running).length > 0) {
      setInstallJobs((prev) => ({ ...running, ...prev }));
    }
  })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

- [ ] **Step 7: Thread `installJobs` to the step components**

The two call sites that passed `installBusy` (near lines 979 and 1009 —
`StepCovenCli` and `StepRuntime`) now pass the map instead:

```tsx
installJobs={installJobs}
```

Update both components' prop types and destructuring:
`installBusy: InstallTarget | null` becomes
`installJobs: Partial<Record<InstallTarget, InstallJobView>>` (in
`StepCovenCli` ~line 1294 and `StepRuntime` ~line 1350, and the matching
destructure lists). Task 4 rewrites their button JSX; for this commit just
make the rename compile — inside each component derive:

```ts
const npmJobRunning = NPM_INSTALL_TARGETS.some(
  (target) => installJobs[target]?.status === "running",
);
```

and replace the two old expressions:

- `disabled={installBusy !== null}` → `disabled={npmJobRunning}` (StepCovenCli, coven-cli is npm-kind)
- `installBusy === oneClick.target ? "Installing…" : ...` → `installJobs[oneClick.target]?.status === "running" ? "Installing…" : ...`
- In `StepRuntime`'s button: `disabled={installBusy !== null}` →

```tsx
disabled={
  installJobs[oneClick.target]?.status === "running" ||
  (NPM_INSTALL_TARGETS.includes(oneClick.target) && npmJobRunning)
}
```

- `installBusy === "coven-cli" ? "Installing…" : ...` (StepCovenCli) → `installJobs["coven-cli"]?.status === "running" ? "Installing…" : ...`

- [ ] **Step 8: Run tests + typecheck**

```bash
node --experimental-strip-types src/components/onboarding-guided-steps.test.ts
node --experimental-strip-types src/app/api/onboarding/install/route.test.ts
pnpm exec tsc --noEmit
```

Expected: both tests print `ok`; tsc exits 0 with no `onboarding-overlay` errors.

- [ ] **Step 9: Commit (signed)**

```bash
git add src/components/onboarding-overlay.tsx src/components/onboarding-guided-steps.test.ts
git commit -S -m "$(cat <<'EOF'
feat(onboarding): per-target install state, polling, refresh re-attach

installBusy was one global flag: any running install disabled every
install button for up to 10 minutes, and a page refresh forgot the run
entirely. The overlay now keeps a per-target job map fed by a 2s polling
effect against the new GET status endpoint, adopts still-running jobs on
mount, and only locks the busy target (npm-kind targets share a lock,
mirroring the server's 409). Completion auto-refreshes the harness report
so cards flip to installed without a manual Refresh.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature | head -5
```

Expected: `Good "ssh" signature` (or configured format).

---

### Task 4: Button + progress UI (spinner, elapsed, live tail)

**Files:**
- Modify: `src/components/onboarding-overlay.tsx`
- Test: `src/components/onboarding-guided-steps.test.ts`

- [ ] **Step 1: Append failing assertions**

Append before the final `console.log`:

```ts
assert.match(
  source,
  /Installing… \$\{formatElapsed\(/,
  "busy install buttons show elapsed time, not a frozen label",
);

assert.match(
  source,
  /ph:circle-notch-bold/,
  "busy install buttons show a spinner",
);

assert.match(
  source,
  /InstallLiveTail/,
  "live installer output renders while a job runs",
);
```

- [ ] **Step 2: Run to verify failure**

```bash
node --experimental-strip-types src/components/onboarding-guided-steps.test.ts
```

Expected: FAIL — `busy install buttons show elapsed time...`

- [ ] **Step 3: Add the helpers**

Insert above `function CommandRow(` (~line 1216):

```tsx
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/** Last N non-empty lines of installer output (\r-heavy progress bars are
 *  normalized to line breaks first). */
function lastLines(text: string, count: number): string {
  return text
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-count)
    .join("\n");
}

function InstallLiveTail({ tail }: { tail: string }) {
  const visible = lastLines(tail, 3);
  if (!visible) return null;
  return (
    <pre className="overflow-hidden whitespace-pre-wrap break-all rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 font-mono text-[11px] leading-4 text-[var(--text-muted)]">
      {visible}
    </pre>
  );
}
```

- [ ] **Step 4: Rework the `StepRuntime` card button block**

In `StepRuntime`'s card body (the `{oneClick ? (<>...</>) : (...)}` block,
~line 1404), derive per-card state just above the button (inside the
`chatHarnesses.map` callback, after `const result = ...`):

```ts
const job = oneClick ? installJobs[oneClick.target] : undefined;
const busy = job?.status === "running";
```

Replace the button JSX with:

```tsx
<button
  onClick={() => onInstall(oneClick.target)}
  disabled={
    busy ||
    (NPM_INSTALL_TARGETS.includes(oneClick.target) && npmJobRunning)
  }
  className="focus-ring inline-flex w-fit items-center gap-2 rounded-md bg-[var(--accent-presence)] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[color-mix(in_oklch,var(--accent-presence)_85%,#000)] disabled:opacity-50"
>
  {busy ? (
    <span className="inline-flex animate-spin">
      <Icon name="ph:circle-notch-bold" />
    </span>
  ) : (
    <Icon name="ph:arrow-down-bold" />
  )}
  {busy
    ? `Installing… ${formatElapsed(job.elapsedMs)}`
    : `Install ${adapter.label}`}
</button>
```

(`ph:circle-notch-bold` is already in the `ICON_NAMES` whitelist in
`src/lib/icon.tsx:177` — no whitelist change. The spin wrapper is a `span`
because `Icon` does not take a `className`.)

Directly under the existing `<CommandRow .../>` in the same block, add:

```tsx
{busy && job ? <InstallLiveTail tail={job.tail} /> : null}
```

- [ ] **Step 5: Same treatment for `StepCovenCli`'s button**

In `StepCovenCli`, derive above its button:

```ts
const job = installJobs["coven-cli"];
const busy = job?.status === "running";
```

Replace its button's icon/label/disabled the same way (`disabled={busy || npmJobRunning}`, spinner + `Installing… ${formatElapsed(job.elapsedMs)}` when busy, label `Install coven CLI` otherwise — keep its existing classNames), and add `{busy && job ? <InstallLiveTail tail={job.tail} /> : null}` after its `CommandRow`.

- [ ] **Step 6: Run tests + typecheck**

```bash
node --experimental-strip-types src/components/onboarding-guided-steps.test.ts
pnpm exec tsc --noEmit
```

Expected: `onboarding-guided-steps.test.ts: ok`; tsc clean.

- [ ] **Step 7: Commit (signed)**

```bash
git add src/components/onboarding-overlay.tsx src/components/onboarding-guided-steps.test.ts
git commit -S -m "$(cat <<'EOF'
polish(onboarding): live progress on install buttons

Busy install buttons now show a spinner and server-derived elapsed time
("Installing… 2m 14s") instead of a frozen label, and a 3-line live tail
of installer output renders under the manual command row — the Hermes
installer runs for minutes and previously looked hung.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature | head -5
```

---

### Task 5: Hermes next-step row + failure output expandable

**Files:**
- Modify: `src/components/onboarding-overlay.tsx`
- Test: `src/components/onboarding-guided-steps.test.ts`

- [ ] **Step 1: Append failing assertions**

Append before the final `console.log`:

```ts
assert.match(
  source,
  /CommandRow command="hermes setup"/,
  "a successful Hermes install surfaces `hermes setup` as a copyable next step",
);

assert.match(
  source,
  /Show full output/,
  "failed installs expose the full installer output tail",
);
```

- [ ] **Step 2: Run to verify failure**

```bash
node --experimental-strip-types src/components/onboarding-guided-steps.test.ts
```

Expected: FAIL — `a successful Hermes install surfaces ...`

- [ ] **Step 3: Add the `HermesSetupNext` component**

Insert above `function CommandRow(`:

```tsx
function HermesSetupNext({ onCopy }: { onCopy: (text: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] font-medium text-[var(--text-secondary)]">
        Next step — finish setup in a terminal:
      </p>
      <CommandRow command="hermes setup" onCopy={onCopy} />
    </div>
  );
}
```

- [ ] **Step 4: Render it for Hermes**

Two render sites in `StepRuntime`'s card (a one-click success refreshes the
harness report, which flips the card to its `adapter.installed` branch — the
next step must survive that flip):

In the `!adapter.installed` block, after `<InstallResultNote result={result} />`:

```tsx
{adapter.id === "hermes" && result?.ok ? (
  <HermesSetupNext onCopy={onCopy} />
) : null}
```

In the installed branch (after the `mt-1 truncate font-mono` path div, ~line 1397), add:

```tsx
{adapter.id === "hermes" && installResults["hermes"]?.ok ? (
  <div className="mt-2">
    <HermesSetupNext onCopy={onCopy} />
  </div>
) : null}
```

(Keyed off `installResults` so it only shows after a one-click install this
session — a Hermes that was already installed when onboarding opened needs no
nudge.)

- [ ] **Step 5: Failure expandable**

Still in the `!adapter.installed` block, after the `HermesSetupNext`
conditional from Step 4:

```tsx
{result && !result.ok && job?.status === "done" && job.tail ? (
  <details>
    <summary className="cursor-pointer text-[11px] text-[var(--text-muted)]">
      Show full output
    </summary>
    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 font-mono text-[11px] leading-4 text-[var(--text-muted)]">
      {job.tail}
    </pre>
  </details>
) : null}
```

- [ ] **Step 6: Run all tests + typecheck**

```bash
node --experimental-strip-types src/components/onboarding-guided-steps.test.ts
node --experimental-strip-types src/app/api/onboarding/install/route.test.ts
pnpm exec tsc --noEmit
```

Expected: both `ok`; tsc clean.

- [ ] **Step 7: Commit (signed)**

```bash
git add src/components/onboarding-overlay.tsx src/components/onboarding-guided-steps.test.ts
git commit -S -m "$(cat <<'EOF'
polish(onboarding): hermes setup next-step + failure output details

After a successful one-click Hermes install the card now surfaces
`hermes setup` as a copyable command row (it survives the card's flip to
the installed state), and failed installs expose the captured output
tail behind a "Show full output" expandable instead of only a one-line
error.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature | head -5
```

---

### Task 6: Full suite, live verify, PR

**Files:** none (verification)

- [ ] **Step 1: Run the repo's app test suite**

```bash
pnpm test:app
```

Expected: passes (CI enforces this same script).

- [ ] **Step 2: Live verification with a mocked installer — NEVER a real install**

Real install targets mutate the machine and take minutes. Verify the UI
against a stub: run the dev server in this worktree and use a Playwright
script with `page.route` interception (pattern in
`~/.claude/.../memory/reference_dev_app_browser_verify.md` and the
project's existing throwaway-worktree recipe; the Playwright config
self-starts on :3100):

- Intercept `POST /api/onboarding/install` → `202 {"started":true,"target":"hermes"}`.
- Intercept `GET /api/onboarding/install?target=hermes` → first N responses
  `{"status":"running","elapsedMs":134000,"tail":"resolving uv...\ninstalling python 3.12..."}`,
  then `{"status":"done","ok":true,"elapsedMs":201000,"binaryPath":"/Users/x/.local/bin/hermes","tail":"done"}`.
- Eyeball: spinner + "Installing… 2m 14s" label, live tail under the command
  row, other install buttons still enabled (Hermes is script-kind), then the
  `hermes setup` next-step row after the done response.
- Failure pass: `{"status":"done","ok":false,"error":"installer exited with code 1","tail":"boom"}` →
  result note + "Show full output" expandable.

- [ ] **Step 3: Audit signatures, push, open PR**

```bash
git log origin/main..HEAD --pretty='%H %G?' | awk '$2 != "G" {print "UNSIGNED:", $0}'
```

Expected: no output. Then:

```bash
git push -u origin feat/onboarding-install-jobs
gh pr create --title "feat(onboarding): live install progress + background install jobs" --body "$(cat <<'EOF'
## Summary
- install route: per-target background jobs (globalThis registry), POST returns 202 immediately, new GET status endpoint with elapsed time + ANSI-stripped output tail; npm-kind installs mutually exclusive (409), script-kind (Hermes) runs alongside
- onboarding overlay: per-target busy state (no more global lock), 2s polling, refresh re-attach, spinner + elapsed label, 3-line live output tail, auto harness refresh on completion
- Hermes: `hermes setup` copyable next-step row on success; failures get a "Show full output" expandable

Spec: docs/superpowers/specs/2026-06-12-hermes-install-button-design.md (local, gitignored)

## Test plan
- [ ] `node --experimental-strip-types src/app/api/onboarding/install/route.test.ts`
- [ ] `node --experimental-strip-types src/components/onboarding-guided-steps.test.ts`
- [ ] `pnpm test:app`
- [ ] Live verify with mocked install route (no real installs)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review (completed)

- **Spec coverage:** registry/POST/GET/409/idempotency → Task 2; per-target
  state, polling, re-attach, auto-refresh → Task 3; spinner/elapsed/tail
  visuals → Task 4; hermes next-step + failure expandable → Task 5; testing +
  mock-only live verify → Tasks 2–6. Out-of-scope items from the spec have no
  tasks (correct).
- **Placeholder scan:** no TBDs; every code step carries the code.
- **Type consistency:** `InstallJobView` (client) matches `jobView()` (server)
  field-for-field; `NPM_INSTALL_TARGETS`/`npmJobRunning` names consistent
  across Tasks 3–4; `installJobs` prop name consistent in both step components.
