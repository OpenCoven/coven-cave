// Cave-private Context Pack contracts (Unit 1, cave-6sles.10).
//
// Client-safe (no node:fs, no fetch). Mirrors the A1 hand-written parser
// style: version-pinned objects, strict allowlists, detached outputs. The
// portable pack object itself lives in the research-protocol module; this
// module owns the Cave-side inputs (selection, redaction map, build
// receipt, preview) and the mapping/derivation helpers the builder and
// store share.

import {
  fail,
  isRecord,
  isSha256,
  isUtcTimestamp,
  pass,
  type ProtocolParseResult,
  type UnknownFields,
} from "./research-protocol/common.ts";
import {
  parseContextSelectorV1,
  type ContextSelectorV1,
} from "./research-protocol/context-pack.ts";
import { canonicalJson, sha256Digest } from "./research-protocol/digest.ts";
import {
  type ResourceKindV1,
  type ResourceManifestV1,
  type ResourceSensitivityV1,
} from "./research-resource-contracts.ts";

// ── Literal vocabularies (portable module keeps these private) ──────────────

const CONTEXT_PACK_RESOURCE_KINDS = [
  "session",
  "thread-self-report",
  "mission",
  "artifact",
  "attachment",
  "saved-resource",
  "metric-snapshot",
] as const;

const CONTEXT_PACK_RESOURCE_TRUST_LEVELS = [
  "user-authored",
  "agent-output",
  "mixed-conversation",
  "model-derived",
  "imported-source",
] as const;

const CONTEXT_PACK_PURPOSES = ["topic-discovery", "research-run"] as const;
const CONTEXT_PACK_RETENTIONS = ["run-only", "7-days", "project"] as const;

export type ContextPackResourceKindV1 = (typeof CONTEXT_PACK_RESOURCE_KINDS)[number];
export type ContextPackResourceTrustV1 = (typeof CONTEXT_PACK_RESOURCE_TRUST_LEVELS)[number];

// ── Selection input (API/UI → builder) ─────────────────────────────────────

export type ContextPackSelectionResourceV1 = {
  resourceId: string; // LOCAL manifest id, e.g. "saved-link-…"
  snapshotId: string; // MUST equal manifest.currentSnapshotId
  sourceSelector: ContextSelectorV1; // original selector over the snapshot
};

export type ContextPackSelectionV1 = {
  version: 1;
  purpose: (typeof CONTEXT_PACK_PURPOSES)[number];
  familiarId: string; // non-empty; mirrors ContextPackSubjectV1.familiarId
  projectId?: string;
  consent: {
    selectionMode: "explicit"; // Unit 1 only
    allowRemoteQueries: false; // Unit 1 pins false (no cloud path)
    allowRemoteContent: false;
    artifactContentSync: false;
    retention: (typeof CONTEXT_PACK_RETENTIONS)[number];
  };
  resources: ContextPackSelectionResourceV1[];
} & UnknownFields;

// ── Redaction map (Cave-private sidecar) ───────────────────────────────────

export type ContextPackRedactionDecisionV1 = {
  resourceId: string; // local manifest id
  selector: { type: "text-span"; start: number; end: number } & UnknownFields;
  category: string; // bounded identifier, e.g. "api-key", "email"
  replacement: string; // replacement text (may be "")
} & UnknownFields;

export type ContextPackRedactionMapV1 = {
  version: 1;
  secretScanVersion: string; // literal shipped version
  decisions: ContextPackRedactionDecisionV1[];
} & UnknownFields;

// ── Build receipt (Cave-private audit sidecar) ─────────────────────────────

export type ContextPackBuildReceiptResourceV1 = {
  packResourceId: string; // portable resource_… id (pack-scoped)
  sourceResourceId: string; // LOCAL manifest id
  snapshotId: string;
  sourceSelector: ContextSelectorV1; // original selector (audit only)
  sourceRevision: number; // manifest.revision at seal time
  sourceNormalizedBlobDigest: string; // snapshot.normalizedBlobDigest at seal time
};

