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
 * maps to a fixed `npm install -g <package>` so nothing user-controlled ever
 * reaches a shell. Targets cover the dependencies onboarding can self-serve;
 * harnesses without an npm one-liner (Hermes, OpenClaw) keep their manual
 * instructions in the overlay instead of appearing here.
 */
const INSTALL_TARGETS = {
  "coven-cli": {
    label: "coven CLI",
    packageName: "@opencoven/cli@latest",
    binary: "coven",
  },
  codex: {
    label: "Codex",
    packageName: "@openai/codex",
    binary: "codex",
  },
  claude: {
    label: "Claude Code",
    packageName: "@anthropic-ai/claude-code",
    binary: "claude",
  },
} as const;

type InstallTarget = keyof typeof INSTALL_TARGETS;

/** Global npm installs can compile native deps; give them real time. */
const INSTALL_TIMEOUT_MS = 240_000;

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
  const target = INSTALL_TARGETS[body.target];

  const npm = await commandPath("npm");
  if (!npm) {
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

  const args = ["install", "-g", target.packageName];

  return new Promise<Response>((resolve) => {
    // Windows resolves npm to npm.cmd, which Node refuses to spawn without a
    // shell. The argv is fully fixed (allowlisted package, no user input), so
    // shell interpolation has nothing to grab.
    const child = spawn(npm, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: covenSpawnEnv(),
      shell: process.platform === "win32",
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(
        NextResponse.json(
          {
            ok: false,
            error: `npm install timed out after ${INSTALL_TIMEOUT_MS / 1000}s`,
            stdout: stripAnsi(out),
            stderr: stripAnsi(err),
          },
          { status: 504 },
        ),
      );
    }, INSTALL_TIMEOUT_MS);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve(
        NextResponse.json({ ok: false, error: e.message }, { status: 500 }),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      void (async () => {
        const installedPath = await commandPath(target.binary);
        const ok = code === 0 && !!installedPath;
        resolve(
          NextResponse.json(
            {
              ok,
              target: body.target,
              label: target.label,
              code,
              binaryPath: installedPath,
              stdout: stripAnsi(out).slice(-4000),
              stderr: stripAnsi(err).slice(-4000),
              ...(ok
                ? {}
                : {
                    error:
                      code === 0
                        ? `${target.binary} still is not on PATH after install — open a new terminal or restart Cave, then re-check.`
                        : `npm install exited with code ${code}`,
                  }),
            },
            { status: ok ? 200 : 502 },
          ),
        );
      })();
    });
  });
}
