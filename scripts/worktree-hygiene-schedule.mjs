#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LABEL = "ai.opencoven.cave-worktree-hygiene";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function xml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function command(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", ...options });
  return {
    ok: result.status === 0 && !result.error,
    out: String(result.stdout ?? "").trim(),
    err: [String(result.stderr ?? "").trim(), result.error?.message ?? ""].filter(Boolean).join("\n"),
  };
}

export function launchAgentPlist({ node, hygieneScript, repo, logPath, hour = 19, minute = 15 }) {
  const args = [node, hygieneScript, "scheduled", "--root", repo, "--fetch", "--json"];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((arg) => `    <string>${xml(arg)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key><string>${xml(repo)}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>${hour}</integer>
    <key>Minute</key><integer>${minute}</integer>
  </dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>${xml(logPath)}</string>
  <key>StandardErrorPath</key><string>${xml(logPath)}</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
`;
}

function paths() {
  const home = os.homedir();
  return {
    plist: path.join(home, "Library", "LaunchAgents", `${LABEL}.plist`),
    logDir: path.join(home, ".coven", "logs"),
    log: path.join(home, ".coven", "logs", "cave-worktree-hygiene.log"),
  };
}

function rootFrom(cwd) {
  const result = command("git", ["-C", cwd, "rev-parse", "--show-toplevel"]);
  if (!result.ok) throw new Error(`not inside a git repository: ${result.err}`);
  return result.out;
}

function installedStatus(plist) {
  const result = command("launchctl", ["print", `gui/${process.getuid()}/${LABEL}`]);
  return { loaded: result.ok, plistExists: existsSync(plist), detail: result.ok ? result.out.split("\n")[0] : result.err };
}

function main(argv = process.argv.slice(2)) {
  const action = argv[0] ?? "status";
  if (process.platform !== "darwin") {
    console.error("worktree-hygiene-schedule: automatic installation currently supports macOS launchd only");
    return 2;
  }
  const p = paths();
  if (action === "status") {
    console.log(JSON.stringify({ label: LABEL, plist: p.plist, log: p.log, ...installedStatus(p.plist) }, null, 2));
    return 0;
  }
  if (action === "uninstall") {
    command("launchctl", ["bootout", `gui/${process.getuid()}`, p.plist]);
    if (existsSync(p.plist)) rmSync(p.plist);
    console.log(`Removed ${LABEL}. Existing hygiene logs were preserved at ${p.log}.`);
    return 0;
  }
  if (action !== "install") {
    console.error("Usage: node scripts/worktree-hygiene-schedule.mjs install|status|uninstall");
    return 1;
  }

  const repo = rootFrom(process.cwd());
  const node = process.execPath;
  const hygieneScript = path.join(scriptDir, "worktree-hygiene.mjs");
  mkdirSync(path.dirname(p.plist), { recursive: true });
  mkdirSync(p.logDir, { recursive: true });
  const plist = launchAgentPlist({ node, hygieneScript, repo, logPath: p.log });
  writeFileSync(p.plist, plist, { mode: 0o600 });

  command("launchctl", ["bootout", `gui/${process.getuid()}`, p.plist]);
  const loaded = command("launchctl", ["bootstrap", `gui/${process.getuid()}`, p.plist]);
  if (!loaded.ok) {
    console.error(`Failed to load ${LABEL}: ${loaded.err}`);
    return 1;
  }
  console.log(`Installed ${LABEL}. It runs daily at 19:15 local time; Sundays emit the weekly report.`);
  console.log(`Reports: ${p.log}`);
  console.log("The schedule is report-only: it fetches/prunes remote-tracking refs and never runs --apply.");
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();

export { LABEL, main };
