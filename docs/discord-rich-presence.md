# Discord Rich Presence

CovenCave publishes a generic, privacy-safe activity to a locally running
Discord desktop client. It does not require a bot, OAuth, a client secret, or
any user content.

## One-time Discord setup

1. In the Discord Developer Portal, create an OpenCoven-managed application
   named `CovenCave`.
2. Use [`assets/brand/cave-icon.png`](../assets/brand/cave-icon.png) as both
   its application icon and a Rich Presence Art Asset named `covencave`.
   Discord lowercases asset keys; keep this key stable.
3. Set the application website to `https://opencoven.ai` and repository to
   `https://github.com/OpenCoven/coven-cave`.
4. Record its public Application ID as the `DEFAULT_APPLICATION_ID` constant in
   [`src-tauri/build.rs`](../src-tauri/build.rs). The ID is not a secret. Never
   add a client secret, bot token, OAuth credential, project name, repository
   path, prompt, memory, terminal output, or conversation data to the presence
   payload.

## Where the Application ID comes from

`src-tauri/build.rs` supplies `COVENCAVE_DISCORD_APPLICATION_ID` to the compiler
on every build, so **no environment variable is needed** — a plain `pnpm dev:app`,
`cargo build --release`, or `tauri build` all produce a binary that publishes
presence.

Set the variable to override the default (a fork running its own Discord
application):

```bash
COVENCAVE_DISCORD_APPLICATION_ID=<other-public-application-id> pnpm dev:app
```

Set it to the empty string to build presence out deliberately; CovenCave then
continues normally and logs that Discord activity is disabled.

Release builds still pass the `COVENCAVE_DISCORD_APPLICATION_ID` repository
variable through the `build` job in
[`.github/workflows/release.yml`](../.github/workflows/release.yml). That is now
belt-and-braces rather than load-bearing: if the repository variable is ever
unset, the build script's default keeps shipped binaries working.

**Why the default exists.** `option_env!` resolves at compile time, so a build
that does not see the variable bakes in `DISCORD_APPLICATION_ID = None` and
cannot be repaired at runtime. Such a binary is indistinguishable from a healthy
one — the only signal is a single log line, and Windows release builds set
`windows_subsystem = "windows"`, so there is no console to print it to. Presence
simply never appears, which reads as a Discord problem rather than a build one.

To confirm any binary carries the ID:

```bash
rg -a -o '1529254721091801180|opencoven\.ai' <path-to-app-binary>
```

Two matches means presence is wired and points at the right domain; no matches
means that build shipped without it.

## Verify

1. Start the installed Discord desktop client and enable detected-activity
   sharing in its Activity Privacy settings.
2. Run `cargo check --manifest-path src-tauri/Cargo.toml`.
3. Launch CovenCave with `pnpm dev:app` and inspect its Discord profile card.
   It should show the Cave icon, generic status, and elapsed time.
4. From a second Discord account, confirm the two public buttons point to
   CovenCave and its GitHub repository. Discord does not show the publisher
   its own Rich Presence buttons.

The worker retries while Discord is closed and reconnects after Discord
restarts. The native app icon and Discord art asset are managed separately.

## What Rich Presence does not control

Discord shows CovenCave in several places, and only the profile activity card
comes from this code. The others are not configurable from this repository:

- **Go Live / stream picker.** While connected to a voice channel, Discord
  scans running processes and lists them as streamable sources, labelled from
  the executable's `ProductName` (`CovenCave`, set by `productName` in
  `src-tauri/tauri.conf.json`). Its icon is resolved against Discord's own
  verified-games database, not the Rich Presence art assets. An unrecognised
  application renders a generic placeholder there, and no asset upload,
  application rename, or embedded executable icon changes it. The row is
  visible only to the local user and only while in voice.
- **Detected-activity entries.** These also come from process scanning and are
  managed under Discord's Settings → Registered Games, independent of the
  application ID used here.

A placeholder icon in either surface is not a Rich Presence defect. Verify
presence from the profile card, per the steps above.
