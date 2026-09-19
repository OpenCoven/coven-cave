//! Privacy-safe Discord Rich Presence for the desktop shell.
//!
//! `COVENCAVE_DISCORD_APPLICATION_ID` is a public Discord application ID,
//! supplied at build time after the OpenCoven-managed Discord application has
//! been created. It is deliberately optional until that application exists:
//! an unconfigured build must remain fully functional when Discord is absent.

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::{
    sync::mpsc,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const DISCORD_APPLICATION_ID: Option<&str> = option_env!("COVENCAVE_DISCORD_APPLICATION_ID");

/// The product's name as a person reads it. Discord titles the card with the
/// Developer Portal application name unless the payload carries its own `name`,
/// and that application is registered as `CovenCave` — so without this the card
/// says "CovenCave", which is the repository slug, not the product.
const DISPLAY_NAME: &str = "Coven Cave";

/// The commit this binary's art is pinned to, and the path it serves.
///
/// Split out so the test below can rebuild the URL and check the path against
/// the working tree without re-parsing the constant.
const ASSET_COMMIT: &str = "19db1c670ffa374d3a25cca014a8e184c0e54c5e";
const ASSET_PATH: &str = "assets/brand/cave-icon.png";

/// The Coven crown, served from the public repository at an immutable commit.
///
/// Discord resolves an `assets.large_image` that is an `https` URL by proxying
/// it, so the art does not depend on a Rich Presence Art Asset having been
/// uploaded in the Developer Portal. It had not been: every card rendered
/// Discord's grey placeholder instead of the logo. An asset key is one manual
/// step in a web UI that nothing in this repository can verify or repair; a URL
/// is checked by the tests below and fixed by committing a file.
///
/// The commit is pinned rather than tracking `main` because this string is
/// baked into shipped binaries. A branch ref would let a later rename of the
/// file silently blank the art on every release already in the wild, which is
/// the same failure mode as the missing asset key, just delayed. Moving the art
/// therefore means a new release, which is the honest cost of shipping a URL.
/// Written out rather than concatenated from the two constants above, which
/// would need a new dependency to do in a `const`. The test below asserts the
/// literal still agrees with both halves, so they cannot drift apart.
const ASSET_URL: &str = "https://raw.githubusercontent.com/OpenCoven/coven-cave/19db1c670ffa374d3a25cca014a8e184c0e54c5e/assets/brand/cave-icon.png";
const RETRY_DELAY: Duration = Duration::from_secs(15);
const REFRESH_DELAY: Duration = Duration::from_secs(60);
const DISCORD_IPC_TIMEOUT: Duration = Duration::from_secs(5);

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn build_activity(started_at: i64) -> activity::Activity<'static> {
    activity::Activity::new()
        .name(DISPLAY_NAME)
        .details("Summoning familiars")
        .state("In the Cave")
        .timestamps(activity::Timestamps::new().start(started_at))
        .assets(
            activity::Assets::new()
                .large_image(ASSET_URL)
                .large_text(DISPLAY_NAME)
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

/// Run one IPC operation on a disposable thread so a blocking Unix socket or
/// Windows named pipe cannot strand the presence worker. A timed-out
/// operation's thread is intentionally detached; the caller must stop after a
/// timeout rather than retrying and accumulating one blocked thread per retry.
fn run_bounded_operation<T, F>(timeout: Duration, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    let (sender, receiver) = mpsc::sync_channel(1);
    let operation_thread = thread::Builder::new()
        .name("discord-rich-presence-operation".into())
        .spawn(move || {
            let _ = sender.send(operation());
        })
        .map_err(|error| format!("could not start Discord IPC operation: {error}"))?;

    match receiver.recv_timeout(timeout) {
        Ok(result) => {
            let _ = operation_thread.join();
            Ok(result)
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {
            // Discord's IPC API does not expose the underlying socket, so the
            // blocked read cannot be cancelled from this thread. Do not join
            // it or start another operation after this timeout.
            drop(operation_thread);
            Err(format!(
                "Discord IPC operation timed out after {}s",
                timeout.as_secs_f32()
            ))
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            let _ = operation_thread.join();
            Err("Discord IPC operation stopped unexpectedly".to_string())
        }
    }
}

fn run_bounded_client_operation<F>(
    client: DiscordIpcClient,
    operation: F,
) -> Result<(DiscordIpcClient, Result<(), String>), String>
where
    F: FnOnce(&mut DiscordIpcClient) -> Result<(), String> + Send + 'static,
{
    run_bounded_operation(DISCORD_IPC_TIMEOUT, move || {
        let mut client = client;
        let result = operation(&mut client);
        (client, result)
    })
}

/// Starts one reconnecting IPC worker for the local Discord desktop client.
///
/// The payload is intentionally generic: it never publishes local projects,
/// repositories, prompts, terminal output, memory, or conversation content.
pub fn start() {
    // `option_env!` cannot distinguish "unset" from "set to empty": an empty
    // value arrives as `Some("")`, not `None`. Treating that as configured
    // would hand Discord an empty application ID and reconnect against it
    // forever, while the documented way to build presence out deliberately —
    // setting the variable to the empty string — silently did the opposite of
    // what it promised.
    let application_id = match DISCORD_APPLICATION_ID {
        Some(id) if !id.trim().is_empty() => id,
        _ => {
            log::warn!(
                "[discord-presence] COVENCAVE_DISCORD_APPLICATION_ID is not configured; Discord activity is disabled"
            );
            return;
        }
    };

    if let Err(error) = thread::Builder::new()
        .name("discord-rich-presence".into())
        .spawn(move || {
            let started_at = unix_now();
            loop {
                let (mut client, connection) = match run_bounded_client_operation(
                    DiscordIpcClient::new(application_id),
                    |client| client.connect().map_err(|error| error.to_string()),
                ) {
                    Ok(result) => result,
                    Err(error) => {
                        log::warn!("[discord-presence] stopping blocked IPC worker: {error}");
                        return;
                    }
                };
                if let Err(error) = connection {
                    log::debug!("[discord-presence] Discord unavailable: {error}");
                    thread::sleep(RETRY_DELAY);
                    continue;
                }

                let mut first_publish = true;
                loop {
                    let (next_client, result) =
                        match run_bounded_client_operation(client, move |client| {
                            publish_activity(client, started_at)
                        }) {
                            Ok(result) => result,
                            Err(error) => {
                                log::warn!(
                                    "[discord-presence] stopping blocked IPC worker: {error}"
                                );
                                return;
                            }
                        };
                    client = next_client;
                    match result {
                        Ok(()) => {
                            if first_publish {
                                log::info!("[discord-presence] Coven Cave presence published");
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

                thread::sleep(RETRY_DELAY);
            }
        })
    {
        log::warn!("[discord-presence] could not start worker: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_activity, publish_activity, run_bounded_operation, ASSET_COMMIT, ASSET_PATH,
        ASSET_URL, DISPLAY_NAME,
    };
    use discord_rich_presence::{activity, error::Error, DiscordIpc};
    use serde_json::{json, Value};
    use std::{
        collections::VecDeque,
        thread,
        time::{Duration, Instant},
    };

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
    fn activity_is_titled_for_a_reader_not_for_the_repository_slug() {
        let activity = build_activity(1_700_000_000);
        let serialized = serde_json::to_value(activity).expect("activity should serialize");

        // Without an explicit name Discord falls back to the Developer Portal
        // application name, which is "CovenCave".
        assert_eq!(serialized["name"], DISPLAY_NAME);
        assert_eq!(serialized["assets"]["large_text"], DISPLAY_NAME);
        assert_eq!(DISPLAY_NAME, "Coven Cave");
        assert!(
            !serialized.to_string().contains("CovenCave"),
            "no payload field may show the repository slug to a reader"
        );
    }

    #[test]
    fn activity_art_is_a_resolvable_url_rather_than_an_unverifiable_asset_key() {
        let activity = build_activity(1_700_000_000);
        let serialized = serde_json::to_value(activity).expect("activity should serialize");

        let large_image = serialized["assets"]["large_image"]
            .as_str()
            .expect("the activity must carry large_image");
        assert!(
            large_image.starts_with("https://"),
            "an asset key silently renders Discord's placeholder when the \
             Developer Portal upload is missing; a URL fails visibly instead"
        );
        assert_eq!(large_image, ASSET_URL);
        assert!(
            large_image.ends_with(".png"),
            "Discord proxies a direct image URL, not an HTML page"
        );
    }

    #[test]
    fn activity_art_url_points_at_a_file_this_repository_actually_carries() {
        // The URL is only as good as the path it names. A rename that lands
        // without updating this constant would otherwise ship a broken card
        // that nothing here notices.
        let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri has a parent");
        let on_disk = repo_root.join(ASSET_PATH);
        assert!(
            on_disk.is_file(),
            "{} is served by the presence card but missing from the repository",
            on_disk.display()
        );
    }

    #[test]
    fn activity_art_url_is_pinned_to_an_immutable_commit() {
        // A branch ref would let a later rename blank the art on every release
        // already shipped, since this string is baked into the binary.
        assert!(
            !ASSET_URL.contains("/main/"),
            "the art URL must not track a moving branch: {ASSET_URL}"
        );
        assert_eq!(ASSET_COMMIT.len(), 40, "pin a full commit SHA");
        assert!(
            ASSET_COMMIT.chars().all(|c| c.is_ascii_hexdigit()),
            "the pinned commit must be a hex SHA"
        );
        assert!(ASSET_URL.contains(ASSET_COMMIT));
        assert!(ASSET_URL.ends_with(ASSET_PATH));
    }

    #[test]
    fn activity_is_generic_and_carries_no_user_content() {
        let activity = build_activity(1_700_000_000);
        let serialized = serde_json::to_value(activity).expect("activity should serialize");

        assert_eq!(serialized["details"], "Summoning familiars");
        assert_eq!(serialized["state"], "In the Cave");
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

    #[test]
    fn bounded_ipc_operation_returns_when_the_operation_stalls() {
        let started = Instant::now();
        let result = run_bounded_operation(Duration::from_millis(25), || {
            thread::sleep(Duration::from_millis(250));
        });

        let error = result.expect_err("a stalled IPC operation must time out");
        assert!(error.contains("timed out"));
        assert!(
            started.elapsed() < Duration::from_millis(150),
            "bounded IPC operation took {:?}",
            started.elapsed()
        );
    }
}