export type ContextPackBuildReceiptV1 = {
  version: 1;
  packId: string; // portable ctx_… id
  createdAt: string; // UTC RFC 3339
  resources: ContextPackBuildReceiptResourceV1[];
} & UnknownFields;

// ── Preview (returned to UI before sealing; no blobs copied yet) ───────────

export type ContextPackResourcePreviewV1 = {
  resourceId: string;
  title?: string;
  kind: ContextPackResourceKindV1;
  sensitivity: ResourceSensitivityV1;
  mediaType: string;
  bytes: number;
  sourceSelector: ContextSelectorV1;
  findings: Array<{
    category: string;
    selector: ContextSelectorV1;
    excerpt: string;
  }>;
};

export type ContextPackPreviewV1 = {
  version: 1;
  resources: ContextPackResourcePreviewV1[];
  totalBytes: number;
  requiresConfirmation: boolean; // true when any selected resource is private/restricted
};

// ── Mapping tables + id derivation (pure functions) ────────────────────────

// Resource layer kind -> portable Context Pack kind.
export const RESOURCE_KIND_TO_CONTEXT_PACK_KIND: Record<
  ResourceKindV1,
  ContextPackResourceKindV1
> = {
  "saved-resource": "saved-resource",
  paper: "saved-resource", // papers are saved resources in portable terms
  attachment: "attachment",
  "mission-artifact": "artifact",
  session: "session",
  "thread-self-report": "thread-self-report",
  "local-file": "attachment",
};

// Trust level for a source manifest (Unit 1 default; override is a review
// decision).
export function contextPackTrustForManifest(
  manifest: ResourceManifestV1,
): ContextPackResourceTrustV1 {
  if (manifest.legacySavedLink || manifest.sourceType === "saved-link") {
    return "imported-source";
  }
  if (manifest.kind === "local-file" || manifest.kind === "attachment") {
    return "user-authored";
  }
  return "model-derived"; // conservative default for anything not explicitly user-authored
}

// Stable portable resource id, unique per (pack, source, selector).
export function contextPackResourceId(
  packId: string,
  sourceResourceId: string,
  sourceSelector: ContextSelectorV1,
): string {
  return `resource_${sha256Digest(
    canonicalJson([packId, sourceResourceId, sourceSelector]),
  ).slice(0, 40)}`;
}

// ── Parsers ────────────────────────────────────────────────────────────────

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function childPath(path: string, key: string): string {
  return `${path}.${key}`;
}

function parseText(value: unknown, path: string, label: string, maxChars: number): ProtocolParseResult<string> {
  if (typeof value !== "string" || value.length === 0 || value.length > maxChars) {
    return fail("invalid_value", path, `${label} must be a 1..=${maxChars} character string`);
  }
  return pass(value);
}

function parseBoundedIdentifier(value: unknown, path: string, label: string, maxChars: number): ProtocolParseResult<string> {
  if (typeof value !== "string" || value.length === 0 || value.length > maxChars) {
    return fail("invalid_value", path, `${label} must be a 1..=${maxChars} character string`);
  }
  return pass(value);
}

