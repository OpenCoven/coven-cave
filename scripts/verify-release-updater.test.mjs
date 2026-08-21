// Unit coverage for the updater verifier's signature math and option parsing.
//
// The verifier is what stands between a release and a dead in-app updater, and
// until cave-gcb0i nothing in CI ran it — so nothing checked that its minisign
// implementation was still correct either. These tests exercise the pure parts
// against keys generated here, so a regression in the ed25519/blake2b handling
// fails on a PR rather than on a shipped release nobody can update.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FETCH_TIMEOUT_MS,
  TARGETS,
  fetchWithRetry,
  isDirectRun,
  parsePub,
  parseSig,
  readOption,
  verifySignature,
} from "./verify-release-updater.mjs";

const SCRIPT = fileURLToPath(new URL("./verify-release-updater.mjs", import.meta.url));

const runCli = (args) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", timeout: 60_000 });

// ── minisign fixtures ──────────────────────────────────────────────────
// A minisign key/signature file is two (or four) lines of text, and Tauri
// hands the whole file to us base64-encoded. Rebuild that shape byte for byte
// so the parsers are tested against the real format, not a convenient one.
const KEY_ID = Buffer.from("0123456789abcdef", "hex");

function makeKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { privateKey, rawPublic: raw };
}

function encodePublicKey(rawPublic, keyId = KEY_ID) {
  const body = Buffer.concat([Buffer.from("Ed", "utf8"), keyId, rawPublic]);
  const file = `untrusted comment: minisign public key\n${body.toString("base64")}\n`;
  return Buffer.from(file, "utf8").toString("base64");
}

function encodeSignature({ privateKey, artifact, algo, keyId = KEY_ID }) {
  const message = algo === "ED" ? crypto.createHash("blake2b512").update(artifact).digest() : artifact;
  const sig = crypto.sign(null, message, privateKey);
  const body = Buffer.concat([Buffer.from(algo, "utf8"), keyId, sig]);
  const file =
    `untrusted comment: signature from minisign secret key\n` +
    `${body.toString("base64")}\n` +
    `trusted comment: timestamp\n` +
    `${Buffer.alloc(64).toString("base64")}\n`;
  return Buffer.from(file, "utf8").toString("base64");
}

// ── option parsing ─────────────────────────────────────────────────────
test("readOption accepts both --name value and --name=value", () => {
  assert.equal(readOption(["--manifest", "latest.json"], "manifest"), "latest.json");
  assert.equal(readOption(["--manifest=latest.json"], "manifest"), "latest.json");
  assert.equal(readOption(["--tag", "v1.2.3", "--allow-partial"], "tag"), "v1.2.3");
});

test("readOption returns null for an absent or value-less flag", () => {
  assert.equal(readOption(["--allow-partial"], "manifest"), null);
  // A bare --manifest followed by another flag must not swallow that flag as
  // its value; otherwise `--manifest --allow-partial` would try to read a file
  // named "--allow-partial" and report a confusing ENOENT.
  assert.equal(readOption(["--manifest", "--allow-partial"], "manifest"), null);
  assert.equal(readOption([], "tag"), null);
});

// ── key / signature parsing ────────────────────────────────────────────
test("parsePub reads the key id and 32-byte public key from the last line", () => {
  const { rawPublic } = makeKeypair();
  const parsed = parsePub(encodePublicKey(rawPublic));
  assert.equal(parsed.keyId.toString("hex"), KEY_ID.toString("hex"));
  assert.equal(parsed.pub.length, 32);
  assert.ok(parsed.pub.equals(rawPublic));
});

test("parseSig reads the algorithm, key id and 64-byte signature from line two", () => {
  const { privateKey } = makeKeypair();
  const parsed = parseSig(encodeSignature({ privateKey, artifact: Buffer.from("payload"), algo: "ED" }));
  assert.equal(parsed.algo, "ED");
  assert.equal(parsed.keyId.toString("hex"), KEY_ID.toString("hex"));
  assert.equal(parsed.sig.length, 64);
});

// ── signature verification ─────────────────────────────────────────────
test("verifySignature accepts a prehashed ED signature", () => {
  const { privateKey, rawPublic } = makeKeypair();
  const artifact = crypto.randomBytes(4096);
  const result = verifySignature(artifact, encodePublicKey(rawPublic), encodeSignature({ privateKey, artifact, algo: "ED" }));
  assert.equal(result.ok, true);
  assert.equal(result.why, "prehashed");
});

