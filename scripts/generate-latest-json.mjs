#!/usr/bin/env node
// Build the Tauri updater manifest (latest.json) from a published GitHub
// release by discovering the signed updater artifacts already uploaded by the
// build matrix. We DISCOVER `<artifact>` + `<artifact>.sig` pairs rather than
// hardcoding installer names, so it's robust to per-platform naming (esp. the
// Windows .msi vs .msi.zip variance across Tauri versions).
//
//   node scripts/generate-latest-json.mjs <tag> [version] > latest.json
//
// Platforms are included only when a signed artifact exists; missing platforms
// are logged and skipped (the app falls back to manual download for those).
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [tag, versionArg] = process.argv.slice(2);
if (!tag) {
  console.error("usage: generate-latest-json.mjs <tag> [version]");
  process.exit(1);
}
const repo = process.env.RELEASE_REPO || "OpenCoven/coven-cave";
const version = (versionArg || tag).replace(/^v/, "");

const gh = (args) => execFileSync("gh", args, { encoding: "utf8" });

const assets = JSON.parse(
  gh(["release", "view", tag, "--repo", repo, "--json", "assets"]),
).assets.map((a) => a.name);

// Pull every signature file so we can read its contents locally.
const dir = mkdtempSync(join(tmpdir(), "latestjson-"));
try {
  gh(["release", "download", tag, "--repo", repo, "--dir", dir, "--pattern", "*.sig", "--clobber"]);
} catch (e) {
  console.error("warning: failed to download .sig assets:", e.message);
}

const sigFor = (name) => {
  const p = join(dir, `${name}.sig`);
  return existsSync(p) ? readFileSync(p, "utf8").trim() : null;
};
const urlFor = (name) =>
  `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`;

const platforms = {};
const add = (key, predicate) => {
  const artifact = assets.find((n) => !n.endsWith(".sig") && predicate(n) && sigFor(n));
  if (!artifact) {
    console.error(`skip ${key}: no signed artifact found`);
    return;
  }
  platforms[key] = { signature: sigFor(artifact), url: urlFor(artifact) };
  console.error(`include ${key}: ${artifact}`);
};

add("darwin-aarch64", (n) => n.endsWith("-aarch64.app.tar.gz"));
add("darwin-x86_64", (n) => n.endsWith("-x86_64.app.tar.gz"));
add("linux-x86_64", (n) => n.endsWith(".AppImage"));
add(
  "windows-x86_64",
  (n) => n.endsWith(".msi.zip") || n.endsWith(".nsis.zip") || n.endsWith(".msi") || n.endsWith("-setup.exe"),
);

if (Object.keys(platforms).length === 0) {
  console.error("ERROR: no signed updater artifacts found on the release; refusing to write an empty manifest");
  process.exit(2);
}

const manifest = { version, pub_date: new Date().toISOString(), platforms };
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
