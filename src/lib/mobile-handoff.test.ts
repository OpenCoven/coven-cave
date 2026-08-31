import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
  OFFICIAL_IOS_INSTALL_URL,
  resolveIosInstallUrl,
  resolveTailscaleBin,
  serveRouteFailure,
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

// ── Machine-global Tailscale Serve ownership (cave-uq1ht) ───────────────────
{
  const module = (await import("./mobile-handoff.ts")) as unknown as Record<string, unknown>;
  assert.deepEqual(
    [
      typeof module.enumerateServeProxyBackends,
      typeof module.assessServeOwnership,
      typeof module.serveRouteOwnedByBackend,
      typeof module.packagedServeMayTakeOverHealthyLoopback,
    ],
    ["function", "function", "function", "function"],
    "Serve ownership exposes pure inventory, assessment, precedence, and verification helpers",
  );

  const enumerateServeProxyBackends = module.enumerateServeProxyBackends as (
    status: unknown,
  ) => Array<{ kind: string; target?: string; raw: string }>;
  const assessServeOwnership = module.assessServeOwnership as (
    status: unknown,
    backend: string,
    probe: (target: string) => Promise<boolean>,
  ) => Promise<{ kind: string; targets: string[] }>;
  const serveRouteOwnedByBackend = module.serveRouteOwnedByBackend as (
    status: unknown,
    backend: string,
  ) => boolean;
  const packagedServeMayTakeOverHealthyLoopback =
    module.packagedServeMayTakeOverHealthyLoopback as (
      backend: string,
      env: Record<string, string | undefined>,
    ) => boolean;
  assert.equal(
    packagedServeMayTakeOverHealthyLoopback(
      "http://127.0.0.1:3020",
      { COVEN_CAVE_BUNDLE: "1", PORT: "3020" },
    ),
    true,
    "only a real packaged process serving the fixed production port gets precedence",
  );
  assert.equal(
    packagedServeMayTakeOverHealthyLoopback(
      "http://127.0.0.1:3020",
      { PORT: "3020" },
    ),
    false,
    "a development process cannot gain precedence by choosing port 3020",
  );
  assert.equal(
    packagedServeMayTakeOverHealthyLoopback(
      "http://127.0.0.1:3000",
      { COVEN_CAVE_BUNDLE: "1", PORT: "3000" },
    ),
    false,
    "bundle evidence alone does not grant precedence to an overridden dev port",
  );
  assert.equal(
    packagedServeMayTakeOverHealthyLoopback(
      "http://127.0.0.1:3020",
      { COVEN_CAVE_BUNDLE: "1", PORT: "3000" },
    ),
    false,
    "a configured 3020 override is not precedence unless this process is actually bound there",
  );

  const competingStatus = {
    Web: {
      [`${serveHost}:443`]: {
        Handlers: {
          "/": { Proxy: "http://localhost:3020/" },
          "/legacy": { Proxy: "http://127.0.0.1:3007" },
        },
      },
    },
  };
  assert.deepEqual(
    enumerateServeProxyBackends(competingStatus),
    [
      { kind: "loopback", raw: "http://localhost:3020/", target: "http://127.0.0.1:3020" },
      { kind: "loopback", raw: "http://127.0.0.1:3007", target: "http://127.0.0.1:3007" },
    ],
    "all proxy handlers are enumerated and loopback aliases normalize to one durable identity",
  );
  assert.equal(
    serveRouteOwnedByBackend(competingStatus, "http://127.0.0.1:3020"),
    false,
    "one desired handler does not own a mixed route",
  );
  assert.equal(
    serveRouteOwnedByBackend(status, "http://localhost:3000/"),
    true,
    "the desired backend owns the complete route when every proxy target matches",
  );

  let protectedProbeCount = 0;
  const protectedStatus = {
    Web: {
      [`${serveHost}:443`]: {
        Handlers: {
          "/external": { Proxy: "https://example.com/backend" },
          "/malformed": { Proxy: "not a URL" },
        },
      },
    },
  };
  const protectedAssessment = await assessServeOwnership(
    protectedStatus,
    "http://127.0.0.1:3000",
    async () => {
      protectedProbeCount += 1;
      return false;
    },
  );
  assert.equal(protectedAssessment.kind, "conflict");
  assert.equal(protectedProbeCount, 0, "protected targets are never network-probed");
  const packagedProtectedAssessment = await (
    assessServeOwnership as typeof assessServeOwnership & (
      (
        status: unknown,
        backend: string,
        probe: (target: string) => Promise<boolean>,
        options: { takeOverHealthyLoopback: boolean },
      ) => Promise<{ kind: string; targets: string[] }>
    )
  )(
    protectedStatus,
    "http://127.0.0.1:3020",
    async () => {
      assert.fail("packaged precedence must not probe or replace a protected route");
    },
    { takeOverHealthyLoopback: true },
  );
  assert.equal(
    packagedProtectedAssessment.kind,
    "conflict",
    "packaged precedence never overrides malformed or non-loopback ownership",
  );
  assert.deepEqual(
    enumerateServeProxyBackends(null),
    [{ kind: "protected", raw: "<malformed status>" }],
    "a non-object Serve status is protected rather than mistaken for an empty route",
  );

  const healthyAssessment = await assessServeOwnership(
    competingStatus,
    "http://127.0.0.1:3000",
    async (target) => target.endsWith(":3020"),
  );
  assert.equal(healthyAssessment.kind, "conflict", "a responsive packaged backend keeps ownership");

  let packagedProbeCount = 0;
  const packagedAssessment = await (
    assessServeOwnership as typeof assessServeOwnership & (
      (
        status: unknown,
        backend: string,
        probe: (target: string) => Promise<boolean>,
        options: { takeOverHealthyLoopback: boolean },
      ) => Promise<{ kind: string; targets: string[] }>
    )
  )(
    {
      Web: {
        [`${serveHost}:443`]: {
          Handlers: { "/": { Proxy: "http://127.0.0.1:3007" } },
        },
      },
    },
    "http://127.0.0.1:3020",
    async () => {
      packagedProbeCount += 1;
      return true;
    },
    { takeOverHealthyLoopback: true },
  );
  assert.equal(
    packagedAssessment.kind,
    "takeover",
    "the trusted packaged 3020 channel has the same healthy-dev precedence as Rust",
  );
  assert.equal(packagedProbeCount, 0, "packaged precedence does not need to probe a dev owner");

  const staleAssessment = await assessServeOwnership(
    competingStatus,
    "http://127.0.0.1:3000",
    async () => false,
  );
  assert.equal(staleAssessment.kind, "takeover", "unreachable competing dev routes may be reclaimed");

  const emptyAssessment = await assessServeOwnership(
    {},
    "http://127.0.0.1:3000",
    async () => {
      assert.fail("an empty route has nothing to probe");
    },
  );
  assert.equal(emptyAssessment.kind, "takeover");

  assert.equal(
    serveRouteOwnedByBackend(
      {
        Web: {
          [`${serveHost}:443`]: {
            Handlers: { "/": { Proxy: "http://127.0.0.1:3020" } },
          },
        },
      },
      "http://127.0.0.1:3000",
    ),
    false,
    "post-mutation verification detects a race that repointed Serve",
  );
}

