import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import QRCode from "qrcode";
import { stripAnsi } from "@/lib/ansi";
import {
  createMobileInvite,
  findServeUrl,
  MOBILE_INVITE_TTL_MS,
} from "@/lib/mobile-handoff";

export const dynamic = "force-dynamic";

type TailscaleResult = {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
};

function runTailscale(args: string[], timeoutMs = 8000): Promise<TailscaleResult> {
  return new Promise((resolve) => {
    const child = spawn("tailscale", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({
        ok: false,
        status: null,
        stdout: stripAnsi(stdout),
        stderr: `tailscale ${args.join(" ")} timed out`,
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        status: null,
        stdout: stripAnsi(stdout),
        stderr: error.message,
      });
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({
        ok: status === 0,
        status,
        stdout: stripAnsi(stdout),
        stderr: stripAnsi(stderr),
      });
    });
  });
}

function backendUrl(req: Request) {
  const url = new URL(req.url);
  const port = url.port || process.env.PORT || "3000";
  return `http://127.0.0.1:${port}`;
}

async function mobileHandoff(req: Request) {
  const accessSecret = process.env.COVEN_CAVE_ACCESS_TOKEN?.trim();
  if (!accessSecret) {
    return NextResponse.json(
      { ok: false, error: "mobile access token unavailable" },
      { status: 503 },
    );
  }

  const self = await runTailscale(["status", "--self"]);
  if (!self.ok) {
    return NextResponse.json(
      { ok: false, error: "tailscale is not connected", stderr: self.stderr },
      { status: 503 },
    );
  }

  const backend = backendUrl(req);
  const serve = await runTailscale(["serve", "--bg", backend]);
  if (!serve.ok) {
    return NextResponse.json(
      { ok: false, error: "failed to start tailscale serve", stderr: serve.stderr },
      { status: 500 },
    );
  }

  const status = await runTailscale(["serve", "status", "--json"]);
  if (!status.ok) {
    return NextResponse.json(
      { ok: false, error: "failed to read tailscale serve status", stderr: status.stderr },
      { status: 500 },
    );
  }

  let parsedStatus: unknown;
  try {
    parsedStatus = JSON.parse(status.stdout);
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid tailscale serve status output" },
      { status: 500 },
    );
  }

  const serveUrl = findServeUrl(parsedStatus, backend);
  if (!serveUrl) {
    return NextResponse.json(
      { ok: false, error: "tailscale serve URL not found", backendUrl: backend },
      { status: 500 },
    );
  }

  const invite = await createMobileInvite({
    baseUrl: serveUrl,
    accessSecret,
    sidecarToken: process.env.COVEN_CAVE_AUTH_TOKEN,
    ttlMs: MOBILE_INVITE_TTL_MS,
  });
  const qrSvg = await QRCode.toString(invite.url, {
    type: "svg",
    margin: 1,
    width: 256,
    errorCorrectionLevel: "M",
  });

  return NextResponse.json({
    ok: true,
    backendUrl: backend,
    serveUrl,
    url: invite.url,
    expiresAt: invite.expiresAt,
    expiresAtIso: invite.expiresAtIso,
    qrSvg,
  });
}

export async function GET(req: Request) {
  return mobileHandoff(req);
}

export async function POST(req: Request) {
  let action = "start";
  try {
    const body = (await req.json()) as { action?: string };
    action = body.action ?? "start";
  } catch {
    action = "start";
  }

  if (action === "reset") {
    const reset = await runTailscale(["serve", "reset"]);
    return NextResponse.json({
      ok: reset.ok,
      error: reset.ok ? undefined : "failed to reset tailscale serve",
      stderr: reset.stderr,
    }, { status: reset.ok ? 200 : 500 });
  }

  return mobileHandoff(req);
}
