#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Build an isolated test executable; never replace the installed daemon or
// write to the source checkout. Compatibility is explicit, never floating main.
const sourceArgument = process.argv[2];
if (!sourceArgument) throw new Error("Usage: node scripts/build-threads-live-daemon.mjs /absolute/path/to/coven");
if (!path.isAbsolute(sourceArgument)) throw new Error("Coven source path must be absolute");
const source = realpathSync(sourceArgument);
const pin = JSON.parse(readFileSync(new URL("../tests/threads-live-daemon/compatibility.json", import.meta.url), "utf8"));
const digest = file => createHash("sha256").update(readFileSync(file)).digest("hex");
function run(command, args, cwd = source) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr}`);
  return result.stdout;
}
function verifySource() {
  if (run("git", ["rev-parse", "HEAD"]).trim() !== pin.covenCommit) throw new Error("Coven commit differs from the reviewed compatibility pin");
  if (run("git", ["status", "--porcelain"]).trim()) throw new Error("Coven source checkout must be clean");
  if (digest(path.join(source, "Cargo.lock")) !== pin.cargoLockSha256) throw new Error("Coven lockfile differs from the reviewed pin");
}
verifySource();
const metadata = JSON.parse(run("cargo", ["metadata", "--locked", "--format-version", "1"]));
const threads = metadata.packages.filter(pkg => pkg.name === "coven-threads-core");
if (threads.length !== 1 || threads[0].source !== `git+https://github.com/OpenCoven/coven-threads?rev=${pin.threadsCommit}#${pin.threadsCommit}`) {
  throw new Error("Cargo did not resolve the exact reviewed Threads dependency");
}
const output = mkdtempSync(path.join(tmpdir(), "cave-threads-build-"));
console.error(`Building clock-enabled test daemon in ${output}`);
run("cargo", ["build", "--locked", "-p", "coven-cli", "--bin", "coven", "--features", "threads-test-clock", "--target-dir", output]);
const corpus = JSON.parse(run("cargo", ["run", "--quiet", "--locked", "--manifest-path", threads[0].manifest_path,
  "--example", "generate_phase5_retired_ward_corpus", "--target-dir", output]));
if (corpus.schema_version !== "phase5-retired-ward-synthetic-v1" || corpus.provenance?.kind !== "synthetic"
  || corpus.provenance?.historical_data_used !== false) throw new Error("Expected repository-authored synthetic corpus");
verifySource();
const binary = path.join(output, "debug", process.platform === "win32" ? "coven.exe" : "coven");
const corpusPath = path.join(output, "corpus.json");
writeFileSync(corpusPath, JSON.stringify(corpus, null, 2) + "\n", { mode: 0o600 });
const manifest = path.join(output, "provenance.json");
writeFileSync(manifest, JSON.stringify({ ...pin, schema: "cave-threads-live-binary-v1", binary,
  binarySha256: digest(binary), corpus: corpusPath, corpusSha256: digest(corpusPath),
  features: ["threads-test-clock"], platform: process.platform,
  builder: fileURLToPath(import.meta.url) }, null, 2) + "\n", { mode: 0o600 });
console.log(manifest);
