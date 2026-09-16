// Release-only guard for the OpenCode compatibility registry. The public key
// is intentionally embedded in the desktop build (it verifies, never signs);
// the private Ed25519 key remains solely in the registry publishing service.
import { validateSignedRegistryConfig } from "./signed-registry-config.mjs";

const error = validateSignedRegistryConfig({
  url: process.env.NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_URL,
  publicKey: process.env.NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEY,
  publicKeys: process.env.NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEYS,
  checkpoint: process.env.NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_CHECKPOINT,
});
if (error) {
  console.error(
    error.kind === "missing"
      ? "::error::OpenCode compatibility registry URL, Ed25519 public key/keyring, and immutable sequence checkpoint must be configured for every desktop release."
      : `::error::Invalid OpenCode compatibility registry configuration: ${error.message}`,
  );
  process.exitCode = 1;
}
