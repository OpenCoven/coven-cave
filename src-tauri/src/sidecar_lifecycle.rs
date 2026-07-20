use super::*;

#[cfg(desktop)]
pub(super) struct SidecarProcess {
    child: Child,
    #[cfg(target_os = "windows")]
    job: windows_process_job::ProcessJob,
}

#[cfg(desktop)]
impl SidecarProcess {
    #[cfg(target_os = "windows")]
    pub(super) fn from_gated(child: Child, job: windows_process_job::ProcessJob) -> Self {
        Self { child, job }
    }

    #[cfg(not(target_os = "windows"))]
    pub(super) fn new(child: Child) -> Self {
        Self { child }
    }
}

#[cfg(desktop)]
pub(super) struct SidecarState(pub(super) Arc<Mutex<Option<SidecarProcess>>>);

#[cfg(desktop)]
#[derive(Clone, Copy)]
pub(super) enum SidecarStartupStep {
    PreparingRuntime,
    StartingService,
    WaitingForService,
}

#[cfg(desktop)]
pub(super) enum SidecarStartError {
    Cancelled,
    Failed(String),
}

#[cfg(desktop)]
pub(super) enum PortWaitResult {
    Ready,
    Cancelled,
    TimedOut,
}

#[cfg(all(desktop, target_os = "windows"))]
pub(super) const SIDECAR_STARTUP_EVENT: &str = "sidecar-startup-progress";

#[cfg(all(desktop, target_os = "windows"))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SidecarStartupStatus {
    pub(super) phase: &'static str,
    pub(super) progress: u8,
    pub(super) message: String,
    pub(super) can_retry: bool,
    pub(super) can_cancel: bool,
}

#[cfg(all(desktop, target_os = "windows"))]
impl SidecarStartupStatus {
    pub(super) fn preparing() -> Self {
        Self {
            phase: "preparing",
            progress: 10,
            message: "Verifying and preparing the application runtime".to_string(),
            can_retry: false,
            can_cancel: false,
        }
    }

    pub(super) fn starting() -> Self {
        Self {
            phase: "starting",
            progress: 70,
            message: "Starting local services".to_string(),
            can_retry: false,
            can_cancel: true,
        }
    }

    pub(super) fn waiting() -> Self {
        Self {
            phase: "waiting",
            progress: 85,
            message: "Waiting for CovenCave to become ready".to_string(),
            can_retry: false,
            can_cancel: true,
        }
    }

    pub(super) fn ready() -> Self {
        Self {
            phase: "ready",
            progress: 100,
            message: "CovenCave is ready".to_string(),
            can_retry: false,
            can_cancel: false,
        }
    }

    pub(super) fn failed(message: String) -> Self {
        Self {
            phase: "failed",
            progress: 0,
            message,
            can_retry: true,
            can_cancel: false,
        }
    }

    pub(super) fn cancelled() -> Self {
        Self {
            phase: "cancelled",
            progress: 0,
            message: "Startup was cancelled. The prepared runtime is safe to reuse.".to_string(),
            can_retry: true,
            can_cancel: false,
        }
    }
}

#[cfg(all(desktop, target_os = "windows"))]
pub(super) struct SidecarStartupControl {
    status: Mutex<SidecarStartupStatus>,
    running: AtomicBool,
    cancel_requested: AtomicBool,
    shutdown_requested: AtomicBool,
}

#[cfg(all(desktop, target_os = "windows"))]
impl SidecarStartupControl {
    pub(super) fn new() -> Self {
        Self {
            status: Mutex::new(SidecarStartupStatus::preparing()),
            running: AtomicBool::new(false),
            cancel_requested: AtomicBool::new(false),
            shutdown_requested: AtomicBool::new(false),
        }
    }