export function parseContextPackSelectionV1(value: unknown): ProtocolParseResult<ContextPackSelectionV1> {
  if (!isRecord(value)) return fail("invalid_type", "selection", "Expected an object");
  if (value.version !== 1) return fail("unknown_major", "selection.version", "version must be 1");
  if (
    typeof value.purpose !== "string" ||
    !CONTEXT_PACK_PURPOSES.includes(value.purpose as never)
  ) {
    return fail("invalid_value", "selection.purpose", "purpose must be topic-discovery or research-run");
  }
  const familiarId = parseBoundedIdentifier(value.familiarId, "selection.familiarId", "familiarId", 64);
  if (!familiarId.ok) return familiarId;
  if (value.projectId !== undefined) {
    const projectId = parseBoundedIdentifier(value.projectId, "selection.projectId", "projectId", 256);
    if (!projectId.ok) return projectId;
  }
  if (!isRecord(value.consent)) {
    return fail("invalid_type", "selection.consent", "Expected an object");
  }
  const consent = value.consent;
  if (consent.selectionMode !== "explicit") {
    return fail("invalid_value", "selection.consent.selectionMode", "Unit 1 supports selectionMode 'explicit' only");
  }
  if (consent.allowRemoteQueries !== false || consent.allowRemoteContent !== false || consent.artifactContentSync !== false) {
    return fail("invalid_value", "selection.consent", "Unit 1 pins remote/content/artifact consent to false");
  }
  if (
    typeof consent.retention !== "string" ||
    !CONTEXT_PACK_RETENTIONS.includes(consent.retention as never)
  ) {
    return fail("invalid_value", "selection.consent.retention", "retention must be run-only, 7-days, or project");
  }
  if (!Array.isArray(value.resources)) {
    return fail("invalid_type", "selection.resources", "Expected an array");
  }
  const resources: ContextPackSelectionResourceV1[] = [];
  for (let index = 0; index < value.resources.length; index += 1) {
    const entry = value.resources[index];
    const path = `selection.resources[${index}]`;
    if (!isRecord(entry)) return fail("invalid_type", path, "Expected an object");
    const resourceId = parseBoundedIdentifier(entry.resourceId, `${path}.resourceId`, "resourceId", 256);
    if (!resourceId.ok) return resourceId;
    const snapshotId = parseBoundedIdentifier(entry.snapshotId, `${path}.snapshotId`, "snapshotId", 256);
    if (!snapshotId.ok) return snapshotId;
    const sourceSelector = parseContextSelectorV1(entry.sourceSelector, `${path}.sourceSelector`);
    if (!sourceSelector.ok) return sourceSelector;
    resources.push({
      resourceId: resourceId.value,
      snapshotId: snapshotId.value,
      sourceSelector: sourceSelector.value,
    });
  }
  return pass({
    version: 1,
    purpose: value.purpose as ContextPackSelectionV1["purpose"],
    familiarId: familiarId.value,
    ...(value.projectId !== undefined ? { projectId: String(value.projectId) } : {}),
    consent: {
      selectionMode: "explicit",
      allowRemoteQueries: false,
      allowRemoteContent: false,
      artifactContentSync: false,
      retention: consent.retention as ContextPackSelectionV1["consent"]["retention"],
    },
    resources,
  });
}

export function parseContextPackRedactionMapV1(value: unknown): ProtocolParseResult<ContextPackRedactionMapV1> {
  if (!isRecord(value)) return fail("invalid_type", "redactionMap", "Expected an object");
  if (value.version !== 1) return fail("unknown_major", "redactionMap.version", "version must be 1");
  const secretScanVersion = parseBoundedIdentifier(value.secretScanVersion, "redactionMap.secretScanVersion", "secretScanVersion", 64);
  if (!secretScanVersion.ok) return secretScanVersion;
  if (!Array.isArray(value.decisions)) {
    return fail("invalid_type", "redactionMap.decisions", "Expected an array");
  }
  const decisions: ContextPackRedactionDecisionV1[] = [];
  for (let index = 0; index < value.decisions.length; index += 1) {
    const entry = value.decisions[index];
    const path = `redactionMap.decisions[${index}]`;
    if (!isRecord(entry)) return fail("invalid_type", path, "Expected an object");
    const resourceId = parseBoundedIdentifier(entry.resourceId, `${path}.resourceId`, "resourceId", 256);
    if (!resourceId.ok) return resourceId;
    if (!isRecord(entry.selector) || entry.selector.type !== "text-span") {
      return fail("invalid_type", `${path}.selector`, "selector must be a text-span object");
    }
    const selector = entry.selector as Record<string, unknown>;
    if (
      typeof selector.start !== "number" ||
      !Number.isInteger(selector.start) ||
      selector.start < 0
    ) {
      return fail("invalid_value", `${path}.selector.start`, "start must be a non-negative integer");
    }
    if (
      typeof selector.end !== "number" ||
      !Number.isInteger(selector.end) ||
      selector.end <= (selector.start as number)
    ) {
      return fail("invalid_value", `${path}.selector.end`, "end must be an integer greater than start");
    }
    const category = parseBoundedIdentifier(entry.category, `${path}.category`, "category", 64);
    if (!category.ok) return category;
    if (typeof entry.replacement !== "string" || entry.replacement.length > 4096) {
      return fail("invalid_value", `${path}.replacement`, "replacement must be a string up to 4096 characters");
    }
    decisions.push({
      resourceId: resourceId.value,
      selector: {
        type: "text-span",
        start: selector.start as number,
        end: selector.end as number,
      },
      category: category.value,
      replacement: entry.replacement,
    });
  }
  return pass({ version: 1, secretScanVersion: secretScanVersion.value, decisions });
}

