// Passive, credential-free launch admission inventory. Never runs a provider turn.
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const [execute, destination] = process.argv.slice(2);
assert.ok(execute === '--execute' && path.isAbsolute(destination ?? '') && process.argv.length === 4,
  'Usage: node --experimental-strip-types --import ./scripts/test-alias-register.mjs scripts/runtime-activity-runtime-matrix.mjs --execute <new absolute report path>');
const root = await mkdtemp(path.join(tmpdir(), 'cave-activity-matrix-'));
await mkdir(path.join(root, 'coven'), { mode: 0o700 });
Object.assign(process.env, { COVEN_HOME: path.join(root, 'coven'), COVEN_CAVE_HOME: path.join(root, 'coven/cave'), COVEN_SOCKET: path.join(root, 'coven/coven.sock') });
const report = { schemaVersion: 2, observedAt: new Date().toISOString(), head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  classification: 'Passive local launch inventory; no provider turns, daemon starts, trust publication or support promotion.', runtimes: [], scratchRoot: root };
const { grokProbeEnvironment, probeGrokRunCapabilities, resolveGrokCompatibility } = await import('../src/lib/grok-compatibility.ts');
const env = grokProbeEnvironment(process.env);
const { discoverCodexRuntime, productionCodexSchemaSources } = await import('../src/lib/codex-compatibility.ts');
const { resolveCodexChatRouting } = await import('../src/app/api/chat/send/codex-routing.ts');
const codex = await discoverCodexRuntime('codex', undefined, env);
const sources = await productionCodexSchemaSources({ cachePath: path.join(root, 'codex-schema.json'), registryUrl: '' });
const routing = resolveCodexChatRouting({ harness: 'codex', isSshRuntime: false, report: codex, sources });
report.runtimes.push({ runtime: 'codex', version: codex.version, path: routing.mode === 'direct' ? 'direct-jsonl' : 'coven-fallback',
  schema: routing.schema?.id ?? null, diagnostic: routing.diagnosticCode, model: null, qualification: 'unverified-provider', approvalAuthority: 'unavailable' });
// Codex local mode (#6088) shares the installed Codex CLI and its schema admission; the
// backend is a local inference server, so no cloud model identity is recorded here.
for (const local of ['codex-ollama', 'codex-lmstudio']) {
  const localRouting = resolveCodexChatRouting({ harness: local, isSshRuntime: false, report: codex, sources });
  report.runtimes.push({ runtime: local, version: codex.version, path: localRouting.mode === 'direct' ? 'direct-jsonl' : 'coven-fallback',
    schema: localRouting.schema?.id ?? null, diagnostic: localRouting.diagnosticCode, model: null, backend: 'local inference endpoint; not probed here',
    qualification: 'unverified-activity: launch/preflight only (#6088); live tool/reasoning parity unqualified', approvalAuthority: 'unavailable' });
}
// Claude runs through the Coven relay with a trusted stream-json profile. The probe
// reads only --version/--help with credentials removed and caches under scratch state.
const { resolveInstalledClaudeRuntime } = await import('../src/lib/server/claude-runtime-compatibility.ts');
const claude = await resolveInstalledClaudeRuntime();
report.runtimes.push({ runtime: 'claude', version: claude.version, path: 'coven',
  schema: claude.compatibility.kind === 'compatible' ? claude.compatibility.profile.id : null,
  admission: claude.compatibility.kind === 'compatible' ? (claude.compatibility.stale ? 'stale-profile' : 'compatible') : 'fallback',
  diagnostic: claude.compatibility.kind === 'compatible' ? (claude.compatibility.stale ? 'stale-profile' : null) : claude.compatibility.reason,
  reasoning: 'unknown: no Runtimes descriptor classifies thinking as summary or progress', model: null,
  qualification: 'unverified-provider', approvalAuthority: 'unavailable' });
