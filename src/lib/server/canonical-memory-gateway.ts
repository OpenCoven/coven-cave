import path from "node:path";

import { Type } from "typebox";
import { Value } from "typebox/value";

import { loadConfig } from "../cave-config.ts";
import {
  callDaemonTarget,
  daemonTargetForConfig,
  localDaemonTarget,
  type DaemonResponse,
} from "../coven-daemon.ts";
import type {
  CanonicalMemoryDetail,
  CanonicalMemoryDetailResponse,
  CanonicalMemoryErrorCode,
  CanonicalMemoryListResponse,
  CanonicalMemoryOverview,
  CanonicalMemoryOverviewResponse,
  CanonicalMemorySummary,
  CanonicalMemoryVerificationState,
} from "../canonical-memory.ts";

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_LIST_ENTRIES = 10_000;
const MAX_OVERVIEW_ISSUES = 1_000;
const MAX_ATTESTATION_FIELDS = 100;
const MAX_ATTESTATION_KEY_LENGTH = 256;
const MAX_TOTAL = 1_000_000;
const MAX_CONTENT_BYTES = 4 * 1024 * 1024;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const FALLBACK_SOURCE = {
  kind: "coven-origin",
  label: "Coven origin",
} as const;

const boundedString = (maxLength = 4_096) =>
  Type.String({ minLength: 1, maxLength });
const nullableBoundedString = (maxLength = 4_096) =>
  Type.Union([boundedString(maxLength), Type.Null()]);
const nullableBoolean = Type.Union([Type.Boolean(), Type.Null()]);
const nonNegativeInteger = Type.Integer({
  minimum: 0,
  maximum: MAX_TOTAL,
});
const wireVerificationState = Type.Union([
  Type.Literal("verified"),
  Type.Literal("needs_review"),
  Type.Literal("degraded"),
  Type.Literal("unknown"),
  Type.Literal("unavailable"),
]);

const sourceSchema = Type.Object(
  {
    kind: boundedString(128),
    label: boundedString(512),
  },
  { additionalProperties: false },
);

const currentListEntrySchema = Type.Object(
  {
    id: boundedString(64),
    familiar_id: boundedString(512),
    title: boundedString(1_024),
    path: boundedString(4_096),
    updated_at: boundedString(256),
    updated_at_iso: boundedString(128),
    excerpt: Type.String({ maxLength: 65_536 }),
    source: Type.Optional(sourceSchema),
    privacy_classification: nullableBoundedString(512),
    reveal_required: nullableBoolean,
    verification_state: wireVerificationState,
  },
  { additionalProperties: false },
);

const currentListSchema = Type.Array(currentListEntrySchema, {
  maxItems: MAX_LIST_ENTRIES,
});

const legacyListEntrySchema = Type.Object(
  {
    id: boundedString(512),
    familiar_id: boundedString(512),
    title: boundedString(1_024),
    path: boundedString(4_096),
    updated_at: boundedString(256),
    excerpt: Type.Optional(Type.String({ maxLength: 65_536 })),
    source_context: Type.Optional(Type.String({ maxLength: 4_096 })),
  },
  { additionalProperties: false },
);

const legacyListSchema = Type.Array(legacyListEntrySchema, {
  minItems: 1,
  maxItems: MAX_LIST_ENTRIES,
});

const overviewTotalsSchema = Type.Object(
  {
    entries: nonNegativeInteger,
    familiars: nonNegativeInteger,
    verified: nonNegativeInteger,
    needs_review: nonNegativeInteger,
    unknown: nonNegativeInteger,
  },
  { additionalProperties: false },
);

const capabilitiesSchema = Type.Object(
  {
    detail: Type.Boolean(),
    verification: Type.Boolean(),
    attestation_metadata: Type.Boolean(),
    supersession_history: Type.Boolean(),
    mutations: Type.Boolean(),
  },
  { additionalProperties: false },
);

