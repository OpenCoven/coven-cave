import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./windows-native-browser-regression.ps1", import.meta.url));
// Git may materialize the PowerShell fixture with CRLF on Windows. Normalize
// before matching function boundaries so the conformance check is checkout-
// independent rather than silently depending on core.autocrlf.
const source = readFileSync(scriptPath, "utf8").replace(/\r\n/g, "\n");
const browserPane = readFileSync(new URL("../src/components/browser-pane.tsx", import.meta.url), "utf8");

// Safe launch/attach contract: one exact executable identity, explicit close
// authority for attached sessions, and a non-mutating dry run.
assert.match(source, /\[Parameter\(Mandatory = \$true\)\]\s*\[string\]\$Executable/);
assert.match(source, /\[int\]\$AttachPid = 0/);
assert.match(source, /\[switch\]\$DryRun/);
assert.match(source, /\[switch\]\$AllowCloseAttached/);
assert.match(source, /Attach mode never closes an existing app unless -AllowCloseAttached is explicit/);
assert.match(source, /Test-PathEqual \(\[string\]\$attached\.ExecutablePath\) \$candidatePath/);
assert.match(source, /Candidate must be an exact \.exe path; MSI\/install inputs are intentionally unsupported/);
assert.match(source, /No app launch, input, resize, close, installation, or process termination occurred/);

// Launch isolation must be genuinely per-run, rather than reusing a human's
// WebView2 profile or a shared debugging endpoint.
assert.match(source, /Get-FreeLoopbackPort/);
assert.match(source, /foreach \(\$target in \$raw\) \{ Write-Output \$target \}/);
assert.match(source, /\[void\]\$socket\.ConnectAsync/);
assert.match(source, /\[void\]\$Socket\.SendAsync/);
assert.match(source, /CDP port \$CdpPort is already in use; launch isolation requires a free port/);
assert.match(source, /covencave-webview2-regression-\{0\}/);
assert.match(source, /WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS.*--remote-debugging-port=\$CdpPort/);
assert.match(source, /WEBVIEW2_USER_DATA_FOLDER.*\$WebView2Profile/);
assert.match(source, /CommandLine -like "\*\$WebView2Profile\*"/);
assert.match(source, /Launch profile must not already exist; the harness only cleans directories it created/);

