import { createHash } from "node:crypto";
import {
  inferenceRouteFingerprint,
  resolveInferenceRoute,
  type InferenceRoute,
} from "../inference-routes.ts";

export type InferenceModelRef = {
  routeId: string;
  id: string;
};

export type InferenceLaunchPlan = {
  harness: string;
  route: InferenceRoute;
  requestedModel: InferenceModelRef | null;
  launchModel: string | null;
  confirmedBy: "stream-echo" | "successful-forwarding" | "unconfirmed";
  fingerprint: string;
  resumeSafe: boolean;
  resumeReason?: "inference-route-changed";
};

type RouteBinding = {
  harness: string;
  inferenceRouteId?: string;
  hasInvalidInferenceRouteBinding?: boolean;
};

type ExistingInferenceRoute = {
  harness: string;
  inferenceRouteId?: string;
  inferenceRouteFingerprint?: string;
};

function launchFingerprint(route: InferenceRoute, translationMode: string): string {
  return createHash("sha256")
    .update(JSON.stringify([
      inferenceRouteFingerprint(route),
      translationMode,
    ]))
    .digest("hex");
}

export function resolveInferenceLaunchPlan(input: {
  routes: Record<string, InferenceRoute>;
  binding: RouteBinding;
  requestedModel: string | null;
  launchModel?: string | null;
  translationMode?: string;
  existingConversation?: ExistingInferenceRoute | null;
}):
  | { ok: true; plan: InferenceLaunchPlan }
  | {
      ok: false;
      code: "route-not-found" | "route-disabled" | "harness-mismatch";
      message: string;
    } {
  const resolved = resolveInferenceRoute(input.routes, input.binding);
  if (!resolved.ok) return resolved;

  const translationMode = input.translationMode ?? "identity";
  const fingerprint = launchFingerprint(resolved.route, translationMode);
  const existing = input.existingConversation;
  let previousFingerprint: string | null = null;
  if (existing?.inferenceRouteFingerprint) {
    previousFingerprint = existing.inferenceRouteFingerprint;
  } else if (existing) {
    const previous = resolveInferenceRoute(input.routes, {
      harness: existing.harness,
      inferenceRouteId: existing.inferenceRouteId,
    });
    if (previous.ok) {
      previousFingerprint = launchFingerprint(previous.route, "identity");
    }
  }
  const resumeSafe =
    !existing ||
    (previousFingerprint !== null && previousFingerprint === fingerprint);

  return {
    ok: true,
    plan: {
      harness: resolved.route.harness,
      route: resolved.route,
      requestedModel: input.requestedModel
        ? { routeId: resolved.route.id, id: input.requestedModel }
        : null,
      launchModel: input.launchModel === undefined
        ? input.requestedModel
        : input.launchModel,
      confirmedBy: "unconfirmed",
      fingerprint,
      resumeSafe,
      ...(!resumeSafe ? { resumeReason: "inference-route-changed" as const } : {}),
    },
  };
}