const overviewVerificationSchema = Type.Object(
  {
    state: wireVerificationState,
    checked_at: boundedString(128),
    manifest: nullableBoundedString(),
    index: nullableBoundedString(),
    issues: Type.Array(Type.String({ maxLength: 4_096 }), {
      maxItems: MAX_OVERVIEW_ISSUES,
    }),
  },
  { additionalProperties: false },
);

const overviewSchema = Type.Object(
  {
    generated_at: boundedString(128),
    totals: overviewTotalsSchema,
    last_updated_at: Type.Union([boundedString(128), Type.Null()]),
    capabilities: capabilitiesSchema,
    verification: overviewVerificationSchema,
  },
  { additionalProperties: false },
);

const privacySchema = Type.Object(
  {
    classification: nullableBoundedString(512),
    reveal_required: nullableBoolean,
    reason: boundedString(),
  },
  { additionalProperties: false },
);

const detailVerificationSchema = Type.Object(
  {
    state: wireVerificationState,
    reason: boundedString(),
  },
  { additionalProperties: false },
);

const supersessionSchema = Type.Object(
  {
    supersedes: Type.Union([boundedString(64), Type.Null()]),
    superseded_by: Type.Union([boundedString(64), Type.Null()]),
  },
  { additionalProperties: false },
);

const attestationSchema = Type.Union([
  Type.Null(),
  Type.Record(
    Type.String({ minLength: 1, maxLength: MAX_ATTESTATION_KEY_LENGTH }),
    Type.Unknown(),
    {
      maxProperties: MAX_ATTESTATION_FIELDS,
    },
  ),
]);

const detailSchema = Type.Object(
  {
    id: boundedString(64),
    familiar_id: boundedString(512),
    title: boundedString(1_024),
    updated_at: boundedString(128),
    source: sourceSchema,
    content: Type.String({ maxLength: MAX_CONTENT_BYTES }),
    content_format: Type.Literal("markdown"),
    privacy: privacySchema,
    verification: detailVerificationSchema,
    attestation: attestationSchema,
    supersession: supersessionSchema,
  },
  { additionalProperties: false },
);

type WireSource = {
  kind: string;
  label: string;
};

type CurrentListEntry = {
  id: string;
  familiar_id: string;
  title: string;
  path: string;
  updated_at: string;
  updated_at_iso: string;
  excerpt: string;
  source?: WireSource;
  privacy_classification: string | null;
  reveal_required: boolean | null;
  verification_state: string;
};

type LegacyListEntry = {
  id: string;
  familiar_id: string;
  title: string;
  path: string;
  updated_at: string;
  excerpt?: string;
  source_context?: string;
};

type WireOverview = {
  generated_at: string;
  totals: {
    entries: number;
    familiars: number;
    verified: number;
    needs_review: number;
    unknown: number;
  };
  last_updated_at: string | null;
  capabilities: {
    detail: boolean;
    verification: boolean;
    attestation_metadata: boolean;
    supersession_history: boolean;
    mutations: boolean;
  };
  verification: {
    state: string;
    checked_at: string;
    manifest: string | null;
    index: string | null;
    issues: string[];
  };
};

type WireDetail = {
  id: string;
  familiar_id: string;
  title: string;
  updated_at: string;
  source: WireSource;
  content: string;
  content_format: "markdown";
  privacy: {
    classification: string | null;
    reveal_required: boolean | null;
    reason: string;
  };
  verification: {
    state: string;
    reason: string;
  };
  attestation: Record<string, unknown> | null;
  supersession: {
    supersedes: string | null;
    superseded_by: string | null;
  };
};

export type CanonicalMemoryGatewayDependencies = {
  loadConfig: typeof loadConfig;
  localTarget: typeof localDaemonTarget;
  selectedTarget: typeof daemonTargetForConfig;
  call: typeof callDaemonTarget;
};

