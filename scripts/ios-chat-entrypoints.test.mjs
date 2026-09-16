import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const ios = new URL("../apps/ios/CovenCave/", import.meta.url);
const read = (path) => readFileSync(new URL(path, ios), "utf8");

test("chat keeps conversation controls but no task or marketplace entrypoints", () => {
  const chat = read("CovenCave/Views/ChatView.swift");
  for (const retired of [
    "showTasks", "LinkedTasksSheet", "linkedContextStrip", "app.tasks",
    "app.loadTasks", "app.reconcileCardLinks", "PluginsPanel",
  ]) {
    assert.ok(!chat.includes(retired), `${retired} is retired from chat`);
  }
  for (const retained of [
    "ModelPickerSheet(", "FamiliarPermissionsSheet(", "LiveVoiceCallView(",
    "FamiliarPickerSheet(", "FamiliarThreadsView(", "attachmentPreviews",
    "flushDraftPersistence()", "retryAssistant(", "modelMutationQueue",
    "persistThreadsBeforeDispatch", "connectionDispatchLeaseIsCurrent",
  ]) {
    assert.ok(chat.includes(retained), `${retained} remains part of chat`);
  }
  assert.doesNotMatch(chat, /startFreshThreadInActiveProject|app\.activeProject|app\.canStartProjectChats/,
    "new and replacement chats cannot inherit ambient workspace access");
  assert.match(chat, /NewChatView\(initialFamiliarIds: thread\.familiarIds\)/,
    "new and replacement chats reuse the explicit per-chat access workflow");
});

test("Siri and Spotlight offer chats, with side-effect-free legacy responses", () => {
  const intents = read("CovenCave/Intents/CaveAppIntents.swift");
  const offered = intents.slice(intents.indexOf("struct CaveShortcuts"));
  assert.match(offered, /intent: OpenChatsIntent\(\)/);
  assert.doesNotMatch(offered, /NewReminderIntent|RunningTasksIntent/);
  for (const name of ["NewReminderIntent", "RunningTasksIntent"]) {
    const legacy = intents.match(new RegExp(`struct ${name}: AppIntent \\{([\\s\\S]*?)(?=\\nstruct |\\n\\/\\/\\/|$)`))?.[1];
    assert.ok(legacy, `${name} stays resolvable for saved shortcuts`);
    assert.match(legacy, /static var isDiscoverable: Bool = false/);
    assert.match(legacy, /\.result\(dialog: "[^"]*desktop/);
    assert.doesNotMatch(legacy, /CaveClient|createReminder|\.tasks\(\)|OpenURLIntent/);
  }
});

