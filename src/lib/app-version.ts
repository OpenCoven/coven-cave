import packageJson from "../../package.json";

export const APP_VERSION = packageJson.version;

/**
 * A release build bakes the exact source revision into both the web shell and
 * its packaged sidecar. It is deliberately public: it identifies an artifact,
 * not a person, path, token, or runtime configuration value.
 */
const requestedRevision = process.env.NEXT_PUBLIC_COVEN_CAVE_BUILD_REVISION?.trim() ?? "";
export const APP_BUILD_REVISION = /^[0-9a-f]{7,64}$/i.test(requestedRevision)
  ? requestedRevision.toLowerCase()
  : "development";
export const APP_BUILD_IDENTITY = `v${APP_VERSION}+${APP_BUILD_REVISION}`;
