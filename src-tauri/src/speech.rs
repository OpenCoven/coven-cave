// On-device macOS speech-to-text for the voice speech loop (cave-0ogg).
//
// WKWebView has no Web Speech `SpeechRecognition`, so the packaged desktop
// app was deaf in the keyless voice modes (local / familiar / ElevenLabs)
// whose ears are device recognition. These commands give the webview a
// native ear: the speech loop records VAD-segmented utterances with
// MediaRecorder (AAC in an mp4 container on WKWebView) and hands each
// finished segment here, where Apple's Speech framework transcribes the
// audio file strictly on this machine — `requiresOnDeviceRecognition` is
// always set, so audio never leaves the device (the same no-cloud promise
// the local voice provider makes).
//
// Two commands:
//   speech_stt_probe      — authorization + on-device availability, called
//                           once at call connect so problems fail fast with
//                           actionable hints (prompts the system permission
//                           sheet on first use).
//   speech_stt_transcribe — one recorded utterance (base64) → final text.
//
// Both are async and do their Objective-C work on a blocking worker thread:
// the Speech framework callbacks land on arbitrary Apple queues, and the
// recognizer/task must stay alive on a thread we own until the final result
// (or error) arrives.

use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SpeechSttProbe {
    /// Platform has a native recognizer wired up at all.
    pub supported: bool,
    /// "authorized" | "denied" | "restricted" | "undetermined" | "unsupported"
    pub status: String,
    /// The active locale's recognizer can run fully on-device.
    pub on_device: bool,
    /// Locale identifier the recognizer resolved to, when one exists.
    pub locale: Option<String>,
    /// Human-readable detail for non-usable states.
    pub detail: Option<String>,
}

/// Map a MediaRecorder mime type to the file extension AVFoundation uses to
/// sniff the container when the Speech framework opens the segment.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn extension_for_mime(mime: &str) -> &'static str {
    let base = mime.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    match base.as_str() {
        "audio/mp4" | "audio/m4a" | "audio/x-m4a" | "audio/aac" => "m4a",
        "audio/wav" | "audio/wave" | "audio/x-wav" => "wav",
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/webm" => "webm",
        _ => "m4a",
    }
}

#[tauri::command]
pub async fn speech_stt_probe(locale: Option<String>) -> Result<SpeechSttProbe, String> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || mac::probe(locale.as_deref()))
            .await
            .map_err(|e| format!("stt_probe_worker_failed: {e}"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = locale;
        Ok(SpeechSttProbe {
            supported: false,
            status: "unsupported".into(),
            on_device: false,
            locale: None,
            detail: Some("native speech recognition is only wired on macOS".into()),
        })
    }
}