test("verifySignature accepts a legacy Ed signature over the raw artifact", () => {
  const { privateKey, rawPublic } = makeKeypair();
  const artifact = crypto.randomBytes(1024);
  const result = verifySignature(artifact, encodePublicKey(rawPublic), encodeSignature({ privateKey, artifact, algo: "Ed" }));
  assert.equal(result.ok, true);
  assert.equal(result.why, "legacy");
});

test("verifySignature rejects an artifact that was modified after signing", () => {
  const { privateKey, rawPublic } = makeKeypair();
  const artifact = crypto.randomBytes(2048);
  const signature = encodeSignature({ privateKey, artifact, algo: "ED" });
  const tampered = Buffer.from(artifact);
  tampered[0] ^= 0xff;
  assert.equal(verifySignature(tampered, encodePublicKey(rawPublic), signature).ok, false);
});

test("verifySignature rejects a signature made by a different key", () => {
  // The release-shaped failure: the signing secret rotates but the pubkey in
  // src-tauri/tauri.conf.json does not. Every shipped client refuses the
  // update, so this must be caught before the manifest is published.
  const signer = makeKeypair();
  const pinned = makeKeypair();
  const artifact = crypto.randomBytes(512);
  const result = verifySignature(
    artifact,
    encodePublicKey(pinned.rawPublic),
    encodeSignature({ privateKey: signer.privateKey, artifact, algo: "ED" }),
  );
  assert.equal(result.ok, false);
});

test("verifySignature reports a key id mismatch before attempting the maths", () => {
  const { privateKey, rawPublic } = makeKeypair();
  const artifact = crypto.randomBytes(512);
  const result = verifySignature(
    artifact,
    encodePublicKey(rawPublic, Buffer.from("fedcba9876543210", "hex")),
    encodeSignature({ privateKey, artifact, algo: "ED" }),
  );
  assert.equal(result.ok, false);
  assert.match(result.why, /key id mismatch/);
});

// ── network robustness ─────────────────────────────────────────────────
// These fetches run after the artifacts are published but before latest.json
// is uploaded, so an unretried blip leaves a released build whose updater
// manifest never went up — the same outage the job exists to prevent.
const stubResponse = (status) => ({ status, ok: status >= 200 && status < 300 });

test("fetchWithRetry retries a 5xx and returns the eventual success", async () => {
  const seen = [];
  let calls = 0;
  const res = await fetchWithRetry("https://example.test/a", {
    fetchImpl: async () => { calls += 1; return stubResponse(calls < 3 ? 503 : 200); },
    sleep: async (ms) => { seen.push(ms); },
  });
  assert.equal(res.status, 200);
  assert.equal(calls, 3);
  assert.deepEqual(seen, [1000, 2000], "backoff doubles between attempts");
});

test("fetchWithRetry retries a transport error, then throws naming the url", async () => {
  let calls = 0;
  await assert.rejects(
    fetchWithRetry("https://example.test/b", {
      fetchImpl: async () => { calls += 1; throw new Error("ECONNRESET"); },
      sleep: async () => {},
    }),
    /https:\/\/example\.test\/b failed after 3 attempts: ECONNRESET/,
  );
  assert.equal(calls, 3);
});

test("fetchWithRetry does NOT retry a 4xx — a missing asset is an answer", async () => {
  let calls = 0;
  const res = await fetchWithRetry("https://example.test/c", {
    fetchImpl: async () => { calls += 1; return stubResponse(404); },
    sleep: async () => {},
  });
  assert.equal(res.status, 404);
  assert.equal(calls, 1, "a 404 must be reported, not retried");
});

test("fetchWithRetry DOES retry 429 — GitHub rate-limits these unauthenticated downloads", async () => {
  // Four release assets are pulled back to back with no credential. A 429 is
  // "ask again in a moment", not "the asset is missing"; treating it as final
  // fails the release and leaves latest.json unpublished — the very outage
  // this step exists to prevent.
  for (const status of [408, 425, 429]) {
    let calls = 0;
    const res = await fetchWithRetry("https://example.test/rl", {
      fetchImpl: async () => { calls += 1; return stubResponse(calls < 3 ? status : 200); },
      sleep: async () => {},
    });
    assert.equal(res.status, 200, `${status} must be retried`);
    assert.equal(calls, 3, `${status} must be retried`);
  }
});

