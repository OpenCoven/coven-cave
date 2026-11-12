/**
 * Whether this build carries the optional OpenCoven Submissions implementation
 * (#6401). It is excluded unless asked for, so the default build holds none of
 * its page, validator or catalog code. Rebuilding with the flag reinstalls it;
 * saved submissions stay in place either way.
 */
export function submissionsBuildConfig(env = process.env) {
  const included = env.COVEN_CAVE_INCLUDE_SUBMISSIONS === '1';
  return {
    included,
    aliases: {
      '@opencoven/submissions-availability': included
        ? './src/lib/server/opencoven-submissions-available.ts'
        : './src/lib/server/opencoven-submissions-unavailable.ts',
      '@opencoven/submissions-runtime': included
        ? './src/lib/server/opencoven-submissions-runtime.ts'
        : './src/lib/server/opencoven-submissions-absent.ts',
      '@opencoven/submissions-page': included
        ? './src/components/opencoven-submission-page.tsx'
        : './src/components/opencoven-submissions-absent-page.tsx',
    },
  };
}