function createCanonicalMemoryPolicySelector(
  hubTargetForConfig: typeof daemonTargetForConfig,
): typeof daemonTargetForConfig {
  return (config) => {
    if (config.multiHost.mode === "local") {
      // Policy-only structural result: requireSelectedLocal reads `mode` and
      // discards this. localTarget remains the sole real socket resolution.
      return { mode: "local", label: "Local daemon", socketPath: "" };
    }
    return hubTargetForConfig(config);
  };
}

const defaultSelectedTarget: typeof daemonTargetForConfig =
  createCanonicalMemoryPolicySelector(daemonTargetForConfig);

const DEFAULT_DEPENDENCIES: CanonicalMemoryGatewayDependencies = {
  loadConfig,
  localTarget: localDaemonTarget,
  selectedTarget: defaultSelectedTarget,
  call: callDaemonTarget,
};

const FAMILIAR_CANONICAL_MEMORY_CACHE_TTL_MS = 60_000;

/** Narrow test seam that exercises the selector actually wired by default. */
export function selectCanonicalMemoryDefaultTargetForTest(
  config: Parameters<typeof daemonTargetForConfig>[0],
): ReturnType<typeof daemonTargetForConfig> {
  return DEFAULT_DEPENDENCIES.selectedTarget(config);
}

export class CanonicalMemoryGatewayError extends Error {
  public readonly code: CanonicalMemoryErrorCode;
  public readonly status: number;

  constructor(code: CanonicalMemoryErrorCode, status: number) {
    super(code);
    this.name = "CanonicalMemoryGatewayError";
    this.code = code;
    this.status = status;
  }
}

function gatewayError(
  code: CanonicalMemoryErrorCode,
  status: number,
): CanonicalMemoryGatewayError {
  return new CanonicalMemoryGatewayError(code, status);
}

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function isIsoTimestamp(value: string): boolean {
  const match = ISO_TIMESTAMP_RE.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= lastDay;
}

function isContainedRelativePath(value: string): boolean {
  if (
    value.includes("\0") ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value)
  ) {
    return false;
  }
  const segments = value.split("/");
  return (
    segments.length > 0 &&
    segments.every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    ) &&
    path.posix.normalize(value) === value
  );
}

function normalizedVerificationState(
  state: string,
): CanonicalMemoryVerificationState {
  return state === "needs_review"
    ? "needs-review"
    : (state as CanonicalMemoryVerificationState);
}

function currentListSemanticsValid(entries: CurrentListEntry[]): boolean {
  return entries.every(
    (entry) =>
      isUuid(entry.id) &&
      isIsoTimestamp(entry.updated_at_iso) &&
      isContainedRelativePath(entry.path),
  );
}

function legacyListSemanticsValid(entries: LegacyListEntry[]): boolean {
  return entries.every((entry) => isContainedRelativePath(entry.path));
}

function overviewSemanticsValid(overview: WireOverview): boolean {
  const { totals } = overview;
  return (
    isIsoTimestamp(overview.generated_at) &&
    isIsoTimestamp(overview.verification.checked_at) &&
    (overview.last_updated_at === null ||
      isIsoTimestamp(overview.last_updated_at)) &&
    totals.familiars <= totals.entries &&
    totals.verified + totals.needs_review + totals.unknown === totals.entries &&
    (totals.entries === 0) === (overview.last_updated_at === null)
  );
}

function detailSemanticsValid(detail: WireDetail, requestedId: string): boolean {
  const attestationKeys =
    detail.attestation === null ? [] : Object.keys(detail.attestation);
  return (
    isUuid(detail.id) &&
    detail.id.toLowerCase() === requestedId.toLowerCase() &&
    isIsoTimestamp(detail.updated_at) &&
    Buffer.byteLength(detail.content, "utf8") <= MAX_CONTENT_BYTES &&
    (detail.supersession.supersedes === null ||
      isUuid(detail.supersession.supersedes)) &&
    (detail.supersession.superseded_by === null ||
      isUuid(detail.supersession.superseded_by)) &&
    attestationKeys.length <= MAX_ATTESTATION_FIELDS &&
    attestationKeys.every(
      (key) => key.length > 0 && key.length <= MAX_ATTESTATION_KEY_LENGTH,
    )
  );
}

