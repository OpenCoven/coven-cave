#!/usr/bin/env node
// Real-release verification for the Tauri in-app updater.
//
//   node scripts/verify-release-updater.mjs
//
// Walks the live update chain a shipped desktop app actually follows, so you
// can confirm auto-update works AFTER cutting a release (CI green is not
// enough — the manifest + signatures must be published and verifiable):
//   1. read endpoint + pubkey from src-tauri/tauri.conf.json (source of truth)
//   2. fetch latest.json from the endpoint  → exists + valid JSON
//   3. schema: version, pub_date, platforms{} for the 4 Tauri targets (url+signature)
//   4. version matches the latest GitHub release tag
//   5. per platform: asset url resolves → download artifact + verify its minisign
//      signature against the configured pubkey (the gate the updater enforces)
//
// Pure Node — no minisign CLI: ed25519 over a blake2b512 prehash, per the
// minisign "ED" (prehashed) / "Ed" (legacy) formats Tauri emits.
//
// --allow-partial (cave-ef6f, CI use only): a missing PLATFORM downgrades to
// a warning — the updater-manifest job now publishes honest partial
// manifests when a build leg flakes, and CI verification of such a release
// must judge what shipped, not what didn't. An EMPTY manifest, an invalid
// signature, or version drift still fail either way.
//
// --manifest <path> (cave-gcb0i): verify a manifest already on disk instead of
// fetching the endpoint. The release pipeline needs this because it verifies
// the manifest it JUST generated, before that release is what
// /releases/latest/download/latest.json resolves to. Steps 3-5 are unchanged —
// the signatures are still checked against the configured pubkey, and the asset
// urls are still fetched from the release — so this is the same gate, just fed
// from the file rather than the endpoint.
//
// --tag <tag> (cave-gcb0i): compare the manifest version against this exact
// release tag rather than querying /releases/latest. Pairs with --manifest: a
// release still being published is not yet "latest", so asking GitHub for the
// latest tag would compare against the PREVIOUS release and report drift on
// every run.
import crypto from "node:crypto";
import fs, { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
export const TARGETS = ["darwin-aarch64", "darwin-x86_64", "linux-x86_64", "windows-x86_64"];
const allowPartial = process.argv.includes("--allow-partial");
let failures = 0;
let partialWarnings = 0;
const fail = (m) => { console.log("  ✗ " + m); failures++; };
const warn = (m) => { console.log("  ! " + m); partialWarnings++; };
const ok = (m) => console.log("  ✓ " + m);

// ── option parsing ─────────────────────────────────────────────────────
// Accepts both "--name value" and "--name=value". Returns null when absent so
// callers can distinguish "not requested" from an empty value.
export const readOption = (argv, name) => {
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return null;
  const value = argv[index + 1];
  return value === undefined || value.startsWith("--") ? null : value;
};

// ── network ────────────────────────────────────────────────────────────
// Every fetch here runs INSIDE the release job, after the artifacts are
// published but BEFORE latest.json is uploaded. A bare fetch() has no timeout,
// so one unresponsive connection hangs until GitHub kills the job — and a
// single transient blip fails the step, leaving a published release whose
// updater manifest never went up. That is exactly the "installs see no update"
// outage this job exists to prevent (cave-ef6f), arriving by a different road.
//
// So: bound every request, and retry the ones that can succeed on a second
// look. A 4xx is an answer — the asset really is missing — and is returned as
// is for the caller to report.
//
// `head` is the budget for every SMALL request: the HEAD probes plus the two
// metadata GETs (latest.json, the releases API). `get` is the artifact budget,
// and it is a TOTAL transfer bound rather than an idle one — Node aborts the
// response stream when the request's signal fires, so it covers the body read
// as well as the handshake. 20 minutes is ~1 MB/s on the largest installer this
// repo ships, i.e. generous for a runner pulling from GitHub's own CDN.
export const FETCH_TIMEOUT_MS = { head: 30_000, get: 20 * 60_000 };
const FETCH_ATTEMPTS = 3;
const RETRY_AFTER_CAP_MS = 60_000;

// The 4xx that mean "ask again" rather than "no". 429 matters most: these are
// UNAUTHENTICATED downloads of four release assets back to back, and GitHub
// rate-limits those. Returning a 429 as a final answer fails the release on a
// condition that clears in seconds — and worse, the 429 body would then be fed
// to verifySignature and misreported as an invalid signature.
const RETRYABLE_STATUS = new Set([408, 425, 429]);
const isRetryableStatus = (status) => status >= 500 || RETRYABLE_STATUS.has(status);

// Honour Retry-After when the server sends one, but cap it: an absurd value
// must not park the release job for hours.
const retryAfterMs = (res) => {
  const raw = res?.headers?.get?.("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS);
};

// `read` runs INSIDE the retry loop, and that placement is the point. Reading
// the body is part of the attempt: a stream that dies or times out mid-transfer
// throws from arrayBuffer()/text(), and when the caller did that read after
// fetchWithRetry returned, the throw landed OUTSIDE this loop and was never
// retried. For a ~150MB installer the handshake is milliseconds and the body is
// the entire risk, so the retry was covering the wrong half of the request. A
// retried GET does re-transfer from byte zero — there is no resume here — which
// is the price of bounding it to `attempts` tries.
//
// Returns the Response when no `read` is given, and `{ res, body }` when one
// is, so a non-ok response is still the caller's to report rather than being
// silently parsed.
export const fetchWithRetry = async (
  url,
  { method = "GET", attempts = FETCH_ATTEMPTS, timeoutMs, fetchImpl = fetch, sleep, read } = {},
) => {
  const budget = timeoutMs ?? (method === "HEAD" ? FETCH_TIMEOUT_MS.head : FETCH_TIMEOUT_MS.get);
  const pause = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let lastError = null;
  let lastRetryAfter = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetchImpl(url, {
        method,
        redirect: "follow",
        signal: AbortSignal.timeout(budget),
      });
      if (!isRetryableStatus(res.status)) {
        if (!read) return res;
        return { res, body: res.ok ? await read(res) : null };
      }
      lastError = new Error(`HTTP ${res.status}`);
      lastRetryAfter = retryAfterMs(res);
    } catch (e) {
      lastError = e;
      lastRetryAfter = null;
    }
    if (attempt < attempts) await pause(lastRetryAfter ?? 1000 * 2 ** (attempt - 1));
  }
  throw new Error(`${method} ${url} failed after ${attempts} attempts: ${lastError?.message ?? "unknown"}`);
};

