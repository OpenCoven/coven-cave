// The build decides Research availability before Turbopack resolves the
// package aliases, so both must look in the same place: this project's own
// node_modules. A package visible only in a parent checkout (an issue
// worktree under .worktrees/) is absent for this build (#6312).
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { researchPackageConfig } from './research-package-config.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'research-config-'));
  const project = path.join(root, '.worktrees', 'unit');
  await mkdir(path.join(project, 'src', 'lib', 'research-host'), { recursive: true });
  await writeFile(path.join(project, 'package.json'), '{"name":"unit"}');
  return { root, project };
}

async function installResearch(dir) {
  const pkg = path.join(dir, 'node_modules', '@opencoven', 'research');
  await mkdir(pkg, { recursive: true });
  await writeFile(path.join(pkg, 'package.json'), '{"name":"@opencoven/research","version":"0.0.0"}');
}

test('a package installed only in a parent checkout is absent for this project', async (t) => {
  const { root, project } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await installResearch(root);
  const config = researchPackageConfig(project);
  assert.equal(config.available, false);
  assert.equal(config.aliases['@opencoven/research-runtime'], './src/lib/server/research-package-absent.ts');
});

test('a package installed in this project is available', async (t) => {
  const { root, project } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await installResearch(project);
  const config = researchPackageConfig(project);
  assert.equal(config.available, true);
  assert.equal(config.aliases['@opencoven/research-runtime'], '@opencoven/research/server');
});

test('no package anywhere is absent', async (t) => {
  const { root, project } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(researchPackageConfig(project).available, false);
});
