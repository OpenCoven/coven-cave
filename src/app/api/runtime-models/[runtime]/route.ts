import { NextResponse } from "next/server";
import { canonicalHarnessId } from "@/lib/harness-adapters";
import { catalogForRuntime } from "@/lib/runtime-models";
import { bindingFor, loadConfig } from "@/lib/cave-config";
import { isSshRuntime } from "@/lib/familiar-runtime";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { listRuntimeModelInventory } from "@/lib/server/runtime-model-options";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function cleanFamiliarId(value: string | null): string | null {
  const familiarId = value?.trim() ?? "";
  if (
    !familiarId ||
    familiarId.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(familiarId)
  ) {
    return null;
  }
  return familiarId;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ runtime: string }> },
) {
  const rawRuntime = (await params).runtime;
  const runtime = canonicalHarnessId(rawRuntime);
  const catalog = catalogForRuntime(runtime);
  if (!catalog) {
    return NextResponse.json(
      { ok: false, error: "runtime not found" },
      { status: 404 },
    );
  }
  // Credential-backed discovery is a desktop-local capability. Remote clients
  // still receive the shared, safe runtime-managed inventory contract instead
  // of being denied the whole endpoint.
  const localInventoryRequest = rejectNonLocalRequest(req) === null;
  const rawFamiliarId = new URL(req.url).searchParams.get("familiarId");
  const familiarId = cleanFamiliarId(rawFamiliarId);
  if (rawFamiliarId !== null && !familiarId) {
    return NextResponse.json(
      { ok: false, error: "invalid familiar id" },
      { status: 400 },
    );
  }
  let allowHermesInventory =
    runtime === "hermes" && localInventoryRequest && familiarId === null;
  if (runtime === "hermes" && localInventoryRequest && familiarId) {
    const binding = bindingFor(await loadConfig(), familiarId);
    allowHermesInventory =
      canonicalHarnessId(binding.harness) === "hermes" &&
      !binding.hermesProfile &&
      !binding.hasInvalidHermesProfileBinding &&
      !isSshRuntime(binding.runtime);
  }
  const inventory = await listRuntimeModelInventory(runtime, familiarId, {
    allowOpenCodeInventory: runtime === "opencode" && localInventoryRequest,
    allowHermesInventory,
  });
  return NextResponse.json({
    ok: true,
    ...inventory,
  });
}
