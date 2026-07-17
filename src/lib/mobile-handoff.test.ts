import assert from "node:assert/strict";

import {
  buildInviteUrl,
  buildPairingSteps,
  classifyTailscaleSelf,
  createMobileInvite,
  withChatFragment,
  findServeUrl,
  magicDnsHost,
  magicDnsServeUrl,
  nativeAppDiscoveryProof,
  resolveTailscaleBin,
  tailnetDiscoveryProof,
  tailscaleIpHost,
} from "./mobile-handoff.ts";
import { verifyMobileAccessToken } from "./mobile-access-token.ts";

const serveHost = "cave.tailnet.example.ts.net";
const serveUrl = `https://${serveHost}/`;

const status = {
  TCP: {
    "443": { HTTPS: true },
  },
  Web: {
    [`${serveHost}:443`]: {
      Handlers: {
        "/": {
          Proxy: "http://127.0.0.1:3000",
        },
      },
    },
  },
};
const signingKey = ["handoff", "mobile", "key"].join("-");

{
  const url = findServeUrl(status, "http://127.0.0.1:3000");
  assert.equal(url, serveUrl);
}

{
  const url = findServeUrl(status, "http://127.0.0.1:4242");
  assert.equal(url, null);
}

{
  // Tailscale may report the proxy with a trailing slash or as `localhost`.
  const variants = {
    Web: {
      [`${serveHost}:443`]: {
        Handlers: { "/": { Proxy: "http://localhost:3000/" } },
      },
    },
  };
  assert.equal(
    findServeUrl(variants, "http://127.0.0.1:3000"),
    serveUrl,
  );
}

{
  const bin = resolveTailscaleBin({
    envBin: "/custom/tailscale",
    pathEnv: "",
    exists: (candidate) => candidate === "/custom/tailscale",
    candidatePaths: ["/Applications/Tailscale.app/Contents/MacOS/Tailscale"],
  });
  assert.equal(bin, "/custom/tailscale");
}

{
  const appBin = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
  const bin = resolveTailscaleBin({
    pathEnv: "/usr/bin:/bin",
    exists: (candidate) => candidate === appBin,
    candidatePaths: [appBin, "/usr/local/bin/tailscale"],
  });
  assert.equal(bin, appBin);
}

{
  const bin = resolveTailscaleBin({
    pathEnv: "/usr/bin:/bin",
    exists: () => false,
    candidatePaths: ["/Applications/Tailscale.app/Contents/MacOS/Tailscale"],
  });
  assert.equal(bin, "tailscale");
}

{
  const url = buildInviteUrl({
    baseUrl: serveUrl,
    mobileAccessToken: "mobile-token",
    sidecarToken: "sidecar-token",
  });
  assert.equal(
    url,
    `${serveUrl}?coven_access_token=mobile-token&covenCaveToken=sidecar-token`,
  );
}

{
  const now = 1_800_000_000_000;
  const invite = await createMobileInvite({
    baseUrl: serveUrl,
    accessSecret: signingKey,
    sidecarToken: "sidecar-a",
    ttlMs: 10 * 60 * 1000,
    now,
    nonce: "nonce-invite",
  });

  assert.equal(invite.expiresAt, now + 10 * 60 * 1000);
  assert.match(invite.url, /^https:\/\/cave\.tailnet\.example\.ts\.net\/\?coven_access_token=v1\./);
  assert.match(invite.url, /&covenCaveToken=sidecar-a$/);

  const parsed = new URL(invite.url);
  const token = parsed.searchParams.get("coven_access_token");
  assert.ok(token);
  const verification = await verifyMobileAccessToken(token, signingKey, now);
  assert.equal(verification.ok, true);

  // The native-app invite is a covencave:// deep link carrying the SERVE host
  // and a LONG-lived token (30d default, not the 8h QR TTL) — tapping it on
  // the device pairs with zero typing, and the device renews from there.
  assert.ok(invite.appInviteUrl.startsWith("covencave://connect?"));
  const app = new URL(invite.appInviteUrl);
  assert.equal(app.searchParams.get("host"), "cave.tailnet.example.ts.net");
  const appToken = app.searchParams.get("token");
  assert.ok(appToken);
  const appVerification = await verifyMobileAccessToken(appToken, signingKey, now);
  assert.equal(appVerification.ok, true);
  if (appVerification.ok) {
    assert.equal(appVerification.expiresAt, invite.appTokenExpiresAt);
    assert.ok(invite.appTokenExpiresAt > invite.expiresAt, "app token outlives the QR invite");
  }
}

{
  // MagicDNS fallback: derive the serve URL from `status --self --json` when
  // the serve config can't be read (the GUI-failed-to-start case). The root
  // dot Tailscale appends to DNSName is stripped.
  const self = { Self: { DNSName: "cave.tailnet.example.ts.net." } };
  assert.equal(magicDnsHost(self), "cave.tailnet.example.ts.net");
  assert.equal(magicDnsServeUrl(self), serveUrl);

  // The fallback host matches what findServeUrl would have produced, so the
  // invite link is well-formed either way.
  assert.equal(magicDnsServeUrl(self), findServeUrl(status, "http://127.0.0.1:3000"));
}