async function requireSelectedLocal(
  dependencies: CanonicalMemoryGatewayDependencies,
): Promise<void> {
  let selectedMode: ReturnType<typeof daemonTargetForConfig>["mode"];
  try {
    const config = await dependencies.loadConfig();
    selectedMode = dependencies.selectedTarget(config).mode;
  } catch {
    throw gatewayError("canonical_memory_unavailable", 503);
  }
  if (selectedMode !== "local") {
    throw gatewayError("local_daemon_required", 409);
  }
}

async function callLocal(
  path: string,
  dependencies: CanonicalMemoryGatewayDependencies,
): Promise<DaemonResponse<unknown>> {
  try {
    const target = dependencies.localTarget();
    return await dependencies.call<unknown>(target, {
      method: "GET",
      path,
      maxResponseBytes: MAX_RESPONSE_BYTES,
    });
  } catch {
    throw gatewayError("canonical_memory_unavailable", 503);
  }
}

function requireSuccessfulResponse(
  response: DaemonResponse<unknown>,
  kind: "list" | "overview" | "detail",
): unknown {
  if (
    response?.error === "malformed response" ||
    response?.error === "daemon response exceeded size limit"
  ) {
    throw gatewayError("invalid_daemon_payload", 502);
  }
  if (!response || response.ok !== true) {
    if (kind === "overview" && response?.status === 404) {
      throw gatewayError("daemon_update_required", 426);
    }
    if (kind === "detail" && response?.status === 404) {
      throw gatewayError("memory_not_found", 404);
    }
    throw gatewayError("canonical_memory_unavailable", 503);
  }
  return response.data;
}

export async function canonicalMemoryList(
  dependencies: CanonicalMemoryGatewayDependencies = DEFAULT_DEPENDENCIES,
): Promise<CanonicalMemorySummary[]> {
  await requireSelectedLocal(dependencies);
  const payload = requireSuccessfulResponse(
    await callLocal("/api/v1/memory", dependencies),
    "list",
  );

  if (Value.Check(currentListSchema, payload)) {
    const entries = payload as CurrentListEntry[];
    if (!currentListSemanticsValid(entries)) {
      throw gatewayError("invalid_daemon_payload", 502);
    }
    return entries.map((entry) => ({
      id: entry.id,
      familiarId: entry.familiar_id,
      title: entry.title,
      updatedAt: entry.updated_at_iso,
      relativeUpdatedAt: entry.updated_at,
      excerpt: entry.excerpt,
      source: entry.source ?? FALLBACK_SOURCE,
      privacy: {
        classification: entry.privacy_classification,
        revealRequired: entry.reveal_required,
      },
      verification: {
        state: normalizedVerificationState(entry.verification_state),
      },
    }));
  }

  if (Value.Check(legacyListSchema, payload)) {
    const entries = payload as LegacyListEntry[];
    if (!legacyListSemanticsValid(entries)) {
      throw gatewayError("invalid_daemon_payload", 502);
    }
    throw gatewayError("daemon_update_required", 426);
  }

  throw gatewayError("invalid_daemon_payload", 502);
}

type FamiliarCanonicalMemoryCache = {
  load: (
    familiarId: string,
    dependencies?: CanonicalMemoryGatewayDependencies,
  ) => Promise<CanonicalMemorySummary[]>;
  invalidate: () => void;
};

type FamiliarCanonicalMemoryCacheOptions = {
  ttlMs?: number;
  now?: () => number;
  loadList?: (
    dependencies?: CanonicalMemoryGatewayDependencies,
  ) => Promise<CanonicalMemorySummary[]>;
};