// Copilot direct JSONL: the same bounded launcher resolution and --version probe the
// send route uses, with the registry refresh disabled so only the bundled protocol applies.
const { copilotStreamSpec } = await import('../src/lib/copilot-stream.ts');
const { resolveCopilotRuntimeLaunch } = await import('../src/lib/server/copilot-runtime-launch.ts');
const { probeCopilotCapability } = await import('../src/lib/server/copilot-capability-probe.ts');
const { resolveRuntimeCompatibility: resolveRegistryCompatibility } = await import('../src/lib/server/runtime-compatibility-registry.ts');
const { prepareCopilotChatRouting } = await import('../src/app/api/chat/send/copilot-routing.ts');
const copilotManifest = copilotStreamSpec();
if (copilotManifest) {
  const copilotLaunch = await resolveCopilotRuntimeLaunch(copilotManifest.executable);
  const copilotCapability = copilotLaunch.availability.state === 'ready'
    ? await probeCopilotCapability(copilotManifest.executable, { resolveRuntimeLaunch: async () => copilotLaunch })
    : { version: null, availability: copilotLaunch.availability };
  const copilotRouting = await prepareCopilotChatRouting({ harness: 'copilot', isSshRuntime: false, probe: async () => copilotCapability,
    resolveCompatibility: () => resolveRegistryCompatibility('copilot', { cachePath: path.join(root, 'copilot-compatibility.json'), fetchImpl: () => { throw new Error('Registry network disabled'); } }) });
  report.runtimes.push({ runtime: 'copilot', version: copilotCapability.version, path: copilotRouting.mode === 'direct-jsonl' ? 'direct-jsonl' : 'coven-fallback',
    schema: copilotRouting.spec?.protocol.id ?? null, admission: copilotRouting.mode,
    diagnostic: copilotRouting.compatibilityDiagnostic ?? copilotCapability.diagnostic ?? (copilotCapability.availability.state === 'ready' ? null : copilotCapability.availability.code),
    reasoning: 'unsupported on direct JSONL', model: null, qualification: 'unverified-provider', approvalAuthority: 'unavailable' });
} else report.runtimes.push({ runtime: 'copilot', qualification: 'unverified', reason: 'Registry manifest does not configure the direct stream' });
const { openCodeRunCapabilities } = await import('../src/app/api/chat/send/chat-send-capabilities.ts');
const { resolveOpenCodeCompatibility } = await import('../src/lib/opencode-compatibility.ts');
const opencode = await openCodeRunCapabilities('effectfixture', undefined, env);
const openAdmission = await resolveOpenCodeCompatibility(opencode, { url: '', publicKeys: {}, cacheFile: path.join(root, 'opencode-schema.json'), fetch: () => { throw new Error('Registry network disabled'); } });
report.runtimes.push({ runtime: 'opencode', version: opencode.version, path: 'direct-cli', schema: openAdmission.schema?.id ?? null,
  admission: openAdmission.mode, probeStatus: opencode.probeStatus, diagnostic: openAdmission.diagnostic ?? null,
  readOnly: 'unsupported: send route refuses with 501', model: null, qualification: 'unverified-provider', approvalAuthority: 'unavailable' });
let grokBin;
try { grokBin = execFileSync('which', ['grok'], { encoding: 'utf8' }).trim(); } catch { grokBin = null; }
if (grokBin) {
  const capabilities = await probeGrokRunCapabilities({ command: grokBin, fixedArgs: [] }, env);
  const admission = await resolveGrokCompatibility(capabilities, { url: '', publicKeys: {}, cachePath: path.join(root, 'grok-schema.json'), fetch: () => { throw new Error('Registry network disabled'); } });
  report.runtimes.push({ runtime: 'grok', version: capabilities.version, path: 'direct-cli', schema: admission.schema?.id ?? null,
    admission: admission.mode, diagnostic: admission.diagnostic ?? null, model: null, qualification: 'unverified-provider', approvalAuthority: 'unavailable' });
} else report.runtimes.push({ runtime: 'grok', qualification: 'unverified', reason: 'No executable on current PATH' });
report.runtimes.push({ runtime: 'hermes', path: 'api', schema: 'hermes-responses-v1', version: null, model: 'served-fixture-v3',
  qualification: 'fixture-only until exact-build harness receipts are attached', servedModel: 'Read from response.runtime.model; request alias does not prove the served model.', approvalAuthority: 'unavailable' });
// Launch paths with no local probe. Their status is declarative and must be re-stated
// by the packet that cites this file; a passive inventory cannot verify them.
report.paths = [
  { path: 'ssh-relay', status: 'unverified', activity: { path: 'ssh', tools: 'unknown', reasoning: 'unknown' }, note: 'No local schema or hook contract is borrowed over SSH; Grok and OpenClaw refuse SSH. Verification needs a registered host.' },
  { path: 'coven-relay', status: 'unverified-provider', note: 'Generic coven run transport; tools/reasoning unknown unless the harness-specific adapter admits them.' },
  { path: 'openclaw', status: 'deferred', reference: '#4892', note: 'Gateway/bridge/CLI paths report tools disabled or unsupported and reasoning unsupported; not planned under #5763.' },
];
await writeFile(destination, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(report));