export function parseContextPackBuildReceiptV1(value: unknown): ProtocolParseResult<ContextPackBuildReceiptV1> {
  if (!isRecord(value)) return fail("invalid_type", "receipt", "Expected an object");
  if (value.version !== 1) return fail("unknown_major", "receipt.version", "version must be 1");
  const packId = parseText(value.packId, "receipt.packId", "packId", 256);
  if (!packId.ok) return packId;
  if (!/^ctx_[A-Za-z0-9_-]+$/.test(packId.value)) {
    return fail("invalid_value", "receipt.packId", "packId must match ctx_…");
  }
  const createdAt = value.createdAt;
  if (typeof createdAt !== "string" || !isUtcTimestamp(createdAt)) {
    return fail("invalid_value", "receipt.createdAt", "createdAt must be a UTC RFC 3339 timestamp");
  }
  if (!Array.isArray(value.resources)) {
    return fail("invalid_type", "receipt.resources", "Expected an array");
  }
  const resources: ContextPackBuildReceiptResourceV1[] = [];
  for (let index = 0; index < value.resources.length; index += 1) {
    const entry = value.resources[index];
    const path = `receipt.resources[${index}]`;
    if (!isRecord(entry)) return fail("invalid_type", path, "Expected an object");
    const packResourceId = parseText(entry.packResourceId, `${path}.packResourceId`, "packResourceId", 256);
    if (!packResourceId.ok) return packResourceId;
    if (!/^resource_[A-Za-z0-9_-]+$/.test(packResourceId.value)) {
      return fail("invalid_value", `${path}.packResourceId`, "packResourceId must match resource_…");
    }
    const sourceResourceId = parseBoundedIdentifier(entry.sourceResourceId, `${path}.sourceResourceId`, "sourceResourceId", 256);
    if (!sourceResourceId.ok) return sourceResourceId;
    const snapshotId = parseBoundedIdentifier(entry.snapshotId, `${path}.snapshotId`, "snapshotId", 256);
    if (!snapshotId.ok) return snapshotId;
    const sourceSelector = parseContextSelectorV1(entry.sourceSelector, `${path}.sourceSelector`);
    if (!sourceSelector.ok) return sourceSelector;
    if (typeof entry.sourceRevision !== "number" || !Number.isInteger(entry.sourceRevision) || entry.sourceRevision < 1) {
      return fail("invalid_value", `${path}.sourceRevision`, "sourceRevision must be a positive integer");
    }
    if (typeof entry.sourceNormalizedBlobDigest !== "string" || !isSha256(entry.sourceNormalizedBlobDigest)) {
      return fail("invalid_value", `${path}.sourceNormalizedBlobDigest`, "sourceNormalizedBlobDigest must be a SHA-256 hex digest");
    }
    resources.push({
      packResourceId: packResourceId.value,
      sourceResourceId: sourceResourceId.value,
      snapshotId: snapshotId.value,
      sourceSelector: sourceSelector.value,
      sourceRevision: entry.sourceRevision as number,
      sourceNormalizedBlobDigest: entry.sourceNormalizedBlobDigest,
    });
  }
  return pass({ version: 1, packId: packId.value, createdAt, resources });
}

