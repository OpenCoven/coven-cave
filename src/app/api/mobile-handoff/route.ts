import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import QRCode from "qrcode";
import { stripAnsi } from "@/lib/ansi";
import { readMobileLastSeen } from "@/lib/server/mobile-paired";
import {
  armMobileAccessSecret,
  provisionMobileAccessSecret,
  retireMobileAccessSecret,
} from "@/lib/server/mobile-access-provision";
import { signMobileAccessToken } from "@/lib/mobile-access-token";
import { appTokenTtlMs } from "@/lib/mobile-token-refresh";
import { ACCESS_TOKEN_COOKIE } from "@/proxy-helpers";
import {
  buildPairingSteps,
  classifyTailscaleSelf,
  createMobileInvite,
  withChatFragment,
  MOBILE_INVITE_TTL_MS,
  nativeAppDiscoveryProof,
  tailnetDiscoveryProof,
  tailscaleBin,
  tailscaleSpawnEnv,
  type PairingStep,
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

function trustedBackendPort() {
  return (process.env.PORT || "3000").trim();
}

function rejectMismatchedHostPort(req: Request) {
  const url = new URL(req.url);
  const hostPort = url.port;
  const expectedPort = trustedBackendPort();
  if (hostPort && hostPort !== expectedPort) {
    return NextResponse.json(
      { ok: false, error: "request Host port does not match the Cave sidecar port" },
      { status: 400 },
    );
  }
  return null;
}

function backendUrl() {
  return `http://127.0.0.1:${trustedBackendPort()}`;
}

function normalizeLoopbackBackend(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:") return null;
    if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function nativeAppBackendUrl(req: Request) {
  const configured = normalizeLoopbackBackend(process.env.COVEN_CAVE_NATIVE_APP_BACKEND_URL);
  if (configured) return configured;

  // App mode is token-gated (`pnpm mobile:tailscale:app` mints the mobile
  // access token), so app-start publishes THIS server and mints signed invites
  // (see ensureNativeAppServe). The packaged bundle above all must not
  // hard-depend on a dev checkout's server (cave-gzje); pointing at a
  // different local server requires the explicit
  // COVEN_CAVE_NATIVE_APP_BACKEND_URL override above.
  return backendUrl();
}

function backendPort(backend: string) {
  try {
    return new URL(backend).port || trustedBackendPort();
  } catch {
    return trustedBackendPort();
  }
}

async function verifyNativeAppBackend(req: Request, backend: string) {
  if (backend === backendUrl()) return { ok: true as const };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(new URL("/api/familiars", backend), {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (res.ok) return { ok: true as const };
    const authHint =
      res.status === 401 || res.status === 403
        ? " The backend is not paired; start the native app server with `pnpm mobile:tailscale:app` and scan its pairing URL."
        : "";
    return {
      ok: false as const,
      error: `native app backend ${backend} returned HTTP ${res.status}.${authHint}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false as const,
      error: `native app backend ${backend} is not ready. Run \`pnpm mobile:tailscale:app\` first. (${message})`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function mobileAccessSecret() {
  return process.env.COVEN_CAVE_ACCESS_TOKEN?.trim() ?? "";
}

// The native route trusts the tailnet only when something explicitly says so:
// the dev script's tokenless server (COVEN_CAVE_TAILNET_TRUST=1) or an
// operator-configured backend override. Everywhere else — the packaged bundle
// first and foremost — pairing rides SIGNED invites minted from the access
// secret, so a packaged user needs no dev checkout to pair a phone (cave-gzje).
function nativeTokenlessMode() {
  if (process.env.COVEN_CAVE_TAILNET_TRUST === "1") return true;
  return Boolean(normalizeLoopbackBackend(process.env.COVEN_CAVE_NATIVE_APP_BACKEND_URL));
}

function mobileUnavailableResponse(
  error: string,
  details?: { stderr?: string; backendUrl?: string; steps?: PairingStep[] },
) {
  return NextResponse.json({ ok: false, unavailable: true, error, ...details });
}

function mobileAccessUnavailableResponse() {
  // With self-provisioning (cave-os73) this is reached only when minting or
  // persisting the pairing secret failed in dev, or when a packaged build is
  // missing its Tauri-supplied token — a real misconfiguration, kept terse.
  const error =
    process.env.NODE_ENV !== "production"
      ? "Couldn't set up phone pairing automatically (the pairing secret could not be provisioned). Retry, or run `pnpm mobile:tailscale` and pair from that session."
      : "mobile access token unavailable";
  return mobileUnavailableResponse(error, {
    steps: buildPairingSteps({ access: { ok: false, detail: error } }),
  });
}

/**
 * Resolve the pairing secret, provisioning one on the fly for a tokenless
 * dev server (cave-os73). Arms the in-process gate immediately so the
 * Tailscale Serve route this request is about to publish is token-gated from
 * the moment it exists. Returns the secret plus whether THIS request
 * provisioned it — the response then hands the requesting browser a signed
 * cookie so the freshly armed gate never locks out the session that turned
 * pairing on.
 */
function resolveMobileAccessSecret(): { secret: string; provisioned: boolean } | null {
  const existing = mobileAccessSecret();
  if (existing) return { secret: existing, provisioned: false };
  const provisioned = provisionMobileAccessSecret();
  if (!provisioned) return null;
  armMobileAccessSecret(provisioned);
  return { secret: provisioned, provisioned: true };
}

/** Install the freshly provisioned session credential on whatever response
 *  goes out — success or failure — so the dev browser that just armed the
 *  gate keeps working without a reload or manual token entry. */
async function withBrowserAccessCookie(
  res: NextResponse,
  req: Request,
  secret: string,
): Promise<NextResponse> {
  const expiresAt = Date.now() + appTokenTtlMs();
  const token = await signMobileAccessToken({ secret, expiresAt });
  let secure = false;
  try {
    secure = new URL(req.url).protocol === "https:";
  } catch {
    // Loopback dev is http; default stays false.
  }
  res.cookies.set(ACCESS_TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: Math.max(1, Math.floor(appTokenTtlMs() / 1000)),
  });
  return res;
}

async function ensureNativeAppServe(req: Request, chatId?: string | null) {
  const hostPortRejection = rejectMismatchedHostPort(req);
  if (hostPortRejection) return hostPortRejection;

  const access = resolveMobileAccessSecret();
  if (!access) {
    return mobileAccessUnavailableResponse();
  }

  const res = await ensureNativeAppServeReady(req, chatId, access.secret);
  return access.provisioned ? withBrowserAccessCookie(res, req, access.secret) : res;
}

async function ensureNativeAppServeReady(
  req: Request,
  chatId: string | null | undefined,
  accessSecret: string,
) {
  const backend = nativeAppBackendUrl(req);
  const backendReady = await verifyNativeAppBackend(req, backend);
  if (!backendReady.ok) {
    return mobileUnavailableResponse(backendReady.error, {
      backendUrl: backend,
      steps: buildPairingSteps({
        access: { ok: true },
        backend: { ok: false, detail: backendReady.error },
      }),
    });
  }

  const self = await runTailscale(["status", "--self", "--json"]);
  // BackendState separates "install Tailscale" / "start it" / "sign in" —
  // the old exit-code-only check lumped a signed-out machine in with a
  // missing CLI and let a Stopped one fail later with a route error.
  const tailscale = classifyTailscaleSelf(self);
  if (tailscale.kind !== "running") {
    const error =
      tailscale.kind === "not-installed"
        ? "Tailscale is not installed"
        : tailscale.kind === "needs-login"
          ? "Tailscale is signed out"
          : "Tailscale is not running";
    return mobileUnavailableResponse(error, {
      stderr: self.stderr,
      steps: buildPairingSteps({
        access: { ok: true },
        backend: { ok: true },
        tailscale,
      }),
    });
  }

  const parsedSelf = parseServeStatus(self.stdout);
  const selfStatus: unknown = "error" in parsedSelf ? null : parsedSelf.value;
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
  const tailnetDiscovery = tailnetDiscoveryProof({ selfStatus, serveStatus, backendUrl: backend });
  let discovery: ReturnType<typeof nativeAppDiscoveryProof> = tailnetDiscovery;
  let fallbackWarning: string | null = null;
  if (!tailnetDiscovery.ok) {
    const httpServe = await runTailscale(["serve", "--bg", `--http=${backendPort(backend)}`, backend]);
    if (httpServe.ok) {
      discovery = nativeAppDiscoveryProof({ selfStatus, serveStatus, backendUrl: backend });
      if (discovery.ok && discovery.source === "tailscale-ip-http") {
        fallbackWarning = serveWarning
          ? `${serveWarning} Using the Tailscale IP fallback for the native app.`
          : "Using the Tailscale IP fallback for the native app.";
      }
    } else {
      const httpServeError = httpServe.stderr || "Tailscale HTTP Serve could not be started.";
      fallbackWarning = serveWarning
        ? `${serveWarning} HTTP fallback failed: ${httpServeError}`
        : httpServeError;
      discovery = {
        ok: false,
        reason: fallbackWarning,
      };
    }
  }

  if (!discovery.ok) {
    const routeDetail = fallbackWarning ?? serveWarning ?? discovery.reason;
    return NextResponse.json(
      {
        ok: false,
        error: routeDetail,
        stderr: fallbackWarning ?? serveWarning ?? status.stderr,
        backendUrl: backend,
        steps: buildPairingSteps({
          access: { ok: true },
          backend: { ok: true },
          tailscale,
          route: { ok: false, detail: routeDetail },
        }),
      },
      { status: 500 },
    );
  }

  // "Continue on phone" (cave-i74f): the QR target carries the chat
  // deep-link fragment so one scan opens THIS conversation. The bare host
  // (nativeHost/serveUrl) stays clean — the native app pairs on the host,
  // not the fragment.
  //
  // Token-gated servers (the packaged bundle, or a token-gated dev session)
  // additionally mint the signed invite the tokenless flow never needed: the
  // QR/link carry `coven_access_token` so Safari pairs via the cookie
  // exchange and the native scanner auto-connects via CaveInvite, and
  // `appInviteUrl` is the covencave:// deep link with the long-lived token.
  // Without this a packaged user's scan lands on a 401 (cave-gzje).
  let invitePayload: {
    inviteUrl: string;
    appUrl: string;
    appInviteUrl: string;
    appTokenExpiresAt: number;
    expiresAt: number;
    expiresAtIso: string;
  } | null = null;
  let qrTarget = withChatFragment(discovery.serveUrl, chatId);
  if (!nativeTokenlessMode()) {
    const invite = await createMobileInvite({
      baseUrl: discovery.serveUrl,
      accessSecret,
      sidecarToken: process.env.COVEN_CAVE_AUTH_TOKEN,
      ttlMs: MOBILE_INVITE_TTL_MS,
    });
    qrTarget = withChatFragment(invite.url, chatId);
    invitePayload = {
      inviteUrl: qrTarget,
      appUrl: qrTarget,
      appInviteUrl: invite.appInviteUrl,
      appTokenExpiresAt: invite.appTokenExpiresAt,
      expiresAt: invite.expiresAt,
      expiresAtIso: invite.expiresAtIso,
    };
  }
  const qrSvg = await QRCode.toString(qrTarget, {
    type: "svg",
    margin: 1,
    width: 256,
    errorCorrectionLevel: "M",
  });
  const lastSeenAt = await readMobileLastSeen();

  return NextResponse.json({
    ok: true,
    backendUrl: backend,
    serveUrl: discovery.serveUrl,
    url: qrTarget,
    ...(invitePayload ?? {}),
    nativeUrl: discovery.serveUrl,
    nativeHost: discovery.host,
    discoverySource: discovery.source,
    // Paired signal (cave-i74f): the last token-refresh beat from a paired
    // device — null until a phone has actually connected.
    lastSeenAt,
    // The whole proven ladder (cave-jr4r.1) — the Phone card renders it as a
    // guided checklist instead of guessing from one error string.
    steps: buildPairingSteps({
      access: { ok: true },
      backend: { ok: true },
      tailscale,
      route: { ok: true },
      phoneSeenAt: lastSeenAt,
    }),
    qrSvg,
    warning: fallbackWarning ?? serveWarning ?? undefined,
  });
}

async function mobileHandoff(req: Request, chatId?: string | null) {
  const hostPortRejection = rejectMismatchedHostPort(req);
  if (hostPortRejection) return hostPortRejection;

  const access = resolveMobileAccessSecret();
  if (!access) {
    return mobileAccessUnavailableResponse();
  }

  const res = await mobileHandoffReady(req, access.secret, chatId);
  return access.provisioned ? withBrowserAccessCookie(res, req, access.secret) : res;
}

async function mobileHandoffReady(
  req: Request,
  accessSecret: string,
  chatId?: string | null,
) {
  // `--json` doubles as the connectivity check (exit 0 == connected) and the
  // source for the MagicDNS fallback host below.
  const self = await runTailscale(["status", "--self", "--json"]);
  if (!self.ok) {
    return mobileUnavailableResponse("tailscale is not connected", { stderr: self.stderr });
  }
  // Best-effort: an unparseable self status just disables the MagicDNS
  // fallback; an existing serve config can still yield a URL. Reuse the
  // tolerant parser so prepended health/warning lines don't break it.
  const parsedSelf = parseServeStatus(self.stdout);
  const selfStatus: unknown = "error" in parsedSelf ? null : parsedSelf.value;

  const backend = backendUrl();

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
  // "Continue on phone" (cave-i74f): the QR carries the chat deep-link
  // fragment so one scan opens THIS conversation, not just the app.
  const inviteUrl = withChatFragment(invite.url, chatId);
  const qrSvg = await QRCode.toString(inviteUrl, {
    type: "svg",
    margin: 1,
    width: 256,
    errorCorrectionLevel: "M",
  });

  return NextResponse.json({
    ok: true,
    backendUrl: backend,
    serveUrl: discovery.serveUrl,
    inviteUrl,
    url: inviteUrl,
    appUrl: inviteUrl,
    // Native-app pairing: covencave:// deep link with a long-lived token —
    // shown beside the QR so the iOS/iPadOS app pairs without typing.
    appInviteUrl: invite.appInviteUrl,
    appTokenExpiresAt: invite.appTokenExpiresAt,
    discoverySource: discovery.source,
    expiresAt: invite.expiresAt,
    expiresAtIso: invite.expiresAtIso,
    // Paired signal (cave-i74f): the last token-refresh beat from a paired
    // device — null until a phone has actually connected.
    lastSeenAt: await readMobileLastSeen(),
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
  let chatId: string | null = null;
  try {
    const body = (await req.json()) as { action?: string; chatId?: string };
    action = body.action ?? "start";
    if (typeof body.chatId === "string") chatId = body.chatId;
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

  // Cheap paired-signal read for the handoff modal's "phone seen" poll: no
  // Tailscale spawn, no Serve reconcile — just the last token-refresh beat.
  if (action === "status") {
    return NextResponse.json({ ok: true, lastSeenAt: await readMobileLastSeen() });
  }

  if (action === "app-start") {
    return ensureNativeAppServe(req, chatId);
  }

  if (action === "app-stop") {
    const reset = await runTailscale(["serve", "reset"]);
    // Mobile mode Off retires the self-provisioned pairing secret (cave-os73):
    // disarm the in-process gate and drop the persisted file so the next dev
    // boot stays tokenless. No-op in the packaged bundle.
    retireMobileAccessSecret();
    return NextResponse.json({
      ok: reset.ok,
      error: reset.ok ? undefined : "failed to stop mobile mode",
      stderr: reset.stderr,
    }, { status: reset.ok ? 200 : 500 });
  }

  return mobileHandoff(req, chatId);
}
