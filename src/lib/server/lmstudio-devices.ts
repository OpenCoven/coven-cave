// Which computer an LM Studio model runs on (#6094).
//
// LM Studio's LM Link serves models loaded on another computer through the
// local server, so `http://127.0.0.1:1234` can answer with inference that
// happens elsewhere. Its REST API carries no device field (LM Studio 0.4.21:
// /v1/models, /api/v0/models and /api/v1/models all list a linked model like a
// local one). The `lms` CLI does: every `lms ls --json` entry has a
// `deviceIdentifier`, null for a model on this computer and the peer's id for
// a linked one, and `lms link status --json` names the peers.
//
// Cave asks `lms` only after the LM Studio server has answered, so the CLI
// never has to wake the LM Studio service. Each call is bounded. When `lms`
// can't be found or doesn't answer, the result says so; it never guesses that
// a model is local.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { canonicalProbeSpawnEnv, warmHarnessSpawnPath } from "../harness-spawn-env.ts";

/** Runs `lms` with fixed arguments and resolves its stdout, or null when it fails. */
export type LmsRunner = (args: string[]) => Promise<string | null>;

export type LmStudioDeviceListing =
  | {
    ok: true;
    /** This computer's LM Link device id, when LM Link reports one. */
    thisDevice: string | null;
    /** Every model `lms ls` lists, with the device it is on (null: this computer). */
    models: Array<{ key: string; device: string | null }>;
    /** Linked peers' display names by device id. */
    deviceNames: Record<string, string>;
  }
  | { ok: false };

/** Where a model the LM Studio server lists actually runs. */
export type LmStudioModelLocation =
  | { kind: "this-computer" }
  | { kind: "lm-link"; deviceName: string | null }
  | { kind: "unchecked" };

// `lms` answers in about 0.3 s warm and about 1 s cold.
const LMS_TIMEOUT_MS = 6_000;
const LMS_MAX_BYTES = 4 * 1024 * 1024;
const MAX_ENTRIES = 500;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deviceId(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(value) ? value : undefined;
}

function displayName(value: unknown): string | null {
  return typeof value === "string" && value.trim() && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value)
    ? value.trim()
    : null;
}

/** The models in `lms ls --json`, or null when the output isn't that list. */
export function parseLmsModelList(stdout: string): Array<{ key: string; device: string | null }> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const models: Array<{ key: string; device: string | null }> = [];
  for (const entry of parsed.slice(0, MAX_ENTRIES)) {
    if (!record(entry) || typeof entry.modelKey !== "string" || !entry.modelKey) continue;
    const device = deviceId(entry.deviceIdentifier);
    // An unreadable device id can't prove the model is local.
    models.push({ key: entry.modelKey, device: device === undefined ? "unknown" : device });
  }
  return models;
}

/** This device and the peers' names from `lms link status --json`. */
export function parseLmsLinkStatus(stdout: string): { thisDevice: string | null; deviceNames: Record<string, string> } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!record(parsed)) return null;
  const deviceNames: Record<string, string> = {};
  for (const peer of Array.isArray(parsed.peers) ? parsed.peers.slice(0, MAX_ENTRIES) : []) {
    if (!record(peer)) continue;
    const id = deviceId(peer.deviceIdentifier);
    const name = displayName(peer.deviceName);
    if (id && name) deviceNames[id] = name;
  }
  return { thisDevice: deviceId(parsed.deviceIdentifier) ?? null, deviceNames };
}

function lmsCommand(): string {
  const executable = process.platform === "win32" ? "lms.exe" : "lms";
  // LM Studio installs its CLI here; a GUI-launched Cave may not have it on PATH.
  const installed = path.join(homedir(), ".lmstudio", "bin", executable);
  return existsSync(installed) ? installed : executable;
}

/** Run the installed `lms` with a credential-free environment and a short timeout. */
export const runLms: LmsRunner = async (args) => {
  let env: NodeJS.ProcessEnv;
  try {
    // The probe environment's PATH comes from a login shell. Warm it without
    // blocking first, as other request paths do, so building it reads the cache.
    await warmHarnessSpawnPath();
    env = canonicalProbeSpawnEnv();
  } catch {
    env = { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  }
  return new Promise((resolve) => {
    try {
      execFile(lmsCommand(), args, { env, timeout: LMS_TIMEOUT_MS, maxBuffer: LMS_MAX_BYTES, windowsHide: true }, (error, stdout) => {
        resolve(error ? null : String(stdout));
      });
    } catch {
      resolve(null);
    }
  });
};

/** Ask `lms` which device each model is on. Peer names are optional; the model list is not. */
export async function readLmStudioDevices(runner: LmsRunner = runLms): Promise<LmStudioDeviceListing> {
  const [list, link] = await Promise.all([runner(["ls", "--json"]), runner(["link", "status", "--json"])]);
  const models = list === null ? null : parseLmsModelList(list);
  if (!models) return { ok: false };
  const status = link === null ? null : parseLmsLinkStatus(link);
  return { ok: true, thisDevice: status?.thisDevice ?? null, models, deviceNames: status?.deviceNames ?? {} };
}

/**
 * Where the server's model `name` runs. A model is on this computer only when
 * `lms` lists it here and on no linked device: LM Studio routes a model that
 * exists on several devices to the preferred one, which may be the peer. A
 * model the server lists but `lms` doesn't list here is treated as linked.
 */
export function lmStudioModelLocation(name: string, listing: LmStudioDeviceListing): LmStudioModelLocation {
  if (!listing.ok) return { kind: "unchecked" };
  const devices = listing.models.filter((model) => model.key === name).map((model) => model.device);
  const elsewhere = devices.find((device) => device !== null && device !== listing.thisDevice);
  if (elsewhere !== undefined) return { kind: "lm-link", deviceName: elsewhere ? listing.deviceNames[elsewhere] ?? null : null };
  if (devices.length > 0) return { kind: "this-computer" };
  return { kind: "lm-link", deviceName: null };
}
