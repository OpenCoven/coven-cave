export const CLIENT_V1_API_VERSION = "1.0";
export const CLIENT_V1_MIN_CLIENT_VERSION = "0.1.0";

export const CLIENT_V1_SCOPES = [
  "chat:read",
  "chat:write",
  "conversations:write",
  "attachments:write",
  "tasks:write",
  "github:write",
] as const;

export const CLIENT_V1_CAPABILITIES = [
  "pairing",
  "credentials",
  "familiars",
  "projects",
  "conversations",
  "conversation-messages",
  "streaming",
  "cursors",
  "revisions",
] as const;

export const CLIENT_V1_ERROR_CODES = [
  "invalid_request",
  "unauthorized",
  "scope_denied",
  "not_found",
  "conflict",
  "rate_limited",
  "pairing_pending",
  "pairing_denied",
  "pairing_expired",
  "incompatible_version",
  "service_unavailable",
  "reconcile_required",
  "internal_error",
] as const;

export const CLIENT_V1_IDENTITY_KINDS = [
  "client",
  "credential",
  "familiar",
  "project",
  "conversation",
  "message",
  "event",
] as const;

export const CLIENT_V1_LIMITS = {
  idempotencyKeyCharacters: 36,
  requestIdCharacters: 64,
  revisionTokenCharacters: 128,
  cursorCharacters: 512,
  errorMessageCharacters: 256,
  errorDetailEntries: 16,
  errorDetailValueCharacters: 256,
  defaultPageSize: 50,
  maxPageSize: 100,
} as const;

export type ClientV1Scope = (typeof CLIENT_V1_SCOPES)[number];
export type ClientV1Capability = (typeof CLIENT_V1_CAPABILITIES)[number];
export type ClientV1ErrorCode = (typeof CLIENT_V1_ERROR_CODES)[number];
export type ClientV1IdentityKind = (typeof CLIENT_V1_IDENTITY_KINDS)[number];

export type ClientV1Record = Record<string, unknown>;
export type ClientV1IdempotencyKey = string & {
  readonly __clientV1IdempotencyKey: unique symbol;
};

export type ClientV1Identity = {
  kind: ClientV1IdentityKind;
  id: string;
  displayName?: string;
} & ClientV1Record;

export type ClientV1Revision = {
  token: string;
  updatedAt: string;
} & ClientV1Record;

export type ClientV1Cursor = {
  current?: string;
  next?: string;
  previous?: string;
  hasMore: boolean;
} & ClientV1Record;

export type ClientV1EnvelopeBase = {
  apiVersion: typeof CLIENT_V1_API_VERSION;
  minimumClientVersion: typeof CLIENT_V1_MIN_CLIENT_VERSION;
  capabilities: ClientV1Capability[];
  requestId?: string;
  identity?: ClientV1Identity;
  revision?: ClientV1Revision;
  cursor?: ClientV1Cursor;
} & ClientV1Record;

export type ClientV1Error = {
  code: ClientV1ErrorCode;
  message: string;
  details?: Record<string, string>;
  retryable: boolean;
} & ClientV1Record;

export type ClientV1SuccessEnvelope<TData extends ClientV1Record = ClientV1Record> = ClientV1EnvelopeBase & {
  data: TData;
};

export type ClientV1ErrorEnvelope = ClientV1EnvelopeBase & {
  error: ClientV1Error;
};

export type ClientV1HealthResponse = ClientV1SuccessEnvelope<{
  status: "ok";
} & ClientV1Record>;

export type ClientV1CredentialResponse = ClientV1SuccessEnvelope<{
  label: string;
  scopes: ClientV1Scope[];
  expiresAt: string | null;
} & ClientV1Record>;

export type ClientV1FamiliarResponse = ClientV1SuccessEnvelope<{
  status: "ready" | "unavailable";
} & ClientV1Record>;

export type ClientV1ProjectResponse = ClientV1SuccessEnvelope<{
  name: string;
} & ClientV1Record>;

export type ClientV1ConversationSummary = {
  identity: ClientV1Identity;
  title: string;
  updatedAt: string;
  revision: ClientV1Revision;
} & ClientV1Record;

export type ClientV1ConversationMessage = {
  identity: ClientV1Identity;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  revision?: ClientV1Revision;
} & ClientV1Record;

