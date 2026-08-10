import { createHash, randomUUID } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { sanitizeAboutDiagnosticText } from "../about-diagnostics.ts";

export const DAEMON_DIAGNOSTIC_CORRELATION_HEADER = "x-coven-correlation-id";
export const DAEMON_DIAGNOSTIC_MAX_EVENTS = 256;
const DAEMON_DIAGNOSTIC_MAX_NATIVE_BYTES = 256 * 1024;

export type DaemonDiagnosticContext = {
  correlationId: string;
  generation: number;
};

export type DaemonDiagnosticComponent = "tauri" | "sidecar" | "next" | "daemon" | "cli";
export type DaemonDiagnosticOutcome =
  | "started"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed-out"
  | "deferred";
export type DaemonDiagnosticEndpointKind =
  | "none"
  | "local-socket"
  | "loopback-http"
  | "hub-http"
  | "cli";

export type DaemonDiagnosticEvent = {
  schemaVersion: 1;
  eventId: string;
  correlationId: string;
  generation: number;
  timestamp: string;
  component: DaemonDiagnosticComponent;
  severity: "debug" | "info" | "warn" | "error";
  operation: string;
  phase: string;
  attempt: number;
  durationMs: number;
  outcome: DaemonDiagnosticOutcome;
  process: {
    pid: number | null;
    platformBirthId: string | null;
  };
  versions: Record<string, string>;
  endpoint: {
    kind: DaemonDiagnosticEndpointKind;
    classification: string;
    status: number | null;
  };
  error: {
    classification: string;
    code: string | null;
    message: string | null;
  } | null;
};

export type DaemonDiagnosticEventInput = {
  component: DaemonDiagnosticComponent;
  severity?: DaemonDiagnosticEvent["severity"];
  operation: string;
  phase: string;
  attempt?: number;
  durationMs?: number;
  outcome: DaemonDiagnosticOutcome;
  process?: {
    pid?: number | null;
    platformBirthId?: string | null;
  };
  versions?: Record<string, string | null | undefined>;
  endpoint?: {
    kind: DaemonDiagnosticEndpointKind;
    classification?: string;
    status?: number | null;
  };
  error?: {
    classification: string;
    code?: string | null;
    message?: string | null;
  } | null;
  timestamp?: string;
};

type DaemonDiagnosticStore = {
  nextGeneration: number;
  nextEvent: number;
  events: DaemonDiagnosticEvent[];
  seededNativeCorrelations: Set<string>;
};

const daemonDiagnosticGlobal = globalThis as typeof globalThis & {
  __covenDaemonDiagnosticStore?: DaemonDiagnosticStore;
};

function store(): DaemonDiagnosticStore {
  daemonDiagnosticGlobal.__covenDaemonDiagnosticStore ??= {
    nextGeneration: 1,
    nextEvent: 1,
    events: [],
    seededNativeCorrelations: new Set(),
  };
  return daemonDiagnosticGlobal.__covenDaemonDiagnosticStore;
}

function safeToken(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? "";
  return /^[a-z0-9][a-z0-9._:-]{0,63}$/i.test(trimmed) ? trimmed : fallback;
}

function safeCorrelationId(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return /^[0-9a-f]{32}$/i.test(trimmed)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}

function safeRequestCorrelationId(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(trimmed)
    ? trimmed
    : null;
}

function normalizedEventId(
  value: string | null | undefined,
  correlationId: string,
  generation: number,
): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed.startsWith(`${correlationId}:`) || trimmed.length > 512) return null;
  const digest = createHash("sha256").update(trimmed).digest("hex").slice(0, 16);
  return `${correlationId}:${generation}:${digest}`;
}

function safePositiveInteger(value: number | null | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function safeDuration(value: number | null | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(Number(value))) : 0;
}

function safeStatus(value: number | null | undefined): number | null {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 999
    ? Number(value)
    : null;
}

function safeTimestamp(value: string | null | undefined): string {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : new Date().toISOString();
}

