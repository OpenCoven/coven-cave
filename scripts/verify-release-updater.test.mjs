// Unit coverage for the updater verifier's signature math and option parsing.
//
// The verifier is what stands between a release and a dead in-app updater, and
// until cave-gcb0i nothing in CI ran it — so nothing checked that its minisign
// implementation was still correct either. These tests exercise the pure parts
// against keys generated here, so a regression in the ed25519/blake2b handling
// fails on a PR rather than on a shipped release nobody can update.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { TARGETS, parsePub, parseSig, readOption, verifySignature } from "./verify-release-updater.mjs";

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

test("TARGETS covers exactly the four Tauri updater platforms", () => {
  assert.deepEqual([...TARGETS].sort(), [
    "darwin-aarch64",
    "darwin-x86_64",
    "linux-x86_64",
    "windows-x86_64",
  ]);
});
