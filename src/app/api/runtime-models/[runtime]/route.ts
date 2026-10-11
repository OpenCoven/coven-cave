import { NextResponse } from "next/server";
import { warmHarnessSpawnPath } from "@/lib/harness-spawn-env";
import { canonicalHarnessId } from "@/lib/harness-adapters";
import { catalogForRuntime } from "@/lib/runtime-models";
import { bindingFor, loadConfig } from "@/lib/cave-config";
import { isSshRuntime } from "@/lib/familiar-runtime";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { listRuntimeModelInventory } from "@/lib/server/runtime-model-options";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function cleanFamiliarId(value: string | null): string | null {
  const familiarId = value?.trim() ?? "";
  if (!familiarId || !isValidFamiliarId(familiarId)) {
    return null;
  }
  return familiarId;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ runtime: string }> },
) {
  // Model inventory builds spawn environments synchronously; join the server's
  // PATH warm-up off the event loop first, or a chat open that lands before it
  // finishes runs the login shell on the loop (3.1 s measured, #5621).
  await warmHarnessSpawnPath();
  const rawRuntime = (await params).runtime;
  const runtime = canonicalHarnessId(rawRuntime);
  const catalog = catalogForRuntime(runtime);
  if (!catalog) {
    return NextResponse.json(
      { ok: false, error: "runtime not found" },
      { status: 404 },
    );
  }
  // OpenCode and Hermes provider discovery remains desktop-local. Other
  // authenticated clients can read the bounded CLI control catalog.
  const localInventoryRequest = rejectNonLocalRequest(req) === null;
  const rawFamiliarId = new URL(req.url).searchParams.get("familiarId");
  const familiarId = cleanFamiliarId(rawFamiliarId);
  if (rawFamiliarId !== null && !familiarId) {
    return NextResponse.json(
      { ok: false, error: "invalid familiar id" },
      { status: 400 },
    );
  }
  const binding = familiarId ? bindingFor(await loadConfig(), familiarId) : null;
  const remoteRuntime = new URL(req.url).searchParams.get("remote") === "true" || Boolean(binding && isSshRuntime(binding.runtime));
  let allowHermesInventory =
    runtime === "hermes" && localInventoryRequest && familiarId === null;
  if (runtime === "hermes" && localInventoryRequest && binding) {
    allowHermesInventory =
      canonicalHarnessId(binding.harness) === "hermes" &&
      !binding.hermesProfile &&
      !binding.hasInvalidHermesProfileBinding &&
      !isSshRuntime(binding.runtime);
  }
  // This endpoint is authenticated by the proxy. CLI control discovery reads
  // public model metadata without creating a thread, prompt, or tool call.
  // A conversation may retain its runtime after the familiar is rebound.
  const allowCliInventory = !remoteRuntime;
  const inventoryRestriction = remoteRuntime ? "remote-runtime"
    : (runtime === "hermes" || runtime === "opencode") && !localInventoryRequest ? "local-only"
    : runtime === "hermes" && !allowHermesInventory ? "profile-managed"
    : undefined;
  const inventory = await listRuntimeModelInventory(runtime, familiarId, {
    allowCliInventory,
    inventoryRestriction,
    allowOpenCodeInventory: runtime === "opencode" && localInventoryRequest,
    allowHermesInventory,
  });
  return NextResponse.json({
    ok: true,
    ...inventory,
  });
}