export type ClientV1ConversationListResponse = ClientV1SuccessEnvelope<{
  conversations: ClientV1ConversationSummary[];
} & ClientV1Record>;

export type ClientV1ConversationDetailResponse = ClientV1SuccessEnvelope<{
  familiar: ClientV1Identity;
  title: string;
  messages: ClientV1ConversationMessage[];
} & ClientV1Record>;

export type ClientV1StreamEvent = {
  event: string;
  data: ClientV1Record;
  eventId?: string;
  identity?: ClientV1Identity;
  revision?: ClientV1Revision;
  cursor?: ClientV1Cursor;
} & ClientV1Record;

export type ClientV1ContractManifest = {
  apiVersion: typeof CLIENT_V1_API_VERSION;
  minimumClientVersion: typeof CLIENT_V1_MIN_CLIENT_VERSION;
  capabilities: ClientV1Capability[];
  pairingScopes: ClientV1Scope[];
  errorCodes: ClientV1ErrorCode[];
  limits: typeof CLIENT_V1_LIMITS;
};

export type ClientV1ContractFixture = {
  contract: ClientV1ContractManifest;
  examples: {
    health: ClientV1HealthResponse;
    error: ClientV1ErrorEnvelope;
    credential: ClientV1CredentialResponse;
    familiar: ClientV1FamiliarResponse;
    project: ClientV1ProjectResponse;
    conversationList: ClientV1ConversationListResponse;
    conversationDetail: ClientV1ConversationDetailResponse;
    streamEvent: ClientV1StreamEvent;
  };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLIENT_V1_SCOPE_SET = new Set<string>(CLIENT_V1_SCOPES);
const CLIENT_V1_CAPABILITY_SET = new Set<string>(CLIENT_V1_CAPABILITIES);
const CLIENT_V1_IDENTITY_KIND_SET = new Set<string>(CLIENT_V1_IDENTITY_KINDS);

function requiredRecord(value: unknown, name: string): ClientV1Record {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Client v1 ${name} must be an object.`);
  }
  return value as ClientV1Record;
}

function requiredString(value: unknown, name: string, maxLength?: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Client v1 ${name} must be a non-empty string.`);
  }
  if (maxLength !== undefined && value.length > maxLength) {
    throw new Error(`Client v1 ${name} must be at most ${maxLength} characters.`);
  }
  return value;
}

function requiredIsoTimestamp(value: unknown, name: string): string {
  const iso = requiredString(value, name);
  if (!Number.isFinite(Date.parse(iso))) {
    throw new Error(`Client v1 ${name} must be an ISO-8601 timestamp.`);
  }
  return iso;
}