// ── minisign verification (pure node) ──────────────────────────────────
export const parsePub = (b64) => {
  const line2 = Buffer.from(b64, "base64").toString("utf8").trim().split("\n").pop().trim();
  const raw = Buffer.from(line2, "base64");                 // 2 + 8 + 32
  return { keyId: raw.subarray(2, 10), pub: raw.subarray(10, 42) };
};
export const parseSig = (b64) => {
  const line2 = Buffer.from(b64, "base64").toString("utf8").trim().split("\n")[1].trim();
  const raw = Buffer.from(line2, "base64");                 // 2 + 8 + 64
  return { algo: raw.subarray(0, 2).toString(), keyId: raw.subarray(2, 10), sig: raw.subarray(10, 74) };
};
const ed25519Verify = (pub32, msg, sig64) => {
  const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), pub32]);
  const key = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
  return crypto.verify(null, msg, key, sig64);
};
export const verifySignature = (artifact, pubB64, sigB64) => {
  const { pub, keyId: pkId } = parsePub(pubB64);
  const { algo, sig, keyId: sId } = parseSig(sigB64);
  if (!pkId.equals(sId)) return { ok: false, why: "key id mismatch (signed by a different key)" };
  const msg = algo === "ED" ? crypto.createHash("blake2b512").update(artifact).digest() : artifact;
  return { ok: ed25519Verify(pub, msg, sig), why: algo === "ED" ? "prehashed" : "legacy" };
};

