import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const hub = await read("apps/ios/CovenCave/CovenCave/Views/FamiliarHubView.swift");
const profile = await read("apps/ios/CovenCave/CovenCave/Views/FamiliarsListView.swift");
const dashboard = await read("apps/ios/CovenCave/CovenCave/Models/FamiliarDashboard.swift");
const models = await read("apps/ios/CovenCave/CovenCave/Models/Models.swift");

assert.match(
  hub,
  /if let profile = section\.data[\s\S]{0,600}FamiliarDetailView\([\s\S]{0,260}identity: snapshot\.identity[\s\S]{0,180}profile: profile[\s\S]{0,180}overview: snapshot\.overview/,
  "Profile renders only dashboard data from the current coherent snapshot",
);
assert.match(
  hub,
  /FamiliarDashboardUnavailableView\([\s\S]{0,180}title: "Profile"[\s\S]{0,180}section\.visibleIssues/,
  "an unreadable Profile section stays visibly unavailable",
);
assert.doesNotMatch(
  hub,
  /FamiliarDetailView\(familiar: familiar\)/,
  "Profile never falls back to a roster-only page that hides section failure",
);
assert.match(
  hub,
  /else \{\s*loadingSkeleton\s*\}/,
  "Profile inherits the hub's explicit initial loading state",
);
assert.match(
  hub,
  /else if let error = entry\.error, entry\.phase == \.failed \{\s*fullSurfaceError\(error\)/,
  "Profile inherits the hub's full-load error state",
);

for (const section of [
  "Identity",
  "Purpose and vocation",
  "Defaults",
  "Memory and media",
  "Capability contract",
  "Access",
]) {
  assert.match(profile, new RegExp(`Text\\(\"${section}\"\\)`), `Profile includes ${section}`);
}

for (const field of [
  "Name",
  "Role",
  "Pronouns",
  "Familiar ID",
  "Purpose",
  "Vocation",
  "Configuration note",
  "Runtime",
  "Self-reports",
  "Memory",
  "Voice",
  "Image defaults",
  "Status",
]) {
  assert.match(
    profile,
    new RegExp(`detailValue\\(\\s*\"${field}\"`),
    `Profile renders ${field}`,
  );
}

assert.match(
  dashboard,
  /enum FamiliarProfilePresentation[\s\S]{0,500}static let notSet = "Not set"/,
  "successful absent values use one explicit Not set contract",
);
assert.match(
  dashboard,
  /guard let memory = section\.data\?\.memory else \{ return "Unavailable" \}/,
  "memory failure is distinct from a successful empty read",
);
for (const field of ["imageProvider", "imageModel", "imageSize", "imageQuality"]) {
  assert.match(models, new RegExp(`var ${field}: String\\? = nil`), `the roster decodes ${field}`);
}

assert.match(
  profile,
  /ViewThatFits\(in: \.horizontal\)[\s\S]{0,900}\.frame\(maxWidth: \.infinity, minHeight: 44/,
  "profile rows stack under Dynamic Type pressure and retain 44-point targets",
);
assert.match(
  profile,
  /\.accessibilityLabel\("\\\(label\): \\\(value\)"\)/,
  "every profile fact exposes its name and value together to VoiceOver",
);
assert.match(
  profile,
  /ModelPickerSheet\([\s\S]{0,400}application: \.familiarDefault/,
  "model editing stays on the familiar-default inventory contract",
);
assert.match(
  profile,
  /FamiliarPermissionsSheet\(familiar: familiar\)/,
  "project and tool access stays on the authoritative permissions surface",
);
assert.match(
  profile,
  /uploadFamiliarAvatar\([\s\S]{0,220}applyFamiliarAvatarMutation[\s\S]*deleteFamiliarAvatar\([\s\S]{0,220}applyFamiliarAvatarMutation/,
  "the avatar affordance is backed by real upload and delete mutations",
);

console.log("ios-familiar-profile.test.mjs: ok");
