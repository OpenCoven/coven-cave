use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::{
    msg_send,
    runtime::{AnyClass, Bool},
};
use serde::Serialize;

const MICROPHONE_SETTINGS_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum MicrophonePermissionStatus {
    Granted,
    Denied,
    Unavailable,
}

#[derive(Serialize)]
pub struct MicrophonePermission {
    status: MicrophonePermissionStatus,
}

fn request_native_permission() -> Result<MicrophonePermission, String> {
    let Some(application) = AnyClass::get(c"AVAudioApplication") else {
        return Ok(MicrophonePermission {
            status: MicrophonePermissionStatus::Unavailable,
        });
    };

    let (sender, receiver) = mpsc::channel();
    let response = RcBlock::new(move |granted: Bool| {
        let _ = sender.send(granted.as_bool());
    });

    unsafe {
        let _: () = msg_send![
            application,
            requestRecordPermissionWithCompletionHandler: &*response
        ];
    }

    let granted = receiver
        .recv_timeout(Duration::from_secs(120))
        .map_err(|error| format!("microphone permission request failed: {error}"))?;
    Ok(MicrophonePermission {
        status: if granted {
            MicrophonePermissionStatus::Granted
        } else {
            MicrophonePermissionStatus::Denied
        },
    })
}

#[tauri::command]
pub async fn microphone_permission_request() -> Result<MicrophonePermission, String> {
    tauri::async_runtime::spawn_blocking(request_native_permission)
        .await
        .map_err(|error| format!("microphone permission task failed: {error}"))?
}

#[tauri::command]
pub fn microphone_settings_open() -> Result<(), String> {
    std::process::Command::new("open")
        .arg(MICROPHONE_SETTINGS_URL)
        .spawn()
        .map_err(|error| format!("failed to open microphone settings: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::MICROPHONE_SETTINGS_URL;

    #[test]
    fn settings_url_targets_microphone_privacy() {
        assert_eq!(
            MICROPHONE_SETTINGS_URL,
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        );
    }
}