function safeVersions(
  versions: Record<string, string | null | undefined> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(versions ?? {})
      .filter(([key, value]) => /^[a-z][a-z0-9.-]{0,31}$/i.test(key) && typeof value === "string")
      .map(([key, value]) => [key, sanitizeAboutDiagnosticText(value as string).slice(0, 64)])
      .filter(([, value]) => Boolean(value)),
  );
}

function safeDiagnosticMessage(value: string): string {
  return sanitizeAboutDiagnosticText(value)
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, "[network endpoint omitted]")
    .replace(/\blocalhost(?::\d{1,5})?\b/gi, "[network endpoint omitted]")
    .replace(/\[::1\](?::\d{1,5})?/g, "[network endpoint omitted]");
}

function safeError(input: DaemonDiagnosticEventInput["error"]): DaemonDiagnosticEvent["error"] {
  if (!input) return null;
  const code = input.code && /^[A-Z0-9_-]{1,32}$/i.test(input.code) ? input.code : null;
  const classification = safeToken(input.classification, "unknown");
  const message = classification === "transport-error"
    || classification === "socket-error"
    || classification === "os-error"
      ? null
      : input.message ? safeDiagnosticMessage(input.message) : null;
  return {
    classification,
    code,
    message,
  };
}

function isDiagnosticOutcome(value: unknown): value is DaemonDiagnosticOutcome {
  return value === "started"
    || value === "succeeded"
    || value === "failed"
    || value === "cancelled"
    || value === "timed-out"
    || value === "deferred";
}

function timestampFromUnixMs(value: number): string {
  return Number.isFinite(value) && value >= 0 && value <= 8.64e15
    ? new Date(value).toISOString()
    : new Date(0).toISOString();
}

function appendEvent(event: DaemonDiagnosticEvent): DaemonDiagnosticEvent {
  const diagnosticStore = store();
  diagnosticStore.events.push(event);
  if (diagnosticStore.events.length > DAEMON_DIAGNOSTIC_MAX_EVENTS) {
    diagnosticStore.events.splice(
      0,
      diagnosticStore.events.length - DAEMON_DIAGNOSTIC_MAX_EVENTS,
    );
  }
  return event;
}

export function createDaemonDiagnosticContext(input: {
  correlationId?: string | null;
  generation?: number | null;
} = {}): DaemonDiagnosticContext {
  const diagnosticStore = store();
  const generation = safePositiveInteger(
    input.generation,
    diagnosticStore.nextGeneration++,
  );
  diagnosticStore.nextGeneration = Math.max(
    diagnosticStore.nextGeneration,
    generation + 1,
  );
  return {
    correlationId: safeCorrelationId(input.correlationId) ?? randomUUID(),
    generation,
  };
}

export function daemonDiagnosticContextFromRequest(request: Request): DaemonDiagnosticContext {
  const nativeCorrelationId = safeCorrelationId(process.env.COVEN_CAVE_CORRELATION_ID);
  const requestedCorrelationId = safeRequestCorrelationId(
    request.headers.get(DAEMON_DIAGNOSTIC_CORRELATION_HEADER),
  );
  const matchingNativeCorrelationId =
    safeCorrelationId(request.headers.get(DAEMON_DIAGNOSTIC_CORRELATION_HEADER))?.toLowerCase() === nativeCorrelationId?.toLowerCase()
      ? nativeCorrelationId
      : null;
  return createDaemonDiagnosticContext({
    correlationId: requestedCorrelationId
      ?? matchingNativeCorrelationId
      ?? nativeCorrelationId,
  });
}

