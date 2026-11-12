// Diagnostic-only preload for an owned synthetic build. Never installed globally.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const v8 = require('node:v8');
const { threadId, isMainThread } = require('node:worker_threads');
const directory = process.env.COVEN_TS_OBSERVATION_DIR;
if (directory) {
  if (!path.isAbsolute(directory)) throw new Error('absolute observation directory required');
  const entry = process.argv[1] || '';
  const compiler = /[/\\]typescript[/\\](?:bin[/\\]tsc|lib[/\\](?:_?tsc)\.js)$/.test(entry);
  const file = path.join(directory, `${process.pid}-${crypto.randomUUID()}.jsonl`);
  const fd = fs.openSync(file, 'wx', 0o600);
  const common = { pid: process.pid, ppid: process.ppid, thread_id: threadId,
    is_main_thread: isMainThread, entry, cwd: process.cwd() };
  function record(data) {
    fs.writeSync(fd, JSON.stringify({ ...common, monotonic_ns: Number(process.hrtime.bigint()), wall_time: new Date().toISOString(), ...data }) + '\n');
    fs.fsyncSync(fd);
  }
  const details = {};
  if (compiler) {
    details.compiler_args = process.argv.slice(2);
    try {
      // Recognize only the frozen Next invocation and diagnostic controls.
      // Unknown forms must not silently imply default tsconfig discovery.
      // `--pretty` appears in Next's `--showConfig --project <path> --pretty false` probe.
      const values = new Set(['--project', '-p', '--declarationMap', '--emitDeclarationOnly', '--tsBuildInfoFile', '--incremental', '--pretty']);
      const flags = new Set(['--noEmit', '--showConfig', '--extendedDiagnostics', '--listFiles']);
      let selectors = 0;
      for (let i = 0; i < details.compiler_args.length; i++) {
        const arg = details.compiler_args[i];
        if (arg === '--project' || arg === '-p') selectors++;
        if (values.has(arg)) { i++; continue; }
        if (!flags.has(arg)) throw Object.assign(new Error(), { code: 'unsupported-config-selection' });
      }
      // More than one selector leaves the effective project to tsc's own
      // precedence rules, so no single hashed config can be claimed.
      if (selectors > 1) throw Object.assign(new Error(), { code: 'unsupported-config-selection' });
      const projectIndex = process.argv.findIndex(arg => arg === '--project' || arg === '-p');
      let configPath;
      if (projectIndex >= 0) {
        const selected = process.argv[projectIndex + 1];
        if (!selected || selected.startsWith('-')) throw new Error('missing-project-value');
        configPath = path.resolve(selected);
        if (fs.statSync(configPath).isDirectory()) configPath = path.join(configPath, 'tsconfig.json');
      } else {
        let candidate = process.cwd();
        while (!fs.existsSync(path.join(candidate, 'tsconfig.json')) && path.dirname(candidate) !== candidate) {
          candidate = path.dirname(candidate);
        }
        configPath = path.join(candidate, 'tsconfig.json');
      }
      details.tsconfig_path = configPath;
      details.tsconfig_sha256 = crypto.createHash('sha256').update(fs.readFileSync(configPath)).digest('hex');
    } catch (error) {
      // The compiler owns argument/config diagnostics and its exit status.
      // Record only a bounded error code, never file contents or exception text.
      details.config_observation_error = error.code || 'invalid-project-selection';
      details.tsconfig_sha256 = null;
    }
  }
  record({ event: 'start', node_version: process.version, heap_size_limit_bytes: v8.getHeapStatistics().heap_size_limit, ...details });
  process.once('exit', code => {
    record({ event: 'exit', exit_code: code,
      ...(isMainThread ? { resource_usage: process.resourceUsage() } : {}) });
    fs.closeSync(fd);
  });
}
