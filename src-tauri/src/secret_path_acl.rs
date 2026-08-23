//! Access control for the plaintext secrets the packaged desktop persists.
//!
//! `sidecar_auth.rs` writes the mobile pairing secret in the clear, and until
//! this module existed it protected that file with `OpenOptions::mode(0o600)`
//! under `#[cfg(unix)]` and nothing at all under Windows. MEASURED on a
//! Windows 11 host, the shipped file
//! `%APPDATA%\ai.opencoven.cave\mobile-access-token` carried
//! `CodexSandboxUsers:(I)(M)` and two foreign user SIDs at `(I)(M,DC)` --
//! Modify, plus Delete-Child on the directory above it. A principal holding
//! that substitutes the gate secret the sidecar is launched with, silently,
//! on every future launch.
//!
//! The JavaScript fix for the same defect class lives in
//! `src/lib/server/client-v1/path-ownership.ts` and cannot reach this copy:
//! `provisioningAllowed()` is false when `COVEN_CAVE_BUNDLE=1`, which is
//! exactly what the Tauri launcher sets. So the shipping artifact needs its
//! own guard, and this is it.
//!
//! # Why native APIs rather than the sibling's PowerShell
//!
//! The JS module shells out to `powershell.exe` because Node exposes no DACL
//! API. Rust links `advapi32` directly, so this module calls
//! `GetNamedSecurityInfoW`/`SetNamedSecurityInfoW` and never spawns anything.
//! That removes the two conditions `cave-37fxr` was filed for outright:
//! Constrained Language Mode and a `powershell.exe` missing from
//! `%SystemRoot%` cannot break an in-process call. It also keeps a subprocess
//! spawn off the desktop shell's startup path.
//!
//! # Why the policy layer is separate from the Win32 layer
//!
//! Everything above the `win` submodule -- the exclusivity rule, the waiver,
//! and every message -- is ordinary cross-platform Rust with no `cfg`. CI runs
//! `cargo test --locked --lib` on Linux, so a guard written entirely inside
//! `#[cfg(windows)]` would have no assertion the runner ever executes. Split
//! this way, the decisions are tested on every runner and only the syscalls
//! are Windows-only.

#[cfg(desktop)]
use std::path::Path;

/// SIDs whose access to a secret path is not a finding.
///
/// SYSTEM and the local Administrators group can already take ownership of any
/// file and rewrite its DACL, so denying them buys no confidentiality and only
/// breaks backup and anti-malware agents. Everything else -- including the
/// `Users` and `Authenticated Users` groups a machine-wide profile policy may
/// inherit onto `%USERPROFILE%` -- is a principal that could substitute the
/// secret, so it is stripped and then refused if it survives.
pub(crate) const WINDOWS_SYSTEM_SID: &str = "S-1-5-18";
pub(crate) const WINDOWS_ADMINISTRATORS_SID: &str = "S-1-5-32-544";

// -- The unverified-ownership waiver ---------------------------------------
//
// Deliberately the SAME two variables, the same exact token and the same
// minimum reason length as `src/lib/server/client-v1/path-ownership.ts`. A
// hardened host that had to set the waiver for the dev server would otherwise
// find the packaged app applying a different, undocumented rule to the same
// class of secret, which is exactly the dev/packaged split that made
// `cave-hdt3f` possible in the first place.
//
// It covers ONE condition: the DACL could not be read or written at all. It
// never covers a DACL that WAS read and found shared -- that has a remedy the
// operator can run (`icacls <path> /reset`), and admitting it would be the
// "reads as protection, provides none" defect #4842 was filed about.
//
// Note what the waiver is NOT here. On the JS side it rescues a host that
// could not boot. In this module a refusal is never fatal: the caller falls
// back to a per-launch token, so the app starts either way and the operator
// loses phone pairing across restarts rather than the application. The waiver
// buys persistence back, not a boot.
const UNVERIFIED_OWNERSHIP_ENV: &str = "COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP";
const UNVERIFIED_OWNERSHIP_REASON_ENV: &str = "COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP_REASON";
const UNVERIFIED_OWNERSHIP_TOKEN: &str = "i-accept-unverified-path-ownership";
const UNVERIFIED_OWNERSHIP_MIN_REASON: usize = 12;

/// One entry of a path's discretionary access control list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Ace {
    pub sid: String,
    /// `Allow`, `Deny`, or `AceType(n)` for a form this module does not parse.
    /// An unparsed type is reported rather than assumed harmless: an ACE whose
    /// layout we cannot read is an access decision we cannot account for.
    pub kind: String,
}

#[cfg(test)]
impl Ace {
    pub fn allow(sid: impl Into<String>) -> Self {
        Self {
            sid: sid.into(),
            kind: "Allow".to_string(),
        }
    }
}

/// The state of a path after any repair this module performed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AclReport {
    /// SID of the identity this process runs as.
    pub self_sid: String,
    /// SID that owns the path.
    pub owner: String,
    /// Whether a DACL is present at all. A security descriptor with no DACL
    /// grants every principal full access, which is the opposite of an empty
    /// DACL and must never be read as "nobody has access".
    pub dacl_present: bool,
    /// Whether the DACL is protected from inheritance.
    pub protected: bool,
    /// Whether this module had to rewrite the DACL to reach the exclusive
    /// state.
    pub repaired: bool,
    /// SIDs the repair stripped, empty when nothing had to change.
    pub removed: Vec<String>,
    /// The DACL as it stood BEFORE any repair. Recorded because a repair is
    /// otherwise unrecoverable: `icacls /reset` restores inheritance but
    /// nothing anywhere records what the path actually granted (cave-okfb2).
    pub before: Vec<Ace>,
    /// The DACL as it stands now.
    pub aces: Vec<Ace>,
}