function indexCanonicalMemorySummariesByFamiliar(
  entries: CanonicalMemorySummary[],
): Map<string, CanonicalMemorySummary[]> {
  const index = new Map<string, CanonicalMemorySummary[]>();
  for (const entry of entries) {
    const familiarEntries = index.get(entry.familiarId);
    if (familiarEntries) {
      familiarEntries.push(entry);
      continue;
    }
    index.set(entry.familiarId, [entry]);
  }
  return index;
}

export function createFamiliarCanonicalMemoryCache(
  options: FamiliarCanonicalMemoryCacheOptions = {},
): FamiliarCanonicalMemoryCache {
  const ttlMs = options.ttlMs ?? FAMILIAR_CANONICAL_MEMORY_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  const loadList = options.loadList ?? canonicalMemoryList;
  let cachedIndex: Map<string, CanonicalMemorySummary[]> | null = null;
  let expiresAt = 0;
  let generation = 0;
  let inFlight:
    | {
        generation: number;
        promise: Promise<Map<string, CanonicalMemorySummary[]>>;
      }
    | null = null;

  async function loadIndex(
    dependencies: CanonicalMemoryGatewayDependencies,
  ): Promise<Map<string, CanonicalMemorySummary[]>> {
    if (cachedIndex !== null && now() < expiresAt) {
      return cachedIndex;
    }
    if (inFlight && inFlight.generation === generation) {
      return inFlight.promise;
    }
    const inFlightGeneration = generation;
    const promise = loadList(dependencies)
      .then((entries) => {
        const indexed = indexCanonicalMemorySummariesByFamiliar(entries);
        if (generation === inFlightGeneration) {
          cachedIndex = indexed;
          expiresAt = now() + ttlMs;
        }
        return indexed;
      })
      .finally(() => {
        if (inFlight?.promise === promise) {
          inFlight = null;
        }
      });
    inFlight = { generation: inFlightGeneration, promise };
    return promise;
  }

  return {
    async load(
      familiarId,
      dependencies = DEFAULT_DEPENDENCIES,
    ): Promise<CanonicalMemorySummary[]> {
      const index = await loadIndex(dependencies);
      return [...(index.get(familiarId) ?? [])];
    },
    invalidate() {
      generation += 1;
      cachedIndex = null;
      expiresAt = 0;
      inFlight = null;
    },
  };
}

const familiarCanonicalMemoryCache = createFamiliarCanonicalMemoryCache();

export async function loadCachedCanonicalMemorySummariesForFamiliar(
  familiarId: string,
  dependencies: CanonicalMemoryGatewayDependencies = DEFAULT_DEPENDENCIES,
): Promise<CanonicalMemorySummary[]> {
  return familiarCanonicalMemoryCache.load(familiarId, dependencies);
}

export function invalidateCachedCanonicalMemorySummariesForTest(): void {
  familiarCanonicalMemoryCache.invalidate();
}

export async function canonicalMemoryOverview(
  dependencies: CanonicalMemoryGatewayDependencies = DEFAULT_DEPENDENCIES,
): Promise<CanonicalMemoryOverview> {
  await requireSelectedLocal(dependencies);
  const payload = requireSuccessfulResponse(
    await callLocal("/api/v1/memory/overview", dependencies),
    "overview",
  );
  if (!Value.Check(overviewSchema, payload)) {
    throw gatewayError("invalid_daemon_payload", 502);
  }
  const overview = payload as WireOverview;
  if (!overviewSemanticsValid(overview)) {
    throw gatewayError("invalid_daemon_payload", 502);
  }
  return {
    generatedAt: overview.generated_at,
    totals: {
      entries: overview.totals.entries,
      familiars: overview.totals.familiars,
      verified: overview.totals.verified,
      needsReview: overview.totals.needs_review,
      unknown: overview.totals.unknown,
    },
    lastUpdatedAt: overview.last_updated_at,
    capabilities: {
      detail: overview.capabilities.detail,
      verification: overview.capabilities.verification,
      attestationMetadata: overview.capabilities.attestation_metadata,
      supersessionHistory: overview.capabilities.supersession_history,
      mutations: overview.capabilities.mutations,
    },
    verification: {
      state: normalizedVerificationState(overview.verification.state),
      checkedAt: overview.verification.checked_at,
      manifest: overview.verification.manifest,
      index: overview.verification.index,
      issues: [...overview.verification.issues],
    },
  };
}

