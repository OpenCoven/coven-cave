import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { submissionsBuildConfig } from './submissions-build-config.mjs';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);

test('a default build excludes Submissions, whatever else is in the environment', () => {
  for (const env of [{}, { COVEN_CAVE_INCLUDE_SUBMISSIONS: '0' }, { COVEN_CAVE_INCLUDE_SUBMISSIONS: 'true' }]) {
    const config = submissionsBuildConfig(env);
    assert.equal(config.included, false);
    assert.match(config.aliases['@opencoven/submissions-runtime'], /absent/);
    assert.match(config.aliases['@opencoven/submissions-page'], /absent/);
    assert.match(config.aliases['@opencoven/submissions-availability'], /unavailable/);
  }
});

test('the flag reinstalls the implementation', () => {
  const config = submissionsBuildConfig({ COVEN_CAVE_INCLUDE_SUBMISSIONS: '1' });
  assert.equal(config.included, true);
  assert.match(config.aliases['@opencoven/submissions-runtime'], /opencoven-submissions-runtime\.ts$/);
  assert.match(config.aliases['@opencoven/submissions-page'], /opencoven-submission-page\.tsx$/);
  assert.match(config.aliases['@opencoven/submissions-availability'], /opencoven-submissions-available\.ts$/);
});

test('compiled route shells classify absent plus disabled without the optional implementation', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'submissions-build-boundary-'));
  const previousToken = process.env.COVEN_CAVE_AUTH_TOKEN;
  const previousDisabled = process.env.COVEN_CAVE_SUBMISSIONS_DISABLED;
  process.env.COVEN_CAVE_AUTH_TOKEN = 'synthetic-build-boundary';
  process.env.COVEN_CAVE_SUBMISSIONS_DISABLED = '1';
  try {
    for (const included of [false, true]) {
      const config = submissionsBuildConfig({ COVEN_CAVE_INCLUDE_SUBMISSIONS: included ? '1' : '0' });
      const outdir = path.join(temp, included ? 'included' : 'absent');
      const result = await build({
        entryPoints: {
          submissions: 'src/app/api/opencoven/submissions/route.ts',
          executions: 'src/app/api/opencoven/executions/route.ts',
        },
        bundle: true, splitting: true, format: 'esm', platform: 'node', packages: 'external',
        outdir, outExtension: { '.js': '.mjs' }, metafile: true,
        alias: {
          '@': path.resolve('src'),
          ...Object.fromEntries(Object.entries(config.aliases).map(([key, value]) => [key, path.resolve(value)])),
        },
        plugins: [{ name: 'native-next-entry', setup(builder) {
          builder.onResolve({ filter: /^next\/server(?:\.js)?$/ }, () => ({ path: require.resolve('next/server.js'), external: true }));
        } }],
      });
      const hasImplementation = Object.keys(result.metafile.inputs).some(file => file.endsWith('/opencoven-submissions-runtime.ts'));
      assert.equal(hasImplementation, included, 'the same build aliases select metadata and implementation');
      // Remove dynamic chunks: disabled/absent admission must still succeed without loading them.
      let removedChunks = 0;
      for (const [file, output] of Object.entries(result.metafile.outputs)) {
        if (output.entryPoint?.endsWith('/opencoven-submissions-runtime.ts') || output.entryPoint?.endsWith('/opencoven-submissions-absent.ts')) {
          await rm(file);
          removedChunks++;
        }
      }
      assert.ok(removedChunks > 0, 'the unavailable dynamic runtime chunk was actually removed');
      for (const [route, methods] of [['submissions', ['GET', 'POST']], ['executions', ['POST']]]) {
        const handlers = await import(pathToFileURL(path.join(outdir, `${route}.mjs`)).href);
        for (const method of methods) {
          const response = await handlers[method](new Request(`http://localhost/api/opencoven/${route}`, { method, headers: {
            host: 'localhost', 'x-coven-cave-token': 'synthetic-build-boundary',
          } }));
          assert.equal(response.status, 503);
          assert.equal((await response.json()).code, included ? 'submissions-disabled' : 'submissions-not-installed');
          const denied = await handlers[method](new Request(`http://localhost/api/opencoven/${route}`, { method, headers: {
            host: 'localhost', 'x-coven-cave-token': 'synthetic-build-boundary', 'x-coven-cave-mobile-access': '1',
          } }));
          assert.equal(denied.status, 403, 'locality remains first in either compiled build');
        }
      }
    }
  } finally {
    if (previousToken === undefined) delete process.env.COVEN_CAVE_AUTH_TOKEN; else process.env.COVEN_CAVE_AUTH_TOKEN = previousToken;
    if (previousDisabled === undefined) delete process.env.COVEN_CAVE_SUBMISSIONS_DISABLED; else process.env.COVEN_CAVE_SUBMISSIONS_DISABLED = previousDisabled;
    await rm(temp, { recursive: true, force: true });
  }
});

test('every alias target exists in both configurations', () => {
  for (const env of [{}, { COVEN_CAVE_INCLUDE_SUBMISSIONS: '1' }]) {
    for (const target of Object.values(submissionsBuildConfig(env).aliases)) {
      assert.ok(existsSync(path.resolve(target)), target);
    }
  }
});
