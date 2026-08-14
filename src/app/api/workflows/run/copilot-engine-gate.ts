/**
 * Make the compatibility decision part of the engine invocation itself so an
 * alternate workflow executor cannot bypass the local Copilot protocol gate.
 * The small dependency-injected seam is intentionally runnable without Next,
 * which gives us a behavioral regression test for the no-daemon-on-block path.
 */
export async function runWorkflowEngineAfterCopilotGate<T>(input: {
  localCopilot: boolean;
  probe: () => Promise<{ version: string | null }>;
  resolveCompatibility: () => Promise<{ eventProtocols?: unknown } | null>;
  selectSpec: (version: string | null, protocols: unknown) => unknown;
  runEngine: () => Promise<T>;
}): Promise<{ blocked: true } | { blocked: false; engine: T }> {
  if (input.localCopilot) {
    const [capability, compatibility] = await Promise.all([
      input.probe(),
      input.resolveCompatibility(),
    ]);
    if (!input.selectSpec(capability.version, compatibility?.eventProtocols)) {
      return { blocked: true };
    }
  }
  return { blocked: false, engine: await input.runEngine() };
}