export function recordDaemonDiagnosticEvent(
  context: DaemonDiagnosticContext,
  input: DaemonDiagnosticEventInput,
): DaemonDiagnosticEvent {
  const diagnosticStore = store();
  return appendEvent({
    schemaVersion: 1,
    eventId: `${context.correlationId}:${context.generation}:${diagnosticStore.nextEvent++}`,
    correlationId: context.correlationId,
    generation: context.generation,
    timestamp: safeTimestamp(input.timestamp),
    component: input.component,
    severity: input.severity ?? (input.outcome === "failed" ? "error" : "info"),
    operation: safeToken(input.operation, "unknown"),
    phase: safeToken(input.phase, "unknown"),
    attempt: safePositiveInteger(input.attempt, 1),
    durationMs: safeDuration(input.durationMs),
    outcome: input.outcome,
    process: {
      pid: Number.isSafeInteger(input.process?.pid) && Number(input.process?.pid) > 0
        ? Number(input.process?.pid)
        : null,
      platformBirthId: input.process?.platformBirthId
        ? safeToken(input.process.platformBirthId, "unknown")
        : null,
    },
    versions: safeVersions(input.versions),
    endpoint: {
      kind: input.endpoint?.kind ?? "none",
      classification: safeToken(
        input.endpoint?.classification,
        input.endpoint?.kind ? "unknown" : "not-applicable",
      ),
      status: safeStatus(input.endpoint?.status),
    },
    error: safeError(input.error),
  });
}

export function diagnosticError(
  error: unknown,
  classification: string,
): NonNullable<DaemonDiagnosticEventInput["error"]> {
  const candidate = typeof error === "object" && error !== null
    ? error as NodeJS.ErrnoException
    : null;
  return {
    classification,
    code: typeof candidate?.code === "string" ? candidate.code : null,
    message: error instanceof Error ? error.message : typeof error === "string" ? error : null,
  };
}

export function seedNativeDaemonDiagnosticEvents(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const correlationId = safeCorrelationId(env.COVEN_CAVE_CORRELATION_ID);
  if (!correlationId) return;
  const diagnosticStore = store();
  if (diagnosticStore.seededNativeCorrelations.has(correlationId)) return;
  diagnosticStore.seededNativeCorrelations.add(correlationId);
  const context = createDaemonDiagnosticContext({
    correlationId,
    generation: Number(env.COVEN_CAVE_DIAGNOSTIC_GENERATION),
  });
  const common = {
    operation: safeToken(env.COVEN_CAVE_DIAGNOSTIC_OPERATION, "sidecar-startup"),
    attempt: Number(env.COVEN_CAVE_DIAGNOSTIC_ATTEMPT),
    versions: {
      cave: env.COVEN_CAVE_NATIVE_VERSION,
      protocol: env.COVEN_CAVE_NATIVE_PROTOCOL_VERSION,
      node: process.version,
    },
    endpoint: {
      kind: "loopback-http" as const,
      classification: "dedicated-sidecar",
    },
  };
  recordDaemonDiagnosticEvent(context, {
    ...common,
    component: "tauri",
    phase: "sidecar-handoff",
    outcome: "succeeded",
    process: { pid: process.ppid },
  });
  recordDaemonDiagnosticEvent(context, {
    ...common,
    component: "sidecar",
    phase: "process-boot",
    outcome: "started",
    process: { pid: process.pid },
  });
}