/// Findings that make a path unusable, or an empty list when it is exclusive.
pub(crate) fn exclusivity_findings(report: &AclReport) -> Vec<String> {
    let mut findings = Vec::new();
    if report.owner != report.self_sid {
        findings.push(format!("owned by {}, not {}", report.owner, report.self_sid));
    }
    if !report.dacl_present {
        findings.push("it carries no DACL at all, which grants every principal full access".to_string());
    }
    if !report.protected {
        findings.push("its DACL still inherits from the parent".to_string());
    }
    let mut foreign: Vec<String> = Vec::new();
    for ace in &report.aces {
        let trusted = ace.sid == report.self_sid
            || ace.sid == WINDOWS_SYSTEM_SID
            || ace.sid == WINDOWS_ADMINISTRATORS_SID;
        if ace.kind != "Allow" || !trusted {
            let entry = format!("{}:{}", ace.kind, ace.sid);
            if !foreign.contains(&entry) {
                foreign.push(entry);
            }
        }
    }
    if !foreign.is_empty() {
        findings.push(format!("access granted to {}", foreign.join(", ")));
    }
    findings
}

/// Whether the operator has explicitly, attributably waived an unverifiable
/// DACL.
///
/// Three properties make this impossible to trip by accident, and they are the
/// point rather than ceremony:
///
/// 1. The value is an exact sentence, not a boolean. Every other switch in
///    this codebase is `=1`, so an operator working from memory reaches for
///    that -- and `1`, `true`, `yes` and a case-shifted token all do nothing
///    here and say so.
/// 2. A second variable must carry a real sentence naming who accepted this
///    and why. That text is what turns up in the log line printed on every
///    boot.
/// 3. It is consulted at exactly one place -- an unverifiable DACL -- so even
///    a correctly set waiver cannot admit a path that was read and refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Waiver {
    Granted { reason: String },
    Denied { note: String },
}

impl Waiver {
    pub fn granted(&self) -> bool {
        matches!(self, Waiver::Granted { .. })
    }
}

pub(crate) fn resolve_waiver(lookup: impl Fn(&str) -> Option<String>) -> Waiver {
    let requested = lookup(UNVERIFIED_OWNERSHIP_ENV).unwrap_or_default();
    let requested = requested.trim();
    if requested.is_empty() {
        return Waiver::Denied {
            note: format!(
                "If the DACL genuinely cannot be read or written on this host, set \
                 {UNVERIFIED_OWNERSHIP_ENV}={UNVERIFIED_OWNERSHIP_TOKEN} and \
                 {UNVERIFIED_OWNERSHIP_REASON_ENV} to a sentence naming who accepted that and \
                 why. It waives only an unverifiable DACL, never one that was read and found \
                 shared."
            ),
        };
    }
    if requested != UNVERIFIED_OWNERSHIP_TOKEN {
        return Waiver::Denied {
            note: format!(
                "{UNVERIFIED_OWNERSHIP_ENV} is set, but not to the waiver: the only accepted \
                 value is the exact string {UNVERIFIED_OWNERSHIP_TOKEN}. A boolean-shaped value \
                 (\"1\", \"true\", \"yes\") never waives this check."
            ),
        };
    }
    let reason = lookup(UNVERIFIED_OWNERSHIP_REASON_ENV).unwrap_or_default();
    let reason = reason.trim();
    if reason.chars().count() < UNVERIFIED_OWNERSHIP_MIN_REASON {
        return Waiver::Denied {
            note: format!(
                "{UNVERIFIED_OWNERSHIP_ENV} is set, but {UNVERIFIED_OWNERSHIP_REASON_ENV} must \
                 carry at least {UNVERIFIED_OWNERSHIP_MIN_REASON} characters naming who accepted \
                 an unverified path and why. The waiver stays closed without that attribution."
            ),
        };
    }
    Waiver::Granted {
        reason: reason.to_string(),
    }
}

/// What the caller is allowed to do with a secret at this path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Protection {
    /// The path is exclusive to the current user. `notice` is present only
    /// when this module had to repair the DACL to get there.
    Enforced { notice: Option<String> },
    /// The DACL could not be answered for, and the operator waived it.
    Waived { disclosure: String },
    /// The secret must not be written to, or read from, this path.
    Refused { message: String },
}

