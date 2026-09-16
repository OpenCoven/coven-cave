import { createPublicKey } from "node:crypto";

function parseKeyring(publicKey, publicKeys) {
  try {
    return publicKeys ? JSON.parse(publicKeys) : publicKey ? { legacy: publicKey } : null;
  } catch {
    return null;
  }
}

export function validateSignedRegistryConfig({ url, publicKey, publicKeys, checkpoint }) {
  const keyring = parseKeyring(publicKey, publicKeys);
  if (!url || !keyring || typeof keyring !== "object" || Array.isArray(keyring) || !checkpoint) {
    return { kind: "missing" };
  }

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) {
      throw new Error("registry URL must use HTTPS without credentials");
    }
    const entries = Object.entries(keyring);
    if (!entries.length || entries.length > 4) throw new Error("registry keyring must contain one to four keys");
    for (const [id, pem] of entries) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id) || typeof pem !== "string") {
        throw new Error("registry keyring has an invalid key id");
      }
      if (createPublicKey(pem).asymmetricKeyType !== "ed25519") throw new Error("registry key must be Ed25519");
    }
    const parsedCheckpoint = JSON.parse(checkpoint);
    if (
      !parsedCheckpoint ||
      typeof parsedCheckpoint !== "object" ||
      Array.isArray(parsedCheckpoint) ||
      Object.keys(parsedCheckpoint).length !== 2 ||
      !Number.isSafeInteger(parsedCheckpoint.sequence) ||
      parsedCheckpoint.sequence < 1 ||
      typeof parsedCheckpoint.payloadHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(parsedCheckpoint.payloadHash)
    ) {
      throw new Error("registry checkpoint must contain a sequence and SHA-256 payload hash");
    }
  } catch (error) {
    return { kind: "invalid", message: error instanceof Error ? error.message : "unknown error" };
  }

  return null;
}
