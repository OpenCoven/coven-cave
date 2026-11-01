import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const runner = fileURLToPath(new URL("./start-playwright-production.mjs", import.meta.url));

test("CI builds before serving and a failed build cannot launch a stale server", async () => {
  const previous = process.env.CI;
  process.env.CI = "true";
  let config;
  try {
    config = (await import("../playwright.config.ts?production-server-test")).default;
  } finally {
    if (previous === undefined) delete process.env.CI;
    else process.env.CI = previous;
  }
  assert.match(config.webServer.command, /^pnpm build && node scripts\/start-playwright-production\.mjs \d+$/);
  assert.equal(config.webServer.reuseExistingServer, false);
  assert.equal(config.webServer.env.COVEN_CAVE_E2E, "1");
  assert.equal(config.webServer.env.NEXT_PUBLIC_CAVE_ROOMS, "all",
    "production fixtures must retain the dev suite's registered-room coverage");

  const root = mkdtempSync(path.join(tmpdir(), "cave-e2e-build-failure-"));
  try {
    writeFileSync(path.join(root, "pnpm"), '#!/bin/sh\n[ "$*" = "build" ] || exit 99\nexit 23\n');
    chmodSync(path.join(root, "pnpm"), 0o755);
    const failed = spawnSync(config.webServer.command, {
      shell: true,
      cwd: root,
      env: { ...process.env, PATH: `${root}${path.delimiter}${process.env.PATH}` },
      encoding: "utf8",
    });
    assert.equal(failed.status, 23, failed.stderr);
    assert.equal(failed.stderr, "", "the server command must not execute after a failed build");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("only the stream benchmark may build another room visibility (#6338)", async () => {
  const previous = { ...process.env };
  const stateRoot = mkdtempSync(path.join(tmpdir(), "cave-stream-rooms-"));
  let stream;
  let ordinary;
  try {
    process.env.CI = "true";
    process.env.CAVE_STREAM_ROOMS = "none";
    delete process.env.CAVE_STREAM_PERFORMANCE;
    ordinary = (await import("../playwright.config.ts?ordinary-rooms-test")).default;
    process.env.CAVE_STREAM_PERFORMANCE = "1";
    process.env.CAVE_STREAM_STATE_ROOT = stateRoot;
    stream = (await import("../playwright.config.ts?stream-rooms-test")).default;
  } finally {
    for (const key of ["CI", "CAVE_STREAM_ROOMS", "CAVE_STREAM_PERFORMANCE", "CAVE_STREAM_STATE_ROOT"]) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    rmSync(stateRoot, { recursive: true, force: true });
  }
  assert.equal(ordinary.webServer.env.NEXT_PUBLIC_CAVE_ROOMS, "all",
    "the E2E suite keeps every registered room whatever the benchmark setting says");
  assert.equal(stream.webServer.env.NEXT_PUBLIC_CAVE_ROOMS, "none");
  assert.equal(stream.webServer.env.COVEN_RESEARCH_ENABLED, "0");
});

test("the production fixture serves this build's assets with isolated runtime settings", () => {
  const root = mkdtempSync(path.join(tmpdir(), "cave-production-e2e-"));
  try {
    for (const dir of ["public", ".next/static", ".next/standalone"]) {
      mkdirSync(path.join(root, dir), { recursive: true });
    }
    writeFileSync(path.join(root, "public/fixture.txt"), "public fixture");
    writeFileSync(path.join(root, ".next/static/chunk.js"), "current chunk");
    writeFileSync(path.join(root, ".next/standalone/server.js"), `
      const { readFileSync } = require("node:fs");
      const path = require("node:path");
      console.log(JSON.stringify({
        public: readFileSync(path.join(__dirname, "public/fixture.txt"), "utf8"),
        chunk: readFileSync(path.join(__dirname, ".next/static/chunk.js"), "utf8"),
        mode: process.env.NODE_ENV,
        host: process.env.HOSTNAME,
        port: process.env.PORT,
        home: process.env.COVEN_CAVE_HOME,
        e2e: process.env.COVEN_CAVE_E2E,
      }));
    `);
    const result = spawnSync(process.execPath, [runner, "3148"], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: "development",
        HOSTNAME: "external-host",
        PORT: "9999",
        COVEN_CAVE_E2E: "1",
        COVEN_CAVE_HOME: path.join(root, "isolated-home"),
      },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      public: "public fixture",
      chunk: "current chunk",
      mode: "production",
      host: "127.0.0.1",
      port: "3148",
      home: path.join(root, "isolated-home"),
      e2e: "1",
    });

    // A failed/incomplete build must not start even if an old server remains.
    rmSync(path.join(root, ".next/static"), { recursive: true });
    const incomplete = spawnSync(process.execPath, [runner, "3148"], {
      cwd: root, encoding: "utf8",
    });
    assert.notEqual(incomplete.status, 0);
    assert.equal(incomplete.stdout, "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
