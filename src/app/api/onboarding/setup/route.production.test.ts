// @ts-nocheck
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(".test-tmp", `onboarding-lifecycle-${process.pid}`);
process.env.COVEN_HOME = root;
delete process.env.COVEN_CAVE_HOME;
delete globalThis.__caveHomeMigration;

function request(id: string): Request {
  return new Request("http://local/api/onboarding/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiar: {
        id,
        displayName: id,
        description: `Description for ${id}`,
        harness: "codex",
        model: "openai/gpt-5.6-sol",
      },
    }),
  });
}

try {
  await rm(root, { recursive: true, force: true });
  await mkdir(path.join(root, "cave"), { recursive: true });
  const {
    loadConfig,
    saveConfig,
    saveConfigUnlocked,
    withFamiliarLifecycleGuard,
  } = await import("../../../../lib/cave-config.ts");
  const { POST } = await import("./route.ts");

  await saveConfig({
    roles: [{ id: "preserved-role", name: "Preserved role", prompt: "keep" }],
    marketplace: { installed: { preserved: { enabled: true } } },
  });

  let releaseMutation: () => void;
  let mutationStarted: () => void;
  const mutationGate = new Promise<void>((resolve) => {
    releaseMutation = resolve;
  });
  const started = new Promise<void>((resolve) => {
    mutationStarted = resolve;
  });
  const mutation = withFamiliarLifecycleGuard(async () => {
    await saveConfigUnlocked({
      familiars: { "lifecycle-racer": { harness: "codex" } },
    });
    mutationStarted();
    await mutationGate;
  });
  await started;

  let setupSettled = false;
  const setup = POST(request("onboarding-racer")).then((response) => {
    setupSettled = true;
    return response;
  });
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.equal(setupSettled, false, "onboarding must wait for an in-flight lifecycle mutation");
  releaseMutation();
  const [response] = await Promise.all([setup, mutation]);
  assert.equal(response.status, 200);

  const afterRace = await loadConfig();
  assert.ok(afterRace.familiars["lifecycle-racer"]);
  assert.ok(afterRace.familiars["onboarding-racer"]);
  assert.equal(afterRace.roles[0]?.id, "preserved-role");
  assert.ok(afterRace.marketplace.installed.preserved);

  const configPath = path.join(root, "cave", "config.json");
  const tomlPath = path.join(root, "familiars.toml");
  const configBeforeFailure = await readFile(configPath, "utf8");
  const tomlBeforeFailure = await readFile(tomlPath, "utf8");
  await chmod(path.join(root, "cave"), 0o555);
  try {
    await assert.rejects(() => POST(request("onboarding-write-failure")));
  } finally {
    await chmod(path.join(root, "cave"), 0o755);
  }
  assert.equal(await readFile(configPath, "utf8"), configBeforeFailure);
  assert.equal(
    await readFile(tomlPath, "utf8"),
    tomlBeforeFailure,
    "a config failure rolls back the associated TOML declaration",
  );

  console.log("onboarding setup production lifecycle tests: ok");
} finally {
  delete process.env.COVEN_HOME;
  delete globalThis.__caveHomeMigration;
  await chmod(path.join(root, "cave"), 0o755).catch(() => {});
  await rm(root, { recursive: true, force: true });
}