// ── Cross-process Serve mutation lease (cave-uq1ht review follow-up) ────────
{
  const module = (await import("./mobile-handoff.ts")) as unknown as Record<string, unknown>;
  assert.deepEqual(
    [
      typeof module.tailscaleServeLeasePath,
      typeof module.acquireTailscaleServeLease,
    ],
    ["function", "function"],
    "Serve ownership exposes the shared lock path and bounded lease acquisition",
  );

  const tailscaleServeLeasePath = module.tailscaleServeLeasePath as (home: string) => string;
  assert.equal(
    tailscaleServeLeasePath("/Users/coven"),
    "/Users/coven/.coven/cave/tailscale-serve-ownership.lock",
    "Node and Rust share one deterministic machine-wide lock path",
  );
  const rustReachability = readFileSync(
    new URL("../../src-tauri/src/desktop_reachability.rs", import.meta.url),
    "utf8",
  );
  assert.match(
    rustReachability,
    /const TAILSCALE_SERVE_LEASE_FILE: &str = "tailscale-serve-ownership\.lock";/,
    "Rust uses the identical lease filename",
  );
  assert.match(
    rustReachability,
    /const TAILSCALE_SERVE_LEASE_VERSION: u8 = 1;/,
    "Rust uses the identical lease record version",
  );

  type FakeEntry = { content: string; dev: number; ino: number };
  class FakeLeaseFs {
    readonly files = new Map<string, FakeEntry>();
    private nextIno = 1;

    async mkdir(): Promise<void> {}

    async writeFile(file: string, content: string, options?: { flag?: string }): Promise<void> {
      if (options?.flag === "wx" && this.files.has(file)) {
        throw Object.assign(new Error("exists"), { code: "EEXIST" });
      }
      this.files.set(file, { content, dev: 1, ino: this.nextIno++ });
    }

    async link(source: string, destination: string): Promise<void> {
      if (this.files.has(destination)) {
        throw Object.assign(new Error("exists"), { code: "EEXIST" });
      }
      const sourceEntry = this.files.get(source);
      assert.ok(sourceEntry, `missing hard-link source ${source}`);
      this.files.set(destination, sourceEntry);
    }

    async readFile(file: string): Promise<string> {
      const entry = this.files.get(file);
      if (!entry) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return entry.content;
    }

    async stat(file: string): Promise<{ dev: number; ino: number }> {
      const entry = this.files.get(file);
      if (!entry) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return { dev: entry.dev, ino: entry.ino };
    }

    async unlink(file: string): Promise<void> {
      if (!this.files.delete(file)) {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }
    }

    replace(file: string, content: string): void {
      this.files.set(file, { content, dev: 1, ino: this.nextIno++ });
    }
  }

  type LeaseOptions = {
    path: string;
    fs: FakeLeaseFs;
    pid: number;
    token: string;
    isProcessAlive: (pid: number) => boolean;
    now: () => number;
    sleep: (milliseconds: number) => Promise<void>;
    timeoutMs: number;
    pollMs: number;
  };
  const acquireTailscaleServeLease = module.acquireTailscaleServeLease as (
    options: LeaseOptions,
  ) => Promise<{ release(): Promise<void> } | null>;
  const lockPath = tailscaleServeLeasePath("/Users/coven");
  let now = 0;
  const sleep = async (milliseconds: number) => {
    now += milliseconds;
  };
  const fs = new FakeLeaseFs();
  const first = await acquireTailscaleServeLease({
    path: lockPath,
    fs,
    pid: 101,
    token: "first-owner",
    isProcessAlive: (pid) => pid === 101,
    now: () => now,
    sleep,
    timeoutMs: 10,
    pollMs: 5,
  });
  assert.ok(first, "the first reconciler acquires the machine-wide lease");
  const contended = await acquireTailscaleServeLease({
    path: lockPath,
    fs,
    pid: 202,
    token: "second-owner",
    isProcessAlive: (pid) => pid === 101 || pid === 202,
    now: () => now,
    sleep,
    timeoutMs: 10,
    pollMs: 5,
  });
  assert.equal(contended, null, "contention is bounded and fails closed");

  await first.release();
  const afterRelease = await acquireTailscaleServeLease({
    path: lockPath,
    fs,
    pid: 202,
    token: "second-owner",
    isProcessAlive: (pid) => pid === 202,
    now: () => now,
    sleep,
    timeoutMs: 10,
    pollMs: 5,
  });
  assert.ok(afterRelease, "the lease releases for the next reconciler");
  await afterRelease.release();

  const crashed = await acquireTailscaleServeLease({
    path: lockPath,
    fs,
    pid: 303,
    token: "crashed-owner",
    isProcessAlive: (pid) => pid === 303,
    now: () => now,
    sleep,
    timeoutMs: 10,
    pollMs: 5,
  });
  assert.ok(crashed);
  const recovered = await acquireTailscaleServeLease({
    path: lockPath,
    fs,
    pid: 404,
    token: "recovered-owner",
    isProcessAlive: (pid) => pid === 404,
    now: () => now,
    sleep,
    timeoutMs: 10,
    pollMs: 5,
  });
  assert.ok(recovered, "a dead process owner is safely recovered");
  await recovered.release();

  const oldOwner = await acquireTailscaleServeLease({
    path: lockPath,
    fs,
    pid: 505,
    token: "old-owner",
    isProcessAlive: (pid) => pid === 505,
    now: () => now,
    sleep,
    timeoutMs: 10,
    pollMs: 5,
  });
  assert.ok(oldOwner);
  fs.replace(lockPath, JSON.stringify({ version: 1, pid: 606, token: "replacement-owner" }));
  await oldOwner.release();
  assert.match(
    await fs.readFile(lockPath),
    /replacement-owner/,
    "release never unlinks a replacement owner's lease",
  );

  const malformedFs = new FakeLeaseFs();
  malformedFs.replace(lockPath, JSON.stringify({ version: 1, pid: 707, token: "../unsafe" }));
  const malformed = await acquireTailscaleServeLease({
    path: lockPath,
    fs: malformedFs,
    pid: 808,
    token: "safe-owner",
    isProcessAlive: () => false,
    now: () => now,
    sleep,
    timeoutMs: 10,
    pollMs: 5,
  });
  assert.equal(malformed, null, "malformed owner records fail closed instead of being unlinked");
  assert.match(await malformedFs.readFile(lockPath), /unsafe/);
}

