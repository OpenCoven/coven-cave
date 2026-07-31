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
3. Set the application website to `https://covencave.ai` and repository to
   `https://github.com/OpenCoven/coven-cave`.
4. Provide its public Application ID as `COVENCAVE_DISCORD_APPLICATION_ID` at
   build time. The ID is not a secret. Never add a client secret, bot token,
   OAuth credential, project name, repository path, prompt, memory, terminal
   output, or conversation data to the presence payload.

For a local desktop build, set the variable before launching the app:

```bash
COVENCAVE_DISCORD_APPLICATION_ID=<public-application-id> pnpm dev:app
```

Release builds must receive the same public variable. Without it, CovenCave
continues normally and logs that Discord activity is disabled.

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