{
  const self = { Self: { DNSName: "cave.tailnet.example.ts.net." } };
  assert.deepEqual(
    tailnetDiscoveryProof({ selfStatus: self, serveStatus: status, backendUrl: "http://127.0.0.1:3000" }),
    {
      ok: true,
      host: "cave.tailnet.example.ts.net",
      serveUrl,
      source: "serve-status",
    },
  );
  assert.deepEqual(
    tailnetDiscoveryProof({ selfStatus: self, serveStatus: {}, backendUrl: "http://127.0.0.1:3000" }),
    {
      ok: true,
      host: "cave.tailnet.example.ts.net",
      serveUrl,
      source: "magicdns-self-status",
    },
  );
  assert.deepEqual(
    tailnetDiscoveryProof({ selfStatus: {}, serveStatus: {}, backendUrl: "http://127.0.0.1:3000" }),
    {
      ok: false,
      reason: "tailscale serve URL not found and status --self had no MagicDNS DNSName",
    },
  );
}

{
  const selfWithoutMagicDns = {
    Self: {
      TailscaleIPs: ["100.101.102.103", "fd7a:115c:a1e0::1"],
    },
  };
  assert.equal(tailscaleIpHost(selfWithoutMagicDns), "100.101.102.103");
  assert.deepEqual(
    nativeAppDiscoveryProof({
      selfStatus: selfWithoutMagicDns,
      serveStatus: {},
      backendUrl: "http://127.0.0.1:3000",
    }),
    {
      ok: true,
      host: "100.101.102.103:3000",
      serveUrl: "http://100.101.102.103:3000/",
      source: "tailscale-ip-http",
    },
  );
}

{
  // No DNSName → no fallback (caller then surfaces the serve error).
  assert.equal(magicDnsServeUrl(null), null);
  assert.equal(magicDnsServeUrl({}), null);
  assert.equal(magicDnsServeUrl({ Self: {} }), null);
  assert.equal(magicDnsHost({ Self: { DNSName: "  " } }), null);
  assert.equal(tailscaleIpHost({ Self: { TailscaleIPs: ["fd7a:115c:a1e0::1"] } }), null);
  assert.equal(tailscaleIpHost({ Self: { TailscaleIPs: "100.101.102.103" } }), null);
  assert.equal(tailscaleIpHost({ TailscaleIPs: { primary: "100.101.102.103" } }), null);
  assert.equal(tailscaleIpHost({ TailscaleIPs: [null, 42, "100.101.102.103"] }), "100.101.102.103");
}

// ── Continue on phone (cave-i74f): the chat deep-link fragment ───────────────
{
  const base = "https://cave.ts.net/?coven_access_token=t";
  assert.equal(
    withChatFragment(base, "s-abc123"),
    `${base}#chat-s-abc123`,
    "a valid session id rides the invite as a #chat fragment",
  );
  assert.equal(withChatFragment(base, null), base, "no chat id → untouched");
  assert.equal(withChatFragment(base, "   "), base, "blank id → untouched");
  assert.equal(
    withChatFragment(base, "../../evil"),
    base,
    "ids outside the daemon's shape never reach the URL",
  );
  assert.equal(
    withChatFragment(`${base}#stale`, "s-1"),
    `${base}#chat-s-1`,
    "an existing fragment is replaced, not doubled",
  );
}

