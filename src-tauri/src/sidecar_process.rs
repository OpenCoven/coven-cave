use std::process::Child;
use std::sync::{Arc, Mutex};
use tauri::Resource;

pub(crate) type SharedSidecar = Arc<Mutex<Option<Child>>>;

trait SidecarChild {
    fn id(&self) -> u32;
    fn kill(&mut self) -> std::io::Result<()>;
    fn wait(&mut self) -> std::io::Result<()>;
}

impl SidecarChild for Child {
    fn id(&self) -> u32 {
        Child::id(self)
    }

    fn kill(&mut self) -> std::io::Result<()> {
        Child::kill(self)
    }

    fn wait(&mut self) -> std::io::Result<()> {
        Child::wait(self).map(|_| ())
    }
}

fn stop_managed_sidecar<C: SidecarChild>(slot: &Mutex<Option<C>>, reason: &str) -> bool {
    let mut child = {
        let mut guard = slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        match guard.take() {
            Some(child) => child,
            None => return false,
        }
    };
    let pid = child.id();
    log::info!("[cave] stopping sidecar pid {pid}: {reason}");
    if let Err(error) = child.kill() {
        log::debug!("[cave] sidecar pid {pid} kill returned: {error}");
    }
    if let Err(error) = child.wait() {
        log::warn!("[cave] failed to reap sidecar pid {pid}: {error}");
    }
    true
}

pub(crate) fn stop_sidecar(sidecar: &SharedSidecar, reason: &str) -> bool {
    stop_managed_sidecar(sidecar.as_ref(), reason)
}

pub(crate) struct SidecarState(pub(crate) SharedSidecar);

impl Default for SidecarState {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(None)))
    }
}

pub(crate) struct SidecarCleanupResource {
    sidecar: SharedSidecar,
}

impl SidecarCleanupResource {
    pub(crate) fn new(sidecar: SharedSidecar) -> Self {
        Self { sidecar }
    }
}

impl Resource for SidecarCleanupResource {}

impl Drop for SidecarCleanupResource {
    fn drop(&mut self) {
        stop_sidecar(&self.sidecar, "Tauri application cleanup");
    }
}

#[cfg(test)]
mod tests {
    use super::{stop_managed_sidecar, stop_sidecar, SidecarChild, SidecarCleanupResource};
    use std::process::Command;
    use std::sync::{Arc, Mutex};

    #[derive(Clone)]
    struct FakeSidecarChild {
        calls: Arc<Mutex<Vec<&'static str>>>,
    }

    impl SidecarChild for FakeSidecarChild {
        fn id(&self) -> u32 {
            42
        }

        fn kill(&mut self) -> std::io::Result<()> {
            self.calls.lock().unwrap().push("kill");
            Ok(())
        }

        fn wait(&mut self) -> std::io::Result<()> {
            self.calls.lock().unwrap().push("wait");
            Ok(())
        }
    }

    #[test]
    fn stop_kills_waits_and_is_idempotent() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let slot = Mutex::new(Some(FakeSidecarChild {
            calls: calls.clone(),
        }));

        assert!(stop_managed_sidecar(&slot, "test"));
        assert!(!stop_managed_sidecar(&slot, "test again"));
        assert_eq!(*calls.lock().unwrap(), ["kill", "wait"]);
    }

    #[cfg(unix)]
    #[test]
    fn dropping_cleanup_resource_kills_and_reaps_a_real_child() {
        let child = Command::new("sh")
            .args(["-c", "sleep 30"])
            .spawn()
            .expect("spawn long-lived child");
        let pid = child.id();
        let sidecar = Arc::new(Mutex::new(Some(child)));

        drop(SidecarCleanupResource::new(sidecar.clone()));

        assert!(sidecar.lock().unwrap().is_none());
        let still_alive = Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .expect("probe child")
            .success();
        assert!(!still_alive, "child {pid} survived cleanup resource drop");
        assert!(!stop_sidecar(&sidecar, "post-drop idempotency"));
    }
}
