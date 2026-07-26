// Public verification material is embedded in a desktop release; this guard
// makes a missing trust anchor a release failure rather than an unsafe default.
import { createPublicKey } from "node:crypto";

const url = process.env.NEXT_PUBLIC_COVEN_GROK_SCHEMA_REGISTRY_URL;
const publicKey = process.env.NEXT_PUBLIC_COVEN_GROK_SCHEMA_REGISTRY_PUBLIC_KEY;
const publicKeys = process.env.NEXT_PUBLIC_COVEN_GROK_SCHEMA_REGISTRY_PUBLIC_KEYS;
const checkpoint = process.env.NEXT_PUBLIC_COVEN_GROK_SCHEMA_REGISTRY_CHECKPOINT;
const fail = (message) => { console.error(`::error::${message}`); process.exitCode = 1; };
let keyring;
try { keyring = publicKeys ? JSON.parse(publicKeys) : publicKey ? { legacy: publicKey } : null; } catch { keyring = null; }
if (!url || !keyring || typeof keyring !== "object" || Array.isArray(keyring) || !checkpoint) {
  fail("Grok compatibility registry URL, Ed25519 public key/keyring, and immutable sequence checkpoint must be configured for every desktop release.");
} else {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) throw new Error("registry URL must use HTTPS without credentials");
    const entries = Object.entries(keyring);
    if (!entries.length || entries.length > 4) throw new Error("registry keyring must contain one to four keys");
    for (const [id, pem] of entries) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id) || typeof pem !== "string") throw new Error("registry keyring has an invalid key id");
      if (createPublicKey(pem).asymmetricKeyType !== "ed25519") throw new Error("registry key must be Ed25519");
    }
    const parsedCheckpoint = JSON.parse(checkpoint);
    if (!parsedCheckpoint || typeof parsedCheckpoint !== "object" || Array.isArray(parsedCheckpoint)
      || Object.keys(parsedCheckpoint).length !== 2 || !Number.isSafeInteger(parsedCheckpoint.sequence) || parsedCheckpoint.sequence < 1
      || typeof parsedCheckpoint.payloadHash !== "string" || !/^[a-f0-9]{64}$/.test(parsedCheckpoint.payloadHash)) throw new Error("registry checkpoint must contain a sequence and SHA-256 payload hash");
  } catch (error) { fail(`Invalid Grok compatibility registry configuration: ${error instanceof Error ? error.message : "unknown error"}`); }
}
