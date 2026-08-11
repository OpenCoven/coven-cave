// The X OAuth client ID is public, but a desktop release must never silently
// ship without its configured native app registration.
const clientId = process.env.COVEN_CAVE_X_PRODUCTION_CLIENT_ID?.trim() ?? "";
const validPublicClientId = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(clientId);
const xReleaseDisabled = process.env.COVEN_CAVE_X_RELEASE_DISABLED === "1";

if (xReleaseDisabled) {
  console.warn("::warning::Shipping with X integration disabled by an explicit manual release override.");
} else if (!validPublicClientId) {
  console.error("::error::COVEN_CAVE_X_PRODUCTION_CLIENT_ID must be configured with a valid OpenCoven X public client ID before creating a release.");
  process.exitCode = 1;
}
