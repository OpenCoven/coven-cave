use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::{
    msg_send,
    runtime::{AnyClass, AnyObject, Bool},
    sel,
};
use serde::Serialize;

#[link(name = "AVFoundation", kind = "framework")]
unsafe extern "C" {
    static AVMediaTypeAudio: *const AnyObject;
}

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
    if let Some(application) = AnyClass::get(c"AVAudioApplication") {
        return request_audio_application_permission(application);
    }
    if let Some(capture_device) = AnyClass::get(c"AVCaptureDevice") {
        return request_capture_device_permission(capture_device);
    }
    Ok(MicrophonePermission {
        status: MicrophonePermissionStatus::Unavailable,
    })
}

fn request_audio_application_permission(
    application: &AnyClass,
) -> Result<MicrophonePermission, String> {
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
    receive_permission(receiver)
}

fn request_capture_device_permission(
    capture_device: &AnyClass,
) -> Result<MicrophonePermission, String> {
    let supported: Bool = unsafe {
        msg_send![
            capture_device,
            respondsToSelector: sel!(requestAccessForMediaType:completionHandler:)
        ]
    };
    if !supported.as_bool() {
        return Ok(MicrophonePermission {
            status: MicrophonePermissionStatus::Unavailable,
        });
    }

    let (sender, receiver) = mpsc::channel();
    let response = RcBlock::new(move |granted: Bool| {
        let _ = sender.send(granted.as_bool());
    });

    unsafe {
        if AVMediaTypeAudio.is_null() {
            return Err("AVMediaTypeAudio is unavailable".into());
        }
        let _: () = msg_send![
            capture_device,
            requestAccessForMediaType: &*AVMediaTypeAudio,
            completionHandler: &*response
        ];
    }
    receive_permission(receiver)
}

fn receive_permission(receiver: mpsc::Receiver<bool>) -> Result<MicrophonePermission, String> {
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
    let status = std::process::Command::new("open")
        .arg(MICROPHONE_SETTINGS_URL)
        .status()
        .map_err(|error| format!("failed to open microphone settings: {error}"))?;
    settings_open_result(status)
}

fn settings_open_result(status: std::process::ExitStatus) -> Result<(), String> {
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "failed to open microphone settings: open exited unsuccessfully ({status})"
        ))
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::process::ExitStatusExt;

    use super::{settings_open_result, MICROPHONE_SETTINGS_URL};

    #[test]
    fn settings_url_targets_microphone_privacy() {
        assert_eq!(
            MICROPHONE_SETTINGS_URL,
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        );
    }

    #[test]
    fn settings_launcher_rejects_non_zero_exit() {
        let error = settings_open_result(std::process::ExitStatus::from_raw(1 << 8))
            .expect_err("a failed open command must reach the frontend");
        assert!(error.contains("exited unsuccessfully"));
    }
}