{
  const failure = serveRouteFailure({
    backendUrl: "http://127.0.0.1:3000",
    serveError: "serve config unavailable",
    statusError: "status should not replace Serve stderr",
  });
  assert.match(failure.error, /serve config unavailable/);
  assert.match(failure.error, /Enable HTTPS for this tailnet at https:\/\/login\.tailscale\.com\/admin\/dns/);
  assert.equal(failure.stderr, "serve config unavailable");

  const missingRoute = serveRouteFailure({
    backendUrl: "http://127.0.0.1:3000",
    routeReason: "tailscale serve route not found for http://127.0.0.1:3000",
  });
  assert.match(missingRoute.error, /tailscale serve route not found/);
  assert.equal(missingRoute.stderr, undefined);

  const nonHttpsRoute = serveRouteFailure({
    backendUrl: "http://127.0.0.1:3020",
    routeReason: "tailscale serve route for http://127.0.0.1:3020 is not an HTTPS listener",
  });
  assert.match(nonHttpsRoute.error, /not an HTTPS listener/);
  assert.match(nonHttpsRoute.error, /Enable HTTPS for this tailnet/);
}

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
  // An HTTP-only Serve listener must never be relabeled as HTTPS. The
  // explicit route also blocks the MagicDNS fallback, even after a successful
  // `serve --bg` mutation, because the listener is known to be non-HTTPS.
  const backend = "http://127.0.0.1:3020";
  const httpOnlyStatus = {
    TCP: {
      "3020": { HTTP: true },
    },
    Web: {
      [`${serveHost}:3020`]: {
        Handlers: {
          "/": {
            Proxy: backend,
          },
        },
      },
    },
  };
  assert.equal(findServeUrl(httpOnlyStatus, backend), null);

  const browserProof = tailnetDiscoveryProof({
    selfStatus: { Self: { DNSName: `${serveHost}.` } },
    serveStatus: httpOnlyStatus,
    backendUrl: backend,
    allowMagicDnsFallback: true,
  });
  assert.deepEqual(browserProof, {
    ok: false,
    reason: `tailscale serve route for ${backend} is not an HTTPS listener`,
  });

  // The native app's explicitly supported Tailscale-IP HTTP path remains
  // available, but it is not a browser invite proof.
  assert.deepEqual(
    nativeAppDiscoveryProof({
      selfStatus: {
        Self: {
          DNSName: `${serveHost}.`,
          TailscaleIPs: ["100.101.102.103"],
        },
      },
      serveStatus: httpOnlyStatus,
      backendUrl: backend,
      allowMagicDnsFallback: false,
    }),
    {
      ok: true,
      host: "100.101.102.103:3020",
      serveUrl: "http://100.101.102.103:3020/",
      source: "tailscale-ip-http",
    },
  );
}

