use super::*;

/// Show or hide the macOS traffic lights (close/minimize/zoom) on the
/// invoking window. The main window's title bar is an Overlay (see the main
/// window builder), so the buttons float over web content — when the app's
/// side panel is closed the shell asks for them to disappear, Dia-style, and
/// brings them back the moment the panel (or its hover-peek) opens. AppKit
/// must be touched on the main thread; a no-op elsewhere.
#[cfg(desktop)]
#[tauri::command]
fn set_traffic_lights_visible(window: tauri::WebviewWindow, visible: bool) {
    #[cfg(target_os = "macos")]
    {
        let win = window.clone();
        let _ = window.run_on_main_thread(move || {
            let Ok(ns_ptr) = win.ns_window() else { return };
            unsafe {
                use objc2::msg_send;
                use objc2::runtime::AnyObject;
                let ns_window = ns_ptr as *mut AnyObject;
                // NSWindowButton: close = 0, miniaturize = 1, zoom = 2.
                for kind in 0u64..=2u64 {
                    let button: *mut AnyObject = msg_send![&*ns_window, standardWindowButton: kind];
                    if !button.is_null() {
                        let _: () = msg_send![&*button, setHidden: !visible];
                    }
                }
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, visible);
    }
}

#[cfg(all(test, desktop))]
#[path = "shell_open_tests.rs"]
mod shell_open_tests;
#[tauri::command]
fn webview_probe_report(report: String) -> Result<(), String> {
    // Dev-only diagnostic hook. In release builds, keep this as a no-op to avoid
    // creating a writable IPC sink for arbitrary/unbounded data.
    if !cfg!(debug_assertions) {
        return Ok(());
    }

    // Prevent unbounded growth if something chatty forwards logs.
    let report = if report.chars().count() > 16_384 {
        let mut s: String = report.chars().take(16_384).collect();
        s.push_str("…<truncated>");
        s
    } else {
        report
    };

    let path = std::env::temp_dir().join("covencave-webview-probe.log");
    use std::io::Write as _;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(f, "{}", report).map_err(|e| e.to_string())?;
    log::debug!("[webview-probe] {}", report);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(all(desktop, target_os = "windows"))]
    if let Some(code) = windows_process_job::run_gated_child_if_requested() {
        std::process::exit(code);
    }

    let builder = tauri::Builder::default().plugin(tauri_plugin_os::init());

    // Mobile-Tauri shell: no sidecar, no tray, no embedded browser/pty.
    // The webview points at the configured devUrl (Tailscale Serve URL
    // in dev, the bundled frontend stub at build) and the daemon lives
    // remote — see docs/mobile-tailscale.md. Notification plugin still
    // initialises so push permissions flow through the OS sheet.
    #[cfg(mobile)]
    {
        builder
            .invoke_handler(tauri::generate_handler![webview_probe_report])
            .setup(|app| {
                if cfg!(debug_assertions) {
                    app.handle().plugin(
                        tauri_plugin_log::Builder::default()
                            .level(log::LevelFilter::Debug)
                            .build(),
                    )?;
                }
                app.handle().plugin(tauri_plugin_notification::init())?;

                // Debug mobile builds are launched by scripts/mobile-tailscale.sh
                // with a live Tailscale Serve dev URL. Release/TestFlight builds
                // cannot receive that env var, so they must open the bundled
                // connection screen instead of silently trying localhost:3000.
                let webview_url = if cfg!(debug_assertions) {
                    // Resolve the Tailscale Serve URL.
                    // Priority: CAVE_MOBILE_DEV_URL env var -> tauri.conf.json devUrl -> localhost:3000
                    // Security: only https://*.ts.net and http(s)://localhost accepted.
                    let resolved_url: tauri::Url = {
                        let from_env = std::env::var("CAVE_MOBILE_DEV_URL")
                            .ok()
                            .and_then(|s| tauri::Url::parse(&s).ok());

                        let url = from_env
                            .or_else(|| app.config().build.dev_url.clone())
                            .unwrap_or_else(|| {
                                tauri::Url::parse("http://localhost:3000")
                                    .expect("fallback url is valid")
                            });

                        let host = url.host_str().unwrap_or("");
                        let scheme = url.scheme();
                        let allowed = (scheme == "https"
                            && (host.ends_with(".ts.net") || host == "localhost"))
                            || (scheme == "http"
                                && (host == "localhost" || host == "127.0.0.1"));

                        if !allowed {
                            panic!(
                                "CAVE_MOBILE_DEV_URL must be https://<host>.ts.net, https://localhost, http://localhost, or http://127.0.0.1 - got: {}",
                                url
                            );
                        }
                        log::info!("[cave-mobile] webview URL: {}", url);
                        url
                    };
                    tauri::WebviewUrl::External(resolved_url)
                } else {
                    tauri::WebviewUrl::App("index.html".into())
                };

                tauri::WebviewWindowBuilder::new(
                    app,
                    "main",
                    webview_url,
                )
                .title("CovenCave")
                .build()?;

                Ok(())
            })
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
        return;
    }

    // Desktop body — sidecar bootstrap, embedded browser, terminal,
    // tray icon. Everything below this point is gated to `cfg(desktop)`
    // by the imports at the top of the file.
    #[cfg(desktop)]
    let sidecar_process = Arc::new(Mutex::new(None));
    #[cfg(desktop)]
    let builder = builder
        .invoke_handler(tauri::generate_handler![
            pty::pty_start,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_stop,
            pty::pty_list,
            pty::pty_snapshot,
            pty::pty_diagnose,
            webview_probe_report,
            browser::browser_commands::browser_navigate,
            browser::browser_commands::browser_set_bounds,
            browser::browser_commands::browser_hide,
            browser::browser_commands::browser_hide_all_except,
            browser::browser_commands::browser_close,
            browser::browser_commands::browser_deactivate_all,
            browser::browser_commands::browser_close_all,
            browser::browser_commands::browser_reload,
            browser::browser_commands::browser_report_user_navigation,
            browser::browser_commands::browser_report_title,
            browser::browser_commands::browser_report_scroll,
            shell_open,
            shell_open_path,
            shell_pick_directory,
            set_traffic_lights_visible,
            speech::speech_stt_available,
            speech::speech_stt_start,
            speech::speech_stt_finish,
            speech::speech_stt_stop,
            #[cfg(target_os = "windows")]
            sidecar_startup_status,
            #[cfg(target_os = "windows")]
            retry_sidecar_startup,
            #[cfg(target_os = "windows")]
            cancel_sidecar_startup,
        ])
        .manage(SidecarState(Arc::clone(&sidecar_process)))
        .manage(browser::BrowserLifecycleState::default());
    #[cfg(all(desktop, target_os = "windows"))]
    let builder = builder.manage(Arc::new(SidecarStartupControl::new()));
    #[cfg(desktop)]
    builder
        .setup(move |app| {
            // The updater's Windows pre-exit path clears the application
            // resource table after validating the package and before starting
            // msiexec. Dropping this guard stops/reaps the sidecar even though
            // std::process::exit bypasses window destruction and RunEvent.
            let _ = app
                .resources_table()
                .add(SidecarCleanupGuard(Arc::clone(&sidecar_process)));
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Debug)
                        .build(),
                )?;
            }

            app.handle().plugin(tauri_plugin_notification::init())?;

            // Desktop auto-update: updater checks/downloads/installs signed
            // release artifacts; process provides relaunch() after install.
            let updater_builder = tauri_plugin_updater::Builder::new();
            #[cfg(target_os = "windows")]
            let updater_builder = {
                let log_dir = app.path().app_log_dir()?;
                std::fs::create_dir_all(&log_dir)?;
                let log_path = log_dir.join(format!(
                    "msi-upgrade-from-{}-{}.log",
                    app.package_info().version,
                    std::process::id()
                ));
                log::info!("[cave] updater MSI log -> {}", log_path.display());
                updater_builder.installer_args([
                    std::ffi::OsString::from("/L*V"),
                    std::ffi::OsString::from(format!("\"{}\"", log_path.display())),
                ])
            };
            app.handle().plugin(updater_builder.build())?;
            app.handle().plugin(tauri_plugin_process::init())?;

            check_app_translocation();

            // Dev builds: when the configured dev server (tauri.conf.json
            // `build.devUrl` — `pnpm dev`) is live, point the main webview
            // straight at it and skip the bundled sidecar entirely. The
            // sidecar bundle only exists after a release build
            // (scripts/sidecar-bundle.sh), so requiring it here meant a clean
            // checkout could not boot `pnpm dev:app` at all — and when a
            // stale bundle did exist, the dev app silently rendered an old
            // production build instead of live code.
            let main_url: Option<tauri::Url> = if let Some(dev_url) = live_dev_server_url(app) {
                Some(dev_url)
            } else {
                #[cfg(target_os = "windows")]
                {
                    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("startup.html".into()))
                        .title("CovenCave")
                        .inner_size(1320.0, 820.0)
                        .min_inner_size(960.0, 600.0)
                        .resizable(true)
                        .disable_drag_drop_handler()
                        .build()?;

                    let startup_control =
                        Arc::clone(app.state::<Arc<SidecarStartupControl>>().inner());
                    spawn_sidecar_startup(app.handle().clone(), startup_control)?;
                    None
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let sidecar_url = match start_sidecar_runtime(app.handle(), |_| {}, || false) {
                        Ok(url) => url,
                        Err(SidecarStartError::Cancelled) => {
                            fatal_exit("sidecar startup was cancelled")
                        }
                        Err(SidecarStartError::Failed(error)) => fatal_exit(&error),
                    };
                    Some(sidecar_url)
                }
            };

            if let Some(main_url) = main_url {
                pty::trust_main_origin(&main_url);
                remember_main_startup_url(&main_url);
                let mut main_window =
                    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(main_url))
                        .title("CovenCave")
                        .inner_size(1320.0, 820.0)
                        .min_inner_size(960.0, 600.0)
                        .resizable(true)
                        // Required for HTML5 drag-and-drop (Coven Board card moves) to
                        // work in the webview — otherwise Tauri's OS-level file-drop
                        // handler intercepts dragenter/dragover/drop before the DOM sees
                        // them.
                        .disable_drag_drop_handler();
                // macOS: dissolve the seam between the native title bar and the
                // app's top toolbar. `Overlay` lets the webview content fill to the
                // very top (the traffic-light buttons float over it) and
                // `hidden_title` drops the centered "CovenCave" label, so the
                // toolbar reads as one continuous strip. The web side reserves room
                // for the traffic lights (`[data-tauri-titlebar]` in globals.css)
                // and marks the bar `data-tauri-drag-region="deep"`; the drag is
                // an ACL-gated IPC call, granted to this loopback origin by
                // capabilities/loopback-window-drag.json. No-op on Windows/Linux.
                #[cfg(target_os = "macos")]
                {
                    main_window = main_window
                        .title_bar_style(tauri::TitleBarStyle::Overlay)
                        .hidden_title(true);
                }
                // Dev-only automation hook: WKWebView has no external driver
                // protocol, so dev tooling (terminal e2e checks, screenshots)
                // can inject a script that runs before the page loads. No-op in
                // release builds.
                if cfg!(debug_assertions) {
                    if let Ok(script) = std::env::var("COVEN_CAVE_DEV_INIT_SCRIPT") {
                        if !script.is_empty() {
                            log::info!(
                                "[cave] injecting COVEN_CAVE_DEV_INIT_SCRIPT ({} bytes)",
                                script.len()
                            );
                            main_window = main_window.initialization_script(&script);
                        }
                    }
                }
                if let Err(e) = main_window.build() {
                    fatal_exit(&format!("failed to build main window: {}", e));
                }
            }

            #[cfg(target_os = "windows")]
            install_windows_main_close_fallback(app).map_err(std::io::Error::other)?;

            // Status bar / system-tray menu — quick access to inbox + reminder
            // creation when CovenCave is in the background. Menu actions either
            // bring the main window forward or emit a `tray:*` event the
            // WebView listens for.
            let open_inbox =
                MenuItem::with_id(app, "open_inbox", "Open Inbox", true, None::<&str>)?;
            let new_reminder =
                MenuItem::with_id(app, "new_reminder", "New Reminder…", true, None::<&str>)?;
            let quick_chat =
                MenuItem::with_id(app, "quick_chat", "Quick Chat…", true, None::<&str>)?;
            let notch_mode = MenuItem::with_id(
                app,
                "notch_mode",
                "Move to Centered Notch",
                true,
                None::<&str>,
            )?;
            let show_app =
                MenuItem::with_id(app, "show_app", "Show CovenCave", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit CovenCave", true, None::<&str>)?;
            let tray_menu = Menu::with_items(
                app,
                &[
                    &open_inbox,
                    &new_reminder,
                    &quick_chat,
                    &notch_mode,
                    &separator,
                    &show_app,
                    &separator,
                    &quit,
                ],
            )?;

            // `icon_as_template(true)` is a macOS-only concept (renders the
            // icon as a template image so the system can adapt it to dark/light
            // menu bar). On other platforms the call doesn't exist — guard it.
            let tray_builder = TrayIconBuilder::with_id("cave-tray")
                .icon(coven_tray_icon())
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .tooltip("CovenCave")
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "open_inbox" => {
                        focus_main_window(app);
                        let _ = app.emit("tray:open-inbox", ());
                    }
                    "new_reminder" => {
                        focus_main_window(app);
                        let _ = app.emit("tray:new-reminder", ());
                    }
                    "quick_chat" => show_quick_chat_from_main(app),
                    // "Move" the menu-bar icon into the centered notch: the
                    // notch window appears top-center, the tray icon hides,
                    // and the choice persists across restarts. The notch's
                    // own dock button (notch:dock-to-tray) is the way back.
                    "notch_mode" => {
                        let Some(url) = app
                            .get_webview_window("main")
                            .and_then(|window| window.url().ok())
                            .and_then(notch_url_from_main)
                        else {
                            focus_main_window(app);
                            return;
                        };

                        show_notch_window(app, &url);
                        if app.get_webview_window(NOTCH_WINDOW_LABEL).is_some() {
                            save_notch_mode(app, true);
                            set_tray_visible(app, false);
                        }
                    }
                    "show_app" => focus_main_window(app),
                    "quit" => {
                        #[cfg(target_os = "windows")]
                        shutdown_owned_processes(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Left-click brings the main window forward; right-click
                    // is reserved for the native menu.
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        focus_main_window(tray.app_handle());
                    }
                });

            // Apply macOS-only template flag after building the rest of the
            // chain so the non-macOS branch compiles cleanly.
            #[cfg(target_os = "macos")]
            let tray_builder = tray_builder.icon_as_template(true);

            #[cfg(target_os = "linux")]
            {
                let previous_hook = std::panic::take_hook();
                std::panic::set_hook(Box::new(|_| {}));
                let tray_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    tray_builder.build(app)
                }));
                std::panic::set_hook(previous_hook);

                match tray_result {
                    Ok(Ok(_tray)) => {}
                    Ok(Err(e)) => log_linux_tray_unavailable(&e.to_string()),
                    Err(payload) => {
                        log_linux_tray_unavailable(&panic_payload_message(payload.as_ref()))
                    }
                }
            }

            #[cfg(not(target_os = "linux"))]
            let _tray = tray_builder.build(app)?;

            let app_handle = app.handle().clone();
            app.listen("quick-chat:open-session", move |_| {
                focus_main_window(&app_handle);
            });

            // Notch state machine — the notch webview only emits intents
            // (capability loopback-notch.json grants it core:event:allow-emit
            // and nothing else); the shell owns geometry and tray visibility.
            // Customizations load from notch-config.json.
            app.manage(NotchState {
                expanded: std::sync::atomic::AtomicBool::new(false),
                config: Mutex::new(load_notch_config(app.handle())),
            });
            let notch_expand_handle = app.handle().clone();
            app.listen("notch:expand", move |_| {
                set_notch_geometry(&notch_expand_handle, true);
            });
            let notch_collapse_handle = app.handle().clone();
            app.listen("notch:collapse", move |_| {
                set_notch_geometry(&notch_collapse_handle, false);
            });
            // Detach: fold the notch back up and pop the traditional floating
            // quick-chat window with all its operations.
            let notch_detach_handle = app.handle().clone();
            app.listen("notch:detach", move |_| {
                set_notch_geometry(&notch_detach_handle, false);
                show_quick_chat_from_main(&notch_detach_handle);
            });
            // Dock: move the quick chat back to the menu bar — restore the
            // tray icon, forget the preference, and close the notch window.
            let notch_dock_handle = app.handle().clone();
            app.listen("notch:dock-to-tray", move |_| {
                save_notch_mode(&notch_dock_handle, false);
                set_tray_visible(&notch_dock_handle, true);
                if let Some(window) = notch_dock_handle.get_webview_window(NOTCH_WINDOW_LABEL) {
                    let _ = window.close();
                }
            });
            // Customizations: the page's toolbar toggle emits notch:config
            // patches ({"fitMenuBar":bool}); the shell persists them and
            // re-applies geometry immediately.
            let notch_config_handle = app.handle().clone();
            app.listen("notch:config", move |event| {
                apply_notch_config_patch(&notch_config_handle, event.payload());
            });

            // Restore the notch presentation on launch when the user left it
            // enabled — the tray icon stays "moved" until they dock it back.
            if load_notch_mode(app.handle()) {
                show_notch_from_main(app.handle());
                if app
                    .handle()
                    .get_webview_window(NOTCH_WINDOW_LABEL)
                    .is_some()
                {
                    set_tray_visible(app.handle(), false);
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Tauri automatically prevents a native close when any JS
            // `tauri://close-requested` listener is registered. If WebView2's
            // JS thread is wedged (the same failure that makes the UI ignore
            // clicks), that listener can never finish the close and Windows'
            // title-bar X becomes permanently inert. The main Windows window
            // has no supported close-to-tray contract, so make its native close
            // request authoritative and independent of WebView responsiveness.
            // Application cleanup drops SidecarCleanupGuard and reaps the
            // sidecar process tree.
            #[cfg(target_os = "windows")]
            if matches!(event, tauri::WindowEvent::CloseRequested { .. })
                && window.label() == "main"
            {
                shutdown_owned_processes(window.app_handle());
                window.app_handle().exit(0);
                return;
            }

            if let tauri::WindowEvent::Destroyed = event {
                if window.label() == "main" {
                    if let Some(state) = window.app_handle().try_state::<SidecarState>() {
                        if let Err(error) = state.stop() {
                            log::warn!(
                                "[cave] could not stop sidecar during window teardown: {error}"
                            );
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
