//! Decisions for the one shared macOS background service. Alternate app
//! identifiers have their own GUI state but must not adopt this service.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum LaunchAgentAction {
    Install,
    Suspend,
    Uninstall,
}

pub(super) fn owns_shared_reachability(identifier: &str) -> bool {
    identifier == "ai.opencoven.cave"
}

pub(super) fn run_owned_daemon(
    identifier: &str,
    run: impl FnOnce() -> Result<i32, String>,
) -> Result<i32, String> {
    if !owns_shared_reachability(identifier) {
        return Err(
            "Background sidecar mode requires the installed CovenCave app identifier.".into(),
        );
    }
    run()
}

pub(super) fn reconcile_launch_agent(
    identifier: &str,
    daemon_mode: bool,
    background_supported: bool,
    agent_present: bool,
    apply: impl FnOnce(LaunchAgentAction) -> Result<(), String>,
) -> Result<(), String> {
    if !owns_shared_reachability(identifier) {
        return Ok(());
    }
    let action = if daemon_mode {
        if background_supported {
            Some(LaunchAgentAction::Install)
        } else {
            Some(LaunchAgentAction::Suspend)
        }
    } else if agent_present {
        Some(LaunchAgentAction::Uninstall)
    } else {
        None
    };
    match action {
        Some(action) => apply(action),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn isolated_daemon_invocation_refuses_before_reading_shared_state() {
        let mut called = false;
        let result = run_owned_daemon("ai.opencoven.cave.qualification", || {
            called = true;
            Ok(0)
        });
        assert!(!called);
        assert!(result.is_err());
    }

    #[test]
    fn canonical_daemon_preserves_exit_code_and_failure() {
        assert_eq!(run_owned_daemon("ai.opencoven.cave", || Ok(42)), Ok(42));
        assert_eq!(
            run_owned_daemon("ai.opencoven.cave", || Err("failed".into())),
            Err("failed".into())
        );
    }

    #[test]
    fn isolated_gui_never_touches_the_installed_background_service() {
        for identifier in [
            "ai.opencoven.cave.qualification",
            "ai.opencoven.cave-dev",
            "",
        ] {
            for (daemon_mode, background_supported, agent_present) in [
                (false, false, true),
                (true, false, true),
                (true, true, true),
                (true, true, false),
            ] {
                let mut operations = Vec::new();
                let result = reconcile_launch_agent(
                    identifier,
                    daemon_mode,
                    background_supported,
                    agent_present,
                    |action| {
                        operations.push(action);
                        Err("another app's service is inaccessible".to_string())
                    },
                );
                assert!(operations.is_empty(), "{identifier}: {operations:?}");
                assert_eq!(result, Ok(()));
            }
        }
    }

    #[test]
    fn canonical_gui_preserves_install_suspend_and_disabled_cleanup() {
        for (daemon_mode, background_supported, agent_present, expected) in [
            (true, true, false, vec![LaunchAgentAction::Install]),
            (true, false, true, vec![LaunchAgentAction::Suspend]),
            (false, false, true, vec![LaunchAgentAction::Uninstall]),
            (false, false, false, vec![]),
        ] {
            let mut operations = Vec::new();
            let result = reconcile_launch_agent(
                "ai.opencoven.cave",
                daemon_mode,
                background_supported,
                agent_present,
                |action| {
                    operations.push(action);
                    Ok(())
                },
            );
            assert_eq!(operations, expected);
            assert_eq!(result, Ok(()));
        }
    }

    #[test]
    fn canonical_reconciliation_failure_is_not_reported_as_success() {
        let result = reconcile_launch_agent("ai.opencoven.cave", true, true, false, |_| {
            Err("launchd refused the service".to_string())
        });
        assert_eq!(result, Err("launchd refused the service".to_string()));
    }
}
