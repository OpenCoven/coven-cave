// Release-only guard for the OpenCode compatibility registry. The public key
// is intentionally embedded in the desktop build (it verifies, never signs);
// the private Ed25519 key remains solely in the registry publishing service.
import { createPublicKey } from "node:crypto";

const url = process.env.NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_URL;
const publicKey = process.env.NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEY;
const publicKeys = process.env.NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEYS;
const checkpoint = process.env.NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_CHECKPOINT;

function fail(message) {
  console.error(`::error::${message}`);
  process.exitCode = 1;
}
let keyring;
try {
  keyring = publicKeys
    ? JSON.parse(publicKeys)
    : publicKey
      ? { legacy: publicKey }
      : null;
} catch {
  keyring = null;
}
if (!url || !keyring || typeof keyring !== "object" || Array.isArray(keyring) || !checkpoint) {
  fail("OpenCode compatibility registry URL, Ed25519 public key/keyring, and immutable sequence checkpoint must be configured for every desktop release.");
} else {
  try {
    const registryUrl = new URL(url);
    // This value is compiled into every desktop artifact. Reject URL userinfo
    // rather than accidentally distributing a publisher credential embedded
    // in an otherwise-valid HTTPS endpoint.
    if (registryUrl.protocol !== "https:" || registryUrl.username || registryUrl.password) {
      throw new Error("registry URL must use HTTPS without credentials");
    }
    const entries = Object.entries(keyring);
    if (!entries.length || entries.length > 4) throw new Error("registry keyring must contain one to four keys");
    for (const [id, pem] of entries) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id) || typeof pem !== "string") throw new Error("registry keyring has an invalid key id");
      if (createPublicKey(pem).asymmetricKeyType !== "ed25519") throw new Error("registry key must be Ed25519");
    }
    const parsedCheckpoint = JSON.parse(checkpoint);
    if (!parsedCheckpoint || typeof parsedCheckpoint !== "object" || Array.isArray(parsedCheckpoint)
      || Object.keys(parsedCheckpoint).length !== 2
      || !Number.isSafeInteger(parsedCheckpoint.sequence) || parsedCheckpoint.sequence < 1
      || typeof parsedCheckpoint.payloadHash !== "string" || !/^[a-f0-9]{64}$/.test(parsedCheckpoint.payloadHash)) {
      throw new Error("registry checkpoint must contain a sequence and SHA-256 payload hash");
    }
  } catch (error) {
    fail(`Invalid OpenCode compatibility registry configuration: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}
