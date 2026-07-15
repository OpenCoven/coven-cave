// Native speech-to-text engine for local voice calls (cave-0ogg).
//
// WKWebView ships no SpeechRecognition, so the packaged macOS app cannot run
// the ears half of the local voice loop (src/lib/voice/speech-loop.ts) in the
// webview. This module owns the ears natively: AVAudioEngine taps the mic and
// feeds an SFSpeechAudioBufferRecognitionRequest; partial and final
// transcripts stream back to the main webview as `speech-stt:event` events.
//
// Surfaced as tauri::commands (all fire-and-forget except `available`;
// engine failures arrive as `error` events so the JS ears own retry policy):
//   speech_stt_available() -> SttAvailability
//   speech_stt_start(session, lang)   spin up mic tap + recognition task
//   speech_stt_finish(session)        end audio; a `final` event follows
//   speech_stt_stop(session)          cancel + tear down, no final
//
// Events emitted to the frontend (all carry the u32 session id so the JS
// side can drop stale events from a torn-down session):
//   speech-stt:event { session, kind: "partial"|"final"|"error"|"end",
//                      text?, code?, message? }
//
// Endpointing (deciding the user finished a sentence) deliberately lives in
// the JS ears (src/lib/voice/native-stt.ts) — SFSpeechRecognizer streams
// partials until endAudio, so the testable partial-stability timer upstream
// calls `speech_stt_finish` instead of this module guessing silence.
//
// Threading: every AVFoundation/Speech object is created and torn down on
// the main thread (they are not Send); commands hop via
// AppHandle::run_on_main_thread and the live session lives in a
// thread-local. The audio tap and recognition callbacks arrive on Apple's
// internal queues — appendAudioPCMBuffer is documented safe from the tap
// thread, and result handling re-dispatches to the main thread before
// touching session state.

use serde::Serialize;
use tauri::AppHandle;

#[derive(Serialize)]
pub struct SttAvailability {
    pub supported: bool,
    /// Human-readable reason when unsupported (platform, denied permission).
    pub reason: Option<String>,
}

pub const STT_EVENT: &str = "speech-stt:event";

#[derive(Clone, Serialize)]
pub struct SttEvent {
    pub session: u32,
    /// "partial" | "final" | "error" | "end"
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[tauri::command]
pub fn speech_stt_available() -> SttAvailability {
    #[cfg(target_os = "macos")]
    {
        SttAvailability { supported: true, reason: None }
    }
    #[cfg(not(target_os = "macos"))]
    {
        SttAvailability {
            supported: false,
            reason: Some("native speech recognition is only wired up on macOS".into()),
        }
    }
}

#[tauri::command]
pub fn speech_stt_start(app: AppHandle, session: u32, lang: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::start(app, session, lang);
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, session, lang);
        Err("native speech recognition is only wired up on macOS".into())
    }
}

#[tauri::command]
pub fn speech_stt_finish(app: AppHandle, session: u32) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::finish(app, session);
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, session);
        Ok(())
    }
}