const exactLinks = [
  ["GitHub", "https://github.com/OpenCoven/coven-cave"],
  ["Docs", "https://docs.opencoven.ai"],
  ["X", "https://x.com/OpenCvn"],
  ["Discord", "https://discord.gg/opencoven"],
  ["Grimoire", "https://mind.opencoven.ai"],
  ["Podcast", "https://pod.opencoven.ai"],
];
for (const [label, href] of exactLinks) {
  assert.match(source, new RegExp(`label = "${label}"; href = "${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
}
assert.match(source, /\[ValidateSet\("Passive", "FocusOnly", "AsyncResizeOnly", "LegacyFullPrep"\)\]\s*\[string\]\$PreparationMode = "Passive"/);
assert.match(source, /\[ValidateRange\(0, 600\)\]\s*\[int\]\$Cycles/);
assert.match(source, /\[ValidateRange\(30000, 600000\)\]\s*\[int\]\$StartupReadyDeadlineMs = 180000/);
assert.match(source, /\[switch\]\$StartupProbeOnly/);
assert.match(source, /\[switch\]\$PartialCoverage/);
assert.match(source, /Full regression mode requires at least 12 cycles so every Settings link is proven twice/);
assert.match(source, /requiredPasses = if \(\$PartialCoverage -or \$StartupProbeOnly\) \{ 0 \} else \{ 2 \}/);
assert.match(source, /if \(-not \$PartialCoverage\)[\s\S]*\$coverage\.passes -ge 2/);
assert.match(source, /if \(\$StartupProbeOnly\)[\s\S]*status = "passed-startup-probe"[\s\S]*no stress input or close was attempted/);
assert.match(source, /Invoke-PhysicalDomClick \$MainWindow \$MainTarget \(\[string\]\$Link\.label\) "text"/);
assert.match(source, /\$s\.hasViewport -and \$s\.address -eq \$Link\.href/);

// Startup preparation is an explicit diagnostic matrix. The default Passive
// branch must be observation-only; focus and resize variants remain isolated.
const preparationFunction = source.match(/function Invoke-StartupPreparation \{[\s\S]*?\n\}\n\nfunction Register-CloseListener/)[0];
const passivePreparation = preparationFunction.match(/"Passive" \{([\s\S]*?)\n\s*\}/)[1];
assert.doesNotMatch(passivePreparation, /(?:ShowWindowAsync|SetWindowPos|Focus-MainWindow|Ensure-MainWindowWithinWorkArea)/);
assert.match(preparationFunction, /"FocusOnly" \{[\s\S]*Focus-MainWindow/);
assert.match(preparationFunction, /"AsyncResizeOnly" \{[\s\S]*Set-MainWindowPlacementAsync/);
assert.match(preparationFunction, /"LegacyFullPrep" \{[\s\S]*ShowWindowAsync[\s\S]*Ensure-MainWindowWithinWorkArea[\s\S]*Focus-MainWindow/);
assert.match(source, /\$moveFlags = \$SWP_NOSIZE -bor \$SWP_NOZORDER -bor \$SWP_NOACTIVATE -bor \$SWP_ASYNCWINDOWPOS/);
assert.match(source, /\$resizeFlags = \$SWP_NOMOVE -bor \$SWP_NOZORDER -bor \$SWP_NOACTIVATE -bor \$SWP_ASYNCWINDOWPOS/);
assert.match(source, /Wait-MainWindowPlacement \$MainWindow \$target -PositionOnly[\s\S]*Wait-MainWindowPlacement \$MainWindow \$target -SizeOnly/);

// Settings links and stress controls are hit through the Windows input queue.
// CDP only supplies coordinates/state; it never calls element.click().
assert.match(source, /SetCursorPos\(\$X, \$Y\)/);
const stableCursor = source.match(/function Set-StableCursorPosition \{[\s\S]*?\n\}\n\nfunction Invoke-PhysicalScreenClick/)[0];
assert.match(stableCursor, /\[ValidateRange\(2, 10\)\]\[int\]\$Attempts = 6/);
assert.match(stableCursor, /Assert-ExactMainForeground \$MainWindow[\s\S]*SetCursorPos\(\$X, \$Y\)[\s\S]*GetCursorPos\(\[ref\]\$first\)[\s\S]*GetCursorPos\(\[ref\]\$second\)/);
assert.match(stableCursor, /\$second\.X -eq \$X -and \$second\.Y -eq \$Y/);
assert.match(stableCursor, /No mouse button was pressed/);
assert.doesNotMatch(stableCursor, /mouse_event/);
assert.match(source, /\[StructLayout\(LayoutKind\.Sequential\)\] public struct MOUSEINPUT/);
assert.match(source, /\[StructLayout\(LayoutKind\.Explicit\)\] public struct INPUTUNION/);
assert.match(source, /\[StructLayout\(LayoutKind\.Sequential\)\] public struct INPUT/);
assert.match(source, /SendInput\(uint inputCount, INPUT\[\] inputs, int inputSize\)/);
const atomicClick = source.match(/function Invoke-AtomicPhysicalClick \{[\s\S]*?\n\}\n\nfunction Invoke-PhysicalScreenClick/)[0];
assert.match(atomicClick, /GetSystemMetrics\(\$SM_XVIRTUALSCREEN\)[\s\S]*GetSystemMetrics\(\$SM_CYVIRTUALSCREEN\)/);
assert.match(atomicClick, /\* 65535\.0\) \/ \(\$virtualWidth - 1\)/);
assert.match(atomicClick, /\$MOUSE_MOVE -bor \$MOUSE_ABSOLUTE -bor \$MOUSE_VIRTUALDESK/);
assert.match(atomicClick, /MouseInput\(\$absoluteX, \$absoluteY[\s\S]*MouseInput\(0, 0, \[uint32\]\$MOUSE_LEFTDOWN\)[\s\S]*MouseInput\(0, 0, \[uint32\]\$MOUSE_LEFTUP\)/);
assert.match(atomicClick, /\[IntPtr\]::Size -eq 8\) \{ 40 \} else \{ 28 \}/);
assert.match(atomicClick, /\[IntPtr\]::Size -eq 8\) \{ 32 \} else \{ 24 \}/);
assert.match(atomicClick, /Assert-MainWindowNotGhosted \$MainWindow[\s\S]*Assert-ExactMainForeground \$MainWindow[\s\S]*GetGUIThreadInfo\(\$TargetThreadId, \[ref\]\$finalGui\)[\s\S]*\$finalFocus -eq \$KeyboardTarget -or \[CovenNativeRegression\.Win32\]::IsChild\(\$MainWryHandle, \$finalFocus\)[\s\S]*\$finalHitWindow -eq \$ExpectedHitWindow[\s\S]*SendInput/);
assert.match(atomicClick, /Mouse focus left the main renderer WRY before SendInput; no batch was submitted/);
assert.match(atomicClick, /\$submitted -eq \[uint32\]\$inputs\.Length/);
assert.equal((atomicClick.match(/::SendInput\(/g) ?? []).length, 1, "ordinary click batching must call SendInput exactly once with no retry");
assert.doesNotMatch(atomicClick, /mouse_event|foreach \(|do \{|while \(/);
assert.match(source, /WindowFromPoint\(\$point\)/);
assert.match(source, /lastPhysicalInput\.hitClass/);
assert.match(source, /IsHungAppWindow\(\$MainWindow\)/);
assert.match(source, /SendMessageTimeout\([\s\S]*SMTO_ABORTIFHUNG/);
assert.match(source, /stableSamples -ge 5/);
assert.match(source, /Wait-MainRendererReady \$mainTarget[\s\S]*Wait-NativeMessagePump \$mainWindow[\s\S]*Invoke-StartupPreparation \$mainWindow \$mainTarget[\s\S]*Wait-StableMainGeometry \$mainWindow \$mainTarget 1000/);
assert.match(source, /Find-MainCdpTarget \$CdpPort[\s\S]*Wait-MainWorkspaceReady \$CdpPort \$mainTarget \$StartupReadyDeadlineMs[\s\S]*Wait-MainRendererReady \$mainTarget/);
assert.match(source, /Windows ghosted the exact candidate native window; OS mouse input is being intercepted/);
assert.match(source, /keybd_event\(\[byte\]\$VK_MENU/);
assert.match(source, /GetForegroundWindow\(\) -eq \$MainWindow/);
assert.match(source, /Assert-ExactMainForeground \$MainWindow/);
assert.doesNotMatch(source, /\$foregroundProcessId -eq \$targetProcessId|isExactCandidateForeground/, "foreground authority must be the exact main HWND, not any same-process window");
assert.match(source, /GhostWindowFromHungWindow\(\$MainWindow\)/);
assert.match(source, /HungWindowFromGhostWindow\(\$ghost\)/);
assert.match(source, /\$hung -ne \$MainWindow/);
assert.match(source, /Get-CorrelatedGhostWindows \$MainWindow/);
assert.match(source, /matching Ghost window before native input; no mouse or keyboard event was sent/);
assert.match(source, /\$className -notin @\("Ghost", "Tao Thread Event Target"\)/);
assert.match(source, /GetClientRect\(\$handle, \[ref\]\$client\)/);
assert.match(source, /\$width -lt 320 -or \$height -lt 240 -or \$clientWidth -lt 300 -or \$clientHeight -lt 200/);
assert.match(source, /Sort-Object clientArea, area -Descending/);
assert.match(source, /did not expose a usable visible top-level window/);
assert.match(source, /MonitorFromWindow\(\$MainWindow, 2\)/);
assert.match(source, /\$margin = if \(\$UseWorkArea\) \{ 72 \} else \{ 24 \}/);
assert.match(source, /SetThreadDpiAwarenessContext\(\[IntPtr\]::new\(-4\)\)/);
assert.match(source, /dpiAwareness = "per-monitor-v2"/);
assert.match(source, /SetWindowPos\(\$MainWindow/);
assert.match(source, /Windows clamped the requested physical click outside the monitor work area/);
assert.match(source, /exact candidate main HWND did not become foreground within the bounded retries/);
assert.match(source, /GetCurrentThreadId\(\)/);
assert.match(source, /AttachThreadInput\(uint attachThread, uint attachToThread, bool attach\)/);
assert.match(source, /BringWindowToTop\(IntPtr hWnd\)/);
assert.match(source, /SetFocus\(IntPtr hWnd\)/);
assert.match(source, /\[StructLayout\(LayoutKind\.Sequential\)\] public struct GUITHREADINFO/);
assert.match(source, /GetGUIThreadInfo\(uint threadId, ref GUITHREADINFO info\)/);
assert.match(source, /IsChild\(IntPtr parent, IntPtr child\)/);
const attachedFocus = source.match(/function Invoke-AttachedMainWindowFocus \{[\s\S]*?\n\}\n\nfunction Focus-MainWindow/)[0];
assert.match(attachedFocus, /GetWindowThreadProcessId\(\$MainWindow/);
assert.match(attachedFocus, /AttachThreadInput\(\$currentThreadId, \[uint32\]\$threadId, \$true\)/);
assert.match(attachedFocus, /ShowWindowAsync\(\$MainWindow, \$SW_RESTORE\)[\s\S]*BringWindowToTop\(\$MainWindow\)[\s\S]*SetForegroundWindow\(\$MainWindow\)[\s\S]*SetFocus\(\$MainWindow\)/);
assert.match(attachedFocus, /finally \{[\s\S]*AttachThreadInput\(\$currentThreadId, \[uint32\]\$threadId, \$false\)/);
assert.match(attachedFocus, /GetForegroundWindow\(\) -eq \$MainWindow/);
const focusFunction = source.match(/function Focus-MainWindow \{[\s\S]*?\n\}\n\nfunction Get-MainWindowWorkAreaPlacement/)[0];
assert.match(focusFunction, /Invoke-AttachedMainWindowFocus \$MainWindow[\s\S]*keybd_event\(\[byte\]\$VK_MENU[\s\S]*Invoke-AttachedMainWindowFocus \$MainWindow/);
assert.match(focusFunction, /Assert-ExactMainForeground \$MainWindow/);
assert.doesNotMatch(focusFunction, /SetCursorPos|WindowFromPoint|mouse_event/, "focus acquisition must never click a potentially covering foreground window");
assert.match(source, /mouse_event\(\$MOUSE_LEFTDOWN/);
assert.match(source, /mouse_event\(\$MOUSE_LEFTUP/);
const resizeFunction = source.match(/function Invoke-PhysicalWindowResize \{[\s\S]*?\n\}\n\nfunction Get-CdpTargets/)[0];
assert.match(resizeFunction, /\$mouseDown = \$false[\s\S]*try \{[\s\S]*MOUSE_LEFTDOWN[\s\S]*finally \{[\s\S]*if \(\$mouseDown\)[\s\S]*MOUSE_LEFTUP/);
assert.match(resizeFunction, /Focus-MainWindow \$MainWindow[\s\S]*Assert-ExactMainForeground \$MainWindow[\s\S]*Set-StableCursorPosition \$MainWindow \$startX \$startY/);
assert.match(resizeFunction, /foreach \(\$step in 1\.\.4\)[\s\S]*Set-StableCursorPosition/);
assert.match(resizeFunction, /\$resizeHit -eq \$MainWindow[\s\S]*native resize edge is covered by another HWND/);
assert.match(resizeFunction, /WindowFromPoint\(\$preResizeDownPoint\)[\s\S]*\$preResizeDownHit -eq \$resizeHit/);
const physicalClickFunction = source.match(/function Invoke-PhysicalScreenClick \{[\s\S]*?\n\}\n\nfunction Invoke-KeyChord/)[0];
assert.match(physicalClickFunction, /Assert-MainWindowNotGhosted \$MainWindow[\s\S]*Focus-MainWindow \$MainWindow[\s\S]*Assert-ExactMainForeground \$MainWindow[\s\S]*Get-MainWryKeyboardTarget \$MainWindow[\s\S]*Set-StableCursorPosition[\s\S]*WindowFromPoint[\s\S]*Assert-MainWindowNotGhosted \$MainWindow[\s\S]*Assert-ExactMainForeground \$MainWindow[\s\S]*Invoke-AtomicPhysicalClick \$MainWindow \$hitWindow \$mainWryHandle \$keyboardTarget \$targetThreadId \$X \$Y/);
assert.match(physicalClickFunction, /AttachThreadInput\(\$currentThreadId, \[uint32\]\$threadId, \$true\)[\s\S]*Could not attach input queues to the main WRY Chrome mouse thread/);
assert.match(physicalClickFunction, /SetFocus\(\$keyboardTarget\)[\s\S]*GetGUIThreadInfo\(\[uint32\]\$targetThreadId, \[ref\]\$gui\)[\s\S]*\$focus -eq \$keyboardTarget -or \[CovenNativeRegression\.Win32\]::IsChild\(\$mainWryHandle, \$focus\)/);
assert.match(physicalClickFunction, /Mouse focus did not enter the main renderer WRY focus chain; no pointer input was sent/);
assert.match(physicalClickFunction, /\$hitWindow -eq \$mainWryHandle -or[\s\S]*IsChild\(\$mainWryHandle, \$hitWindow\)[\s\S]*stale native child or another overlay may be intercepting input/);
assert.match(physicalClickFunction, /finally \{[\s\S]*AttachThreadInput\(\$currentThreadId, \[uint32\]\$threadId, \$false\)/);
assert.doesNotMatch(physicalClickFunction, /mouse_event/);
const keyInputFunction = source.match(/function Invoke-KeyChord \{[\s\S]*?\n\}\n\nfunction Invoke-PhysicalWindowResize/)[0];
assert.match(keyInputFunction, /Focus-MainWindow \$MainWindow[\s\S]*Assert-ExactMainForeground \$MainWindow[\s\S]*keybd_event\(\$Key/);
const keyboardTarget = source.match(/function Get-MainWryKeyboardTarget \{[\s\S]*?\n\}\n\nfunction Focus-MainWindow/)[0];
assert.match(keyboardTarget, /Get-DirectWryWebViews \$MainWindow[\s\S]*Get-MainWryWebView \$wrys/);
assert.match(keyboardTarget, /Get-WindowClassName \$handle\) -eq "Chrome_WidgetWin_1"/);
assert.match(keyboardTarget, /EnumChildWindows\(\$mainWry\.handle/);
assert.match(keyboardTarget, /Sort-Object area -Descending/);
assert.match(keyInputFunction, /AttachThreadInput\(\$currentThreadId, \[uint32\]\$threadId, \$true\)/);
assert.match(keyInputFunction, /SetFocus\(\$keyboardTarget\)[\s\S]*GetGUIThreadInfo\(\[uint32\]\$targetThreadId/);
assert.match(keyInputFunction, /\$focus -eq \$keyboardTarget -or \[CovenNativeRegression\.Win32\]::IsChild\(\$mainWryHandle, \$focus\)/);
assert.match(keyInputFunction, /Assert-MainWindowNotGhosted \$MainWindow[\s\S]*Assert-ExactMainForeground \$MainWindow[\s\S]*\$finalFocus -eq \$keyboardTarget -or \[CovenNativeRegression\.Win32\]::IsChild/);
assert.match(keyInputFunction, /finally \{[\s\S]*if \(\$keyDown\)[\s\S]*if \(\$controlDown\)[\s\S]*AttachThreadInput\(\$currentThreadId, \[uint32\]\$threadId, \$false\)/);
assert.match(source, /Invoke-PhysicalDomClick \$MainWindow \$MainTarget "any-inactive-tab" "inactive-tab"/);
assert.match(source, /Invoke-KeyChord \$MainWindow \(\[byte\]\$VK_K\) -Control/);
assert.match(source, /Invoke-PhysicalDomClick \$MainWindow \$MainTarget "Toggle address bar" "aria"/);
assert.match(source, /Invoke-PhysicalDomClick \$MainWindow \$MainTarget "Reload" "aria"/);
assert.match(source, /Invoke-PhysicalWindowResize/);
assert.match(source, /inactiveTabCount -ge 1/);
assert.match(source, /activeTabLabel -and \$s\.activeTabLabel -ne \$activeTabBefore/);
assert.match(source, /\$s\.quickOpenVisible[\s\S]*\$transition\.quickOpenShown = \$true[\s\S]*-not \$s\.quickOpenVisible[\s\S]*\$transition\.quickOpenHidden = \$true/);
assert.match(source, /\$s\.addressOverlayVisible[\s\S]*\$transition\.addressOverlayShown = \$true[\s\S]*-not \$s\.addressOverlayVisible[\s\S]*\$transition\.addressOverlayHidden = \$true/);
assert.match(source, /reloadControl -eq "Reload" -and -not \$s\.loading[\s\S]*reloadControl -eq "Stop" -and \$s\.loading[\s\S]*reloadStarted = \$true[\s\S]*-not \$s\.loading[\s\S]*reloadCompleted = \$true/);
assert.doesNotMatch(source, /scrollIntoView/, "CDP geometry reads must not mutate the document scroll position");
assert.match(source, /\[aria-label="Settings"\], \[aria-label="Account \/ settings"\]/);
assert.match(source, /link\[rel="manifest"\]\[href="\/manifest\.webmanifest"\]/);
assert.match(source, /\$settingsLabel = "Settings"[\s\S]*\$settingsLabel = "Account \/ settings"/);
assert.match(source, /Invoke-KeyChord \$MainWindow \(\[byte\]\$VK_OEM_COMMA\) -Control/);
assert.match(source, /Invoke-PhysicalDomClick \$MainWindow \$MainTarget "Expand navigation" "aria" 5000/);
assert.match(source, /keyboard focus out of a native Browser child and into Cave/);
assert.match(source, /if \(\$state\.hash -ne "#about"\)[\s\S]*physical About click to select the Links section/);
assert.match(source, /Invoke-PhysicalDomClick \$MainWindow \$MainTarget "About" "text" 15000/);
assert.match(source, /Wait-DomBox \$MainTarget "GitHub" "text" 15000/);
assert.match(source, /Open-SettingsAbout \$MainWindow \$MainTarget\s*Wait-NativeBrowserInactive/);
assert.doesNotMatch(source, /\.click\(\)/, "the native harness must not substitute DOM clicks for real OS input");

// The native-child target must reach the requested URL or a narrowly listed
// HTTPS redirect. Merely trusting the address field in the main DOM is weaker.
assert.match(source, /function Test-AllowedChildUrl/);
assert.match(source, /\$uri\.Scheme -ne "https"/);
for (const host of ["github.com", "docs.opencoven.ai", "x.com", "discord.gg", "discord.com", "mind.opencoven.ai", "pod.opencoven.ai"]) {
  assert.match(source, new RegExp(`host = "${host.replaceAll(".", "\\.")}"`));
}
assert.match(source, /Wait-ActiveChildUrl \$CdpPort \$MainTarget \$Link/);
assert.match(source, /visibilityState: document\.visibilityState/);
assert.match(source, /\$runtime\.visibilityState -eq "visible"/);
assert.match(source, /\$allowedVisible\.Count -eq 1/);
assert.match(source, /actualChildUrl = \$childUrl\.actualUrl/);

// Every diagnostic phase carries a wall-clock timestamp plus native health,
// window/client rectangles, direct WRY geometry, and optional DOM state.
assert.match(source, /function Add-PhaseEvidence/);
assert.match(source, /timestampUtc = \[DateTime\]::UtcNow\.ToString\("o"\)/);
assert.match(source, /elapsedMilliseconds = \$reportWatch\.ElapsedMilliseconds/);
assert.match(source, /messagePumpResponsive =/);
assert.match(source, /exactForeground =/);
assert.match(source, /clientRect =/);
assert.match(source, /directWryWebViews =/);
assert.match(source, /Add-PhaseEvidence -Name "failure"/);
assert.match(source, /function Wait-StableMainGeometry/);
assert.match(source, /\[int\]\$StableForMs = 1000/);
assert.match(source, /stableDuration -ge \$StableForMs/);
assert.match(source, /startupGeometry = Wait-StableMainGeometry/);
assert.match(source, /SetThreadDpiAwarenessContext\(\$previousDpiContext\)/);
assert.match(source, /dpiAwarenessRestored = \$restoreResult -ne \[IntPtr\]::Zero/);
const finalizer = source.slice(source.lastIndexOf("\nfinally {\n    try {"));
assert.match(finalizer, /try \{[\s\S]*finally \{[\s\S]*SetThreadDpiAwarenessContext\(\$previousDpiContext\)/);

// Cold CDP startup is governed by the outer deadline. A single two-second
// /json/list timeout is only a poll miss and cannot escape Find-MainCdpTarget.
const findMainTarget = source.match(/function Find-MainCdpTarget \{[\s\S]*?\n\}\n\nfunction Wait-MainWorkspaceReady/)[0];
assert.match(findMainTarget, /try \{[\s\S]*\$targets = @\(Get-CdpTargets \$Port\)[\s\S]*catch \{/);
assert.doesNotMatch(findMainTarget, /Wait-CdpTargets/);
assert.match(findMainTarget, /while \(\$watch\.ElapsedMilliseconds -lt \$TimeoutMs\)/);
assert.match(findMainTarget, /\[string\]\$target\.url -ceq \$trustedStartupUrl[\s\S]*return \$target/);

// The isolated candidate's exact bundled startup page is accepted as the main
// target, but the same target ID must later expose trusted workspace DOM.
assert.match(source, /\$trustedStartupUrl = "http:\/\/tauri\.localhost\/startup\.html"/);
const workspaceWait = source.match(/function Wait-MainWorkspaceReady \{[\s\S]*?\n\}\n\nfunction Wait-MainRendererReady/)[0];
assert.match(workspaceWait, /\[int\]\$TimeoutMs = 180000/);
assert.match(workspaceWait, /\[string\]\$_\.id -ceq \$targetId/);
assert.match(workspaceWait, /Invoke-CdpExpression -Target \$lastTarget -Expression \$mainWorkspaceProbeExpression/);
assert.match(workspaceWait, /workspaceReady = \$true/);
assert.match(workspaceWait, /elapsedMilliseconds = \$watch\.ElapsedMilliseconds/);
assert.match(workspaceWait, /while \(\$watch\.ElapsedMilliseconds -lt \$TimeoutMs\)/);

// Native geometry is measured at both layers. Direct-child filtering prevents
// unrelated Chromium descendants from being mistaken for Browser overlays.
assert.match(browserPane, /<div ref=\{surfaceRef\} data-native-browser-viewport className="absolute inset-0" \/>/);
assert.match(source, /GetParent\(\$handle\) -ne \$MainWindow/);
assert.match(source, /\$class\.ToString\(\) -eq "WRY_WEBVIEW"/);
assert.match(source, /Get-NativeBrowserWebViews \$wrys \$mainWry \| Where-Object visible/);
assert.match(source, /\$visible\.Count -eq 1/);
assert.match(source, /\$visible\.Count -eq 0/);
assert.match(source, /\$scaleX = \$MainWebView\.width \/ \[double\]\$Box\.innerWidth/);
assert.match(source, /\$scaleY = \$MainWebView\.height \/ \[double\]\$Box\.innerHeight/);
assert.match(source, /\[ValidateRange\(0, 1\)\]\s*\[int\]\$ClientContainmentTolerancePx = 1/);
assert.match(source, /\$actual\.left -ge \(\$client\.left - \$ClientContainmentTolerancePx\).*\$actual\.right -le \(\$client\.right \+ \$ClientContainmentTolerancePx\)/s);
assert.match(source, /Assert-RectNear \$actual \$expected \$BoundsTolerancePx/);
assert.match(source, /\$lastGeometryMismatch = \$_\.Exception\.Message/);
assert.match(source, /converge within the bounded poll interval/);

// Close is asynchronous, finite, and attributed. The harness stalls both the
// main listener-bearing renderer and a child page, then only posts WM_CLOSE.
assert.match(source, /tauri:\/\/close-requested/);
assert.match(source, /Start-BoundedCdpStall \$childTarget \$RendererStallMs/);
assert.match(source, /Start-BoundedCdpStall \$mainTarget \$RendererStallMs/);
assert.match(source, /Test-CdpTargetResponsive \$childTarget 750/);
assert.match(source, /Test-CdpTargetResponsive \$mainTarget 750/);
assert.match(source, /Wait-CdpTargetUnresponsive \$childTarget 2500/);
assert.match(source, /Wait-CdpTargetUnresponsive \$mainTarget 2500/);
assert.match(source, /Child Browser renderer resumed before WM_CLOSE was posted/);
assert.match(source, /Main renderer resumed before WM_CLOSE was posted/);
assert.match(source, /unresponsiveBeforeClose = \$false/);
assert.match(source, /PostMessage\(\$mainWindow, \$WM_CLOSE/);
assert.match(source, /\$closeWatch\.ElapsedMilliseconds -lt \$CloseDeadlineMs/);
assert.match(source, /It was not force-terminated/);

// Every owned descendant is tracked as an exact PID + creation-time tuple;
// WebView2, Node, and PTY families are classified and checked after root exit.
assert.match(source, /creationTimeUtcTicks = \[long\]\$created\.Ticks/);
assert.match(source, /return "\{0\}\|\{1\}" -f \[int\]\$Tuple\.processId, \[long\]\$Tuple\.creationTimeUtcTicks/);
assert.match(source, /Get-CimInstance Win32_Process/);
assert.match(source, /\$byParent/);
assert.match(source, /"msedgewebview2\.exe".*return "webview2"/);
assert.match(source, /"node\.exe".*return "node"/);
assert.match(source, /"conhost\.exe", "OpenConsole\.exe", "winpty-agent\.exe"/);
assert.match(source, /\$captured\[\(Get-TupleKey \$tuple\)\] = \$tuple/);
assert.match(source, /Test-ProcessTupleAlive \$_/);
assert.match(source, /Owned PID\+creation tuples survived exit/);
assert.match(source, /function Get-AttributedProcessTuples/);
assert.match(source, /Name = 'msedgewebview2\.exe'/);
assert.match(source, /CommandLine[\s\S]*IndexOf\(\$UniqueWebViewProfile/);
assert.match(source, /Test-PathEqual \(\[string\]\$root\.ExecutablePath\) \(\[string\]\$ExactRootTuple\.executablePath\)/);

// Optional PTY setup uses the trusted main renderer's real Tauri command and
// must observe a new exact PTY tuple, not merely assume the invoke succeeded.
assert.match(source, /\[switch\]\$StartTrustedPty/);
assert.match(source, /window\.__TAURI__\?\.core\?\.invoke/);
assert.match(source, /await invoke\('pty_start'/);
assert.match(source, /thread_id: \$threadJson/);
const trustedPtyStart = source.match(/function Start-TrustedPtyForRegression \{[\s\S]*?\n\}\n\nfunction Get-DomBox/)[0];
assert.match(trustedPtyStart, /\$report\.ptySetup\.attemptedAtUtc = \[DateTime\]::UtcNow\.ToString\("o"\)/);
assert.match(trustedPtyStart, /\$report\.ptySetup\.threadId = \$threadId[\s\S]*\$report\.ptySetup\.projectRoot = \$projectRoot[\s\S]*\$invokeWatch = \[Diagnostics\.Stopwatch\]::StartNew\(\)[\s\S]*Invoke-CdpExpression/);
assert.match(trustedPtyStart, /finally \{[\s\S]*\$report\.ptySetup\.invokeElapsedMs = \$invokeWatch\.ElapsedMilliseconds/);
assert.match(trustedPtyStart, /\$report\.ptySetup\.started = \$true/);
assert.match(source, /\$_.kind -eq "pty" -and -not \$before\.ContainsKey/);
assert.match(source, /newExactTuple = \$newPty\[0\]/);

// No force-kill or installer path exists. The only recursive deletion is the
// run-owned temp profile guarded by its marker and temp-root containment.
assert.doesNotMatch(source, /\b(?:Stop-Process|taskkill|TerminateProcess|msiexec(?:\.exe)?)\b/i);
assert.match(source, /\.coven-native-regression-owner/);
assert.match(source, /coven-native-regression-owner-v1`n\$profileOwnerToken`n\$OutputPath/);
assert.match(source, /\$tempBoundary = \$tempRoot \+ \[System\.IO\.Path\]::DirectorySeparatorChar/);
assert.match(source, /-not \$profileFull\.Equals\(\$tempRoot[\s\S]*\$profileFull\.StartsWith\(\$tempBoundary/);
assert.match(source, /\$actualMarkerContent -ceq \$profileMarkerContent/);
assert.match(source, /Remove-Item -LiteralPath \$profileFull -Recurse -Force -ErrorAction Stop/);
assert.match(source, /Get-AttributedProcessTuples \$appProcessId \$rootTuple \$WebView2Profile \| Where-Object kind -eq "webview2"/);
assert.match(source, /\$profileProcesses\.Count -eq 0[\s\S]*\$profileCleanupWatch\.ElapsedMilliseconds -lt \$PostExitDeadlineMs/);
assert.match(source, /deleteAttempts = \[int\]\$report\.isolation\.profileCleanup\.deleteAttempts \+ 1/);
assert.match(source, /\$deleteWatch\.ElapsedMilliseconds -lt \$PostExitDeadlineMs/);
assert.match(source, /bounded cleanup retries/);
assert.match(source, /Run-owned WebView2 profile cleanup failed/);
assert.match(source, /if \(\[string\]\$report\.status -like "passed\*"\)[\s\S]*\$report\.status = "failed"/);
assert.match(source, /installedAppMutationInvoked = \$false/);
assert.match(source, /msiMutationInvoked = \$false/);
assert.match(source, /unrelatedProcessTerminationInvoked = \$false/);

// On Windows, exercise the production script's parser and DryRun path as a
// fast fixture. node.exe is only an identity fixture: DryRun must not launch it.
if (process.platform === "win32") {
  const fixtureRoot = join(tmpdir(), `coven-native-regression-test-${process.pid}-${Date.now()}`);
  const output = `${fixtureRoot}.json`;
  const profile = `${fixtureRoot}-profile`;
  try {
    const parse = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$e=$null;$t=$null;[System.Management.Automation.Language.Parser]::ParseFile($env:COVEN_HARNESS_PATH,[ref]$t,[ref]$e)|Out-Null;if($e.Count){$e|% Message;exit 1}",
      ],
      { encoding: "utf8", env: { ...process.env, COVEN_HARNESS_PATH: scriptPath } },
    );
    assert.equal(parse.status, 0, `PowerShell parser rejected ${basename(scriptPath)}:\n${parse.stderr}\n${parse.stdout}`);

    const dryRun = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-Executable",
        process.execPath,
        "-WebView2Profile",
        profile,
        "-PreparationMode",
        "Passive",
        "-StartupProbeOnly",
        "-Cycles",
        "0",
        "-OutputPath",
        output,
        "-DryRun",
      ],
      { encoding: "utf8", timeout: 15_000 },
    );
    assert.equal(dryRun.status, 0, `DryRun fixture failed:\n${dryRun.stderr}\n${dryRun.stdout}`);
    const report = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(report.status, "dry-run");
    assert.equal(resolve(report.candidate.path), resolve(process.execPath));
    assert.equal(report.candidate.processId, null, "launch DryRun must not start the candidate");
    assert.equal(report.preparation.mode, "Passive");
    assert.equal(report.preparation.startupProbeOnly, true);
    assert.equal(report.cyclesRequested, 0);
    assert.equal(report.startupWait.deadlineMilliseconds, 180_000);
    assert.equal(report.startupWait.attempted, false);
    assert.equal(report.startupWait.workspaceReady, false);
    assert.equal(report.ptySetup.attemptedAtUtc, null);
    assert.equal(report.ptySetup.threadId, null);
    assert.equal(report.ptySetup.projectRoot, null);
    assert.equal(report.ptySetup.invokeElapsedMs, null);
    assert.equal(report.close.skipped, true);
    assert.equal(report.settingsLinks.length, 6);
    assert.equal(report.linkCoverage.length, 6);
    assert.ok(report.linkCoverage.every((entry) => entry.requiredPasses === 0));
    assert.equal(report.geometryTolerances.clientContainmentPixels, 1);
    assert.equal(report.isolation.profileCreatedByHarness, false);
    assert.equal(report.isolation.profileCleanup.attempted, false);
    assert.equal(existsSync(profile), false, "DryRun must not create a WebView2 profile");
    assert.deepEqual(
      Object.values(report.safety).filter((value) => value === true),
      [true, true],
      "only exact-identity and attached-close guards may be true in safety evidence",
    );

    mkdirSync(profile);
    const existingProfile = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-Executable",
        process.execPath,
        "-WebView2Profile",
        profile,
        "-DryRun",
      ],
      { encoding: "utf8", timeout: 15_000 },
    );
    assert.notEqual(existingProfile.status, 0, "a pre-existing profile path must be rejected even when empty");
    assert.match(`${existingProfile.stderr}\n${existingProfile.stdout}`, /Launch profile must not already exist/);
  } finally {
    rmSync(output, { force: true });
    rmSync(profile, { recursive: true, force: true });
  }
}

console.log("windows-native-browser-regression.test.mjs: ok");
