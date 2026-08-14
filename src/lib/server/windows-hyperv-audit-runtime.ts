import { loadConversation } from "../cave-conversations.ts";
import { isValidFamiliarId } from "./familiar-id.ts";
import {
  authorizeWindowsHypervAuditRuntime,
  runWindowsHypervAudit,
  type HypervInventory,
  type WindowsHypervAuditRuntimeAuthority,
} from "../windows-hyperv-audit.ts";

type RuntimeInput = { familiarId: string; sessionId: string };
type RuntimeDependencies = {
  loadConversation: typeof loadConversation;
  authorize: typeof authorizeWindowsHypervAuditRuntime;
  invoke: (authority: WindowsHypervAuditRuntimeAuthority) => Promise<HypervInventory>;
};

/** Native/server-runtime bridge for the registered Windows audit adapter. It
 * is intentionally not an HTTP handler: a browser cannot select an arbitrary
 * familiar/session pair and cause a host process to run. */
async function invoke(input: RuntimeInput, dependencies: RuntimeDependencies): Promise<HypervInventory> {
  if (!isValidFamiliarId(input.familiarId) || !input.sessionId.trim()) throw new Error("invalid Windows Host Audit runtime session");
  const conversation = await dependencies.loadConversation(input.sessionId);
  if (!conversation || conversation.familiarId !== input.familiarId) throw new Error("Windows Host Audit requires the active session owned by this familiar");
  const authority = await dependencies.authorize({ familiarId: input.familiarId, sessionId: input.sessionId, platform: "win32" });
  return dependencies.invoke(authority);
}

export async function invokeWindowsHypervAuditForServerRuntime(input: RuntimeInput): Promise<HypervInventory> {
  return invoke(input, { loadConversation, authorize: authorizeWindowsHypervAuditRuntime, invoke: runWindowsHypervAudit });
}

/** @internal Fixture seam; production must use the non-injectable entrypoint. */
export async function invokeWindowsHypervAuditForServerRuntimeFixture(input: RuntimeInput, dependencies: RuntimeDependencies): Promise<HypervInventory> {
  return invoke(input, dependencies);
}