// ── run ────────────────────────────────────────────────────────────────
async function main() {
  // A flag that is present but carries no usable value must not fall through
  // to the network path — that would quietly verify a DIFFERENT release than
  // the caller named. Same failure class as the isDirectRun guard at the foot
  // of this file: silently doing something else is worse than stopping.
  for (const name of ["manifest", "tag"]) {
    if (process.argv.includes(`--${name}`) || process.argv.includes(`--${name}=`)) {
      if (!readOption(process.argv, name)) {
        console.log(`  ✗ --${name} was given without a value`);
        console.log("\n=== RESULT: FAIL (usage) ===");
        process.exit(1);
      }
    }
  }

  const manifestPath = readOption(process.argv, "manifest");
  const expectedTag = readOption(process.argv, "tag");

  const conf = JSON.parse(readFileSync(path.join(ROOT, "src-tauri/tauri.conf.json"), "utf8"));
  const upd = conf.plugins?.updater ?? conf.updater;
  const endpoint = upd?.endpoints?.[0];
  const pubkey = upd?.pubkey;
  const repo = (endpoint?.match(/github\.com\/([^/]+\/[^/]+?)(?:\/|$)/) || [])[1] || "OpenCoven/coven-cave";

  console.log("=== config (src-tauri/tauri.conf.json) ===");
  endpoint ? ok(`endpoint: ${endpoint}`) : fail("no updater endpoint configured");
  pubkey ? ok(`pubkey present (key id ${parsePub(pubkey).keyId.toString("hex")})`) : fail("no pubkey configured");
  if (!endpoint || !pubkey) { console.log("\n=== RESULT: FAIL (config) ==="); process.exit(1); }

  // A manifest must be a JSON OBJECT, and this is checked at the parse rather
  // than left to the `if (manifest)` below. `null`, `0`, `false` and `""` are
  // all valid JSON and all FALSY, so they skipped every remaining step without
  // incrementing `failures` — the script printed "PASS — updater chain verified
  // end to end" having verified no signature at all. That is the same
  // exit-0-without-looking state the isDirectRun guard at the foot of this file
  // exists to prevent, reached through the parser instead of the run guard. An
  // array is refused with them: platforms{} cannot live on one, and saying so
  // once beats reporting it as four unrelated missing fields.
  const asManifest = (parsed) => {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`expected a JSON object, got ${Array.isArray(parsed) ? "an array" : JSON.stringify(parsed)}`);
    }
    return parsed;
  };

  let manifest = null;
  if (manifestPath) {
    console.log(`\n=== 1. read manifest from disk (${manifestPath}) ===`);
    try {
      manifest = asManifest(JSON.parse(readFileSync(path.resolve(manifestPath), "utf8")));
      ok("manifest read + valid JSON");
    } catch (e) { fail(`could not read manifest: ${e.message}`); }
  } else {
    console.log("\n=== 1. fetch latest.json from endpoint ===");
    try {
      // latest.json is a few hundred bytes; give it the small-request budget
      // rather than the 20-minute artifact one, or a black-holed endpoint parks
      // this step for an hour across three attempts before reporting anything.
      const { res, body } = await fetchWithRetry(endpoint, {
        timeoutMs: FETCH_TIMEOUT_MS.head,
        read: (r) => r.text(),
      });
      if (!res.ok) {
        fail(`endpoint returned HTTP ${res.status} — updater manifest is NOT published; in-app check() finds no update`);
      } else {
        try { manifest = asManifest(JSON.parse(body)); ok("latest.json fetched + valid JSON"); }
        catch (e) { fail(`endpoint did not return a usable manifest (${e.message}): ${body.slice(0, 80)}`); }
      }
    } catch (e) { fail(e.message); }
  }

  if (manifest) {
    console.log("\n=== 2. schema ===");
    manifest.version ? ok(`version: ${manifest.version}`) : fail("no version field");
    manifest.pub_date ? ok(`pub_date: ${manifest.pub_date}`) : fail("no pub_date");
    // Count the RECOGNISED targets, not the raw key count. `Object.keys` was
    // the emptiness backstop, and it is satisfiable by keys this script never
    // looks at: `platforms: {"darwin-arm64": …}` (a plausible typo — node's
    // process.arch says `arm64` where Tauri says `aarch64`), `platforms: "abc"`
    // (keys "0","1","2") and `platforms: ["a"]` all report a non-zero length.
    // Under --allow-partial each of the four real targets then downgraded to a
    // warning, the per-platform loop below iterated ZERO times, and the script
    // printed "PASS — updater chain verified end to end" having verified no
    // signature at all. Measured on all three shapes: exit 0, PASS.
    //
    // That is the same class as the isDirectRun guard and the falsy-JSON parse
    // above — a check that appears to run but verifies nothing — reached here
    // through the one field --allow-partial is allowed to be lenient about. The
    // shape test travels with the count because a string and an array both pass
    // a bare length check; with both in place, PASS implies at least one target
    // carried a url + signature, which implies step 4 ran at least once.
    const raw = manifest.platforms;
    const plats = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    if (!TARGETS.some((t) => plats[t])) {
      fail("platforms{} is EMPTY of the four Tauri updater targets — no signed artifacts (updater non-functional)");
    }
    for (const t of TARGETS) {
      const p = plats[t];
      if (!p) {
        (allowPartial ? warn : fail)(`missing platform "${t}"${allowPartial ? " (tolerated: --allow-partial)" : ""}`);
        continue;
      }
      if (p.url && p.signature) ok(`${t}: url + signature present`);
      else fail(`${t}: missing ${!p.url ? "url" : "signature"}`);
    }

    if (expectedTag) {
      console.log("\n=== 3. version matches the release being published ===");
      const want = expectedTag.replace(/^v/, "");
      manifest.version === want ? ok(`manifest ${manifest.version} == tag ${expectedTag}`)
        : fail(`version drift: manifest=${manifest.version} vs tag=${expectedTag}`);
    } else {
      console.log("\n=== 3. version matches latest GitHub release ===");
      try {
        const { res, body } = await fetchWithRetry(
          `https://api.github.com/repos/${repo}/releases/latest`,
          { timeoutMs: FETCH_TIMEOUT_MS.head, read: (r) => r.json() },
        );
        if (!res.ok) throw new Error(`releases API returned HTTP ${res.status}`);
        const ghTag = body?.tag_name;
        const want = (ghTag || "").replace(/^v/, "");
        manifest.version === want ? ok(`latest.json ${manifest.version} == release ${ghTag}`)
          : fail(`version drift: latest.json=${manifest.version} vs release=${ghTag}`);
      } catch (e) { fail("could not resolve latest GitHub release: " + e.message); }
    }

    console.log("\n=== 4. per-platform asset + SIGNATURE verification ===");
    for (const t of TARGETS) {
      // Same normalised `plats` the schema step read, so the two loops cannot
      // disagree about what the manifest offers.
      const p = plats[t];
      if (!p?.url || !p?.signature) continue;
      try {
        const head = await fetchWithRetry(p.url, { method: "HEAD" });
        if (!head.ok) { fail(`${t}: asset url HTTP ${head.status}`); continue; }
        // Read the body inside the retry (see fetchWithRetry): a reset partway
        // through a 150MB download is the failure this step actually meets.
        const got = await fetchWithRetry(p.url, { read: async (r) => Buffer.from(await r.arrayBuffer()) });
        // An error page is not a corrupt artifact. Reporting a non-ok download
        // as "signature INVALID" would send whoever cut the release hunting a
        // key rotation that never happened.
        if (!got.res.ok) { fail(`${t}: asset download HTTP ${got.res.status}`); continue; }
        const buf = got.body;
        const v = verifySignature(buf, pubkey, p.signature);
        v.ok ? ok(`${t}: signature VALID (${v.why}, ${(buf.length / 1e6).toFixed(1)}MB)`)
             : fail(`${t}: signature INVALID — updater would REJECT this (${v.why})`);
      } catch (e) { fail(`${t}: signature check error — ${e.message}`); }
    }
  }

  const partialNote = partialWarnings ? ` (${partialWarnings} platform(s) tolerated by --allow-partial)` : "";
  console.log(`\n=== RESULT: ${failures === 0 ? `PASS — updater chain verified end to end${partialNote}` : failures + " FAILURE(S)"} ===`);
  process.exit(failures ? 1 : 0);
}