// ── Wiring pins: one action → QR opens THIS conversation + paired signal ─────
{
  const { readFileSync } = await import("node:fs");
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

  const route = read("../app/api/mobile-handoff/route.ts");
  assert.match(route, /withChatFragment\(discovery\.serveUrl, chatId\)/, "app-start QR target carries the chat fragment");
  assert.match(route, /ensureNativeAppServe\(req, chatId\)/, "POST threads chatId into app-start");
  assert.match(route, /lastSeenAt: await readMobileLastSeen\(\)/, "handoff responses expose the paired-device beat");
  // cave-gzje: on token-gated servers (the packaged bundle above all),
  // app-start mints the signed invite instead of the bare host, so a packaged
  // scan pairs instead of landing on a 401.
  assert.match(route, /qrTarget = withChatFragment\(invite\.url, chatId\)/, "token-gated app-start swaps the QR target to the signed invite");
  assert.match(route, /expiresAtIso: invite\.expiresAtIso/, "token-gated app-start exposes the invite expiry");
  assert.match(route, /ok: false, unavailable: true/, "known optional prerequisites use a clean application-level unavailable response");

  const refresh = read("../app/api/mobile-token/refresh/route.ts");
  assert.match(refresh, /await recordMobileSeen\(\);/, "a successful token refresh records the paired-device beat");

  const modal = read("../components/mobile-handoff-modal.tsx");
  assert.match(modal, /chatId \? \{ action: "app-start", chatId \} : \{ action: "app-start" \}/, "the modal forwards its chatId to app-start");
  assert.match(modal, /Scan to continue this conversation on your phone\./, "chat handoff says what the scan does");

  const chatView = read("../components/chat-view.tsx");
  assert.match(chatView, /cave:continue-on-phone[\s\S]*detail: \{ chatId: sessionId \}/, "chat overflow dispatches the continue-on-phone event with the session id");
  assert.match(chatView, />\s*Continue on phone\s*</, "the overflow menu offers Continue on phone");

  const workspace = read("../components/workspace.tsx");
  assert.match(workspace, /addEventListener\("cave:continue-on-phone"/, "workspace listens for the handoff event");
  assert.match(workspace, /chatId=\{mobileHandoffChatId\}/, "workspace threads the chat id into the pairing modal");

  const settings = read("../components/settings-shell.tsx");
  assert.match(settings, /Paired · last seen \{relativeTime\(/, "the Settings card shows the paired-device beat");
}

console.log("mobile-handoff.test.ts OK");

// ── Guided pairing checklist (cave-jr4r.1) ────────────────────────────────────

// classifyTailscaleSelf reads BackendState — exit code alone can't separate
// "sign in" from "start Tailscale" from "install Tailscale".
{
  assert.deepEqual(
    classifyTailscaleSelf({ ok: true, stdout: JSON.stringify({ BackendState: "Running" }), stderr: "" }),
    { kind: "running" },
    "BackendState Running is the healthy state",
  );
  assert.equal(
    classifyTailscaleSelf({ ok: true, stdout: JSON.stringify({ BackendState: "NeedsLogin" }), stderr: "" }).kind,
    "needs-login",
    "NeedsLogin asks for a sign-in, not an install",
  );
  assert.equal(
    classifyTailscaleSelf({ ok: true, stdout: JSON.stringify({ BackendState: "NeedsMachineAuth" }), stderr: "" }).kind,
    "needs-login",
    "NeedsMachineAuth also reads as a sign-in problem",
  );
  assert.equal(
    classifyTailscaleSelf({ ok: true, stdout: JSON.stringify({ BackendState: "Stopped" }), stderr: "" }).kind,
    "not-running",
    "Stopped asks to start Tailscale",
  );
  assert.equal(
    classifyTailscaleSelf({ ok: true, stdout: "not json", stderr: "" }).kind,
    "not-running",
    "an unparseable status reads as not-running, never a crash",
  );
  assert.equal(
    classifyTailscaleSelf({ ok: false, stdout: "", stderr: "Tailscale CLI not found. Install Tailscale…" }).kind,
    "not-installed",
    "a missing CLI asks for an install",
  );
  assert.equal(
    classifyTailscaleSelf({ ok: false, stdout: "", stderr: "some transient failure" }).kind,
    "not-running",
    "other probe failures read as not-running with the stderr as detail",
  );
}

// buildPairingSteps: the ladder reports every rung — fail marks the break,
// everything after reads skipped, and the phone rung is pending (never a
// failure) until a device has been seen.
{
  const broken = buildPairingSteps({
    access: { ok: true },
    backend: { ok: true },
    tailscale: { kind: "needs-login", detail: "Open Tailscale and sign in." },
  });
  assert.deepEqual(
    broken.map((s) => [s.id, s.state]),
    [["access", "ok"], ["backend", "ok"], ["tailscale", "fail"], ["route", "skipped"], ["phone", "skipped"]],
    "a mid-ladder failure marks later rungs skipped",
  );
  assert.equal(broken[2].detail, "Open Tailscale and sign in.", "the failing rung carries the actionable detail");

  const waiting = buildPairingSteps({
    access: { ok: true },
    backend: { ok: true },
    tailscale: { kind: "running" },
    route: { ok: true },
    phoneSeenAt: null,
  });
  assert.deepEqual(
    waiting.map((s) => s.state),
    ["ok", "ok", "ok", "ok", "pending"],
    "a healthy ladder with no scan yet reads pending on the phone rung, not failed",
  );

  const paired = buildPairingSteps({
    access: { ok: true },
    backend: { ok: true },
    tailscale: { kind: "running" },
    route: { ok: true },
    phoneSeenAt: Date.now(),
  });
  assert.equal(paired[4].state, "ok", "a seen phone completes the ladder");

  const noToken = buildPairingSteps({ access: { ok: false, detail: "token unavailable" } });
  assert.deepEqual(
    noToken.map((s) => s.state),
    ["fail", "skipped", "skipped", "skipped", "skipped"],
    "a first-rung failure skips the whole rest of the ladder",
  );
}

console.log("pairing checklist: ok");