test("widgets and Control Center offer only chat destinations", () => {
  const widgets = read("CovenCaveWidgets/CovenCaveWidgets.swift");
  const controls = read("CovenCaveWidgets/CovenCaveControls.swift");
  assert.match(widgets, /ChatLiveActivity\(\)/);
  assert.match(widgets, /ChatsControl\(\)/);
  assert.match(widgets, /covencave:\/\/thread\//);
  assert.match(controls, /covencave:\/\/chats/);
  assert.doesNotMatch(widgets + controls, /TaskLiveActivity|TasksControl|runningTaskCount|covencave:\/\/(?:task|reminder|automation)/);
});

test("retired reminder alerts are cleared without touching chat alerts or backend data", () => {
  const reminders = read("CovenCave/Notifications/ReminderNotifications.swift");
  const chat = read("CovenCave/Notifications/ChatNotifications.swift");
  assert.match(reminders, /override init\(\)[\s\S]{0,100}Task \{ await ReminderNotifications\.clear\(\) \}/);
  assert.match(reminders, /static func sync\(_: \[Reminder\]\) async \{\s*await clear\(\)/);
  assert.match(reminders, /identifier\.hasPrefix\(idPrefix\)/);
  assert.match(reminders, /idPrefix = "cave\.reminder\."/);
  assert.match(reminders, /removePendingNotificationRequests\(withIdentifiers: ours\)/);
  assert.match(reminders, /removeDeliveredNotifications\(withIdentifiers: retired\)/);
  assert.match(reminders, /willPresent notification:[\s\S]{0,220}isRetiredRequest/);
  assert.doesNotMatch(reminders, /UNCalendarNotificationTrigger|center\.add\(|center\.requestAuthorization|removeAll|CaveClient|destination: \.tasks/);
  assert.match(chat, /requestAuthorization\(options: \[\.alert, \.sound, \.badge\]\)/);
  assert.match(chat, /center\.add\(request\)/);
});

test("native quick actions and notification categories cannot advertise retired destinations", () => {
  function swiftSources(directory) {
    return readdirSync(new URL(directory, ios), { withFileTypes: true }).flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      return entry.isDirectory() ? swiftSources(path) : path.endsWith(".swift") ? [read(path)] : [];
    });
  }
  const source = swiftSources("CovenCave").join("\n");
  const plist = read("CovenCave/Info.plist");
  assert.doesNotMatch(plist, /UIApplicationShortcutItems/);
  assert.doesNotMatch(source, /UIApplicationShortcutItem\s*\(|UNNotificationCategory\s*\(/,
    "adding native quick actions or categories requires an explicit chat-only contract");
});

test("chat UI scenarios explicitly open their fixture instead of assuming chat-first boot", () => {
  const activity = read("CovenCaveUITests/AgentActivityUITests.swift");
  const sessions = read("CovenCaveUITests/SessionSwitchUITests.swift");
  assert.match(activity, /launchEnvironment\["CAVE_OPEN_THREAD"\] = "ui-preview-tool-activity"/);
  assert.match(sessions, /launchEnvironment\["CAVE_OPEN_THREAD"\] = "ui-preview-empty-chat"/);
  for (const scenario of [
    "testComposerOffersChatActionsWithoutTaskOrMarketplaceManagement",
    "testCommandReferenceDoesNotOfferRetiredTaskNavigation",
    "testTypedLegacyTaskCommandExplainsDesktopOnlyAndKeepsTheChat",
  ]) {
    assert.match(sessions, new RegExp(`func ${scenario}\\(\\) \\{\\s*let app = launchInFirstThread\\((?:clearDraft: true)?\\)`));
  }
});

test("readable chat history does not authorize sends while project access is unavailable", () => {
  const chat = read("CovenCave/Views/ChatView.swift");
  const commands = read("CovenCave/Models/SlashCommand.swift");
  const app = read("CovenCave/State/AppModel.swift");
  assert.match(app, /var chatAccessIsCurrent: Bool \{\s*projectsLoaded && projectMembershipLoaded && projectContextError == nil/);
  assert.match(chat, /private var chatAccessLoaded: Bool \{\s*app\.chatAccessIsCurrent\(projectRoot: thread\.projectRoot, familiarIds: thread\.familiarIds\)/);
  assert.match(chat, /private func requireChatAccess\(\) -> Bool \{\s*app\.requireCurrentChatAccess\(projectRoot: thread\.projectRoot, familiarIds: thread\.familiarIds\)/);
  assert.match(chat, /if !chatAccessLoaded \{[\s\S]{0,350}Button\("Refresh access"\)/);
  assert.match(chat, /private var voiceCallLaunch:[\s\S]{0,350}guard chatAccessLoaded else \{ return nil \}/);
  assert.match(chat, /return chatAccessLoaded && thread\.canSendMessages/);
  assert.match(chat, /case \.prose\(let text\):[\s\S]{0,160}guard requireChatAccess\(\) else \{ return \}/,
    "ordinary sends check access before clearing drafts or attachments");
  for (const name of ["sendSuggestion", "startDiagram", "forward"]) {
    const body = chat.slice(chat.indexOf(`private func ${name}(`));
    assert.match(body.slice(0, 700), /guard requireChatAccess\(\) else \{ return \}/,
      `${name} checks current access before initiating a message write`);
  }
  assert.match(chat, /private func retryAssistant[\s\S]{0,550}app\.requireCurrentChatAccess\(projectRoot: thread\.projectRoot, familiarIds: \[familiarId\]\)/,
    "retry authorizes the selected reply's recipient rather than an ambient roster");
  const lateChecks = [...chat.matchAll(/liveDispatchLeaseIsCurrent: \{([\s\S]*?)\}/g)];
  assert.equal(lateChecks.length, 6);
  for (const [, check] of lateChecks) {
    assert.match(check, /dispatchIsCurrent\((?:dispatchBinding|destinationBinding), in: (?:thread|destination), lease: dispatchLease\)/,
      "the captured endpoint, root and recipients are rechecked at the actual dispatch");
  }
  assert.match(chat, /private func dispatchIsCurrent[\s\S]{0,600}connectionDispatchLeaseIsCurrent\(lease\)[\s\S]*binding\.matches\(target\)[\s\S]*app\.chatAccessIsCurrent\(projectRoot: binding\.projectRoot, familiarIds: binding\.familiarIds\)/);
  assert.match(commands, /case \.sendAsPrompt, \.startDiagram: return true/);
  assert.match(chat, /if command\.sendsChatMessage \{\s*guard requireChatAccess\(\)/,
    "typed message commands keep the draft intact when authorization is unavailable");
  assert.match(chat, /if case \.command\(let command, _\) = SlashInput\.parse\(draft\), !command\.sendsChatMessage \{\s*return true/,
    "local navigation and desktop-only explanations remain usable");
});

test("voice retains one captured presentation and permanently ends it on authority loss", () => {
  const chat = read("CovenCave/Views/ChatView.swift");
  const view = read("CovenCave/Views/Voice/LiveVoiceCallView.swift");
  const model = read("CovenCave/Views/Voice/LiveVoiceCallModel.swift");
  const sender = read("CovenCave/Views/Voice/CaveVoiceTurnSender.swift");
  const coordinator = read("CovenCave/Voice/VoiceCallCoordinator.swift");
  const realtime = read("CovenCave/Voice/OpenAIRealtimeTransport.swift");
  assert.match(chat, /@State private var voiceCall: LiveVoiceCallModel\?/);
  assert.match(chat, /\.fullScreenCover\(item: \$voiceCall\) \{ model in\s*LiveVoiceCallView\(model: model\)/);
  assert.doesNotMatch(chat, /showVoiceCall/);
  assert.match(chat, /private func beginVoiceCall[\s\S]*let callThread = thread[\s\S]*captureConnectionDispatchLease\(\)[\s\S]*LiveVoiceCallModel\([\s\S]*client: client,[\s\S]*authorityIsCurrent: \{[\s\S]*dispatchIsCurrent\(binding, in: callThread, lease: dispatchLease\)[\s\S]*binding\.matches\(callThread, includingSessions: true\)/);
  assert.match(view, /init\(model: LiveVoiceCallModel\)/);
  assert.doesNotMatch(view, /LiveVoiceCallModel\(/);
  assert.match(view, /onChange\(of: model\.authorityIsCurrent, initial: true\)[\s\S]*model\.refreshAuthority\(\)/);
  assert.match(view, /\.onDisappear \{ model\.end\(\) \}/);
  assert.match(model, /func start\(\) async \{\s*guard !hasStarted, !hasEnded, refreshAuthority\(\)/);
  assert.match(model, /func refreshAuthority\(\) -> Bool \{[\s\S]*guard !authorityRevoked[\s\S]*authorityRevoked = true[\s\S]*end\(\)[\s\S]*VoiceCallCopy\.authorityChanged/);
  assert.match(model, /realtimeSessionID\(client: client, projectRoot: projectRoot\)\s*guard canContinueLaunch\(generation\)/);
  assert.match(model, /client\.mintVoiceSession\([\s\S]*?\)\s*guard canContinueLaunch\(generation\)/);
  assert.match(sender, /client\.sendStream\(\s*body,\s*preflight: liveDispatchLeaseIsCurrent/);
  assert.match(coordinator, /await mediaSession\.prepare\([^\n]*\)\s*guard liveAuthorityIsCurrent\(\), !state\.phase\.isTerminal/);
  assert.match(realtime, /private func sendOffer[^\n]*\{\s*try requireActiveAuthority\(\)/);
  const tests = read("CovenCaveTests/LiveVoiceCallModelTests.swift");
  for (const scenario of [
    "testStablePresentationStartsOnceAndDismissalCleansUpIdempotently",
    "testAuthorityRecoveryNeverRestartsARevokedPresentation",
    "testAuthorityIsRecheckedAfterSuspendedMicrophonePermission",
    "testDismissalDuringTransportStartupStopsLateActivation",
    "testRevocationDuringSessionCreationCleansUpWithoutMintingOrStarting",
    "testEndDuringGrantMintingCannotStartALateTransport",
  ]) {
    assert.ok(tests.includes(`func ${scenario}(`), `native voice scenario ${scenario} is present`);
  }
});
