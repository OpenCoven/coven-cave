import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import QRCode from "qrcode";
import { stripAnsi } from "@/lib/ansi";
import {
  createMobileInvite,
  MOBILE_INVITE_TTL_MS,
  tailnetDiscoveryProof,
  tailscaleBin,
  tailscaleSpawnEnv,
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
    const bin = tailscaleBin();
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: tailscaleSpawnEnv(),
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
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      resolve({
        ok: false,
        status: null,
        stdout: stripAnsi(stdout),
        stderr: missing
          ? "Tailscale CLI not found. Install Tailscale or set TAILSCALE_BIN to the tailscale executable."
          : error.message,
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

// `tailscale serve status --json` is normally a clean JSON document, but some
// builds prepend health/warning lines (or emit nothing when there is no serve
// config). Parse tolerantly: empty output means "no serve config" ({}), and we
// fall back to extracting the outermost JSON object before giving up.
function parseServeStatus(raw: string): { value: unknown } | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: {} };
  try {
    return { value: JSON.parse(trimmed) };
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return { value: JSON.parse(trimmed.slice(start, end + 1)) };
      } catch {
        // fall through
      }
    }
    return { error: trimmed.slice(0, 500) };
  }
}

function backendUrl(req: Request) {
  const url = new URL(req.url);
  const port = url.port || process.env.PORT || "3000";
  return `http://127.0.0.1:${port}`;
}

async function ensureNativeAppServe(req: Request) {
  const self = await runTailscale(["status", "--self", "--json"]);
  if (!self.ok) {
    return NextResponse.json(
      { ok: false, error: "tailscale is not connected", stderr: self.stderr },
      { status: 503 },
    );
  }

  const parsedSelf = parseServeStatus(self.stdout);
  const selfStatus: unknown = "error" in parsedSelf ? null : parsedSelf.value;
  const backend = backendUrl(req);
  const serve = await runTailscale(["serve", "--bg", backend]);
  const serveWarning = serve.ok
    ? null
    : serve.stderr || "Tailscale Serve could not be (re)started.";

  let serveStatus: unknown = {};
  const status = await runTailscale(["serve", "status", "--json"]);
  if (status.ok) {
    const parsed = parseServeStatus(status.stdout);
    if (!("error" in parsed)) serveStatus = parsed.value;
  }
  const discovery = tailnetDiscoveryProof({ selfStatus, serveStatus, backendUrl: backend });

  if (!discovery.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: serveWarning ?? discovery.reason,
        stderr: serveWarning ?? status.stderr,
        backendUrl: backend,
      },
      { status: 500 },
    );
  }

  const qrSvg = await QRCode.toString(discovery.serveUrl, {
    type: "svg",
    margin: 1,
    width: 256,
    errorCorrectionLevel: "M",
  });

  return NextResponse.json({
    ok: true,
    backendUrl: backend,
    serveUrl: discovery.serveUrl,
    nativeUrl: discovery.serveUrl,
    nativeHost: discovery.host,
    discoverySource: discovery.source,
    qrSvg,
    warning: serveWarning ?? undefined,
  });
}

async function mobileHandoff(req: Request) {
  const accessSecret = process.env.COVEN_CAVE_ACCESS_TOKEN?.trim();
  if (!accessSecret) {
    // Plain `next dev` never sets COVEN_CAVE_ACCESS_TOKEN, so the handoff
    // can't mint a signed invite. Give devs the exact next step instead of
    // an opaque string; keep the terse message in packaged builds, where a
    // missing token is a real misconfiguration rather than the dev default.
    const error =
      process.env.NODE_ENV !== "production"
        ? "Mobile handoff isn't available in plain `pnpm dev` — it needs the signed access token that the packaged app and `pnpm mobile:tailscale` set up. Run `pnpm mobile:tailscale` (or open the packaged app), then use Open on phone from that session."
        : "mobile access token unavailable";
    return NextResponse.json({ ok: false, error }, { status: 503 });
  }

  // `--json` doubles as the connectivity check (exit 0 == connected) and the
  // source for the MagicDNS fallback host below.
  const self = await runTailscale(["status", "--self", "--json"]);
  if (!self.ok) {
    return NextResponse.json(
      { ok: false, error: "tailscale is not connected", stderr: self.stderr },
      { status: 503 },
    );
  }
  // Best-effort: an unparseable self status just disables the MagicDNS
  // fallback; an existing serve config can still yield a URL. Reuse the
  // tolerant parser so prepended health/warning lines don't break it.
  const parsedSelf = parseServeStatus(self.stdout);
  const selfStatus: unknown = "error" in parsedSelf ? null : parsedSelf.value;

  const backend = backendUrl(req);

  // Best-effort (re)start of Tailscale Serve. Don't hard-fail when this errors
  // — on macOS the CLI can return "GUI failed to start (CLIError 3)" even
  // though the serve config (and tunnel) is already live in the daemon. Capture
  // the error as a non-fatal warning and try to produce a working link anyway.
  const serve = await runTailscale(["serve", "--bg", backend]);
  const serveWarning = serve.ok
    ? null
    : serve.stderr || "Tailscale Serve could not be (re)started.";

  // Prefer the real serve config when it's readable.
  let serveStatus: unknown = {};
  const status = await runTailscale(["serve", "status", "--json"]);
  if (status.ok) {
    const parsed = parseServeStatus(status.stdout);
    if (!("error" in parsed)) serveStatus = parsed.value;
  }

  const discovery = tailnetDiscoveryProof({ selfStatus, serveStatus, backendUrl: backend });

  if (!discovery.ok) {
    // Nothing usable — surface the most actionable error we have.
    return NextResponse.json(
      {
        ok: false,
        error: serveWarning ?? discovery.reason,
        stderr: serveWarning ?? status.stderr,
        backendUrl: backend,
      },
      { status: 500 },
    );
  }

  const invite = await createMobileInvite({
    baseUrl: discovery.serveUrl,
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
    serveUrl: discovery.serveUrl,
    inviteUrl: invite.url,
    url: invite.url,
    appUrl: invite.url,
    // Native-app pairing: covencave:// deep link with a long-lived token —
    // shown beside the QR so the iOS/iPadOS app pairs without typing.
    appInviteUrl: invite.appInviteUrl,
    appTokenExpiresAt: invite.appTokenExpiresAt,
    discoverySource: discovery.source,
    expiresAt: invite.expiresAt,
    expiresAtIso: invite.expiresAtIso,
    qrSvg,
    // Non-fatal: the link/QR are usable, but Serve couldn't be (re)started, so
    // the tunnel may need attention if the link doesn't resolve on the phone.
    warning: serveWarning ?? undefined,
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

  if (action === "app-start") {
    return ensureNativeAppServe(req);
  }

  if (action === "app-stop") {
    const reset = await runTailscale(["serve", "reset"]);
    return NextResponse.json({
      ok: reset.ok,
      error: reset.ok ? undefined : "failed to stop mobile mode",
      stderr: reset.stderr,
    }, { status: reset.ok ? 200 : 500 });
  }

  return mobileHandoff(req);
}