test("fetchWithRetry honours a Retry-After header, capped so it cannot park the job", async () => {
  const withRetryAfter = (status, value) => ({
    ...stubResponse(status),
    headers: { get: (name) => (name === "retry-after" ? value : null) },
  });
  const backoffFor = async (value) => {
    const seen = [];
    let calls = 0;
    await fetchWithRetry("https://example.test/ra", {
      fetchImpl: async () => { calls += 1; return calls < 2 ? withRetryAfter(429, value) : stubResponse(200); },
      sleep: async (ms) => { seen.push(ms); },
    });
    return seen;
  };
  assert.deepEqual(await backoffFor("5"), [5000], "a sane Retry-After is obeyed");
  assert.deepEqual(await backoffFor("86400"), [60_000], "an absurd Retry-After is capped, not honoured");
  assert.deepEqual(await backoffFor("soon"), [1000], "an unparseable Retry-After falls back to the backoff");
});

test("fetchWithRetry reads the body INSIDE the retry, so a mid-transfer failure retries", async () => {
  // The artifact body is the whole risk on a 150MB installer: the handshake is
  // milliseconds. When the caller awaited arrayBuffer() after fetchWithRetry
  // returned, a stream that died mid-download threw outside the loop and got
  // zero retries — the retry covered the wrong half of the request.
  let calls = 0;
  const got = await fetchWithRetry("https://example.test/artifact", {
    fetchImpl: async () => {
      calls += 1;
      const failing = calls < 3;
      return {
        ...stubResponse(200),
        arrayBuffer: async () => {
          if (failing) throw new TypeError("terminated");
          return Uint8Array.from([1, 2, 3]).buffer;
        },
      };
    },
    sleep: async () => {},
    read: async (r) => Buffer.from(await r.arrayBuffer()),
  });
  assert.equal(calls, 3, "a body that dies mid-transfer must re-issue the whole GET");
  assert.deepEqual([...got.body], [1, 2, 3]);
  assert.equal(got.res.ok, true);
});

test("fetchWithRetry does not parse the body of a non-ok response", async () => {
  // A 404 page fed to verifySignature reports "signature INVALID", sending
  // whoever cut the release hunting a key rotation that never happened.
  let read = 0;
  const got = await fetchWithRetry("https://example.test/gone", {
    fetchImpl: async () => stubResponse(404),
    sleep: async () => {},
    read: async () => { read += 1; return "<html>Not Found</html>"; },
  });
  assert.equal(got.res.status, 404);
  assert.equal(got.body, null, "the caller must see the status, not an error page as a payload");
  assert.equal(read, 0);
});

test("every request carries an abort signal so none can hang the release job", async () => {
  let init = null;
  await fetchWithRetry("https://example.test/d", {
    method: "HEAD",
    fetchImpl: async (_url, got) => { init = got; return stubResponse(200); },
  });
  assert.ok(init.signal, "a bare fetch() has no timeout and hangs until the job is killed");
  assert.equal(init.method, "HEAD");
  assert.ok(FETCH_TIMEOUT_MS.head > 0 && FETCH_TIMEOUT_MS.get > FETCH_TIMEOUT_MS.head);
});

// ── the CLI actually runs ──────────────────────────────────────────────
// A signature gate that exits 0 without executing is worse than no gate: the
// release goes green having verified nothing. The first cut of this script
// did exactly that, because `import.meta.url === new URL(process.argv[1],
// "file:").href` is false on Windows, where argv[1] is a `C:\...` path. These
// tests spawn the real script so a silent no-op fails here instead of shipping.
test("isDirectRun recognises the script being executed, on POSIX and Windows paths", () => {
  assert.equal(isDirectRun(SCRIPT, new URL("./verify-release-updater.mjs", import.meta.url).href), true);
  assert.equal(isDirectRun(SCRIPT, new URL("./generate-latest-json.mjs", import.meta.url).href), false);
  assert.equal(isDirectRun("", import.meta.url), false);
  assert.equal(isDirectRun(undefined, import.meta.url), false);
  assert.equal(isDirectRun(SCRIPT, "not-a-url"), false, "a malformed module url is a non-match, not a throw");
});

test("the relative invocation the release workflow uses executes the gate", () => {
  // .github/workflows/release.yml runs `node scripts/verify-release-updater.mjs`
  // from the checkout root, not by absolute path. Every other assertion here
  // spawns the absolute path, so without this the exact form CI uses is the one
  // form nothing covers.
  const repoRoot = path.dirname(path.dirname(SCRIPT));
  const result = spawnSync(
    process.execPath,
    [path.join("scripts", "verify-release-updater.mjs"), "--manifest"],
    { cwd: repoRoot, encoding: "utf8", timeout: 60_000 },
  );
  assert.equal(result.status, 1, "the relative invocation must run and report usage, not exit 0 silently");
  assert.match(result.stdout, /given without a value/);
});