function parseUniqueStringEnumList<T extends string>(
  value: unknown,
  name: string,
  supported: ReadonlySet<string>,
): T[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Client v1 ${name} must be a non-empty array.`);
  }
  const items: T[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string" || !supported.has(candidate)) {
      throw new Error(`Client v1 ${name} entry is not supported.`);
    }
    if (items.includes(candidate as T)) {
      throw new Error(`Client v1 ${name} must not contain duplicates.`);
    }
    items.push(candidate as T);
  }
  return items;
}

export function parseClientV1IdempotencyKey(value: unknown): ClientV1IdempotencyKey {
  if (typeof value !== "string" || value.length !== CLIENT_V1_LIMITS.idempotencyKeyCharacters || !UUID_RE.test(value)) {
    throw new Error("Client v1 idempotency key must be a UUID.");
  }
  return value as ClientV1IdempotencyKey;
}

export function parseClientV1PairingScopes(value: unknown): ClientV1Scope[] {
  return parseUniqueStringEnumList<ClientV1Scope>(value, "pairing scopes", CLIENT_V1_SCOPE_SET);
}

export function parseClientV1Capabilities(value: unknown): ClientV1Capability[] {
  return parseUniqueStringEnumList<ClientV1Capability>(value, "capabilities", CLIENT_V1_CAPABILITY_SET);
}

export function parseClientV1RequestId(value: unknown): string {
  return requiredString(value, "requestId", CLIENT_V1_LIMITS.requestIdCharacters);
}

export function parseClientV1Identity(value: unknown): ClientV1Identity {
  const identity = requiredRecord(value, "identity");
  if (typeof identity.kind !== "string" || !CLIENT_V1_IDENTITY_KIND_SET.has(identity.kind)) {
    throw new Error("Client v1 identity kind is not supported.");
  }
  requiredString(identity.id, "identity id");
  if (identity.displayName !== undefined) requiredString(identity.displayName, "identity displayName");
  return identity as ClientV1Identity;
}

export function parseClientV1Revision(value: unknown): ClientV1Revision {
  const revision = requiredRecord(value, "revision");
  requiredString(revision.token, "revision token", CLIENT_V1_LIMITS.revisionTokenCharacters);
  requiredIsoTimestamp(revision.updatedAt, "revision updatedAt");
  return revision as ClientV1Revision;
}

export function parseClientV1Cursor(value: unknown): ClientV1Cursor {
  const cursor = requiredRecord(value, "cursor");
  if (typeof cursor.hasMore !== "boolean") {
    throw new Error("Client v1 cursor hasMore must be a boolean.");
  }
  const current = cursor.current === undefined
    ? undefined
    : requiredString(cursor.current, "cursor current", CLIENT_V1_LIMITS.cursorCharacters);
  const next = cursor.next === undefined
    ? undefined
    : requiredString(cursor.next, "cursor next", CLIENT_V1_LIMITS.cursorCharacters);
  const previous = cursor.previous === undefined
    ? undefined
    : requiredString(cursor.previous, "cursor previous", CLIENT_V1_LIMITS.cursorCharacters);
  if (!current && !next && !previous) {
    throw new Error("Client v1 cursor must publish at least one current, next, or previous token.");
  }
  return {
    ...(current ? { current } : {}),
    ...(next ? { next } : {}),
    ...(previous ? { previous } : {}),
    hasMore: cursor.hasMore,
  };
}

export function parseClientV1ErrorDetails(value: unknown): Record<string, string> {
  const details = requiredRecord(value, "error details");
  const entries = Object.entries(details);
  if (entries.length > CLIENT_V1_LIMITS.errorDetailEntries) {
    throw new Error(
      `Client v1 error details must have at most ${CLIENT_V1_LIMITS.errorDetailEntries} entries.`,
    );
  }
  for (const [key, detail] of entries) {
    requiredString(key, "error detail key");
    requiredString(
      detail,
      `error detail "${key}"`,
      CLIENT_V1_LIMITS.errorDetailValueCharacters,
    );
  }
  return details as Record<string, string>;
}

export function sortClientV1JsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortClientV1JsonKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortClientV1JsonKeys((value as ClientV1Record)[key])]),
  );
}

function defaultCapabilities(): ClientV1Capability[] {
  return [...CLIENT_V1_CAPABILITIES];
}

function envelopeBase(
  overrides: Partial<Pick<ClientV1EnvelopeBase, "requestId" | "identity" | "revision" | "cursor" | "capabilities">> = {},
): ClientV1EnvelopeBase {
  return {
    apiVersion: CLIENT_V1_API_VERSION,
    minimumClientVersion: CLIENT_V1_MIN_CLIENT_VERSION,
    capabilities: overrides.capabilities ? [...overrides.capabilities] : defaultCapabilities(),
    ...(overrides.requestId ? { requestId: overrides.requestId } : {}),
    ...(overrides.identity ? { identity: { ...overrides.identity } } : {}),
    ...(overrides.revision ? { revision: { ...overrides.revision } } : {}),
    ...(overrides.cursor ? { cursor: { ...overrides.cursor } } : {}),
  };
}

export function createClientV1ContractFixture(): ClientV1ContractFixture {
  const credentialIdentity: ClientV1Identity = {
    kind: "credential",
    id: "credential-example",
    displayName: "Example companion",
  };
  const familiarIdentity: ClientV1Identity = {
    kind: "familiar",
    id: "familiar-example",
    displayName: "Lumen",
  };
  const projectIdentity: ClientV1Identity = {
    kind: "project",
    id: "project-example",
    displayName: "Example project",
  };
  const conversationIdentity: ClientV1Identity = {
    kind: "conversation",
    id: "conversation-example",
    displayName: "Example conversation",
  };
  const conversationRevision: ClientV1Revision = {
    token: "conversation-example-revision-1",
    updatedAt: "2026-08-15T00:00:01.000Z",
  };
  const conversationCursor: ClientV1Cursor = {
    current: "conversation-list:cursor:0",
    next: "conversation-list:cursor:1",
    hasMore: true,
  };
  const streamCursor: ClientV1Cursor = {
    current: "conversation-example:stream:1",
    next: "conversation-example:stream:2",
    hasMore: true,
  };

  return {
    contract: {
      apiVersion: CLIENT_V1_API_VERSION,
      minimumClientVersion: CLIENT_V1_MIN_CLIENT_VERSION,
      capabilities: defaultCapabilities(),
      pairingScopes: [...CLIENT_V1_SCOPES],
      errorCodes: [...CLIENT_V1_ERROR_CODES],
      limits: CLIENT_V1_LIMITS,
    },
    examples: {
      health: {
        ...envelopeBase({
          requestId: "request-example-health",
          capabilities: defaultCapabilities(),
        }),
        data: { status: "ok" },
      },
      error: {
        ...envelopeBase({
          requestId: "request-example-error",
          capabilities: defaultCapabilities(),
        }),
        error: {
          code: "reconcile_required",
          message: "Client state must be reconciled.",
          details: { reason: "resume_from_canonical_state" },
          retryable: true,
        },
      },
      credential: {
        ...envelopeBase({
          requestId: "request-example-credential",
          identity: credentialIdentity,
          revision: {
            token: "credential-example-revision-1",
            updatedAt: "2026-08-15T00:00:00.000Z",
          },
          capabilities: defaultCapabilities(),
        }),
        data: {
          label: "Example companion",
          scopes: [...CLIENT_V1_SCOPES],
          expiresAt: null,
        },
      },
      familiar: {
        ...envelopeBase({
          requestId: "request-example-familiar",
          identity: familiarIdentity,
          revision: {
            token: "familiar-example-revision-1",
            updatedAt: "2026-08-15T00:00:00.000Z",
          },
          capabilities: defaultCapabilities(),
        }),
        data: {
          status: "ready",
        },
      },
      project: {
        ...envelopeBase({
          requestId: "request-example-project",
          identity: projectIdentity,
          revision: {
            token: "project-example-revision-1",
            updatedAt: "2026-08-15T00:00:00.000Z",
          },
          capabilities: defaultCapabilities(),
        }),
        data: {
          name: "Example project",
        },
      },
      conversationList: {
        ...envelopeBase({
          requestId: "request-example-conversation-list",
          cursor: conversationCursor,
          capabilities: defaultCapabilities(),
        }),
        data: {
          conversations: [
            {
              identity: conversationIdentity,
              title: "Example conversation",
              updatedAt: "2026-08-15T00:00:01.000Z",
              revision: conversationRevision,
            },
          ],
        },
      },
      conversationDetail: {
        ...envelopeBase({
          requestId: "request-example-conversation-detail",
          identity: conversationIdentity,
          revision: conversationRevision,
          capabilities: defaultCapabilities(),
        }),
        data: {
          familiar: familiarIdentity,
          title: "Example conversation",
          messages: [
            {
              identity: {
                kind: "message",
                id: "message-example-user",
              },
              role: "user",
              content: "Hello",
              createdAt: "2026-08-15T00:00:00.000Z",
            },
            {
              identity: {
                kind: "message",
                id: "message-example-assistant",
              },
              role: "assistant",
              content: "Hello. How can I help?",
              createdAt: "2026-08-15T00:00:01.000Z",
              revision: {
                token: "message-example-assistant-revision-1",
                updatedAt: "2026-08-15T00:00:01.000Z",
              },
            },
          ],
        },
      },
      streamEvent: {
        event: "message.delta",
        eventId: "event-example",
        identity: {
          kind: "event",
          id: "event-example",
        },
        revision: {
          token: "conversation-example-stream-revision-1",
          updatedAt: "2026-08-15T00:00:01.000Z",
        },
        cursor: streamCursor,
        data: {
          conversationId: conversationIdentity.id,
          text: "Hello",
        },
      },
    },
  };
}

export function renderClientV1ContractFixture(): string {
  return `${JSON.stringify(sortClientV1JsonKeys(createClientV1ContractFixture()), null, 2)}\n`;
}