    pub(super) fn begin(&self) -> Result<(), String> {
        if self.shutdown_requested.load(Ordering::Acquire) {
            return Err("application shutdown is in progress".to_string());
        }
        self.running
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "sidecar startup is already running".to_string())?;
        self.cancel_requested.store(false, Ordering::Release);
        Ok(())
    }

    pub(super) fn finish(&self) {
        self.running.store(false, Ordering::Release);
    }

    pub(super) fn request_cancel(&self) -> Result<(), String> {
        if !self.running.load(Ordering::Acquire) {
            return Err("sidecar startup is not running".to_string());
        }
        self.cancel_requested.store(true, Ordering::Release);
        Ok(())
    }

    pub(super) fn is_cancelled(&self) -> bool {
        self.cancel_requested.load(Ordering::Acquire)
            || self.shutdown_requested.load(Ordering::Acquire)
    }

    pub(super) fn request_shutdown(&self) {
        self.shutdown_requested.store(true, Ordering::Release);
        self.cancel_requested.store(true, Ordering::Release);
    }

    pub(super) fn status(&self) -> Result<SidecarStartupStatus, String> {
        self.status
            .lock()
            .map(|status| status.clone())
            .map_err(|_| "sidecar startup status lock is poisoned".to_string())
    }

    pub(super) fn set_status(&self, status: SidecarStartupStatus) -> Result<(), String> {
        let mut current = self
            .status
            .lock()
            .map_err(|_| "sidecar startup status lock is poisoned".to_string())?;
        *current = status;
        Ok(())
    }
}

#[cfg(desktop)]
pub(super) struct SidecarCleanupGuard(pub(super) Arc<Mutex<Option<SidecarProcess>>>);

#[cfg(desktop)]
impl tauri::Resource for SidecarCleanupGuard {}

#[cfg(desktop)]
impl Drop for SidecarCleanupGuard {
    fn drop(&mut self) {
        let state = SidecarState(Arc::clone(&self.0));
        if let Err(error) = state.stop() {
            log::warn!("[cave] could not stop sidecar during application cleanup: {error}");
        }
    }
}

#[cfg(desktop)]
impl SidecarState {
    pub(super) fn stop(&self) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        let mut guard = match self.0.try_lock() {
            Ok(guard) => guard,
            Err(std::sync::TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
            Err(std::sync::TryLockError::WouldBlock) => {
                // Never stall the Windows UI/exit path on a startup worker.
                // Any locally-held Job Object is closed by process exit.
                return Err("sidecar state is busy; process-job cleanup remains armed".to_string());
            }
        };
        #[cfg(not(target_os = "windows"))]
        let mut guard = self
            .0
            .lock()
            .map_err(|_| "sidecar process lock is poisoned".to_string())?;
        let Some(child) = guard.take() else {
            return Ok(());
        };
        drop(guard);
        stop_sidecar_child(child)
    }
}

#[cfg(desktop)]
pub(super) fn stop_sidecar_child(mut process: SidecarProcess) -> Result<(), String> {
    if process
        .child
        .try_wait()
        .map_err(|error| format!("could not inspect sidecar process: {error}"))?
        .is_some()
    {
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        // TerminateJobObject is a bounded kernel operation over the full tree;
        // it does not wait for Node, Coven, pipes, JavaScript, or taskkill.exe.
        // Dropping the KILL_ON_JOB_CLOSE handle is a second fail-safe and also
        // covers Task Manager/TerminateProcess, where Rust cleanup never runs.
        process
            .job
            .terminate()
            .map_err(|error| format!("could not terminate sidecar process job: {error}"))?;
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        if process
            .child
            .try_wait()
            .map_err(|error| format!("could not inspect terminated sidecar: {error}"))?
            .is_none()
        {
            process
                .child
                .kill()
                .map_err(|error| format!("could not stop sidecar process: {error}"))?;
        }
        process
            .child
            .wait()
            .map_err(|error| format!("could not wait for sidecar process shutdown: {error}"))?;
        Ok(())
    }
}

#[cfg(all(desktop, target_os = "windows"))]
pub(super) fn shutdown_owned_processes(app: &tauri::AppHandle) {
    if let Some(control) = app.try_state::<Arc<SidecarStartupControl>>() {
        control.request_shutdown();
    }
    if let Some(sidecar) = app.try_state::<SidecarState>() {
        if let Err(error) = sidecar.stop() {
            log::warn!("[cave] sidecar shutdown deferred to process job: {error}");
        }
    }
    pty::terminate_all_owned_processes();
}
