/**
 * Client-side contract for exporting the daemon diagnostics bundle (#6298,
 * slice 4). The bundle itself is built and redacted on the server by
 * `buildDaemonDiagnosticBundle`; this module only decides whether what came
 * back is that bundle, what to call the file, and how to serialize it. Pure
 * and DOM-free so the Settings control and its tests share one definition.
 */

export const DAEMON_DIAGNOSTICS_BUNDLE_KIND = "coven-cave-daemon-diagnostics";
export const DAEMON_DIAGNOSTICS_BUNDLE_SCHEMA_VERSION = 1;
export const DAEMON_DIAGNOSTICS_EXPORT_BASENAME = "coven-cave-daemon-diagnostics";

export type DaemonDiagnosticsBundle = {
  manifest: {
    schemaVersion: typeof DAEMON_DIAGNOSTICS_BUNDLE_SCHEMA_VERSION;
    kind: typeof DAEMON_DIAGNOSTICS_BUNDLE_KIND;
    generatedAt: string;
  };
  events: unknown[];
} & Record<string, unknown>;

export type DaemonDiagnosticsBundleRefusal =
  | "not-an-object"
  | "missing-manifest"
  | "unexpected-kind"
  | "unsupported-schema"
  | "invalid-generated-at"
  | "missing-events";

export type ParsedDaemonDiagnosticsBundle =
  | { ok: true; bundle: DaemonDiagnosticsBundle; generatedAt: string }
  | { ok: false; reason: DaemonDiagnosticsBundleRefusal };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Accept only the redacted bundle the route builds. An HTML error page, a
 * proxy's JSON error, or a future schema must not be written to disk under
 * the diagnostics filename, where it would be sent to support as if it were.
 */
export function parseDaemonDiagnosticsBundle(value: unknown): ParsedDaemonDiagnosticsBundle {
  if (!isRecord(value)) return { ok: false, reason: "not-an-object" };
  const manifest = value.manifest;
  if (!isRecord(manifest)) return { ok: false, reason: "missing-manifest" };
  if (manifest.kind !== DAEMON_DIAGNOSTICS_BUNDLE_KIND) return { ok: false, reason: "unexpected-kind" };
  if (manifest.schemaVersion !== DAEMON_DIAGNOSTICS_BUNDLE_SCHEMA_VERSION) {
    return { ok: false, reason: "unsupported-schema" };
  }
  const generatedAt = manifest.generatedAt;
  if (typeof generatedAt !== "string" || !Number.isFinite(Date.parse(generatedAt))) {
    return { ok: false, reason: "invalid-generated-at" };
  }
  if (!Array.isArray(value.events)) return { ok: false, reason: "missing-events" };
  return { ok: true, bundle: value as DaemonDiagnosticsBundle, generatedAt };
}

/**
 * `coven-cave-daemon-diagnostics-2026-10-27T14-05-09Z.json`: the generation
 * instant, second precision, with the colons and milliseconds that some
 * filesystems and mail clients reject removed. Falls back to the stable name
 * the route's content-disposition header advertises.
 */
export function daemonDiagnosticsExportFilename(generatedAt: string): string {
  const parsed = Date.parse(generatedAt);
  if (!Number.isFinite(parsed)) return `${DAEMON_DIAGNOSTICS_EXPORT_BASENAME}.json`;
  const stamp = new Date(parsed).toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
  return `${DAEMON_DIAGNOSTICS_EXPORT_BASENAME}-${stamp}.json`;
}

/** Indented so a person can read it before sending it, newline-terminated. */
export function serializeDaemonDiagnosticsBundle(bundle: DaemonDiagnosticsBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}
