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
        .details("Summoning familiars")
        .state("In the Cave")
        .timestamps(activity::Timestamps::new().start(started_at))
        .assets(
            activity::Assets::new()
                .large_image(ASSET_KEY)
                .large_text("CovenCave")
                // Discord caps an activity at two buttons, so the repository
                // link lives on the clickable art asset and both buttons stay
                // free for the two destinations that recruit.
                .large_url("https://github.com/OpenCoven/coven-cave"),
        )
        .buttons(vec![
            activity::Button::new("Join the Coven", "https://discord.gg/opencoven"),
            activity::Button::new("Enter the Cave", "https://opencoven.ai"),
        ])
}

fn publish_activity(client: &mut impl DiscordIpc, started_at: i64) -> Result<(), String> {
    client
        .set_activity(build_activity(started_at))
        .map_err(|error| error.to_string())?;
    loop {
        let (opcode, response) = client.recv().map_err(|error| error.to_string())?;
        match opcode {
            1 => {
                if response.get("evt").is_some_and(|event| !event.is_null()) {
                    return Err("Discord rejected the activity update".into());
                }
                return Ok(());
            }
            3 => client
                .send(response, 4)
                .map_err(|error| error.to_string())?,
            _ => return Err(format!("unexpected Discord IPC opcode {opcode}")),
        }
    }
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
                    match publish_activity(&mut client, started_at) {
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
    use super::{build_activity, publish_activity, ASSET_KEY};
    use discord_rich_presence::{activity, error::Error, DiscordIpc};
    use serde_json::{json, Value};
    use std::collections::VecDeque;

    struct RecordingClient {
        activity_published: bool,
        responses_read: usize,
        responses: VecDeque<(u32, Value)>,
        sent_frames: Vec<(u8, Value)>,
    }

    impl RecordingClient {
        fn new() -> Self {
            Self {
                activity_published: false,
                responses_read: 0,
                responses: VecDeque::from([(1, json!({ "evt": null }))]),
                sent_frames: Vec::new(),
            }
        }

        fn with_response(opcode: u32, response: Value) -> Self {
            Self::with_responses([(opcode, response)])
        }

        fn with_responses(responses: impl IntoIterator<Item = (u32, Value)>) -> Self {
            Self {
                responses: responses.into_iter().collect(),
                ..Self::new()
            }
        }
    }

    impl DiscordIpc for RecordingClient {
        fn get_client_id(&self) -> &str {
            "test-client"
        }

        fn connect_ipc(&mut self) -> Result<(), Error> {
            Ok(())
        }

        fn write(&mut self, _data: &[u8]) -> Result<(), Error> {
            Ok(())
        }

        fn read(&mut self, _buffer: &mut [u8]) -> Result<(), Error> {
            Ok(())
        }

        fn send(&mut self, data: Value, opcode: u8) -> Result<(), Error> {
            self.sent_frames.push((opcode, data));
            Ok(())
        }

        fn set_activity(&mut self, _activity_payload: activity::Activity<'_>) -> Result<(), Error> {
            self.activity_published = true;
            Ok(())
        }

        fn recv(&mut self) -> Result<(u32, Value), Error> {
            self.responses_read += 1;
            Ok(self
                .responses
                .pop_front()
                .expect("test client needs a queued response"))
        }

        fn close(&mut self) -> Result<(), Error> {
            Ok(())
        }
    }

    #[test]
    fn activity_is_generic_and_uses_the_stable_cave_asset_key() {
        let activity = build_activity(1_700_000_000);
        let serialized = serde_json::to_value(activity).expect("activity should serialize");

        assert_eq!(serialized["details"], "Summoning familiars");
        assert_eq!(serialized["state"], "In the Cave");
        assert_eq!(serialized["assets"]["large_image"], ASSET_KEY);
        assert_eq!(
            serialized["assets"]["large_url"],
            "https://github.com/OpenCoven/coven-cave"
        );
        assert_eq!(serialized["timestamps"]["start"], 1_700_000_000);
        assert_eq!(serialized["buttons"][0]["label"], "Join the Coven");
        assert_eq!(
            serialized["buttons"][0]["url"],
            "https://discord.gg/opencoven"
        );
        assert_eq!(serialized["buttons"][1]["label"], "Enter the Cave");
        assert_eq!(serialized["buttons"][1]["url"], "https://opencoven.ai");
    }

    #[test]
    fn activity_stays_within_the_two_button_discord_limit() {
        let activity = build_activity(1_700_000_000);
        let serialized = serde_json::to_value(activity).expect("activity should serialize");

        let buttons = serialized["buttons"]
            .as_array()
            .expect("activity should carry buttons");
        assert!(
            buttons.len() <= 2,
            "Discord rejects an activity with more than 2 buttons, got {}",
            buttons.len()
        );
    }

    #[test]
    fn publishing_consumes_the_activity_response() {
        let mut client = RecordingClient::new();

        publish_activity(&mut client, 1_700_000_000).expect("activity should publish");

        assert!(client.activity_published);
        assert_eq!(client.responses_read, 1);
    }

    #[test]
    fn publishing_rejects_non_frame_responses() {
        let mut client = RecordingClient::with_response(2, json!({ "code": 4000 }));

        let result = publish_activity(&mut client, 1_700_000_000);

        assert!(result.is_err());
    }

    #[test]
    fn publishing_rejects_discord_error_events() {
        let mut client = RecordingClient::with_response(
            1,
            json!({
                "evt": "ERROR",
                "data": { "code": 4000, "message": "invalid activity" }
            }),
        );

        let result = publish_activity(&mut client, 1_700_000_000);

        assert!(result.is_err());
    }

    #[test]
    fn publishing_answers_ping_before_reading_activity_response() {
        let ping_payload = json!({ "nonce": "ping-1" });
        let mut client = RecordingClient::with_responses([
            (3, ping_payload.clone()),
            (1, json!({ "evt": null })),
        ]);

        publish_activity(&mut client, 1_700_000_000).expect("activity should publish");

        assert_eq!(client.responses_read, 2);
        assert_eq!(client.sent_frames, [(4, ping_payload)]);
    }
}
