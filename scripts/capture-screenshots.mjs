#!/usr/bin/env node
// Capture the screenshots the README shows, from screenshots/manifest.json.
//
//   pnpm screenshots:readme                       # every capture
//   pnpm screenshots:readme --only home.png       # one capture
//   pnpm screenshots:readme --origin http://127.0.0.1:3412
//
// Without --origin this starts its own production server (`pnpm build` must
// have run) on a free loopback port with an empty temporary home, and stops it
// afterwards. What the images show comes from screenshots/fixtures.json, which
// answers the API reads with synthetic data; nothing from the real ~/.coven
// can reach an image. With --origin, the server is the caller's to vouch for.
//
// A capture fails, and writes no file, when its `waitFor` selector never
// appears: a screenshot of a loading state is worse than no screenshot.
// See docs/workflows/release-train.md, step 11.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const READY_TIMEOUT_MS = 90_000;
const SURFACE_TIMEOUT_MS = 30_000;

// Local screenshots the README embeds, in HTML or Markdown form.
export function readmeImages(readme) {
  const images = [];
  const pattern = /<img\s[^>]*?src="screenshots\/([^"]+)"[^>]*?alt="([^"]*)"|!\[([^\]]*)\]\(screenshots\/([^)\s]+)\)/g;
  for (const match of readme.matchAll(pattern)) {
    images.push(match[1] ? { file: match[1], alt: match[2] } : { file: match[4], alt: match[3] });
  }
  return images;
}

function parseArgs(argv) {
  const options = { only: [] };
  const args = [...argv];
  while (args.length > 0) {
    const arg = args.shift();
    if (!["--origin", "--only", "--out", "--manifest"].includes(arg)) throw new Error(`unknown option ${arg}`);
    if (args.length === 0) throw new Error(`${arg} needs a value`);
    if (arg === "--only") options.only.push(args.shift());
    else options[arg.slice(2)] = args.shift();
  }
  return options;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// A production server this run owns: empty home, demo data only.
async function startServer(log) {
  if (!existsSync(path.join(ROOT, "server.mjs"))) throw new Error("server.mjs is missing; run `pnpm build` first");
  // Short path: the server keeps sockets under its home, and macOS caps their length.
  const home = realpathSync(mkdtempSync("/tmp/cave-shots-"));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, NODE_ENV: "production", COVEN_CAVE_PORT: String(port), PORT: String(port), HOME: home, USERPROFILE: home };
  delete env.COVEN_HOME;
  const child = spawn(process.execPath, ["server.mjs"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const stop = async () => {
    child.kill("SIGTERM");
    await exited;
    rmSync(home, { recursive: true, force: true });
  };

  log(`starting a production server on ${origin} with an empty home`);
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    const ready = await fetch(`${origin}/api/onboarding/status`).then((response) => response.ok, () => false);
    if (ready) return { origin, stop };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await stop();
  throw new Error(`the server did not become ready:\n${output.slice(-2000)}`);
}

// Serve the synthetic fixture for a GET whose path is a fixture key or sits
// under one. Every other request reaches the server and its empty home.
async function routeFixtures(context, fixtures) {
  const keys = Object.keys(fixtures);
  await context.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const key = keys.find((candidate) => pathname === candidate || pathname.startsWith(`${candidate}/`));
    if (key && route.request().method() === "GET") await route.fulfill({ json: fixtures[key] });
    else await route.continue();
  });
}

async function capture({ origin, manifest, fixtures, only, outDir, log }) {
  const { chromium } = await import("@playwright/test");
  const wanted = manifest.captures.filter((entry) => only.length === 0 || only.includes(entry.file));
  const unknown = only.filter((file) => !manifest.captures.some((entry) => entry.file === file));
  if (unknown.length > 0) throw new Error(`not in the manifest: ${unknown.join(", ")}`);

  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const failures = [];
  try {
    for (const entry of wanted) {
      const context = await browser.newContext({
        viewport: manifest.viewport,
        deviceScaleFactor: manifest.deviceScaleFactor,
        colorScheme: manifest.colorScheme,
      });
      await context.addCookies([{ name: "cave_onboarding_dismissed", value: "1", url: origin }]);
      await context.addInitScript((storage) => {
        for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
      }, { "cave:onboarding:dismissed": "1", ...manifest.storage, ...entry.storage });
      await routeFixtures(context, fixtures);
      const page = await context.newPage();
      try {
        await page.goto(new URL(entry.path ?? manifest.path, origin).href, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForSelector(manifest.ready, { timeout: SURFACE_TIMEOUT_MS });
        // A capture with its own path is already on its surface.
        if (!entry.path) {
          await page.evaluate((mode) => {
            window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode } }));
          }, entry.mode);
        }
        await page.waitForSelector(entry.waitFor, { state: "visible", timeout: SURFACE_TIMEOUT_MS });
        for (const selector of entry.click ?? []) {
          await page.locator(selector).first().click({ timeout: SURFACE_TIMEOUT_MS });
        }
        await page.waitForTimeout(entry.settleMs ?? 1200);
        await page.screenshot({ path: path.join(outDir, entry.file), type: "png", animations: "disabled" });
        log(`  ok    ${entry.file}  (${entry.mode})`);
      } catch (error) {
        failures.push(entry.file);
        log(`  FAIL  ${entry.file}: ${error.message.split("\n")[0]}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return failures;
}

export async function main(argv, { log = console.log } = {}) {
  const options = parseArgs(argv);
  const manifest = JSON.parse(readFileSync(options.manifest ?? path.join(ROOT, "screenshots", "manifest.json"), "utf8"));
  const manifestPath = options.manifest ?? path.join(ROOT, "screenshots", "manifest.json");
  const fixtures = manifest.fixtures ? JSON.parse(readFileSync(path.resolve(path.dirname(manifestPath), manifest.fixtures), "utf8")) : {};
  const outDir = path.resolve(options.out ?? path.join(ROOT, "screenshots"));
  const server = options.origin ? { origin: options.origin, stop: async () => {} } : await startServer(log);
  try {
    const failures = await capture({ origin: server.origin, manifest, fixtures, only: options.only, outDir, log });
    if (failures.length > 0) {
      log(`\n${failures.length} capture(s) failed. No file was written for them.`);
      return 1;
    }
    log(`\nWrote to ${outDir}. Look at each image before committing it.`);
    return 0;
  } finally {
    await server.stop();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`capture-screenshots: ${error.message}`);
      process.exit(2);
    },
  );
}
