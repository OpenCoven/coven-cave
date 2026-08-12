use std::ffi::OsStr;
use std::os::windows::process::CommandExt;
use std::process::Command;

/// Win32 CREATE_NO_WINDOW. Apply only to app-owned, noninteractive children;
/// intentional PTY shells keep their own visible terminal contract.
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub(crate) fn hidden_command(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

/// Launch a Windows system program from the trusted System32 directory. An
/// absolute argv[0] prevents executable planting, while the trusted cwd keeps
/// utilities such as where.exe from searching a project directory first.
pub(crate) fn hidden_system32_command(program: &str) -> Command {
    let system32 = super::windows_system32_binary("");
    let mut command = hidden_command(super::windows_system32_binary(program));
    command.current_dir(system32);
    command
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::process::Stdio;

    const HELPER_ENV: &str = "COVEN_CAVE_HIDDEN_COMMAND_HELPER";
    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

    #[test]
    fn hidden_command_probe_child() {
        if std::env::var_os(HELPER_ENV).is_none() {
            return;
        }
        let console = unsafe { windows_sys::Win32::System::Console::GetConsoleWindow() };
        print!(
            "console={}",
            if console.is_null() {
                "absent"
            } else {
                "present"
            }
        );
        std::io::stdout().flush().expect("flush console probe");
    }

    #[test]
    fn hidden_command_suppresses_a_console_for_native_children() {
        let mut visible_control_command =
            Command::new(std::env::current_exe().expect("test executable"));
        visible_control_command.creation_flags(CREATE_NEW_CONSOLE);
        let visible_control = visible_control_command
            .args([
                "--exact",
                "windows_command::tests::hidden_command_probe_child",
                "--nocapture",
                "--test-threads=1",
            ])
            .env(HELPER_ENV, "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .expect("spawn visible console control");

        assert!(
            visible_control.status.success(),
            "visible control failed: {visible_control:?}"
        );
        assert!(
            String::from_utf8_lossy(&visible_control.stdout).contains("console=present"),
            "console probe cannot observe an ordinary console child; hidden-result proof would be inconclusive: {visible_control:?}"
        );

        let output = hidden_command(std::env::current_exe().expect("test executable"))
            .args([
                "--exact",
                "windows_command::tests::hidden_command_probe_child",
                "--nocapture",
                "--test-threads=1",
            ])
            .env(HELPER_ENV, "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .expect("spawn hidden console probe");

        assert!(output.status.success(), "probe failed: {output:?}");
        assert!(
            String::from_utf8_lossy(&output.stdout).contains("console=absent"),
            "hidden child acquired a console: {output:?}"
        );
    }

    #[test]
    fn system32_children_use_absolute_programs_and_a_trusted_working_directory() {
        let command = hidden_system32_command("where.exe");
        assert_eq!(
            command.get_program(),
            super::super::windows_system32_binary("where.exe")
        );
        assert_eq!(
            command.get_current_dir(),
            Some(super::super::windows_system32_binary("").as_path())
        );
    }
}
