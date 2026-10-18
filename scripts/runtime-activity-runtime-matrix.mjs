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
const report = { schemaVersion: 1, observedAt: new Date().toISOString(), head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
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
await writeFile(destination, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(report));