export function parseContextPackPreviewV1(value: unknown): ProtocolParseResult<ContextPackPreviewV1> {
  if (!isRecord(value)) return fail("invalid_type", "preview", "Expected an object");
  if (value.version !== 1) return fail("unknown_major", "preview.version", "version must be 1");
  if (!Array.isArray(value.resources)) {
    return fail("invalid_type", "preview.resources", "Expected an array");
  }
  const resources: ContextPackResourcePreviewV1[] = [];
  for (let index = 0; index < value.resources.length; index += 1) {
    const entry = value.resources[index];
    const path = `preview.resources[${index}]`;
    if (!isRecord(entry)) return fail("invalid_type", path, "Expected an object");
    const resourceId = parseBoundedIdentifier(entry.resourceId, `${path}.resourceId`, "resourceId", 256);
    if (!resourceId.ok) return resourceId;
    if (entry.title !== undefined) {
      const title = parseText(entry.title, `${path}.title`, "title", 512);
      if (!title.ok) return title;
    }
    if (
      typeof entry.kind !== "string" ||
      !CONTEXT_PACK_RESOURCE_KINDS.includes(entry.kind as never)
    ) {
      return fail("invalid_value", `${path}.kind`, `kind must be one of ${CONTEXT_PACK_RESOURCE_KINDS.join(", ")}`);
    }
    if (
      typeof entry.sensitivity !== "string" ||
      !["public", "private", "restricted"].includes(entry.sensitivity)
    ) {
      return fail("invalid_value", `${path}.sensitivity`, "sensitivity must be public, private, or restricted");
    }
    const mediaType = parseBoundedIdentifier(entry.mediaType, `${path}.mediaType`, "mediaType", 128);
    if (!mediaType.ok) return mediaType;
    if (typeof entry.bytes !== "number" || !Number.isInteger(entry.bytes) || entry.bytes < 0) {
      return fail("invalid_value", `${path}.bytes`, "bytes must be a non-negative integer");
    }
    const sourceSelector = parseContextSelectorV1(entry.sourceSelector, `${path}.sourceSelector`);
    if (!sourceSelector.ok) return sourceSelector;
    if (!Array.isArray(entry.findings)) {
      return fail("invalid_type", `${path}.findings`, "Expected an array");
    }
    const findings: ContextPackResourcePreviewV1["findings"] = [];
    for (let findingIndex = 0; findingIndex < entry.findings.length; findingIndex += 1) {
      const finding = entry.findings[findingIndex];
      const findingPath = `${path}.findings[${findingIndex}]`;
      if (!isRecord(finding)) return fail("invalid_type", findingPath, "Expected an object");
      const category = parseBoundedIdentifier(finding.category, `${findingPath}.category`, "category", 64);
      if (!category.ok) return category;
      const selector = parseContextSelectorV1(finding.selector, `${findingPath}.selector`);
      if (!selector.ok) return selector;
      if (typeof finding.excerpt !== "string" || finding.excerpt.length > 512) {
        return fail("invalid_value", `${findingPath}.excerpt`, "excerpt must be a string up to 512 characters");
      }
      findings.push({ category: category.value, selector: selector.value, excerpt: finding.excerpt });
    }
    resources.push({
      resourceId: resourceId.value,
      ...(entry.title !== undefined ? { title: String(entry.title) } : {}),
      kind: entry.kind as ContextPackResourceKindV1,
      sensitivity: entry.sensitivity as ResourceSensitivityV1,
      mediaType: mediaType.value,
      bytes: entry.bytes as number,
      sourceSelector: sourceSelector.value,
      findings,
    });
  }
  if (typeof value.totalBytes !== "number" || !Number.isInteger(value.totalBytes) || value.totalBytes < 0) {
    return fail("invalid_value", "preview.totalBytes", "totalBytes must be a non-negative integer");
  }
  if (typeof value.requiresConfirmation !== "boolean") {
    return fail("invalid_type", "preview.requiresConfirmation", "requiresConfirmation must be a boolean");
  }
  return pass({
    version: 1,
    resources,
    totalBytes: value.totalBytes as number,
    requiresConfirmation: value.requiresConfirmation,
  });
}

export { hasOwn, childPath };
