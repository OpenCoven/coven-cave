// `next build` that always builds for production (#5701).
//
// Next prerenders /_global-error with the React build NODE_ENV selects. A
// shell that inherited NODE_ENV=development — every terminal and agent session
// the Cave dev server spawns does — made the production build load the
// development React and fail with "Cannot read properties of null (reading
// 'useContext')" while CI, with NODE_ENV unset, stayed green. A build is a
// production build, so this pins NODE_ENV and says so when it overrides one.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/** The environment `next build` runs with: always NODE_ENV=production. */
export function productionBuildEnv(env) {
  return { ...env, NODE_ENV: "production" };
}

/** The one-line notice for an overridden NODE_ENV, or null when none applies. */
export function nodeEnvOverrideNotice(env) {
  const current = env.NODE_ENV;
  if (current === undefined || current === "" || current === "production") return null;
  return `next-build: NODE_ENV=${current} is ignored; building with NODE_ENV=production (#5701).`;
}

function main() {
  const notice = nodeEnvOverrideNotice(process.env);
  if (notice) console.warn(notice);
  const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
  const result = spawnSync(process.execPath, [nextBin, "build", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: productionBuildEnv(process.env),
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
