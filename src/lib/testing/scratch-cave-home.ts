/**
 * Point every Cave home, vault and env-file path at a throwaway directory so
 * a route test can store credentials and config without touching the
 * developer's own state (#6359). Call before importing the module under test.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export type ScratchCaveHome = {
  root: string;
  caveHome: string;
  cleanup(): void;
};

export function isolateCaveHome(prefix: string): ScratchCaveHome {
  const root = mkdtempSync(path.join(tmpdir(), `${prefix}-`));
  const covenHome = path.join(root, ".coven");
  const caveHome = path.join(covenHome, "cave");
  mkdirSync(caveHome, { recursive: true });
  process.env.HOME = root;
  process.env.COVEN_HOME = covenHome;
  process.env.COVEN_CAVE_HOME = caveHome;
  process.env.COVEN_CAVE_ENV_FILE = path.join(root, ".env.local");
  process.env.COVEN_VAULT_FILE = path.join(root, "vault.yaml");
  process.env.COVEN_CAVE_LOCAL_VAULT_FILE = path.join(root, "local-vault.enc.json");
  process.env.COVEN_CAVE_LOCAL_VAULT_KEY_FILE = path.join(root, "local-vault.key");
  return {
    root,
    caveHome,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
