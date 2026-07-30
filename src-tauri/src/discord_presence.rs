//! Privacy-safe Discord Rich Presence for the desktop shell.
//!
//! `COVENCAVE_DISCORD_APPLICATION_ID` is a public Discord application ID,
//! supplied at build time after the OpenCoven-managed Discord application has
//! been created. It is deliberately optional until that application exists:
//! an unconfigured build must remain fully functional when Discord is absent.

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::{
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const DISCORD_APPLICATION_ID: Option<&str> = option_env!("COVENCAVE_DISCORD_APPLICATION_ID");
const ASSET_KEY: &str = "covencave";
const RETRY_DELAY: Duration = Duration::from_secs(15);
const REFRESH_DELAY: Duration = Duration::from_secs(60);

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn build_activity(started_at: i64) -> activity::Activity<'static> {
    activity::Activity::new()
        .details("Desktop control room for OpenCoven")
        .state("Working with familiars")
        .timestamps(activity::Timestamps::new().start(started_at))
        .assets(
            activity::Assets::new()
                .large_image(ASSET_KEY)
                .large_text("CovenCave")
                .large_url("https://covencave.ai"),
        )
        .buttons(vec![
            activity::Button::new("Open CovenCave", "https://covencave.ai"),
            activity::Button::new("View on GitHub", "https://github.com/OpenCoven/coven-cave"),
        ])
}

/// Starts one reconnecting IPC worker for the local Discord desktop client.
///
/// The payload is intentionally generic: it never publishes local projects,
/// repositories, prompts, terminal output, memory, or conversation content.
pub fn start() {
    let Some(application_id) = DISCORD_APPLICATION_ID else {
        log::warn!(
            "[discord-presence] COVENCAVE_DISCORD_APPLICATION_ID is not configured; Discord activity is disabled"
        );
        return;
    };

    if let Err(error) = thread::Builder::new()
        .name("discord-rich-presence".into())
        .spawn(move || {
            let started_at = unix_now();
            loop {
                let mut client = DiscordIpcClient::new(application_id);
                if let Err(error) = client.connect() {
                    log::debug!("[discord-presence] Discord unavailable: {error}");
                    thread::sleep(RETRY_DELAY);
                    continue;
                }

                let mut first_publish = true;
                loop {
                    match client.set_activity(build_activity(started_at)) {
                        Ok(()) => {
                            if first_publish {
                                log::info!("[discord-presence] CovenCave presence published");
                                first_publish = false;
                            }
                        }
                        Err(error) => {
                            log::debug!("[discord-presence] connection lost: {error}");
                            break;
                        }
                    }
                    thread::sleep(REFRESH_DELAY);
                }

                let _ = client.close();
                thread::sleep(RETRY_DELAY);
            }
        })
    {
        log::warn!("[discord-presence] could not start worker: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::{build_activity, ASSET_KEY};

    #[test]
    fn activity_is_generic_and_uses_the_stable_cave_asset_key() {
        let activity = build_activity(1_700_000_000);
        let serialized = serde_json::to_value(activity).expect("activity should serialize");

        assert_eq!(serialized["details"], "Desktop control room for OpenCoven");
        assert_eq!(serialized["state"], "Working with familiars");
        assert_eq!(serialized["assets"]["large_image"], ASSET_KEY);
        assert_eq!(serialized["timestamps"]["start"], 1_700_000_000);
        assert_eq!(serialized["buttons"][0]["url"], "https://covencave.ai");
        assert_eq!(
            serialized["buttons"][1]["url"],
            "https://github.com/OpenCoven/coven-cave"
        );
    }
}