test("a symlinked entry point still runs the gate", () => {
  // Node realpaths the main module's URL but leaves argv[1] as the link path,
  // so a guard comparing them without realpath disagrees with itself on every
  // platform — and this script's failure mode for that is exit 0 having
  // verified no signature at all.
  const dir = mkdtempSync(path.join(tmpdir(), "verify-updater-link-"));
  const link = path.join(dir, "linked-verify-release-updater.mjs");
  try {
    symlinkSync(SCRIPT, link, "file");
  } catch {
    return; // unprivileged Windows cannot create symlinks
  }
  const result = spawnSync(process.execPath, [link, "--manifest"], { encoding: "utf8", timeout: 60_000 });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /given without a value/);
});

test("the CLI executes and fails an empty manifest even under --allow-partial", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "verify-updater-"));
  const manifest = path.join(dir, "latest.json");
  writeFileSync(manifest, JSON.stringify({ version: "9.9.9", pub_date: "2026-01-01T00:00:00Z", platforms: {} }));

  const result = runCli(["--manifest", manifest, "--tag", "v9.9.9", "--allow-partial"]);
  assert.ok(result.stdout.includes("=== RESULT:"), "the CLI must actually run and print a verdict");
  assert.match(result.stdout, /platforms\{\} is EMPTY/);
  assert.equal(result.status, 1, "an empty manifest must fail even with --allow-partial");
});

test("the CLI refuses a --manifest or --tag given without a value", () => {
  for (const args of [["--manifest"], ["--manifest="], ["--tag", "--allow-partial"]]) {
    const result = runCli(args);
    assert.equal(result.status, 1, `${args.join(" ")} must not fall through to the network path`);
    assert.match(result.stdout, /given without a value/);
  }
});

// ── the CLI's verdicts, end to end ─────────────────────────────────────
// Everything above stops at a usage error or at a pure function, and main()
// is where the promised verdicts actually live. Measured with mutations:
// replacing the drift comparison with a constant, forcing the signature
// verdict to `true`, or deleting either non-ok guard on the asset fetch each
// left this whole file green — the "exits 0 having verified nothing" state
// the header calls worse than no gate, reintroduced one line at a time.
//
// These drive the real CLI against a loopback origin standing in for the
// release assets (the manifest's url is whatever the manifest says it is, so
// no network is needed). The secret matching the pinned pubkey is not in this
// repo, so a VALID signature cannot be produced here — every pin below is a
// REJECTION, which is the half that has to keep working anyway.
const PINNED_PUBKEY = (() => {
  const conf = JSON.parse(
    readFileSync(fileURLToPath(new URL("../src-tauri/tauri.conf.json", import.meta.url)), "utf8"),
  );
  return (conf.plugins?.updater ?? conf.updater)?.pubkey;
})();

const manifestNaming = (port, { version = "9.9.9", signature = "unused" } = {}) => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "verify-updater-e2e-")), "latest.json");
  writeFileSync(file, JSON.stringify({
    version,
    pub_date: "2026-01-01T00:00:00Z",
    platforms: { "darwin-aarch64": { url: `http://127.0.0.1:${port}/app.tar.gz`, signature } },
  }));
  return file;
};

// spawnSync would deadlock here: it blocks this process's event loop, so the
// loopback server below never accepts the connection the child is waiting on
// and both sides sit there until the timeout. Every test that serves an asset
// must drive the CLI asynchronously.
const runCliAsync = (args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [SCRIPT, ...args]);
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.resume();
  const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
  child.on("error", (error) => { clearTimeout(timer); reject(error); });
  child.on("close", (status) => { clearTimeout(timer); resolve({ status, stdout }); });
});

