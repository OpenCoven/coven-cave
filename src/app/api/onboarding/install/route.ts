import { NextResponse } from "next/server";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { stripAnsi } from "@/lib/ansi";
import { covenSpawnEnv } from "@/lib/coven-bin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

/**
 * One-click dependency installs for onboarding.
 *
 * Hard allowlist: the request names a TARGET, never a command. Every target
 * maps to a fixed install mechanism so nothing user-controlled ever reaches
 * a shell:
 *
 *   - kind "npm":    `npm install -g <pinned package>`
 *   - kind "script": the harness's official installer at a pinned HTTPS URL,
 *                    run byte-for-byte as its docs instruct users to run it
 *                    (bash on POSIX, PowerShell on Windows).
 */
const INSTALL_TARGETS = {
  "coven-cli": {
    kind: "npm",
    label: "coven CLI",
    packageName: "@opencoven/cli@latest",
    binary: "coven",
    timeoutMs: 240_000,
  },
  codex: {
    kind: "npm",
    label: "Codex",
    packageName: "@openai/codex",
    binary: "codex",
    timeoutMs: 240_000,
  },
  claude: {
    kind: "npm",
    label: "Claude Code",
    packageName: "@anthropic-ai/claude-code",
    binary: "claude",
    timeoutMs: 240_000,
  },
  openclaw: {
    kind: "npm",
    label: "OpenClaw",
    packageName: "openclaw@latest",
    binary: "openclaw",
    timeoutMs: 240_000,
  },
  hermes: {
    kind: "script",
    label: "Hermes",
    // Official installer (github.com/NousResearch/hermes-agent#quick-install).
    // It provisions its own dependencies (uv, Python, …), so no npm precheck.
    posix: "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
    windows: "iex (irm https://hermes-agent.nousresearch.com/install.ps1)",
    binary: "hermes",
    // Heavier than an npm install — it bootstraps a Python toolchain.
    timeoutMs: 600_000,
  },
} as const;

type InstallTarget = keyof typeof INSTALL_TARGETS;

function nodeInstallHint(): string {
  if (process.platform === "darwin") {
    return "Install Node.js LTS from https://nodejs.org or with `brew install node`, then click Install again.";
  }
  if (process.platform === "win32") {
    return "Install Node.js LTS from https://nodejs.org (or `winget install OpenJS.NodeJS.LTS`), restart Cave so the new PATH applies, then click Install again.";
  }
  return "Install Node.js LTS from https://nodejs.org or your package manager (e.g. `sudo apt install nodejs npm`), then click Install again.";
}

async function commandPath(binary: string): Promise<string | null> {
  const finder = process.platform === "win32" ? "where" : "which";
  try {
    const { stdout } = await execFileAsync(finder, [binary], {
      env: covenSpawnEnv(),
      timeout: 1500,
    });
    return stdout.trim().split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

function isInstallTarget(value: unknown): value is InstallTarget {
  return typeof value === "string" && value in INSTALL_TARGETS;
}

type SpawnPlan = {
  command: string;
  args: string[];
  shell: boolean;
};

/** Resolve the fixed spawn plan for a target. Returns null when a
 *  prerequisite is missing (npm targets need npm on PATH). */
async function spawnPlanFor(
  target: (typeof INSTALL_TARGETS)[InstallTarget],
): Promise<SpawnPlan | { npmMissing: true } | null> {
  if (target.kind === "npm") {
    const npm = await commandPath("npm");
    if (!npm) return { npmMissing: true };
    return {
      command: npm,
      args: ["install", "-g", target.packageName],
      // Windows resolves npm to npm.cmd, which Node refuses to spawn without
      // a shell. The argv is fully fixed (allowlisted package, no user
      // input), so shell interpolation has nothing to grab.
      shell: process.platform === "win32",
    };
  }
  // kind === "script" — run the harness's official installer exactly as its
  // docs instruct. The command string is a pinned constant from the
  // allowlist above; the request never contributes to it.
  if (process.platform === "win32") {
    return {
      command: "powershell",
      args: ["-NoProfile", "-Command", target.windows],
      shell: false,
    };
  }
  return {
    command: "bash",
    args: ["-lc", target.posix],
    shell: false,
  };
}

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
  const tail = job.output.slice(-2000);
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

  // Re-check after the await above: two near-simultaneous POSTs for the same
  // target could otherwise both pass the running-check and double-spawn.
  const recheck = jobs.get(targetName);
  if (recheck?.status === "running") {
    return NextResponse.json(jobView(recheck));
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
  child.stdout.on("data", (d) => appendOutput(job, stripAnsi(d.toString())));
  child.stderr.on("data", (d) => appendOutput(job, stripAnsi(d.toString())));
  let killTimer: NodeJS.Timeout | undefined;
  const timer = setTimeout(() => {
    // curl|bash bootstraps can ignore SIGTERM; escalate so the job can't stay running forever
    job.error = `install timed out after ${target.timeoutMs / 1000}s`;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  }, target.timeoutMs);
  child.on("error", (e) => {
    clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
    job.status = "done";
    job.finishedAt = Date.now();
    job.ok = false;
    job.error = e.message;
  });
  child.on("close", (code, signal) => {
    clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
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
            : `installer exited with ${code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`}`;
      }
    })();
  });

  return NextResponse.json(
    { started: true, target: targetName },
    { status: 202 },
  );
}