export function parseNativeDaemonDiagnosticEvents(raw: string): DaemonDiagnosticEvent[] {
  return raw
    .split(/\r?\n/)
    .flatMap((line): DaemonDiagnosticEvent[] => {
      if (!line.trim()) return [];
      let parsed: Record<string, unknown>;
      try {
        const value = JSON.parse(line);
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        parsed = value as Record<string, unknown>;
      } catch {
        return [];
      }
      const correlationId = safeCorrelationId(
        typeof parsed.correlationId === "string" ? parsed.correlationId : null,
      );
      const generation = safePositiveInteger(
        typeof parsed.generation === "number" ? parsed.generation : null,
        0,
      );
      const outcome = parsed.outcome;
      const eventId = normalizedEventId(
        typeof parsed.eventId === "string" ? parsed.eventId : null,
        correlationId ?? "",
        generation,
      );
      if (!correlationId || !generation || !eventId || !isDiagnosticOutcome(outcome)) return [];

      const processValue = parsed.process && typeof parsed.process === "object"
        ? parsed.process as Record<string, unknown>
        : {};
      const versionsValue = parsed.versions && typeof parsed.versions === "object"
        ? parsed.versions as Record<string, unknown>
        : {};
      const endpointValue = parsed.endpoint && typeof parsed.endpoint === "object"
        ? parsed.endpoint as Record<string, unknown>
        : {};
      const errorValue = parsed.error && typeof parsed.error === "object"
        ? parsed.error as Record<string, unknown>
        : null;
      const endpointKind = endpointValue.kind;
      const kind: DaemonDiagnosticEndpointKind =
        endpointKind === "local-socket"
        || endpointKind === "loopback-http"
        || endpointKind === "hub-http"
        || endpointKind === "cli"
          ? endpointKind
          : "none";
      const timestampUnixMs = typeof parsed.timestampUnixMs === "number"
        ? parsed.timestampUnixMs
        : Number(parsed.timestampUnixMs);

      return [{
        schemaVersion: 1,
        eventId,
        correlationId,
        generation,
        timestamp: timestampFromUnixMs(timestampUnixMs),
        component: "tauri",
        severity: outcome === "failed" ? "error" : "info",
        operation: safeToken(
          typeof parsed.operation === "string" ? parsed.operation : null,
          "unknown",
        ),
        phase: safeToken(typeof parsed.phase === "string" ? parsed.phase : null, "unknown"),
        attempt: safePositiveInteger(
          typeof parsed.attempt === "number" ? parsed.attempt : null,
          1,
        ),
        durationMs: safeDuration(
          typeof parsed.durationMs === "number" ? parsed.durationMs : null,
        ),
        outcome,
        process: {
          pid: Number.isSafeInteger(processValue.pid) && Number(processValue.pid) > 0
            ? Number(processValue.pid)
            : null,
          platformBirthId: typeof processValue.platformBirthId === "string"
            ? safeToken(processValue.platformBirthId, "unknown")
            : null,
        },
        versions: safeVersions(Object.fromEntries(
          Object.entries(versionsValue).map(([key, value]) => [
            key,
            typeof value === "string" ? value : null,
          ]),
        )),
        endpoint: {
          kind,
          classification: safeToken(
            typeof endpointValue.classification === "string"
              ? endpointValue.classification
              : null,
            "unknown",
          ),
          status: safeStatus(
            typeof endpointValue.status === "number" ? endpointValue.status : null,
          ),
        },
        error: errorValue
          ? safeError({
              classification: typeof errorValue.classification === "string"
                ? errorValue.classification
                : "unknown",
              code: typeof errorValue.code === "string" || typeof errorValue.code === "number"
                ? String(errorValue.code)
                : null,
              message: typeof errorValue.message === "string" ? errorValue.message : null,
            })
          : null,
      }];
    });
}

