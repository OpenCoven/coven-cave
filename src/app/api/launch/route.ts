import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { resolveAllowedProjectPath } from "@/lib/server/project-paths";
import {
  BoundedProcessOutput,
  safeProcessErrorMessage,
  terminateProcessTree,
} from "@/lib/process-execution";

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
      windowsHide: true,
      detached: true,
    });
    const stderr = new BoundedProcessOutput(16 * 1024);
    let settled = false;
    let timedOut = false;
    const finish = (response: Response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(response);
    };
    child.stderr.on("data", (data) => stderr.append(data));
    const timer = setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(child).then(() => finish(
        NextResponse.json(
          { ok: false, error: "launch timed out", stderr: stderr.text() },
          { status: 504 },
        ),
      ));
    }, 4000);
    child.on("error", (err) => {
      finish(
        NextResponse.json(
          { ok: false, error: safeProcessErrorMessage(err, "Terminal launcher") },
          { status: 500 },
        ),
      );
    });
    child.on("close", (code) => {
      if (timedOut) {
        finish(
          NextResponse.json(
            { ok: false, error: "launch timed out", stderr: stderr.text() },
            { status: 504 },
          ),
        );
        return;
      }
      if (code === 0) {
        finish(NextResponse.json({ ok: true, command }));
      } else {
        finish(
          NextResponse.json(
            { ok: false, error: `osascript exited ${code}`, stderr: stderr.text() },
            { status: 500 },
          ),
        );
      }
    });
  });
}
