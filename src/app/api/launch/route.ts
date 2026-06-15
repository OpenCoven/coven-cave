import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { resolveAllowedProjectPath } from "@/lib/server/project-paths";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LaunchBody = {
  mode: "attach" | "chat";
  sessionId?: string;
  cwd?: string;
};

function escapeForAppleScript(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Returns true for absolute paths on both Unix (/foo) and Windows (C:\, C:/, \\server). */
function isAbsolutePath(p: string): boolean {
  if (process.platform === "win32") {
    return /^[a-zA-Z]:[/\\]/.test(p) || p.startsWith("\\\\");
  }
  return p.startsWith("/");
}

function shellQuote(input: string): string {
  return "'" + input.replace(/'/g, "'\\''") + "'";
}

function buildCovenCommand(body: LaunchBody): string | null {
  if (body.mode === "attach") {
    if (!body.sessionId || !UUID_RE.test(body.sessionId)) return null;
    return `coven attach ${body.sessionId}`;
  }
  if (body.mode === "chat") {
    if (!body.cwd) return "coven chat";
    if (!isAbsolutePath(body.cwd)) return null;
    const cwd = resolveAllowedProjectPath(body.cwd);
    return cwd ? `cd ${shellQuote(cwd)} && coven chat` : null;
  }
  return null;
}

export async function POST(req: Request) {
  if (process.platform !== "darwin") {
    return NextResponse.json(
      { ok: false, error: "external TUI launch only implemented on macOS" },
      { status: 501 },
    );
  }
  let body: LaunchBody;
  try {
    body = (await req.json()) as LaunchBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const command = buildCovenCommand(body);
  if (!command) {
    return NextResponse.json({ ok: false, error: "invalid launch parameters" }, { status: 400 });
  }
  const script = [
    'tell application "Terminal" to activate',
    `tell application "Terminal" to do script "${escapeForAppleScript(command)}"`,
  ].join("\n");

  return new Promise<Response>((resolve) => {
    const child = spawn("osascript", ["-e", script], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(
        NextResponse.json(
          { ok: false, error: "launch timed out", stderr },
          { status: 504 },
        ),
      );
    }, 4000);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve(
        NextResponse.json({ ok: false, error: err.message }, { status: 500 }),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(NextResponse.json({ ok: true, command }));
      } else {
        resolve(
          NextResponse.json(
            { ok: false, error: `osascript exited ${code}`, stderr },
            { status: 500 },
          ),
        );
      }
    });
  });
}