#[tauri::command]
pub async fn speech_stt_transcribe(
    audio_base64: String,
    mime_type: String,
    locale: Option<String>,
) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            mac::transcribe(&audio_base64, &mime_type, locale.as_deref())
        })
        .await
        .map_err(|e| format!("stt_worker_failed: {e}"))?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (audio_base64, mime_type, locale);
        Err("stt_unsupported_platform: native speech recognition is only wired on macOS".into())
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use super::SpeechSttProbe;
    use base64::Engine as _;
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::NSObjectProtocol as _;
    use objc2::AnyThread as _;
    use objc2_foundation::{NSError, NSLocale, NSString, NSURL};
    use objc2_speech::{
        SFSpeechRecognitionResult, SFSpeechRecognizer, SFSpeechRecognizerAuthorizationStatus,
        SFSpeechURLRecognitionRequest,
    };
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::mpsc;
    use std::time::Duration;

    /// One utterance segment is ≤ ~45s of AAC; on-device recognition of that
    /// is seconds. Anything past this is a wedged framework call.
    const RECOGNITION_TIMEOUT: Duration = Duration::from_secs(60);
    /// The system permission sheet blocks on the user; be generous.
    const AUTHORIZATION_TIMEOUT: Duration = Duration::from_secs(300);

    fn make_recognizer(locale: Option<&str>) -> Option<Retained<SFSpeechRecognizer>> {
        unsafe {
            if let Some(id) = locale.filter(|l| !l.trim().is_empty()) {
                let ns_locale = NSLocale::initWithLocaleIdentifier(
                    NSLocale::alloc(),
                    &NSString::from_str(id.trim()),
                );
                if let Some(r) =
                    SFSpeechRecognizer::initWithLocale(SFSpeechRecognizer::alloc(), &ns_locale)
                {
                    return Some(r);
                }
            }
            // Unsupported requested locale → the user's default recognizer.
            SFSpeechRecognizer::init(SFSpeechRecognizer::alloc())
        }
    }

    /// Current authorization, prompting the system sheet on first use and
    /// blocking (on the worker thread) until the user answers.
    fn resolve_authorization() -> SFSpeechRecognizerAuthorizationStatus {
        let status = unsafe { SFSpeechRecognizer::authorizationStatus() };
        if status != SFSpeechRecognizerAuthorizationStatus::NotDetermined {
            return status;
        }
        let (tx, rx) = mpsc::channel::<isize>();
        let handler = RcBlock::new(move |st: SFSpeechRecognizerAuthorizationStatus| {
            let _ = tx.send(st.0);
        });
        unsafe { SFSpeechRecognizer::requestAuthorization(&handler) };
        match rx.recv_timeout(AUTHORIZATION_TIMEOUT) {
            Ok(raw) => SFSpeechRecognizerAuthorizationStatus(raw),
            Err(_) => SFSpeechRecognizerAuthorizationStatus::NotDetermined,
        }
    }

    fn status_label(status: SFSpeechRecognizerAuthorizationStatus) -> &'static str {
        match status {
            SFSpeechRecognizerAuthorizationStatus::Authorized => "authorized",
            SFSpeechRecognizerAuthorizationStatus::Denied => "denied",
            SFSpeechRecognizerAuthorizationStatus::Restricted => "restricted",
            _ => "undetermined",
        }
    }

    /// `supportsOnDeviceRecognition` arrived in macOS 10.15; guard the
    /// selector so ancient systems degrade to "not supported" instead of
    /// throwing unrecognized-selector.
    fn supports_on_device(recognizer: &SFSpeechRecognizer) -> bool {
        if !recognizer.respondsToSelector(objc2::sel!(supportsOnDeviceRecognition)) {
            return false;
        }
        unsafe { recognizer.supportsOnDeviceRecognition() }
    }

    pub fn probe(locale: Option<&str>) -> SpeechSttProbe {
        let status = resolve_authorization();
        let label = status_label(status).to_string();
        if status != SFSpeechRecognizerAuthorizationStatus::Authorized {
            return SpeechSttProbe {
                supported: true,
                status: label,
                on_device: false,
                locale: None,
                detail: Some(
                    "macOS has not authorized CovenCave for speech recognition".into(),
                ),
            };
        }
        let Some(recognizer) = make_recognizer(locale) else {
            return SpeechSttProbe {
                supported: true,
                status: label,
                on_device: false,
                locale: None,
                detail: Some("no speech recognizer exists for this language".into()),
            };
        };
        let resolved_locale =
            Some(unsafe { recognizer.locale().localeIdentifier() }.to_string());
        if !unsafe { recognizer.isAvailable() } {
            return SpeechSttProbe {
                supported: true,
                status: label,
                on_device: false,
                locale: resolved_locale,
                detail: Some("the speech recognizer is temporarily unavailable".into()),
            };
        }
        SpeechSttProbe {
            supported: true,
            status: label,
            on_device: supports_on_device(&recognizer),
            locale: resolved_locale,
            detail: None,
        }
    }

    /// Temp segment file that cleans itself up on every exit path.
    struct SegmentFile(PathBuf);
    impl Drop for SegmentFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    fn write_segment(bytes: &[u8], ext: &str) -> Result<SegmentFile, String> {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "coven-stt-{}-{}.{ext}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed),
        ));
        std::fs::write(&path, bytes).map_err(|e| format!("stt_segment_write_failed: {e}"))?;
        Ok(SegmentFile(path))
    }

    pub fn transcribe(
        audio_base64: &str,
        mime_type: &str,
        locale: Option<&str>,
    ) -> Result<String, String> {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(audio_base64.trim())
            .map_err(|e| format!("stt_bad_audio_payload: {e}"))?;
        if bytes.is_empty() {
            return Err("stt_empty_audio: the recorded segment had no bytes".into());
        }

        let status = unsafe { SFSpeechRecognizer::authorizationStatus() };
        if status != SFSpeechRecognizerAuthorizationStatus::Authorized {
            return Err(format!(
                "stt_permission_{}: allow Speech Recognition for CovenCave in System Settings → Privacy & Security",
                status_label(status)
            ));
        }
        let recognizer = make_recognizer(locale)
            .ok_or("stt_no_recognizer: no speech recognizer exists for this language")?;
        if !unsafe { recognizer.isAvailable() } {
            return Err("stt_recognizer_unavailable: the speech recognizer is temporarily unavailable".into());
        }
        if !supports_on_device(&recognizer) {
            return Err(
                "stt_on_device_unsupported: this Mac cannot transcribe this language on-device"
                    .into(),
            );
        }

        let segment = write_segment(&bytes, super::extension_for_mime(mime_type))?;
        let url = NSURL::fileURLWithPath(&NSString::from_str(&segment.0.to_string_lossy()));
        let request = unsafe {
            SFSpeechURLRecognitionRequest::initWithURL(
                SFSpeechURLRecognitionRequest::alloc(),
                &url,
            )
        };
        unsafe {
            request.setShouldReportPartialResults(false);
            // The privacy contract of this engine: audio never leaves the Mac.
            request.setRequiresOnDeviceRecognition(true);
        }
        // Punctuated dictation reads far better in transcripts; the setter is
        // macOS 13+, so probe the selector rather than crashing on older systems.
        if request.respondsToSelector(objc2::sel!(setAddsPunctuation:)) {
            unsafe { request.setAddsPunctuation(true) };
        }

        let (tx, rx) = mpsc::channel::<Result<String, String>>();
        let handler = RcBlock::new(
            move |result: *mut SFSpeechRecognitionResult, error: *mut NSError| {
                if let Some(error) = unsafe { error.as_ref() } {
                    let _ = tx.send(Err(format!(
                        "stt_recognition_failed: {}",
                        error.localizedDescription()
                    )));
                    return;
                }
                if let Some(result) = unsafe { result.as_ref() } {
                    if unsafe { result.isFinal() } {
                        let text =
                            unsafe { result.bestTranscription().formattedString() }.to_string();
                        let _ = tx.send(Ok(text));
                    }
                }
            },
        );
        // Keep the task (and with it the handler + recognizer) alive until the
        // framework delivers the final callback or we give up.
        let _task = unsafe { recognizer.recognitionTaskWithRequest_resultHandler(&request, &handler) };
        match rx.recv_timeout(RECOGNITION_TIMEOUT) {
            Ok(result) => result,
            Err(_) => Err("stt_recognition_timeout: on-device recognition did not finish".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::extension_for_mime;

    #[test]
    fn maps_recorder_mimes_to_avfoundation_extensions() {
        assert_eq!(extension_for_mime("audio/mp4"), "m4a");
        assert_eq!(extension_for_mime("audio/mp4;codecs=mp4a.40.2"), "m4a");
        assert_eq!(extension_for_mime("AUDIO/AAC"), "m4a");
        assert_eq!(extension_for_mime("audio/wav"), "wav");
        assert_eq!(extension_for_mime("audio/webm;codecs=opus"), "webm");
        // Unknown types fall back to the WKWebView default container.
        assert_eq!(extension_for_mime("application/octet-stream"), "m4a");
        assert_eq!(extension_for_mime(""), "m4a");
    }
}