{
  // HTTPS Serve on a non-default port is accepted only when the listener
  // protocol is explicit in the Serve status.
  const backend = "http://127.0.0.1:3020";
  const httpsStatus = {
    TCP: {
      "3020": { HTTPS: true },
    },
    Web: {
      [`${serveHost}:3020`]: {
        Handlers: { "/": { Proxy: backend } },
      },
    },
  };
  assert.equal(findServeUrl(httpsStatus, backend), `https://${serveHost}:3020/`);
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
    tailnetDiscoveryProof({
      selfStatus: self,
      serveStatus: {},
      backendUrl: "http://127.0.0.1:3000",
      allowMagicDnsFallback: false,
    }),
    {
      ok: false,
      reason: "tailscale serve route not found for http://127.0.0.1:3000",
    },
    "a readable empty Serve status must not promote a bare MagicDNS name unless mutation evidence allows it",
  );
  const linuxMismatchedServeStatus = {
    Web: {
      [`${serveHost}:443`]: {
        Handlers: { "/": { Proxy: "http://127.0.0.1:4242" } },
      },
    },
  };
  assert.deepEqual(
    tailnetDiscoveryProof({
      selfStatus: self,
      serveStatus: linuxMismatchedServeStatus,
      backendUrl: "http://127.0.0.1:3000",
      allowMagicDnsFallback: false,
    }),
    {
      ok: false,
      reason: "tailscale serve route not found for http://127.0.0.1:3000",
    },
    "a stale Serve status for another loopback backend must not promote MagicDNS without mutation evidence",
  );
  assert.deepEqual(
    tailnetDiscoveryProof({
      selfStatus: self,
      serveStatus: linuxMismatchedServeStatus,
      backendUrl: "http://127.0.0.1:3000",
      allowMagicDnsFallback: true,
    }),
    {
      ok: true,
      host: "cave.tailnet.example.ts.net",
      serveUrl,
      source: "magicdns-self-status",
    },
    "after an acknowledged reclaim mutation, stale status-schema data cannot veto the recovered route",
  );
  assert.deepEqual(
    tailnetDiscoveryProof({
      selfStatus: self,
      serveStatus: { FutureSchema: { routes: [] } },
      backendUrl: "http://127.0.0.1:3000",
      allowMagicDnsFallback: true,
    }),
    {
      ok: true,
      host: "cave.tailnet.example.ts.net",
      serveUrl,
      source: "magicdns-self-status",
    },
    "an unknown future Serve status schema cannot veto an acknowledged successful mutation",
  );
  assert.deepEqual(
    nativeAppDiscoveryProof({
      selfStatus: { Self: { DNSName: "cave.tailnet.example.ts.net.", TailscaleIPs: ["100.101.102.103"] } },
      serveStatus: {},
      backendUrl: "http://127.0.0.1:3000",
      allowMagicDnsFallback: false,
    }),
    {
      ok: true,
      host: "100.101.102.103:3000",
      serveUrl: "http://100.101.102.103:3000/",
      source: "tailscale-ip-http",
    },
    "the explicit HTTP fallback must use the Tailscale IP even when MagicDNS exists",
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
  assert.match(
    route,
    /async function inspectServeOwnership\(backend: string\)/,
    "every mutation path shares one fail-closed Serve ownership inspection",
  );
  assert.equal(
    route.match(/await inspectServeOwnership\(backend\)/g)?.length,
    3,
    "app-start, GET/start, and reset inspect ownership before mutating Serve",
  );
  assert.match(
    route,
    /let serveStatus = ownership\.status;[\s\S]*?if \(ownership\.kind !== "owned"\)/,
    "an already-owned route reuses status without churning serve --bg",
  );
  assert.match(
    route,
    /serveRouteOwnedByBackend\(verified\.status, backend\)/,
    "claim success requires a post-mutation status snapshot that still points only at this backend",
  );
  assert.match(
    route,
    /async function resetOwnedServeRoute\(backend: string\)/,
    "app-stop and explicit reset share an ownership-aware reset",
  );
  assert.equal(
    route.match(/(?:return|await) resetOwnedServeRoute\(/g)?.length,
    2,
    "both destructive actions refuse to reset a route owned by another instance",
  );
  assert.doesNotMatch(
    route,
    /if \(action === "(?:reset|app-stop)"\) \{\s*const reset = await runTailscale\(\["serve", "reset"\]\)/,
    "no destructive action reaches serve reset without ownership proof",
  );
  assert.match(
    route,
    /return mobileUnavailableResponse\(detail, \{ backendUrl: backend, steps \}, 503\)/,
    "healthy ownership conflicts return the reconciler's unavailable breaker response",
  );

  const refresh = read("../app/api/mobile-token/refresh/route.ts");
  assert.match(refresh, /await recordMobileSeen\(\);/, "a successful token refresh records the paired-device beat");
  assert.match(
    refresh,
    /const PRIVATE_NO_STORE_HEADERS = \{\s*"Cache-Control": "private, no-store",?\s*\}/,
    "token refresh declares the private no-store response boundary",
  );
  assert.equal(
    refresh.match(/headers: PRIVATE_NO_STORE_HEADERS/g)?.length,
    2,
    "token refresh applies private no-store headers to success and failure responses",
  );

  const modal = read("../components/mobile-handoff-modal.tsx");
  assert.match(modal, /chatId \? \{ action: "app-start", chatId \} : \{ action: "app-start" \}/, "the modal forwards its chatId to app-start");
  assert.match(modal, /Scan to continue this conversation on your phone\./, "chat handoff says what the scan does");

  const sessionHeader = read("../components/chat-session-header.tsx");
  assert.match(sessionHeader, /cave:continue-on-phone[\s\S]*detail: \{ chatId: sessionId \}/, "chat overflow dispatches the continue-on-phone event with the session id");
  const menuModel = read("../lib/chat-session-menu-model.ts");
  assert.match(menuModel, /label: "Continue on phone"/, "the overflow menu model offers Continue on phone");

  const workspace = read("../components/workspace.tsx");
  assert.match(workspace, /addEventListener\("cave:continue-on-phone"/, "workspace listens for the handoff event");
  assert.match(workspace, /chatId=\{mobileHandoffChatId\}/, "workspace threads the chat id into the pairing modal");

  const settingsPhone = read("../components/settings-phone.tsx");
  assert.match(
    settingsPhone,
    /paired && handoff\?\.lastSeenAt[\s\S]*?`paired · last seen \$\{relativeTime\(new Date\(handoff\.lastSeenAt\)\.toISOString\(\)\)\}`/,
    "the Settings Phone card shows the paired-device beat",
  );
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

// ─── resolveIosInstallUrl (cave-jr4r.3, #3802) ────────────────────────────────
// Config-gated install link: only real Apple install destinations qualify,
// everything else — unset, junk, http, wrong host — resolves to null so the
// Phone card never shows an invented URL.
{
  assert.equal(resolveIosInstallUrl({}), null, "unset resolves to null");
  assert.equal(
    resolveIosInstallUrl({ COVEN_CAVE_IOS_INSTALL_URL: "   " }),
    null,
    "blank env resolves to null",
  );
  assert.equal(
    resolveIosInstallUrl({ COVEN_CAVE_IOS_INSTALL_URL: "not a url" }),
    null,
    "unparseable value resolves to null",
  );
  assert.equal(
    resolveIosInstallUrl({ COVEN_CAVE_IOS_INSTALL_URL: "http://testflight.apple.com/join/AbC123" }),
    null,
    "http is rejected — Apple install links are https",
  );
  assert.equal(
    resolveIosInstallUrl({ COVEN_CAVE_IOS_INSTALL_URL: "https://example.com/join/AbC123" }),
    null,
    "non-Apple hosts are rejected",
  );
  assert.equal(
    resolveIosInstallUrl({ COVEN_CAVE_IOS_INSTALL_URL: "https://testflight.apple.com/join/AbC123" }),
    "https://testflight.apple.com/join/AbC123",
    "a TestFlight public link resolves",
  );
  assert.equal(
    resolveIosInstallUrl({ COVEN_CAVE_IOS_INSTALL_URL: " https://apps.apple.com/app/id0000000000 " }),
    "https://apps.apple.com/app/id0000000000",
    "an App Store link resolves, trimmed",
  );
  // The checked-in default is still the O4 fill-in: null until the TestFlight
  // lane publishes a public link.
  assert.equal(OFFICIAL_IOS_INSTALL_URL, null, "no official link is baked in yet (O4 owns producing one)");
}
