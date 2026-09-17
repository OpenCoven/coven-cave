// OpenClaw's signed compatibility registry is optional for Cave releases.
//
// If no remote registry is configured, Cave ships with its built-in OpenClaw
// compatibility baseline and does not trust a remote registry. If an operator
// configures any part of the signed registry contract, the contract becomes
// fail-closed: URL, Ed25519 trust anchor/keyring, and immutable checkpoint must
// all be present and valid before the desktop release may proceed.
import { validateSignedRegistryConfig } from "./signed-registry-config.mjs";

const config = {
  url: process.env.NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_URL,
  publicKey: process.env.NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_PUBLIC_KEY,
  publicKeys: process.env.NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_PUBLIC_KEYS,
  checkpoint: process.env.NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_CHECKPOINT,
};

const configuredFields = Object.values(config).filter(
  (value) => typeof value === "string" && value.trim().length > 0,
).length;

if (configuredFields === 0) {
  console.log(
    "OpenClaw signed compatibility registry is not configured; shipping the built-in compatibility baseline only.",
  );
} else {
  const error = validateSignedRegistryConfig(config);
  if (error) {
    console.error(
      error.kind === "missing"
        ? "::error::OpenClaw compatibility registry configuration is partial. Configure the HTTPS registry URL, Ed25519 public key/keyring, and immutable sequence checkpoint together, or leave all OpenClaw registry settings unset."
        : `::error::Invalid OpenClaw compatibility registry configuration: ${error.message}`,
    );
    process.exitCode = 1;
  } else {
    console.log("Verified configured OpenClaw signed compatibility registry contract.");
  }
}
