import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { loadVaultMapForMutation, saveVaultMap } from "../../../lib/vault";
import { GET, PATCH, POST } from "./route";

let root: string;
const legacyRef = "op://Development/OpenAI API Key 2/credential";
const request = (method: string, body: unknown) => new NextRequest("http://localhost/api/vault", {
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cave-vault-route-"));
  vi.stubEnv("COVEN_CAVE_BUNDLE", "1");
  vi.stubEnv("COVEN_CAVE_HOME", root);
  vi.stubEnv("COVEN_VAULT_FILE", "");
  vi.stubEnv("COVEN_CAVE_ENV_FILE", join(root, ".env.local"));
  vi.stubEnv("COVEN_CAVE_LOCAL_VAULT_FILE", join(root, "local-vault.enc.json"));
  vi.stubEnv("COVEN_CAVE_LOCAL_VAULT_KEY_FILE", join(root, "local-vault.key"));
  vi.stubEnv("CAVE_ROUTE_TEST_KEY", "");
  saveVaultMap({ CAVE_ROUTE_TEST_KEY: { ref: legacyRef, scope: ["sage"] } });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

test("loading and changing a familiar grant cannot confirm a legacy reference", async () => {
  const before = readFileSync(join(root, "vault.yaml"), "utf8");
  const response = await GET();
  const payload = await response.json();
  expect(payload.mappings[0].status).toBe("unresolved");
  expect(payload.mappings[0].error).toContain("old Cave default");
  expect(readFileSync(join(root, "vault.yaml"), "utf8")).toBe(before);
  const grant = await PATCH(request("PATCH", { key: "CAVE_ROUTE_TEST_KEY", action: "grant", familiarId: "nova" }));
  expect(grant.status).toBe(200);
  expect(loadVaultMapForMutation().CAVE_ROUTE_TEST_KEY).toEqual({ ref: legacyRef, scope: ["sage", "nova"] });
});

test("saving a reviewed reference confirms only that entry and preserves its grants", async () => {
  const response = await POST(request("POST", { key: "CAVE_ROUTE_TEST_KEY", storage: "1password", ref: legacyRef }));
  expect(response.status).toBe(200);
  expect(loadVaultMapForMutation().CAVE_ROUTE_TEST_KEY).toEqual({
    ref: legacyRef, providerAccessConfirmed: true, scope: ["sage"],
  });
  const status = await (await GET()).json();
  expect(status.mappings[0].status).toBe("configured");
  expect(status.mappings[0].hasValue).toBe(false);
});

test("invalid reference saves cannot confirm provider access", async () => {
  const response = await POST(request("POST", { key: "CAVE_ROUTE_TEST_KEY", storage: "1password", ref: "op://incomplete" }));
  expect(response.status).toBe(400);
  expect(loadVaultMapForMutation().CAVE_ROUTE_TEST_KEY.providerAccessConfirmed).toBeUndefined();
});
