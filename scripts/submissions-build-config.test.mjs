import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { submissionsBuildConfig } from './submissions-build-config.mjs';

test('a default build excludes Submissions, whatever else is in the environment', () => {
  for (const env of [{}, { COVEN_CAVE_INCLUDE_SUBMISSIONS: '0' }, { COVEN_CAVE_INCLUDE_SUBMISSIONS: 'true' }]) {
    const config = submissionsBuildConfig(env);
    assert.equal(config.included, false);
    assert.match(config.aliases['@opencoven/submissions-runtime'], /absent/);
    assert.match(config.aliases['@opencoven/submissions-page'], /absent/);
  }
});

test('the flag reinstalls the implementation', () => {
  const config = submissionsBuildConfig({ COVEN_CAVE_INCLUDE_SUBMISSIONS: '1' });
  assert.equal(config.included, true);
  assert.match(config.aliases['@opencoven/submissions-runtime'], /opencoven-submissions-runtime\.ts$/);
  assert.match(config.aliases['@opencoven/submissions-page'], /opencoven-submission-page\.tsx$/);
});

test('every alias target exists in both configurations', () => {
  for (const env of [{}, { COVEN_CAVE_INCLUDE_SUBMISSIONS: '1' }]) {
    for (const target of Object.values(submissionsBuildConfig(env).aliases)) {
      assert.ok(existsSync(path.resolve(target)), target);
    }
  }
});
