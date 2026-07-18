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
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const TARGETS = ["darwin-aarch64", "darwin-x86_64", "linux-x86_64", "windows-x86_64"];
const allowPartial = process.argv.includes("--allow-partial");
let failures = 0;
let partialWarnings = 0;
const fail = (m) => { console.log("  ✗ " + m); failures++; };
const warn = (m) => { console.log("  ! " + m); partialWarnings++; };
const ok = (m) => console.log("  ✓ " + m);

// ── minisign verification (pure node) ──────────────────────────────────
const parsePub = (b64) => {
  const line2 = Buffer.from(b64, "base64").toString("utf8").trim().split("\n").pop().trim();
  const raw = Buffer.from(line2, "base64");                 // 2 + 8 + 32
  return { keyId: raw.subarray(2, 10), pub: raw.subarray(10, 42) };
};
const parseSig = (b64) => {
  const line2 = Buffer.from(b64, "base64").toString("utf8").trim().split("\n")[1].trim();
  const raw = Buffer.from(line2, "base64");                 // 2 + 8 + 64
  return { algo: raw.subarray(0, 2).toString(), keyId: raw.subarray(2, 10), sig: raw.subarray(10, 74) };
};
const ed25519Verify = (pub32, msg, sig64) => {
  const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), pub32]);
  const key = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
  return crypto.verify(null, msg, key, sig64);
};
const verifySignature = (artifact, pubB64, sigB64) => {
  const { pub, keyId: pkId } = parsePub(pubB64);
  const { algo, sig, keyId: sId } = parseSig(sigB64);
  if (!pkId.equals(sId)) return { ok: false, why: "key id mismatch (signed by a different key)" };
  const msg = algo === "ED" ? crypto.createHash("blake2b512").update(artifact).digest() : artifact;
  return { ok: ed25519Verify(pub, msg, sig), why: algo === "ED" ? "prehashed" : "legacy" };
};

// ── run ────────────────────────────────────────────────────────────────
const conf = JSON.parse(readFileSync(path.join(ROOT, "src-tauri/tauri.conf.json"), "utf8"));
const upd = conf.plugins?.updater ?? conf.updater;
const endpoint = upd?.endpoints?.[0];
const pubkey = upd?.pubkey;
const repo = (endpoint?.match(/github\.com\/([^/]+\/[^/]+?)(?:\/|$)/) || [])[1] || "OpenCoven/coven-cave";

console.log("=== config (src-tauri/tauri.conf.json) ===");
endpoint ? ok(`endpoint: ${endpoint}`) : fail("no updater endpoint configured");
pubkey ? ok(`pubkey present (key id ${parsePub(pubkey).keyId.toString("hex")})`) : fail("no pubkey configured");
if (!endpoint || !pubkey) { console.log("\n=== RESULT: FAIL (config) ==="); process.exit(1); }

console.log("\n=== 1. fetch latest.json from endpoint ===");
let manifest = null;
const res = await fetch(endpoint, { redirect: "follow" });
if (!res.ok) {
  fail(`endpoint returned HTTP ${res.status} — updater manifest is NOT published; in-app check() finds no update`);
} else {
  const text = await res.text();
  try { manifest = JSON.parse(text); ok("latest.json fetched + valid JSON"); }
  catch { fail("endpoint did not return valid JSON: " + text.slice(0, 80)); }
}

if (manifest) {
  console.log("\n=== 2. schema ===");
  manifest.version ? ok(`version: ${manifest.version}`) : fail("no version field");
  manifest.pub_date ? ok(`pub_date: ${manifest.pub_date}`) : fail("no pub_date");
  const plats = manifest.platforms || {};
  if (!Object.keys(plats).length) fail("platforms{} is EMPTY — no signed artifacts (updater non-functional)");
  for (const t of TARGETS) {
    const p = plats[t];
    if (!p) {
      (allowPartial ? warn : fail)(`missing platform "${t}"${allowPartial ? " (tolerated: --allow-partial)" : ""}`);
      continue;
    }
    if (p.url && p.signature) ok(`${t}: url + signature present`);
    else fail(`${t}: missing ${!p.url ? "url" : "signature"}`);
  }

  console.log("\n=== 3. version matches latest GitHub release ===");
  try {
    const ghTag = (await (await fetch(`https://api.github.com/repos/${repo}/releases/latest`,
      { headers: { "User-Agent": "verify-release-updater" } })).json()).tag_name;
    const want = (ghTag || "").replace(/^v/, "");
    manifest.version === want ? ok(`latest.json ${manifest.version} == release ${ghTag}`)
      : fail(`version drift: latest.json=${manifest.version} vs release=${ghTag}`);
  } catch (e) { fail("could not resolve latest GitHub release: " + e.message); }

  console.log("\n=== 4. per-platform asset + SIGNATURE verification ===");
  for (const t of TARGETS) {
    const p = (manifest.platforms || {})[t];
    if (!p?.url || !p?.signature) continue;
    const head = await fetch(p.url, { method: "HEAD", redirect: "follow" });
    if (!head.ok) { fail(`${t}: asset url HTTP ${head.status}`); continue; }
    const buf = Buffer.from(await (await fetch(p.url, { redirect: "follow" })).arrayBuffer());
    try {
      const v = verifySignature(buf, pubkey, p.signature);
      v.ok ? ok(`${t}: signature VALID (${v.why}, ${(buf.length / 1e6).toFixed(1)}MB)`)
           : fail(`${t}: signature INVALID — updater would REJECT this (${v.why})`);
    } catch (e) { fail(`${t}: signature check error — ${e.message}`); }
  }
}

const partialNote = partialWarnings ? ` (${partialWarnings} platform(s) tolerated by --allow-partial)` : "";
console.log(`\n=== RESULT: ${failures === 0 ? `PASS — updater chain verified end to end${partialNote}` : failures + " FAILURE(S)"} ===`);
process.exit(failures ? 1 : 0);