fn render_aces(aces: &[Ace]) -> String {
    if aces.is_empty() {
        return "(empty)".to_string();
    }
    aces.iter()
        .map(|ace| format!("{}:{}", ace.kind, ace.sid))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Turn one probe outcome into a decision.
///
/// Pure, and deliberately so: this is the whole of the security policy, and it
/// runs on every CI runner rather than only on the Windows hosts where the
/// syscalls beneath it exist.
pub(crate) fn classify(
    subject: &str,
    display: &str,
    outcome: Result<AclReport, String>,
    waiver: &Waiver,
) -> Protection {
    let report = match outcome {
        Ok(report) => report,
        Err(cause) => {
            // The ONE condition the waiver covers: the host could not answer
            // the question. Everything below this point had an answer.
            return match waiver {
                Waiver::Granted { reason } => Protection::Waived {
                    disclosure: format!(
                        "SECURITY WAIVER - {subject} is being used UNVERIFIED. Its access control \
                         could not be established on this host ({cause}), and \
                         {UNVERIFIED_OWNERSHIP_ENV} is set, so {display} is trusted on the \
                         operator's word alone: reason given - {reason}. Any principal that can \
                         write {display} can substitute the secret the sidecar is launched with. \
                         Unset {UNVERIFIED_OWNERSHIP_ENV} to restore the check."
                    ),
                },
                Waiver::Denied { note } => Protection::Refused {
                    message: format!(
                        "{subject} access control could not be established on Windows: {cause}. \
                         Refusing {display}; inspect it with: icacls \"{display}\". {note}"
                    ),
                },
            };
        }
    };

    let findings = exclusivity_findings(&report);
    if !findings.is_empty() {
        let mut message = format!(
            "{subject} is not exclusive to the current user: {}. Refusing {display}; inspect it \
             with: icacls \"{display}\"",
            findings.join("; ")
        );
        if waiver.granted() {
            // Named here only to say it does not apply. This path has a remedy
            // the operator can run, and admitting it would be the
            // unconditional pass #4842 was filed about wearing an env var.
            message.push_str(&format!(
                ". {UNVERIFIED_OWNERSHIP_ENV} does not cover a DACL that was read: this one was, \
                 and it is shared. Repair it with: icacls \"{display}\" /reset"
            ));
        }
        return Protection::Refused { message };
    }

    if report.repaired && report.removed.is_empty() {
        // The ordinary case for a freshly created file: it was born inheriting
        // an already-exclusive DACL from the directory this module protected a
        // moment earlier, and the repair only detached it from that
        // inheritance. Nothing was ever exposed, so this must not read like an
        // incident -- a notice that cries wolf on every mint is a notice
        // nobody reads when it matters.
        return Protection::Enforced {
            notice: Some(format!(
                "{subject} was inheriting its access control; pinned {display} to the current \
                 user so a later change to its parent cannot re-open it. No principal had to be \
                 revoked."
            )),
        };
    }

    if report.repaired {
        // Expected on the first run of every existing install -- `%APPDATA%`
        // inherits group ACEs by default and nothing in this shell ever
        // stripped them -- so this is a notice, not an incident. It still has
        // to be said: until this repair the secret carried no enforced access
        // control at all.
        return Protection::Enforced {
            notice: Some(format!(
                "{subject} had no enforced access control on Windows; restricted {display} to the \
                 current user and revoked {}. Its DACL before the repair was {}. Treat anything \
                 those principals could read as exposed.",
                report.removed.join(", "),
                render_aces(&report.before)
            )),
        };
    }

    Protection::Enforced { notice: None }
}

/// The noun phrases the messages above open with.
#[cfg(desktop)]
pub(crate) const MOBILE_SECRET_SUBJECT: &str = "The mobile access token";
#[cfg(desktop)]
pub(crate) const MOBILE_SECRET_DIR_SUBJECT: &str = "The mobile access token's directory";

/// Make `path` exclusive to the current user, and say whether it now is.
///
/// On Windows this reads the DACL, rewrites it when it is not already
/// exclusive, and reads it back. On every other platform it is a no-op that
/// answers `Enforced`: POSIX already has a create-time mode and a uid, which
/// is what `write_secret_file` applies there, and inventing a second answer
/// for those platforms would only add a way for them to disagree.
#[cfg(desktop)]
pub(crate) fn protect_secret_path(path: &Path, subject: &str) -> Protection {
    #[cfg(target_os = "windows")]
    {
        let display = path.display().to_string();
        let waiver = resolve_waiver(|key| std::env::var(key).ok());
        classify(
            subject,
            &display,
            win::restrict_to_current_user(path).map_err(|error| error.to_string()),
            &waiver,
        )
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (path, subject);
        Protection::Enforced { notice: None }
    }
}

#[cfg(all(desktop, target_os = "windows"))]
pub(crate) mod win {
    //! The Win32 half: read a DACL, write a DACL, and nothing else.
    //!
    //! Ownership is verified, never taken. A path owned by somebody else is a
    //! finding to report, not a race to win: `SetNamedSecurityInfoW` with an
    //! owner section needs `SeTakeOwnershipPrivilege` or `WRITE_OWNER`, and an
    //! app that quietly seizes ownership of a file it found is doing something
    //! the operator did not ask for.

    use super::{Ace, AclReport, WINDOWS_ADMINISTRATORS_SID, WINDOWS_SYSTEM_SID};
    use std::ffi::OsStr;
    use std::io;
    use std::mem::size_of;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use windows_sys::Win32::Foundation::{CloseHandle, LocalFree, ERROR_SUCCESS, HANDLE};
    use windows_sys::Win32::Security::Authorization::{
        ConvertSidToStringSidW, GetNamedSecurityInfoW, SetNamedSecurityInfoW, SE_FILE_OBJECT,
    };
    use windows_sys::Win32::Security::{
        AddAccessAllowedAceEx, AclSizeInformation, CreateWellKnownSid, GetAce, GetAclInformation,
        GetLengthSid, GetSecurityDescriptorControl, GetSecurityDescriptorDacl, GetTokenInformation,
        InitializeAcl, IsValidSid, TokenUser, ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_REVISION,
        ACL_SIZE_INFORMATION, CONTAINER_INHERIT_ACE, DACL_SECURITY_INFORMATION, NO_INHERITANCE,
        OBJECT_INHERIT_ACE, OWNER_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION,
        PSECURITY_DESCRIPTOR, PSID, SECURITY_MAX_SID_SIZE, SE_DACL_PROTECTED, TOKEN_QUERY,
        TOKEN_USER, WinBuiltinAdministratorsSid, WinLocalSystemSid,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    /// `FILE_ALL_ACCESS`, spelled out rather than pulled from
    /// `Win32_Storage_FileSystem`: one constant is not worth a second feature
    /// on `windows-sys`, and this is the value `icacls` renders as `(F)`.
    const FILE_ALL_ACCESS: u32 = 0x001F_01FF;
    const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
    const ACCESS_DENIED_ACE_TYPE: u8 = 1;

    fn wide_null(value: impl AsRef<OsStr>) -> Vec<u16> {
        value
            .as_ref()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    /// Raw bytes of the SID this process runs as.
    fn current_user_sid() -> io::Result<Vec<u8>> {
        let mut token: HANDLE = std::ptr::null_mut();
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
            return Err(io::Error::last_os_error());
        }
        let mut needed: u32 = 0;
        unsafe { GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut needed) };
        if needed == 0 {
            let error = io::Error::last_os_error();
            unsafe { CloseHandle(token) };
            return Err(error);
        }
        let mut buffer = vec![0u8; needed as usize];
        let read = unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                buffer.as_mut_ptr().cast(),
                needed,
                &mut needed,
            )
        };
        unsafe { CloseHandle(token) };
        if read == 0 {
            return Err(io::Error::last_os_error());
        }
        let user = unsafe { &*(buffer.as_ptr() as *const TOKEN_USER) };
        copy_sid(user.User.Sid)
    }

    fn copy_sid(sid: PSID) -> io::Result<Vec<u8>> {
        if sid.is_null() || unsafe { IsValidSid(sid) } == 0 {
            return Err(io::Error::other("the security descriptor carried an invalid SID"));
        }
        let length = unsafe { GetLengthSid(sid) } as usize;
        let mut bytes = vec![0u8; length];
        unsafe { std::ptr::copy_nonoverlapping(sid.cast::<u8>(), bytes.as_mut_ptr(), length) };
        Ok(bytes)
    }

    fn well_known_sid(kind: i32) -> io::Result<Vec<u8>> {
        let mut buffer = vec![0u8; SECURITY_MAX_SID_SIZE as usize];
        let mut size = SECURITY_MAX_SID_SIZE;
        let created = unsafe {
            CreateWellKnownSid(
                kind,
                std::ptr::null_mut(),
                buffer.as_mut_ptr().cast(),
                &mut size,
            )
        };
        if created == 0 {
            return Err(io::Error::last_os_error());
        }
        buffer.truncate(size as usize);
        Ok(buffer)
    }

    fn sid_to_string(sid: PSID) -> String {
        if sid.is_null() || unsafe { IsValidSid(sid) } == 0 {
            return "<invalid-sid>".to_string();
        }
        let mut raw: windows_sys::core::PWSTR = std::ptr::null_mut();
        if unsafe { ConvertSidToStringSidW(sid, &mut raw) } == 0 || raw.is_null() {
            return "<unreadable-sid>".to_string();
        }
        let mut length = 0usize;
        while unsafe { *raw.add(length) } != 0 {
            length += 1;
        }
        let slice = unsafe { std::slice::from_raw_parts(raw, length) };
        let value = String::from_utf16_lossy(slice);
        unsafe { LocalFree(raw.cast()) };
        value
    }

    struct SecurityDescriptor {
        raw: PSECURITY_DESCRIPTOR,
        owner: PSID,
        dacl: *mut ACL,
        dacl_present: bool,
    }

    impl Drop for SecurityDescriptor {
        fn drop(&mut self) {
            if !self.raw.is_null() {
                unsafe { LocalFree(self.raw.cast()) };
                self.raw = std::ptr::null_mut();
            }
        }
    }

    fn read_security_descriptor(path: &[u16]) -> io::Result<SecurityDescriptor> {
        let mut raw: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
        let mut owner: PSID = std::ptr::null_mut();
        let mut dacl: *mut ACL = std::ptr::null_mut();
        let status = unsafe {
            GetNamedSecurityInfoW(
                path.as_ptr(),
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
                &mut owner,
                std::ptr::null_mut(),
                &mut dacl,
                std::ptr::null_mut(),
                &mut raw,
            )
        };
        if status != ERROR_SUCCESS {
            return Err(io::Error::from_raw_os_error(status as i32));
        }
        // `GetNamedSecurityInfoW` hands back pointers INTO the descriptor it
        // allocated, so re-reading the DACL presence flag from the descriptor
        // is the only way to tell "no DACL" (everyone gets everything) from
        // "empty DACL" (nobody does). Conflating them is how a guard ends up
        // admitting the most permissive state on the planet.
        let mut present: windows_sys::Win32::Foundation::BOOL = 0;
        let mut defaulted: windows_sys::Win32::Foundation::BOOL = 0;
        let mut dacl_from_sd: *mut ACL = std::ptr::null_mut();
        let read =
            unsafe { GetSecurityDescriptorDacl(raw, &mut present, &mut dacl_from_sd, &mut defaulted) };
        let descriptor = SecurityDescriptor {
            raw,
            owner,
            dacl,
            dacl_present: read != 0 && present != 0 && !dacl_from_sd.is_null(),
        };
        if read == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(descriptor)
    }

    fn descriptor_is_protected(raw: PSECURITY_DESCRIPTOR) -> io::Result<bool> {
        let mut control: u16 = 0;
        let mut revision: u32 = 0;
        if unsafe { GetSecurityDescriptorControl(raw, &mut control, &mut revision) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(control & SE_DACL_PROTECTED != 0)
    }

    fn read_aces(dacl: *mut ACL) -> io::Result<Vec<Ace>> {
        if dacl.is_null() {
            return Ok(Vec::new());
        }
        let mut info = ACL_SIZE_INFORMATION {
            AceCount: 0,
            AclBytesInUse: 0,
            AclBytesFree: 0,
        };
        let read = unsafe {
            GetAclInformation(
                dacl,
                (&mut info as *mut ACL_SIZE_INFORMATION).cast(),
                size_of::<ACL_SIZE_INFORMATION>() as u32,
                AclSizeInformation,
            )
        };
        if read == 0 {
            return Err(io::Error::last_os_error());
        }
        let mut aces = Vec::with_capacity(info.AceCount as usize);
        for index in 0..info.AceCount {
            let mut entry: *mut core::ffi::c_void = std::ptr::null_mut();
            if unsafe { GetAce(dacl, index, &mut entry) } == 0 || entry.is_null() {
                return Err(io::Error::last_os_error());
            }
            let header = unsafe { &*(entry as *const ACE_HEADER) };
            match header.AceType {
                ACCESS_ALLOWED_ACE_TYPE | ACCESS_DENIED_ACE_TYPE => {
                    // `SidStart` is the first DWORD of a variable-length SID
                    // laid out inline, so its address is the PSID.
                    let sid = unsafe {
                        std::ptr::addr_of!((*(entry as *const ACCESS_ALLOWED_ACE)).SidStart)
                    } as PSID;
                    aces.push(Ace {
                        sid: sid_to_string(sid),
                        kind: if header.AceType == ACCESS_ALLOWED_ACE_TYPE {
                            "Allow".to_string()
                        } else {
                            "Deny".to_string()
                        },
                    });
                }
                other => aces.push(Ace {
                    sid: "<unparsed>".to_string(),
                    kind: format!("AceType({other})"),
                }),
            }
        }
        Ok(aces)
    }

    /// Replace the DACL with exactly self + SYSTEM + Administrators, and
    /// detach it from inheritance so a later change to the parent cannot
    /// re-open it.
    fn apply_exclusive_dacl(path: &[u16], inheritable: bool, sids: &[Vec<u8>]) -> io::Result<()> {
        let ace_overhead = size_of::<ACCESS_ALLOWED_ACE>() - size_of::<u32>();
        let mut size = size_of::<ACL>();
        for sid in sids {
            size += ace_overhead + sid.len();
        }
        // The ACL must be DWORD-aligned; a Vec<u32> guarantees that where a
        // Vec<u8> does not.
        let mut storage = vec![0u32; size.div_ceil(size_of::<u32>())];
        let acl = storage.as_mut_ptr().cast::<ACL>();
        if unsafe { InitializeAcl(acl, (storage.len() * size_of::<u32>()) as u32, ACL_REVISION) } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let flags = if inheritable {
            OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE
        } else {
            NO_INHERITANCE
        };
        for sid in sids {
            let added = unsafe {
                AddAccessAllowedAceEx(
                    acl,
                    ACL_REVISION,
                    flags,
                    FILE_ALL_ACCESS,
                    sid.as_ptr() as PSID,
                )
            };
            if added == 0 {
                return Err(io::Error::last_os_error());
            }
        }
        let mut wide = path.to_vec();
        let status = unsafe {
            SetNamedSecurityInfoW(
                wide.as_mut_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                acl,
                std::ptr::null(),
            )
        };
        if status != ERROR_SUCCESS {
            return Err(io::Error::from_raw_os_error(status as i32));
        }
        Ok(())
    }

    fn state(path: &[u16], self_sid: &str) -> io::Result<AclReport> {
        let descriptor = read_security_descriptor(path)?;
        let protected = descriptor_is_protected(descriptor.raw)?;
        let aces = read_aces(descriptor.dacl)?;
        Ok(AclReport {
            self_sid: self_sid.to_string(),
            owner: sid_to_string(descriptor.owner),
            dacl_present: descriptor.dacl_present,
            protected,
            repaired: false,
            removed: Vec::new(),
            before: aces.clone(),
            aces,
        })
    }

    /// Read the DACL, repair it if it is not already exclusive, and report the
    /// state it ends in.
    ///
    /// A symlink or other reparse point is refused outright rather than
    /// followed: `SetNamedSecurityInfoW` writes through it, so the DACL this
    /// function verified would not be the DACL guarding the bytes. That is the
    /// gap `cave-8p0hn` records against the JavaScript sibling, and there is
    /// no reason to import it here.
    pub(crate) fn restrict_to_current_user(path: &Path) -> io::Result<AclReport> {
        if let Ok(metadata) = std::fs::symlink_metadata(path) {
            if metadata.file_type().is_symlink() {
                return Err(io::Error::other(
                    "it is a symlink, and the DACL of a reparse point is not the DACL of its target",
                ));
            }
        }
        let wide = wide_null(path);
        let me = current_user_sid()?;
        let self_sid = sid_to_string(me.as_ptr() as PSID);
        let system = well_known_sid(WinLocalSystemSid)?;
        let admins = well_known_sid(WinBuiltinAdministratorsSid)?;
        debug_assert_eq!(sid_to_string(system.as_ptr() as PSID), WINDOWS_SYSTEM_SID);
        debug_assert_eq!(
            sid_to_string(admins.as_ptr() as PSID),
            WINDOWS_ADMINISTRATORS_SID
        );

        let before = state(&wide, &self_sid)?;
        if super::exclusivity_findings(&before).is_empty() {
            return Ok(before);
        }

        let inheritable = std::fs::metadata(path)?.is_dir();
        let trusted = [me, system, admins];
        apply_exclusive_dacl(&wide, inheritable, &trusted)?;

        let mut after = state(&wide, &self_sid)?;
        let mut removed: Vec<String> = Vec::new();
        for ace in &before.aces {
            let kept = after.aces.iter().any(|kept| kept.sid == ace.sid && kept.kind == ace.kind);
            if !kept && !removed.contains(&ace.sid) {
                removed.push(ace.sid.clone());
            }
        }
        after.repaired = true;
        after.removed = removed;
        after.before = before.aces;
        Ok(after)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exclusive_report() -> AclReport {
        AclReport {
            self_sid: "S-1-5-21-1-2-3-1001".to_string(),
            owner: "S-1-5-21-1-2-3-1001".to_string(),
            dacl_present: true,
            protected: true,
            repaired: false,
            removed: Vec::new(),
            before: vec![Ace::allow("S-1-5-21-1-2-3-1001")],
            aces: vec![
                Ace::allow("S-1-5-21-1-2-3-1001"),
                Ace::allow(WINDOWS_SYSTEM_SID),
                Ace::allow(WINDOWS_ADMINISTRATORS_SID),
            ],
        }
    }

    // -- exclusivity rule ---------------------------------------------------
    // Every assertion below is pure policy and runs identically on the Linux
    // CI runner and on Windows. Nothing here is `cfg`-gated, so none of it can
    // pass vacuously on a runner that has no DACL.

    #[test]
    fn an_exclusive_path_has_no_findings() {
        assert!(exclusivity_findings(&exclusive_report()).is_empty());
    }

    #[test]
    fn a_foreign_allow_ace_is_a_finding() {
        let mut report = exclusive_report();
        report.aces.push(Ace::allow("S-1-5-32-545"));
        let findings = exclusivity_findings(&report);
        assert_eq!(findings, vec!["access granted to Allow:S-1-5-32-545"]);
    }

    #[test]
    fn a_deny_ace_for_a_trusted_sid_is_still_a_finding() {
        // Trust is about which principal, but a Deny changes the access
        // decision for everyone downstream of it, so "trusted SID" is not
        // enough to admit an ACE whose type we did not expect.
        let mut report = exclusive_report();
        report.aces.push(Ace {
            sid: WINDOWS_SYSTEM_SID.to_string(),
            kind: "Deny".to_string(),
        });
        assert_eq!(
            exclusivity_findings(&report),
            vec![format!("access granted to Deny:{WINDOWS_SYSTEM_SID}")]
        );
    }

    #[test]
    fn an_ace_form_the_parser_cannot_read_is_a_finding() {
        let mut report = exclusive_report();
        report.aces.push(Ace {
            sid: "<unparsed>".to_string(),
            kind: "AceType(9)".to_string(),
        });
        assert_eq!(
            exclusivity_findings(&report),
            vec!["access granted to AceType(9):<unparsed>"]
        );
    }

    #[test]
    fn an_absent_dacl_is_a_finding_rather_than_an_empty_one() {
        // A NULL DACL grants EVERY principal full access. Reading it as "no
        // entries, therefore nobody has access" would admit the single most
        // permissive state Windows can express.
        let mut report = exclusive_report();
        report.dacl_present = false;
        report.aces.clear();
        assert_eq!(
            exclusivity_findings(&report),
            vec!["it carries no DACL at all, which grants every principal full access"]
        );
    }

    #[test]
    fn an_inheriting_dacl_and_a_foreign_owner_are_findings() {
        let mut report = exclusive_report();
        report.protected = false;
        report.owner = "S-1-5-21-1-2-3-500".to_string();
        assert_eq!(
            exclusivity_findings(&report),
            vec![
                "owned by S-1-5-21-1-2-3-500, not S-1-5-21-1-2-3-1001",
                "its DACL still inherits from the parent",
            ]
        );
    }

    #[test]
    fn a_duplicated_foreign_ace_is_named_once() {
        let mut report = exclusive_report();
        report.aces.push(Ace::allow("S-1-5-32-545"));
        report.aces.push(Ace::allow("S-1-5-32-545"));
        assert_eq!(
            exclusivity_findings(&report),
            vec!["access granted to Allow:S-1-5-32-545"]
        );
    }

    // -- the waiver ---------------------------------------------------------

    fn env_of<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |key| {
            pairs
                .iter()
                .find(|(name, _)| *name == key)
                .map(|(_, value)| (*value).to_string())
        }
    }

    #[test]
    fn an_unset_waiver_is_denied_and_says_how_to_set_it() {
        let waiver = resolve_waiver(env_of(&[]));
        match waiver {
            Waiver::Denied { note } => {
                assert!(note.contains(UNVERIFIED_OWNERSHIP_ENV));
                assert!(note.contains(UNVERIFIED_OWNERSHIP_TOKEN));
                assert!(note.contains(UNVERIFIED_OWNERSHIP_REASON_ENV));
            }
            other => panic!("an unset waiver must be denied, got {other:?}"),
        }
    }

    #[test]
    fn boolean_shaped_values_never_waive() {
        for value in ["1", "true", "yes", "on", "I-Accept-Unverified-Path-Ownership"] {
            let waiver = resolve_waiver(env_of(&[
                (UNVERIFIED_OWNERSHIP_ENV, value),
                (UNVERIFIED_OWNERSHIP_REASON_ENV, "a perfectly good reason"),
            ]));
            assert!(
                !waiver.granted(),
                "{value:?} must not waive an unverifiable DACL"
            );
        }
    }

    #[test]
    fn the_exact_token_without_attribution_never_waives() {
        for reason in ["", "   ", "too short"] {
            let waiver = resolve_waiver(env_of(&[
                (UNVERIFIED_OWNERSHIP_ENV, UNVERIFIED_OWNERSHIP_TOKEN),
                (UNVERIFIED_OWNERSHIP_REASON_ENV, reason),
            ]));
            assert!(
                !waiver.granted(),
                "reason {reason:?} is not attribution enough to waive"
            );
        }
    }

    #[test]
    fn the_exact_token_with_attribution_waives_and_keeps_the_reason() {
        let waiver = resolve_waiver(env_of(&[
            (UNVERIFIED_OWNERSHIP_ENV, "  i-accept-unverified-path-ownership  "),
            (UNVERIFIED_OWNERSHIP_REASON_ENV, "  ops accepted this on the WDAC fleet  "),
        ]));
        assert_eq!(
            waiver,
            Waiver::Granted {
                reason: "ops accepted this on the WDAC fleet".to_string()
            }
        );
    }

    #[test]
    fn the_waiver_matches_the_javascript_guard_it_shares_a_host_with() {
        // A user must not get a protected token in dev and an unprotected one
        // in the packaged app, nor a waiver that works on one and not the
        // other. These four values are the contract with
        // src/lib/server/client-v1/path-ownership.ts; changing one here
        // without changing it there re-opens the split cave-hdt3f was filed
        // for.
        assert_eq!(UNVERIFIED_OWNERSHIP_ENV, "COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP");
        assert_eq!(
            UNVERIFIED_OWNERSHIP_REASON_ENV,
            "COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP_REASON"
        );
        assert_eq!(UNVERIFIED_OWNERSHIP_TOKEN, "i-accept-unverified-path-ownership");
        assert_eq!(UNVERIFIED_OWNERSHIP_MIN_REASON, 12);
    }

    // -- the decision -------------------------------------------------------

    fn denied() -> Waiver {
        resolve_waiver(env_of(&[]))
    }

    fn granted() -> Waiver {
        resolve_waiver(env_of(&[
            (UNVERIFIED_OWNERSHIP_ENV, UNVERIFIED_OWNERSHIP_TOKEN),
            (UNVERIFIED_OWNERSHIP_REASON_ENV, "ops accepted this on the WDAC fleet"),
        ]))
    }

    #[test]
    fn an_exclusive_path_is_enforced_without_a_notice() {
        assert_eq!(
            classify("The secret", "C:\\s", Ok(exclusive_report()), &denied()),
            Protection::Enforced { notice: None }
        );
    }

    #[test]
    fn a_repaired_path_is_enforced_and_records_the_dacl_it_replaced() {
        let mut report = exclusive_report();
        report.repaired = true;
        report.removed = vec!["S-1-5-32-545".to_string()];
        report.before = vec![Ace::allow("S-1-5-32-545"), Ace::allow(WINDOWS_SYSTEM_SID)];
        match classify("The secret", "C:\\s", Ok(report), &denied()) {
            Protection::Enforced { notice: Some(notice) } => {
                assert!(notice.contains("revoked S-1-5-32-545"));
                // cave-okfb2: the prior DACL is otherwise unrecoverable once
                // the repair lands, so the notice has to carry it.
                assert!(
                    notice.contains("Allow:S-1-5-32-545, Allow:S-1-5-18"),
                    "the notice must record the DACL as it stood before the repair: {notice}"
                );
            }
            other => panic!("a repaired path is enforced with a notice, got {other:?}"),
        }
    }

    #[test]
    fn a_shared_path_is_refused_and_names_the_remedy() {
        let mut report = exclusive_report();
        report.aces.push(Ace::allow("S-1-5-32-545"));
        match classify("The secret", "C:\\s", Ok(report), &denied()) {
            Protection::Refused { message } => {
                assert!(message.contains("not exclusive to the current user"));
                assert!(message.contains("Allow:S-1-5-32-545"));
                assert!(message.contains("icacls \"C:\\s\""));
            }
            other => panic!("a shared path must be refused, got {other:?}"),
        }
    }

    #[test]
    fn the_waiver_never_admits_a_dacl_that_was_read_and_found_shared() {
        // The whole point of the waiver's single call site. If this ever
        // passes, the waiver has become the unconditional pass #4842 was filed
        // about.
        let mut report = exclusive_report();
        report.aces.push(Ace::allow("S-1-5-32-545"));
        report.protected = false;
        report.owner = "S-1-5-21-9-9-9-500".to_string();
        report.dacl_present = false;
        match classify("The secret", "C:\\s", Ok(report), &granted()) {
            Protection::Refused { message } => {
                assert!(
                    message.contains("does not cover a DACL that was read"),
                    "the refusal must say why the waiver did not apply: {message}"
                );
                assert!(message.contains("/reset"));
            }
            other => panic!("a read-and-shared DACL is refused even when waived, got {other:?}"),
        }
    }

    #[test]
    fn an_unverifiable_dacl_is_refused_without_the_waiver() {
        match classify(
            "The secret",
            "C:\\s",
            Err("Access is denied. (os error 5)".to_string()),
            &denied(),
        ) {
            Protection::Refused { message } => {
                assert!(message.contains("could not be established on Windows"));
                assert!(message.contains("os error 5"));
                assert!(message.contains(UNVERIFIED_OWNERSHIP_TOKEN));
            }
            other => panic!("an unverifiable DACL must be refused, got {other:?}"),
        }
    }

    #[test]
    fn an_unverifiable_dacl_is_waived_with_a_disclosure_that_names_the_reason() {
        match classify(
            "The secret",
            "C:\\s",
            Err("Access is denied. (os error 5)".to_string()),
            &granted(),
        ) {
            Protection::Waived { disclosure } => {
                assert!(disclosure.starts_with("SECURITY WAIVER"));
                assert!(disclosure.contains("ops accepted this on the WDAC fleet"));
                assert!(disclosure.contains("os error 5"));
            }
            other => panic!("a waived unverifiable DACL discloses, got {other:?}"),
        }
    }

    #[test]
    fn a_symlink_is_refused_rather_than_followed() {
        // cave-8p0hn against the JavaScript sibling: the DACL of a reparse
        // point is not the DACL of the bytes the write lands in.
        match classify(
            "The secret",
            "C:\\s",
            Err("it is a symlink, and the DACL of a reparse point is not the DACL of its target"
                .to_string()),
            &denied(),
        ) {
            Protection::Refused { message } => assert!(message.contains("symlink")),
            other => panic!("a symlink must be refused, got {other:?}"),
        }
    }

    // -- the Win32 layer ----------------------------------------------------
    // These are the only tests in this file that do NOT run on the Linux CI
    // runner. They are the reason the policy above is a separate, pure layer:
    // if the syscalls were the only coverage, CI would prove nothing at all.

    #[cfg(all(desktop, target_os = "windows"))]
    mod windows {
        use super::super::*;
        use std::process::Command;

        fn scratch(name: &str) -> std::path::PathBuf {
            let dir = std::env::temp_dir().join(format!(
                "cave-secret-acl-{name}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .expect("clock")
                    .as_nanos()
            ));
            std::fs::create_dir_all(&dir).expect("create scratch dir");
            dir
        }

        fn icacls(path: &std::path::Path) -> String {
            let output = Command::new(
                std::path::PathBuf::from(std::env::var_os("SystemRoot").expect("SystemRoot"))
                    .join("System32")
                    .join("icacls.exe"),
            )
            .arg(path)
            .output()
            .expect("run icacls");
            String::from_utf8_lossy(&output.stdout).to_string()
        }

        /// Hand a foreign principal Modify on `path`, the way an inherited
        /// profile policy does, so the repair has something real to strip.
        /// The inheritance flags are valid on a container only, so a file gets
        /// the bare grant.
        fn grant_users_modify(path: &std::path::Path) {
            let grant = if path.is_dir() {
                "*S-1-5-32-545:(OI)(CI)(M)"
            } else {
                "*S-1-5-32-545:(M)"
            };
            let status = Command::new(
                std::path::PathBuf::from(std::env::var_os("SystemRoot").expect("SystemRoot"))
                    .join("System32")
                    .join("icacls.exe"),
            )
            .arg(path)
            .arg("/grant")
            .arg(grant)
            .output()
            .expect("run icacls /grant");
            assert!(
                status.status.success(),
                "icacls /grant must succeed: {}",
                String::from_utf8_lossy(&status.stderr)
            );
            let observed = icacls(path);
            assert!(
                observed.contains("S-1-5-32-545") || observed.contains("Users"),
                "the fixture must actually be shared before the repair: {observed}"
            );
        }

        #[test]
        fn restricting_a_directory_strips_a_foreign_principal_and_protects_the_dacl() {
            let dir = scratch("dir");
            grant_users_modify(&dir);

            let report = win::restrict_to_current_user(&dir).expect("restrict scratch dir");

            assert!(report.repaired, "a shared directory has to be repaired");
            assert!(report.protected, "the repaired DACL must not inherit");
            assert!(report.dacl_present, "the repair must leave a DACL behind");
            assert!(
                report.removed.iter().any(|sid| sid == "S-1-5-32-545"),
                "the granted principal must be reported as removed: {:?}",
                report.removed
            );
            assert!(
                exclusivity_findings(&report).is_empty(),
                "the repaired directory must be exclusive: {:?}",
                exclusivity_findings(&report)
            );
            let after = icacls(&dir);
            assert!(
                !after.contains("S-1-5-32-545") && !after.contains("BUILTIN\\Users"),
                "an independent tool must agree the principal is gone: {after}"
            );

            std::fs::remove_dir_all(&dir).expect("cleanup");
        }

        #[test]
        fn a_second_pass_over_an_already_exclusive_path_does_not_repair_again() {
            let dir = scratch("idempotent");
            win::restrict_to_current_user(&dir).expect("first pass");
            let second = win::restrict_to_current_user(&dir).expect("second pass");
            assert!(
                !second.repaired,
                "an already exclusive path must not be rewritten on every launch"
            );
            assert!(exclusivity_findings(&second).is_empty());
            std::fs::remove_dir_all(&dir).expect("cleanup");
        }

        #[test]
        fn a_missing_path_is_an_error_rather_than_a_pass() {
            let dir = scratch("missing");
            let absent = dir.join("nothing-here");
            assert!(win::restrict_to_current_user(&absent).is_err());
            std::fs::remove_dir_all(&dir).expect("cleanup");
        }

        #[test]
        fn protect_secret_path_reports_a_repaired_file_as_enforced_with_a_notice() {
            let dir = scratch("file");
            let file = dir.join("mobile-access-token");
            std::fs::write(&file, "x").expect("write fixture");
            grant_users_modify(&file);

            match protect_secret_path(&file, "The mobile access token") {
                Protection::Enforced { notice: Some(notice) } => {
                    assert!(notice.contains("S-1-5-32-545"), "{notice}");
                }
                other => panic!("a repairable file is enforced with a notice, got {other:?}"),
            }
            let after = icacls(&file);
            assert!(!after.contains("S-1-5-32-545"), "{after}");
            assert!(
                matches!(
                    protect_secret_path(&file, "The mobile access token"),
                    Protection::Enforced { notice: None }
                ),
                "the second look must find nothing left to repair"
            );

            std::fs::remove_dir_all(&dir).expect("cleanup");
        }
    }
}
