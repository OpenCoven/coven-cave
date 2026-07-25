// Release-only guard for the OpenCode compatibility registry. The public key
// is intentionally embedded in the desktop build (it verifies, never signs);
// the private Ed25519 key remains solely in the registry publishing service.
import { createPublicKey } from "node:crypto";

const url = process.env.NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_URL;
const publicKey = process.env.NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEY;

function fail(message) {
  console.error(`::error::${message}`);
  process.exitCode = 1;
}
if (!url || !publicKey) {
  fail("OpenCode compatibility registry URL and Ed25519 public key must be configured for every desktop release.");
} else {
  try {
    if (new URL(url).protocol !== "https:") throw new Error("registry URL must use HTTPS");
    if (createPublicKey(publicKey).asymmetricKeyType !== "ed25519") throw new Error("registry key must be Ed25519");
  } catch (error) {
    fail(`Invalid OpenCode compatibility registry configuration: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}
