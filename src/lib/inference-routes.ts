import { createHash } from "node:crypto";
import {
  canonicalHarnessId,
  runtimeDisplayLabel,
} from "./harness-adapters.ts";
import { catalogForRuntime } from "./runtime-models.ts";

export type InferenceSupportTier =
  | "native-account"
  | "native-byok"
  | "compatible-gateway"
  | "experimental-shim";

export type InferenceProtocol =
  | "openai-responses"
  | "openai-chat"
  | "anthropic-messages"
  | "azure-openai"
  | "runtime-managed";

export type InferenceRoute = {
  id: string;
  label: string;
  harness: string;
  provider: string;
  protocol: InferenceProtocol;
  supportTier: InferenceSupportTier;
  endpoint?: string;
  credentialRef?: string;
  runtimeProfile?: string;
  gatewayKind?: "litellm" | "openrouter" | "custom";
  enabled: boolean;
};

const ROUTE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PROVIDER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const PROFILE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CREDENTIAL_REF_RE = /^vault:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SUPPORT_TIERS = new Set<InferenceSupportTier>([
  "native-account",
  "native-byok",
  "compatible-gateway",
  "experimental-shim",
]);
const PROTOCOLS = new Set<InferenceProtocol>([
  "openai-responses",
  "openai-chat",
  "anthropic-messages",
  "azure-openai",
  "runtime-managed",
]);
const GATEWAY_KINDS = new Set<NonNullable<InferenceRoute["gatewayKind"]>>([
  "litellm",
  "openrouter",
  "custom",
]);

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean && clean.length <= maxLength ? clean : null;
}

function normalizedEndpoint(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const raw = cleanText(value, 2_048);
  if (!raw) return null;
  let endpoint: URL;
  try {
    endpoint = new URL(raw);
  } catch {
    return null;
  }
  if (endpoint.username || endpoint.password || endpoint.hash) return null;
  const loopback =
    endpoint.hostname === "localhost" ||
    endpoint.hostname === "127.0.0.1" ||
    endpoint.hostname === "::1" ||
    endpoint.hostname === "[::1]";
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && loopback)) {
    return null;
  }
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, "") || "/";
  const normalized = endpoint.toString();
  return endpoint.pathname === "/" && !endpoint.search
    ? normalized.replace(/\/$/, "")
    : normalized;
}

export function implicitNativeInferenceRoute(harness: string): InferenceRoute {
  const canonicalHarness = canonicalHarnessId(harness);
  const provider = catalogForRuntime(canonicalHarness)?.provider ?? "runtime";
  return {
    id: `native:${canonicalHarness}`,
    label: `${runtimeDisplayLabel(canonicalHarness)} account`,
    harness: canonicalHarness,
    provider,
    protocol: "runtime-managed",
    supportTier: "native-account",
    enabled: true,
  };
}

export function normalizeInferenceRoute(value: unknown): InferenceRoute | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const id = cleanText(input.id, 128);
  const label = cleanText(input.label, 120);
  const rawHarness = cleanText(input.harness, 80);
  const provider = cleanText(input.provider, 64);
  const protocol = input.protocol;
  const supportTier = input.supportTier;
  if (
    !id ||
    !ROUTE_ID_RE.test(id) ||
    id.startsWith("native:") ||
    !label ||
    !rawHarness ||
    !provider ||
    !PROVIDER_ID_RE.test(provider) ||
    typeof protocol !== "string" ||
    !PROTOCOLS.has(protocol as InferenceProtocol) ||
    typeof supportTier !== "string" ||
    !SUPPORT_TIERS.has(supportTier as InferenceSupportTier) ||
    typeof input.enabled !== "boolean"
  ) {
    return null;
  }
  const harness = canonicalHarnessId(rawHarness);
  if (!catalogForRuntime(harness)) return null;
  const endpoint = normalizedEndpoint(input.endpoint);
  if (endpoint === null) return null;
  const credentialRef = input.credentialRef === undefined
    ? undefined
    : cleanText(input.credentialRef, 134);
  if (credentialRef !== undefined && (!credentialRef || !CREDENTIAL_REF_RE.test(credentialRef))) {
    return null;
  }
  const runtimeProfile = input.runtimeProfile === undefined
    ? undefined
    : cleanText(input.runtimeProfile, 128);
  if (runtimeProfile !== undefined && (!runtimeProfile || !PROFILE_ID_RE.test(runtimeProfile))) {
    return null;
  }
  const gatewayKind = input.gatewayKind;
  if (
    gatewayKind !== undefined &&
    (typeof gatewayKind !== "string" ||
      !GATEWAY_KINDS.has(gatewayKind as NonNullable<InferenceRoute["gatewayKind"]>))
  ) {
    return null;
  }
  return {
    id,
    label,
    harness,
    provider,
    protocol: protocol as InferenceProtocol,
    supportTier: supportTier as InferenceSupportTier,
    ...(endpoint ? { endpoint } : {}),
    ...(credentialRef ? { credentialRef } : {}),
    ...(runtimeProfile ? { runtimeProfile } : {}),
    ...(gatewayKind
      ? { gatewayKind: gatewayKind as NonNullable<InferenceRoute["gatewayKind"]> }
      : {}),
    enabled: input.enabled,
  };
}

export function resolveInferenceRoute(
  routes: Record<string, InferenceRoute>,
  binding: {
    harness: string;
    inferenceRouteId?: string;
    hasInvalidInferenceRouteBinding?: boolean;
  },
):
  | {
      ok: true;
      route: InferenceRoute;
      source: "configured" | "implicit-native";
    }
  | {
      ok: false;
      code: "route-not-found" | "route-disabled" | "harness-mismatch";
      message: string;
    } {
  const harness = canonicalHarnessId(binding.harness);
  const routeId = binding.inferenceRouteId?.trim();
  if (!routeId || routeId === `native:${harness}`) {
    return {
      ok: true,
      route: implicitNativeInferenceRoute(harness),
      source: "implicit-native",
    };
  }
  const route = routes[routeId];
  if (!route) {
    return {
      ok: false,
      code: "route-not-found",
      message: "The selected inference route is unavailable.",
    };
  }
  if (!route.enabled) {
    return {
      ok: false,
      code: "route-disabled",
      message: "The selected inference route is disabled.",
    };
  }
  if (canonicalHarnessId(route.harness) !== harness) {
    return {
      ok: false,
      code: "harness-mismatch",
      message: "The selected inference route is not compatible with this harness.",
    };
  }
  if (binding.hasInvalidInferenceRouteBinding) {
    return {
      ok: false,
      code: "route-not-found",
      message: "The selected inference route is unavailable.",
    };
  }
  return { ok: true, route, source: "configured" };
}

export function inferenceRouteFingerprint(route: InferenceRoute): string {
  return createHash("sha256")
    .update(JSON.stringify([
      route.id,
      canonicalHarnessId(route.harness),
      route.provider,
      route.protocol,
      route.supportTier,
      route.endpoint ?? "",
      route.credentialRef ?? "",
      route.runtimeProfile ?? "",
      route.gatewayKind ?? "",
    ]))
    .digest("hex");
}
