# Discord Rich Presence

Coven Cave publishes a generic, privacy-safe activity to a locally running
Discord desktop client. It does not require a bot, OAuth, a client secret, or
any user content.

## What the card must say

The card reads **Coven Cave** and shows the Coven crown. Both are set by the
payload in [`src-tauri/src/discord_presence.rs`](../src-tauri/src/discord_presence.rs)
and covered by its tests, so neither depends on Developer Portal state:

- **Name.** Discord titles the card with the Developer Portal application name
  unless the activity carries its own `name`. That application is registered as
  `CovenCave`, so the payload sets `name` to `Coven Cave`. Renaming the portal
  application is still worth doing, but it is no longer what the card depends on.
- **Art.** `assets.large_image` is the `https` URL of
  [`assets/brand/cave-icon.png`](../assets/brand/cave-icon.png) in this public
  repository, which Discord proxies. It was previously a Rich Presence Art Asset
  key, `covencave`, that was never uploaded — so every card rendered Discord's
  grey placeholder. An asset key is a manual step in a web UI that nothing here
  can verify or repair; a URL is checked by a test and fixed by committing a
  file.

  The URL pins a **commit**, not `main`. This string is baked into shipped
  binaries, so a branch ref would let a later rename of the file blank the art
  on every release already in the wild — the same silent failure as the missing
  asset key, only delayed. Moving or replacing the art therefore means editing
  `ASSET_COMMIT` and `ASSET_PATH` in `discord_presence.rs` and cutting a new
  release. Tests assert the pin is a full hex SHA, that the URL agrees with both
  constants, and that the path still names a file this repository carries.

## One-time Discord setup

1. In the Discord Developer Portal, create an OpenCoven-managed application
   named `Coven Cave`.
2. Use [`assets/brand/cave-icon.png`](../assets/brand/cave-icon.png) as its
   application icon. A Rich Presence Art Asset is **not** required: the payload
   carries the art as a URL. Uploading one changes nothing unless the payload is
   changed back to an asset key, which would reintroduce the placeholder the
   moment the upload is missing.
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

Set it to the empty string to build presence out deliberately; Coven Cave then
continues normally and logs that Discord activity is disabled.

`option_env!` cannot tell "unset" from "set to empty" — an empty value arrives
as `Some("")`, not `None` — so `start()` checks for a blank ID explicitly rather
than relying on the `Option` alone. Without that check this paragraph was
false: an empty variable produced a build that reconnected against an empty
application ID forever instead of disabling presence.

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
3. Launch Coven Cave with `pnpm dev:app` and inspect its Discord profile card.
   It must read **Coven Cave** — not `CovenCave` — and show the Coven crown, the
   generic status, and elapsed time. A grey placeholder where the crown belongs
   means Discord did not resolve the art URL; confirm the URL in
   `discord_presence.rs` still returns `200` and `image/png`.
4. From a second Discord account, confirm the two public buttons — **Join the
   Coven** (`https://discord.gg/opencoven`) and **Enter the Cave**
   (`https://opencoven.ai`) — and that clicking the Cave art asset opens the
   GitHub repository. Discord does not show the publisher its own Rich Presence
   buttons.

Discord caps an activity at **two** buttons and rejects a third, which is why
the repository link lives on the art asset's `large_url` rather than in a third
button. A button can only open a URL, so presence cannot offer a screen-share
action; Discord's equivalent is the Spectate flow, which needs `Secrets` and a
`Party` on the payload plus an `ACTIVITY_SPECTATE` handler, none of which this
worker implements.

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
