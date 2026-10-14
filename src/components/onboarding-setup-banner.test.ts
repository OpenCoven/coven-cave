// @ts-nocheck
// Background setup progress banner (#5982). Source pins: the trigger lives in
// the shell beside the other banner triggers, mirrors one banner id in place,
// hides while the dialog shows the same progress, announces transitions, and
// never shows for an idle or unconfirmed run. Workspace still makes no
// bootstrap request of its own.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const banner = await readFile(new URL("./onboarding-setup-banner.tsx", import.meta.url), "utf8");
const host = await readFile(new URL("./onboarding-local-setup-host.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("./shell.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");

assert.match(
  shell,
  /import \{ SetupProgressBannerTrigger \} from "@\/components\/onboarding-setup-banner";/,
  "the shell imports the setup progress trigger",
);
assert.match(
  shell,
  /<CaveHomeMigrationBannerTrigger \/>\s*<SetupProgressBannerTrigger \/>\s*<ShellBannerStrip \/>/,
  "the trigger mounts beside the other banner triggers on every shell route",
);

assert.match(banner, /export const SETUP_BANNER_ID = "onboarding-setup";/, "one stable banner id");
assert.equal(
  (banner.match(/id: SETUP_BANNER_ID,/g) ?? []).length,
  3,
  "running, failed and complete all update the same banner in place",
);
assert.match(
  banner,
  /severity: "info",\s*title,\s*cta: \{ label: "View setup", onClick: openSetup \}/,
  "a running stage is an info banner whose CTA reopens the dialog",
);
assert.match(banner, /`Setting up Cave — \$\{active\.label\}…`/, "the running title names the live stage");
assert.match(
  banner,
  /severity: "warning",\s*title,\s*detail: state\.failure\?\.message,\s*cta: \{ label: "Retry setup", onClick: openSetup \}/,
  "a failure is a warning banner with the message behind Details and Retry routed to the dialog",
);
assert.match(banner, /`Setup stopped at \$\{stageLabel\}\.`/, "the failure title names the blocked stage");
assert.match(
  banner,
  /pushBanner\(\{ id: SETUP_BANNER_ID, severity: "info", title: "Cave is set up\." \}\)/,
  "completion is a plain info banner with only the dismiss control",
);
assert.doesNotMatch(banner, /fetch\("\/api\/onboarding\/bootstrap"/, "the trigger reads through the shared status store");
assert.match(
  banner,
  /usePausablePoll\(async \(\) => \{\s*await fetchOnboardingBootstrapStatus\(\);\s*\}, POLL_MS, \{\s*enabled: phase === "polling" && !dialogOpen,\s*serialize: true,\s*\}\)/,
  "the 2 s poll runs only while armed and the dialog is closed, serialized",
);
assert.match(banner, /const POLL_MS = 2_000;/);
assert.match(
  banner,
  /if \(dialogOpen\) \{[\s\S]*?dismissBanner\(SETUP_BANNER_ID\);/,
  "the banner hides while the dialog is open",
);
assert.match(
  banner,
  /if \(dialogOpen\) \{[\s\S]*?if \(state\?\.complete\) \{\s*clearSetupBackgrounded\(\);\s*setPhase\("idle"\);/,
  "a run that completes inside the dialog never echoes as a banner afterwards",
);
assert.match(banner, /useAnnouncer\(\)/, "transitions use the shared live region");
assert.match(banner, /announceOnce\(\s*`failed:[\s\S]*?"assertive",\s*\)/, "failure announces assertively");
assert.match(banner, /announceOnce\("complete", "Cave is set up\."\)/, "completion is announced once");
assert.match(
  banner,
  /\/\/ Idle \(unconfirmed or interrupted\)[\s\S]*?dismissBanner\(SETUP_BANNER_ID\);[\s\S]*?setPhase\("idle"\);/,
  "idle or unconfirmed state never shows a banner",
);
assert.match(
  banner,
  /if \(consumeSetupBackgrounded\(\)\) activate\(\);[\s\S]*?window\.addEventListener\(SETUP_BACKGROUNDED_EVENT, onBackgrounded\)/,
  "the trigger reads the retained latch on mount and listens for the live event",
);
assert.match(
  banner,
  /if \(phaseRef\.current === "polling"\) markSetupBackgrounded\(\);/,
  "a shell swap re-arms the latch so the next trigger resumes the run",
);
assert.match(banner, /useSetupOpener\("banner"\)/, "the CTA opens setup as a banner-origin request");
assert.match(banner, /return setupHost;/, "the trigger renders the local overlay host when no Workspace listens");

assert.match(host, /if \(requestOpenSetup\(origin\)\) return;/, "a registered host (the Workspace) is preferred");
assert.match(host, /import \{ OnboardingOverlay \} from "@\/components\/lazy-surfaces";/, "the fallback overlay is the lazy chunk");
assert.match(
  host,
  /const unregister = registerSetupHost\(\);[\s\S]*?window\.addEventListener\(SETUP_OPEN_EVENT, listener\)/,
  "a mounted local host registers so later requests on the same route reuse it",
);

assert.doesNotMatch(workspace, /fetch\("\/api\/onboarding\/bootstrap"/, "Workspace still makes no bootstrap request");
assert.match(workspace, /const unregisterHost = registerSetupHost\(\);/, "the Workspace registers as the dialog host");
assert.match(
  workspace,
  /onboardingOriginRef\.current = readSetupOpenOrigin\(event\);\s*openCreate\(\);/,
  "the bridge records who asked before opening",
);
assert.match(
  workspace,
  /if \(origin === "surface" && daemonRunning && familiars\.length === 0\) setMode\("agents"\);/,
  "only surface opens keep the first-run redirect to Familiars",
);

console.log("onboarding-setup-banner.test.ts: ok");