function readNativeDaemonDiagnosticEvents(
  env: NodeJS.ProcessEnv = process.env,
): DaemonDiagnosticEvent[] {
  const filePath = env.COVEN_CAVE_NATIVE_DIAGNOSTICS_FILE;
  if (!filePath) return [];
  let descriptor: number | null = null;
  try {
    descriptor = openSync(filePath, "r");
    const size = fstatSync(descriptor).size;
    const length = Math.min(size, DAEMON_DIAGNOSTIC_MAX_NATIVE_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(descriptor, buffer, 0, length, Math.max(0, size - length));
    return parseNativeDaemonDiagnosticEvents(buffer.toString("utf8"));
  } catch {
    return [];
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

export function listDaemonDiagnosticEvents(): DaemonDiagnosticEvent[] {
  seedNativeDaemonDiagnosticEvents();
  const eventsById = new Map<string, DaemonDiagnosticEvent>();
  for (const event of [...readNativeDaemonDiagnosticEvents(), ...store().events]) {
    eventsById.set(event.eventId, event);
  }
  return [...eventsById.values()]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .slice(-DAEMON_DIAGNOSTIC_MAX_EVENTS)
    .map((event) => structuredClone(event));
}

export function clearDaemonDiagnosticEventsForTests(): void {
  daemonDiagnosticGlobal.__covenDaemonDiagnosticStore = {
    nextGeneration: 1,
    nextEvent: 1,
    events: [],
    seededNativeCorrelations: new Set(),
  };
}

function sanitizeEventForExport(event: DaemonDiagnosticEvent): DaemonDiagnosticEvent {
  const correlationId = safeCorrelationId(event.correlationId) ?? "invalid-correlation";
  const generation = safePositiveInteger(event.generation, 1);
  const endpointKind = event.endpoint?.kind;
  const kind: DaemonDiagnosticEndpointKind =
    endpointKind === "local-socket"
    || endpointKind === "loopback-http"
    || endpointKind === "hub-http"
    || endpointKind === "cli"
      ? endpointKind
      : "none";
  return {
    schemaVersion: 1,
    eventId: normalizedEventId(event.eventId, correlationId, generation)
      ?? `${correlationId}:${generation}:redacted-event`,
    correlationId,
    generation,
    timestamp: safeTimestamp(event.timestamp),
    component: event.component === "tauri"
      || event.component === "sidecar"
      || event.component === "next"
      || event.component === "daemon"
      || event.component === "cli"
        ? event.component
        : "next",
    severity: event.severity === "debug"
      || event.severity === "info"
      || event.severity === "warn"
      || event.severity === "error"
        ? event.severity
        : "error",
    operation: safeToken(event.operation, "unknown"),
    phase: safeToken(event.phase, "unknown"),
    attempt: safePositiveInteger(event.attempt, 1),
    durationMs: safeDuration(event.durationMs),
    outcome: isDiagnosticOutcome(event.outcome) ? event.outcome : "failed",
    process: {
      pid: Number.isSafeInteger(event.process?.pid) && Number(event.process?.pid) > 0
        ? Number(event.process?.pid)
        : null,
      platformBirthId: event.process?.platformBirthId
        ? safeToken(event.process.platformBirthId, "unknown")
        : null,
    },
    versions: safeVersions(event.versions),
    endpoint: {
      kind,
      classification: safeToken(event.endpoint?.classification, "unknown"),
      status: safeStatus(event.endpoint?.status),
    },
    error: safeError(event.error),
  };
}

export function buildDaemonDiagnosticBundle(input: {
  events?: DaemonDiagnosticEvent[];
  generatedAt?: string;
  runtime?: {
    platform?: string | null;
    architecture?: string | null;
    nodeVersion?: string | null;
    caveVersion?: string | null;
  };
} = {}) {
  const events = (input.events ?? listDaemonDiagnosticEvents()).slice(
    -DAEMON_DIAGNOSTIC_MAX_EVENTS,
  ).map(sanitizeEventForExport);
  return {
    manifest: {
      schemaVersion: 1,
      kind: "coven-cave-daemon-diagnostics",
      generatedAt: safeTimestamp(input.generatedAt),
      retention: {
        scope: "current-sidecar-process",
        maxEvents: DAEMON_DIAGNOSTIC_MAX_EVENTS,
        includedEvents: events.length,
      },
      included: [
        "bounded daemon lifecycle events",
        "correlation and operation generations",
        "sanitized endpoint, version, duration, outcome, and OS error classifications",
      ],
      excluded: [
        "credentials and secret values",
        "URL query and fragment values",
        "personal and machine-local paths",
        "command lines, raw stdout and stderr, and conversation content",
        "unrelated environment variables",
        "opt-in telemetry",
      ],
      telemetry: {
        included: false,
        collectionEnabledByExport: false,
      },
    },
    runtime: {
      platform: safeToken(input.runtime?.platform, "unknown"),
      architecture: safeToken(input.runtime?.architecture, "unknown"),
      nodeVersion: input.runtime?.nodeVersion
        ? sanitizeAboutDiagnosticText(input.runtime.nodeVersion).slice(0, 64)
        : "unknown",
      caveVersion: input.runtime?.caveVersion
        ? sanitizeAboutDiagnosticText(input.runtime.caveVersion).slice(0, 64)
        : "unknown",
    },
    events,
  };
}