async function servingAsset(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await run(server.address().port);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

const notFound = (_request, response) => { response.writeHead(404); response.end(); };

test("the CLI fails on version drift between the manifest and the tag being released", async () => {
  // The manifest names the version a client will be offered. If it disagrees
  // with the tag whose assets it points at, every install is told about an
  // update that is not what it downloads.
  await servingAsset(notFound, async (port) => {
    const result = await runCliAsync([
      "--manifest", manifestNaming(port, { version: "9.9.8" }),
      "--tag", "v9.9.9",
      "--allow-partial",
    ]);
    assert.match(result.stdout, /version drift: manifest=9\.9\.8 vs tag=v9\.9\.9/);
    assert.equal(result.status, 1, "a manifest naming a different version must never be published");
  });
});

test("a missing asset is reported as its HTTP status, never as an invalid signature", async () => {
  // Two shapes, because they clear different guards: the asset is simply gone,
  // and the HEAD probe succeeds while the download does not — the CDN redirect
  // that expires between the two requests. Feeding either error page to
  // verifySignature reports "signature INVALID" and sends whoever cut the
  // release hunting a key rotation that never happened.
  for (const [label, headStatus, expected] of [
    ["asset gone", 404, /darwin-aarch64: asset url HTTP 404/],
    ["gone between HEAD and GET", 200, /darwin-aarch64: asset download HTTP 404/],
  ]) {
    await servingAsset(
      (request, response) => {
        response.writeHead(request.method === "HEAD" ? headStatus : 404);
        response.end();
      },
      async (port) => {
        const result = await runCliAsync(["--manifest", manifestNaming(port), "--tag", "v9.9.9", "--allow-partial"]);
        assert.match(result.stdout, expected, label);
        assert.doesNotMatch(result.stdout, /signature INVALID/, `${label}: a 404 body is not a corrupt artifact`);
        assert.equal(result.status, 1, label);
      },
    );
  }
});

test("--allow-partial downgrades a missing platform; without it, a missing platform FAILS", async () => {
  // The flag is the whole difference between "this release ships 1 of 4
  // platforms" and a clean verdict, and every other CLI assertion in this file
  // passes it — so the fail-vs-warn branch itself had no coverage. Measured:
  // replacing `allowPartial ? warn : fail` with an unconditional `warn` left
  // the entire suite green, which makes the strict run this script documents
  // accept a release three platforms short of complete.
  await servingAsset(notFound, async (port) => {
    const manifest = manifestNaming(port); // names darwin-aarch64 and nothing else

    const strict = await runCliAsync(["--manifest", manifest, "--tag", "v9.9.9"]);
    assert.match(strict.stdout, /missing platform "darwin-x86_64"/, "an absent platform must be reported");
    assert.doesNotMatch(strict.stdout, /tolerated: --allow-partial/, "nothing is tolerated without the flag");
    assert.match(strict.stdout, /RESULT: 4 FAILURE\(S\)/, "three absent platforms plus the unreachable asset");
    assert.equal(strict.status, 1);

    const tolerated = await runCliAsync(["--manifest", manifest, "--tag", "v9.9.9", "--allow-partial"]);
    assert.match(tolerated.stdout, /missing platform "darwin-x86_64" \(tolerated: --allow-partial\)/);
    assert.match(
      tolerated.stdout,
      /RESULT: 1 FAILURE\(S\)/,
      "only the unreachable asset counts against a deliberately partial release",
    );
    assert.equal(tolerated.status, 1);
  });
});

test("an artifact that does not verify against the pinned pubkey fails the release", async () => {
  // The release-shaped failure this whole job exists for: the signing key
  // drifts from the pubkey pinned in src-tauri/tauri.conf.json, every
  // signature is well-formed, the platform count is green, and every
  // installed app rejects the update. Both halves of the check are pinned —
  // the key-id screen a rotation trips, and the ed25519 maths underneath it,
  // reached by borrowing the pinned key id so the screen cannot short-circuit.
  assert.ok(PINNED_PUBKEY, "src-tauri/tauri.conf.json must pin an updater pubkey for the gate to check against");
  const pinnedKeyId = parsePub(PINNED_PUBKEY).keyId;
  const rotatedKeyId = Buffer.from(pinnedKeyId);
  rotatedKeyId[0] ^= 0xff;

  for (const [label, keyId] of [["a rotated signing key", rotatedKeyId], ["the pinned key id", pinnedKeyId]]) {
    const { privateKey } = makeKeypair();
    const artifact = crypto.randomBytes(1024);
    const signature = encodeSignature({ privateKey, artifact, algo: "ED", keyId });
    await servingAsset(
      (request, response) => {
        response.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-length": String(artifact.length),
        });
        response.end(request.method === "HEAD" ? undefined : artifact);
      },
      async (port) => {
        const result = await runCliAsync([
          "--manifest", manifestNaming(port, { signature }),
          "--tag", "v9.9.9",
          "--allow-partial",
        ]);
        assert.match(result.stdout, /darwin-aarch64: signature INVALID/, label);
        assert.doesNotMatch(result.stdout, /signature VALID/, `${label}: the gate must not pass without looking`);
        assert.match(result.stdout, /RESULT: 1 FAILURE\(S\)/, `${label}: the signature is the only thing that failed`);
        assert.equal(result.status, 1, label);
      },
    );
  }
});

test("TARGETS covers exactly the four Tauri updater platforms", () => {
  assert.deepEqual([...TARGETS].sort(), [
    "darwin-aarch64",
    "darwin-x86_64",
    "linux-x86_64",
    "windows-x86_64",
  ]);
});
