// Public verification material is embedded in a desktop release; this guard
// makes a missing trust anchor a release failure rather than an unsafe default.
import { validateSignedRegistryConfig } from "./signed-registry-config.mjs";

const error = validateSignedRegistryConfig({
  url: process.env.NEXT_PUBLIC_COVEN_GROK_SCHEMA_REGISTRY_URL,
  publicKey: process.env.NEXT_PUBLIC_COVEN_GROK_SCHEMA_REGISTRY_PUBLIC_KEY,
  publicKeys: process.env.NEXT_PUBLIC_COVEN_GROK_SCHEMA_REGISTRY_PUBLIC_KEYS,
  checkpoint: process.env.NEXT_PUBLIC_COVEN_GROK_SCHEMA_REGISTRY_CHECKPOINT,
});
if (error) {
  console.error(
    error.kind === "missing"
      ? "::error::Grok compatibility registry URL, Ed25519 public key/keyring, and immutable sequence checkpoint must be configured for every desktop release."
      : `::error::Invalid Grok compatibility registry configuration: ${error.message}`,
  );
  process.exitCode = 1;
}
