// Release-only guard for the OpenCode compatibility registry. The public key
// is intentionally embedded in the desktop build (it verifies, never signs);
// the private Ed25519 key remains solely in the registry publishing service.
import { createPublicKey } from "node:crypto";

const url = process.env.NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_URL;
const publicKey = process.env.NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEY;
const publicKeys = process.env.NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEYS;

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
if (!url || !keyring || typeof keyring !== "object" || Array.isArray(keyring)) {
  fail("OpenCode compatibility registry URL and an Ed25519 public key or bounded keyring must be configured for every desktop release.");
} else {
  try {
    if (new URL(url).protocol !== "https:") throw new Error("registry URL must use HTTPS");
    const entries = Object.entries(keyring);
    if (!entries.length || entries.length > 4) throw new Error("registry keyring must contain one to four keys");
    for (const [id, pem] of entries) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id) || typeof pem !== "string") throw new Error("registry keyring has an invalid key id");
      if (createPublicKey(pem).asymmetricKeyType !== "ed25519") throw new Error("registry key must be Ed25519");
    }
  } catch (error) {
    fail(`Invalid OpenCode compatibility registry configuration: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}