export async function canonicalMemoryDetail(
  id: string,
  dependencies: CanonicalMemoryGatewayDependencies = DEFAULT_DEPENDENCIES,
): Promise<CanonicalMemoryDetail> {
  await requireSelectedLocal(dependencies);
  if (!isUuid(id)) {
    throw gatewayError("invalid_memory_id", 400);
  }
  const validatedId = id.toLowerCase();
  const payload = requireSuccessfulResponse(
    await callLocal(`/api/v1/memory/${validatedId}`, dependencies),
    "detail",
  );
  if (!Value.Check(detailSchema, payload)) {
    throw gatewayError("invalid_daemon_payload", 502);
  }
  const detail = payload as WireDetail;
  if (!detailSemanticsValid(detail, validatedId)) {
    throw gatewayError("invalid_daemon_payload", 502);
  }
  return {
    id: detail.id,
    familiarId: detail.familiar_id,
    title: detail.title,
    updatedAt: detail.updated_at,
    source: detail.source,
    content: detail.content,
    contentFormat: detail.content_format,
    privacy: {
      classification: detail.privacy.classification,
      revealRequired: detail.privacy.reveal_required,
      reason: detail.privacy.reason,
    },
    verification: {
      state: normalizedVerificationState(detail.verification.state),
      reason: detail.verification.reason,
    },
    attestationMetadata:
      detail.attestation === null
        ? null
        : { fieldCount: Object.keys(detail.attestation).length },
    supersession: {
      supersedes: detail.supersession.supersedes,
      supersededBy: detail.supersession.superseded_by,
    },
  };
}

export function canonicalMemoryJson(
  body:
    | CanonicalMemoryListResponse
    | CanonicalMemoryOverviewResponse
    | CanonicalMemoryDetailResponse,
  status = 200,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}

export function canonicalMemoryMethodNotAllowed(): Response {
  return Response.json(
    { ok: false, code: "method_not_allowed" },
    {
      status: 405,
      headers: {
        Allow: "GET",
        "Cache-Control": "private, no-store",
      },
    },
  );
}

function canonicalMemoryErrorResponse(error: unknown): Response {
  if (error instanceof CanonicalMemoryGatewayError) {
    return canonicalMemoryJson(
      { ok: false, code: error.code },
      error.status,
    );
  }
  return canonicalMemoryJson(
    { ok: false, code: "canonical_memory_unavailable" },
    503,
  );
}

export async function canonicalMemoryListResponse(): Promise<Response> {
  try {
    return canonicalMemoryJson({
      ok: true,
      entries: await canonicalMemoryList(),
    });
  } catch (error) {
    return canonicalMemoryErrorResponse(error);
  }
}

export async function canonicalMemoryOverviewResponse(): Promise<Response> {
  try {
    return canonicalMemoryJson({
      ok: true,
      overview: await canonicalMemoryOverview(),
    });
  } catch (error) {
    return canonicalMemoryErrorResponse(error);
  }
}

export async function canonicalMemoryDetailResponse(
  id: string,
): Promise<Response> {
  try {
    return canonicalMemoryJson({
      ok: true,
      entry: await canonicalMemoryDetail(id),
    });
  } catch (error) {
    return canonicalMemoryErrorResponse(error);
  }
}