#[tauri::command]
pub fn speech_stt_stop(app: AppHandle, session: u32) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::stop(app, session);
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, session);
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::cell::RefCell;
    use std::ptr::NonNull;

    use block2::RcBlock;
    use log::{info, warn};
    use objc2::rc::Retained;
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_avf_audio::{AVAudioEngine, AVAudioPCMBuffer, AVAudioTime};
    use objc2_foundation::{NSError, NSLocale, NSString};
    use objc2_speech::{
        SFSpeechAudioBufferRecognitionRequest, SFSpeechRecognitionResult, SFSpeechRecognitionTask,
        SFSpeechRecognizer, SFSpeechRecognizerAuthorizationStatus,
    };
    use tauri::{AppHandle, Emitter};

    use super::{SttEvent, STT_EVENT};

    struct ActiveStt {
        session: u32,
        engine: Retained<AVAudioEngine>,
        request: Retained<SFSpeechAudioBufferRecognitionRequest>,
        task: Retained<SFSpeechRecognitionTask>,
        // Kept alive for the duration of the task.
        _recognizer: Retained<SFSpeechRecognizer>,
    }

    thread_local! {
        /// The one live recognition session; only the main thread touches it.
        static ACTIVE: RefCell<Option<ActiveStt>> = const { RefCell::new(None) };
    }

    fn emit(app: &AppHandle, event: SttEvent) {
        if let Err(err) = app.emit(STT_EVENT, event) {
            warn!("speech_stt: event emit failed: {err}");
        }
    }

    fn emit_error(app: &AppHandle, session: u32, code: &'static str, message: String) {
        emit(app, SttEvent { session, kind: "error", text: None, code: Some(code), message: Some(message) });
        emit(app, SttEvent { session, kind: "end", text: None, code: None, message: None });
    }

    /// Tear down the active session if it matches `session`. Main thread only.
    fn teardown_if_current(session: u32) {
        ACTIVE.with(|slot| {
            let mut slot = slot.borrow_mut();
            if slot.as_ref().is_some_and(|a| a.session == session) {
                if let Some(active) = slot.take() {
                    unsafe {
                        active.task.cancel();
                        active.request.endAudio();
                        active.engine.stop();
                        active.engine.inputNode().removeTapOnBus(0);
                    }
                }
            }
        });
    }

    pub fn start(app: AppHandle, session: u32, lang: Option<String>) {
        let app2 = app.clone();
        let run = app.run_on_main_thread(move || match unsafe { SFSpeechRecognizer::authorizationStatus() } {
            SFSpeechRecognizerAuthorizationStatus::Authorized => start_engine(app2, session, lang),
            SFSpeechRecognizerAuthorizationStatus::Denied
            | SFSpeechRecognizerAuthorizationStatus::Restricted => {
                emit_error(
                    &app2,
                    session,
                    "stt_permission_denied",
                    "Speech recognition permission is denied — allow it in System Settings → Privacy & Security → Speech Recognition.".into(),
                );
            }
            _ => {
                // Not determined: ask, then continue on the main thread.
                let app3 = app2.clone();
                let handler = RcBlock::new(move |status: SFSpeechRecognizerAuthorizationStatus| {
                    let app4 = app3.clone();
                    let lang = lang.clone();
                    let _ = app3.run_on_main_thread(move || {
                        if status == SFSpeechRecognizerAuthorizationStatus::Authorized {
                            start_engine(app4, session, lang);
                        } else {
                            emit_error(
                                &app4,
                                session,
                                "stt_permission_denied",
                                "Speech recognition permission was not granted.".into(),
                            );
                        }
                    });
                });
                unsafe { SFSpeechRecognizer::requestAuthorization(&handler) };
            }
        });
        if let Err(err) = run {
            warn!("speech_stt_start[{session}]: main-thread dispatch failed: {err}");
        }
    }

    /// Main-thread body: build recognizer + request + mic tap, start the task.
    fn start_engine(app: AppHandle, session: u32, lang: Option<String>) {
        debug_assert!(MainThreadMarker::new().is_some());
        // A newer session replaces any live one (the JS ears serialize this,
        // but a stray overlap must not leak a running engine).
        ACTIVE.with(|slot| {
            if let Some(active) = slot.borrow_mut().take() {
                unsafe {
                    active.task.cancel();
                    active.engine.stop();
                    active.engine.inputNode().removeTapOnBus(0);
                }
            }
        });

        let recognizer = lang
            .filter(|l| !l.trim().is_empty())
            .and_then(|l| {
                let locale = NSLocale::localeWithLocaleIdentifier(&NSString::from_str(l.trim()));
                unsafe { SFSpeechRecognizer::initWithLocale(SFSpeechRecognizer::alloc(), &locale) }
            })
            .or_else(|| Some(unsafe { SFSpeechRecognizer::new() }))
            .filter(|r| unsafe { r.isAvailable() });
        let Some(recognizer) = recognizer else {
            emit_error(
                &app,
                session,
                "stt_unavailable",
                "macOS speech recognition is unavailable for this language right now.".into(),
            );
            return;
        };

        let request = unsafe { SFSpeechAudioBufferRecognitionRequest::new() };
        unsafe {
            request.setShouldReportPartialResults(true);
            // Prefer the on-device dictation model when this Mac has it — the
            // local provider's promise is "no cloud". Machines without the
            // model fall back to Apple's system dictation service.
            if recognizer.supportsOnDeviceRecognition() {
                request.setRequiresOnDeviceRecognition(true);
            }
        }

        let engine = unsafe { AVAudioEngine::new() };
        let input = unsafe { engine.inputNode() };
        let format = unsafe { input.outputFormatForBus(0) };
        {
            let request = request.clone();
            let tap = RcBlock::new(
                move |buffer: NonNull<AVAudioPCMBuffer>, _when: NonNull<AVAudioTime>| {
                    // Documented-safe from the tap's audio thread.
                    unsafe { request.appendAudioPCMBuffer(buffer.as_ref()) };
                },
            );
            let tap_ptr = &*tap as *const _ as *mut _;
            unsafe { input.installTapOnBus_bufferSize_format_block(0, 4096, Some(&format), tap_ptr) };
        }

        unsafe { engine.prepare() };
        if let Err(err) = unsafe { engine.startAndReturnError() } {
            unsafe { input.removeTapOnBus(0) };
            emit_error(
                &app,
                session,
                "stt_mic_failed",
                format!("The microphone could not be started: {}", err.localizedDescription()),
            );
            return;
        }

        let handler_app = app.clone();
        let handler = RcBlock::new(
            move |result: *mut SFSpeechRecognitionResult, error: *mut NSError| {
                // Runs on an Apple-owned queue: read what we need, then hop to
                // the main thread for any session-state change.
                let mut final_text: Option<String> = None;
                let mut partial_text: Option<String> = None;
                if let Some(result) = unsafe { result.as_ref() } {
                    let text = unsafe { result.bestTranscription().formattedString() }.to_string();
                    if unsafe { result.isFinal() } {
                        final_text = Some(text);
                    } else {
                        partial_text = Some(text);
                    }
                }
                let errored = !error.is_null() && final_text.is_none();
                let message = unsafe { error.as_ref() }.map(|e| e.localizedDescription().to_string());

                if let Some(text) = partial_text {
                    emit(&handler_app, SttEvent { session, kind: "partial", text: Some(text), code: None, message: None });
                    return;
                }

                let app = handler_app.clone();
                let _ = handler_app.run_on_main_thread(move || {
                    // Only the live session may speak; a cancelled task's
                    // trailing error callback must stay silent.
                    let is_current = ACTIVE
                        .with(|slot| slot.borrow().as_ref().is_some_and(|a| a.session == session));
                    if !is_current {
                        return;
                    }
                    teardown_if_current(session);
                    if let Some(text) = final_text {
                        emit(&app, SttEvent { session, kind: "final", text: Some(text), code: None, message: None });
                        emit(&app, SttEvent { session, kind: "end", text: None, code: None, message: None });
                    } else if errored {
                        emit_error(
                            &app,
                            session,
                            "stt_failed",
                            message.unwrap_or_else(|| "speech recognition failed".into()),
                        );
                    } else {
                        emit(&app, SttEvent { session, kind: "end", text: None, code: None, message: None });
                    }
                });
            },
        );
        let task = unsafe { recognizer.recognitionTaskWithRequest_resultHandler(&request, &handler) };

        info!("speech_stt[{session}]: engine started (on-device={})", unsafe {
            recognizer.supportsOnDeviceRecognition()
        });
        ACTIVE.with(|slot| {
            *slot.borrow_mut() = Some(ActiveStt { session, engine, request, task, _recognizer: recognizer });
        });
    }

    pub fn finish(app: AppHandle, session: u32) {
        let run = app.run_on_main_thread(move || {
            ACTIVE.with(|slot| {
                let slot = slot.borrow();
                if let Some(active) = slot.as_ref().filter(|a| a.session == session) {
                    unsafe {
                        // Stop capturing immediately; the final result arrives
                        // through the task handler, which tears down the rest.
                        active.engine.stop();
                        active.engine.inputNode().removeTapOnBus(0);
                        active.request.endAudio();
                    }
                }
            });
        });
        if let Err(err) = run {
            warn!("speech_stt_finish[{session}]: main-thread dispatch failed: {err}");
        }
    }

    pub fn stop(app: AppHandle, session: u32) {
        let run = app.run_on_main_thread(move || teardown_if_current(session));
        if let Err(err) = run {
            warn!("speech_stt_stop[{session}]: main-thread dispatch failed: {err}");
        }
    }
}