// Compare CANONICAL filesystem paths, NOT `import.meta.url` against
// `new URL(process.argv[1], "file:")`. That URL form is the idiom used
// elsewhere in scripts/, and it silently fails on Windows: argv[1] arrives as
// `C:\...\verify-release-updater.mjs`, which does not parse into the
// `file:///C:/...` href this module reports, so the comparison is false and
// main() never runs. The script then exits 0 having verified nothing — a
// signature gate that passes without looking, which is worse than no gate.
//
// realpathSync is what makes this identical to the guards in
// generate-latest-json.mjs and dev-app-origin-health.mjs, and it is not
// decoration: Node realpaths the main module's URL but leaves argv[1] as the
// link path, so a symlinked entry point disagrees with itself on EVERY
// platform and lands in exactly the exit-0-verified-nothing state above. The
// lowercase fold covers Windows drive-letter and 8.3 casing. A path that is
// not on disk falls back to the resolved form so the predicate stays usable in
// unit tests; a malformed module URL is a non-match rather than a throw.
const canonicalPath = (target) => {
  const resolved = path.resolve(target);
  let real = resolved;
  try { real = fs.realpathSync.native(resolved); } catch { /* not on disk */ }
  return process.platform === "win32" ? real.toLowerCase() : real;
};

export const isDirectRun = (argv1, moduleUrl) => {
  if (!argv1) return false;
  try { return canonicalPath(argv1) === canonicalPath(fileURLToPath(moduleUrl)); }
  catch { return false; }
};

if (isDirectRun(process.argv[1], import.meta.url)) {
  await main();
}
