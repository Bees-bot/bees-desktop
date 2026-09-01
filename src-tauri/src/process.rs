//! Lifecycle plumbing for the single DSH Node sidecar supervised by Bees.

use std::net::TcpListener;
use std::path::Path;
use std::process::Child;
use std::thread;
use std::time::Duration;
use sysinfo::{ProcessesToUpdate, System};

/// A loopback listener on whichever ephemeral port the OS handed out, and that port.
pub fn bind_loopback() -> Result<(TcpListener, u16), String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    Ok((listener, port))
}

/// An ephemeral port the OS picked, released again before the caller binds it for real.
pub fn available_loopback_port() -> Result<u16, String> {
    bind_loopback().map(|(_, port)| port)
}

fn managed_sidecar(executable: Option<&Path>, expected: &Path) -> bool {
    executable == Some(expected)
}

/// Remove a bundled sidecar whose Bees parent was hard-killed before `Drop` could reap it.
/// The exact executable path keeps this from touching another app's process.
pub fn reap_orphaned_sidecars(executable: &Path) -> usize {
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    let mut reaped = 0;
    for process in system.processes().values() {
        let orphaned = process
            .parent()
            .is_none_or(|parent| parent.as_u32() == 1 || system.process(parent).is_none());
        if orphaned && managed_sidecar(process.exe(), executable) && process.kill() {
            reaped += 1;
        }
    }
    reaped
}

/// Remove a llama-server left behind by a previous app instance. The model manager tracks its
/// child only in memory, so a crash orphans the server and the next launch reports "not running"
/// and spawns a duplicate. Matched on the `--alias active` we always pass, so another app's
/// llama-server is left alone.
pub fn reap_orphan_llama_servers() {
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    for process in system.processes().values() {
        let ours = process
            .exe()
            .and_then(Path::file_stem)
            .is_some_and(|name| name == "llama-server");
        if ours
            && process
                .cmd()
                .windows(2)
                .any(|a| a[0] == "--alias" && a[1] == "active")
        {
            process.kill();
        }
    }
}

/// End the Chrome the agent browses in. DSH starts it, but DSH is hard-killed on quit so its own
/// cleanup never runs, and a Chrome left behind sits in the Dock and holds the profile lock.
/// Matched on the exact profile argument, so a person's own Chrome is left alone.
pub fn reap_agent_browser(profile: &Path) {
    let expected = format!("--user-data-dir={}", profile.display());
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    for process in system.processes().values() {
        if process.cmd().iter().any(|arg| arg == expected.as_str()) {
            process.kill();
        }
    }
}

/// A child process that is killed and reaped when it goes out of scope, so dropping whatever
/// owns it — app state, a manager's `Option`, a map entry — is all the cleanup there is.
pub struct Sidecar(Child);

impl Sidecar {
    pub fn new(child: Child) -> Self {
        Self(child)
    }

    /// False once the process has exited. Errors only if the wait itself fails.
    pub fn alive(&mut self) -> Result<bool, String> {
        self.0
            .try_wait()
            .map(|status| status.is_none())
            .map_err(|error| error.to_string())
    }

    pub fn child(&mut self) -> &mut Child {
        &mut self.0
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        // A child stuck uninterruptible in the kernel (macOS holds first-launch of an unsigned
        // binary during Gatekeeper/XProtect assessment) ignores the pending SIGKILL until it
        // leaves that state, so a plain `wait()` here would hang the command thread and freeze
        // the UI. Detach after a short grace instead.
        let _ = self.0.kill();
        for _ in 0..20 {
            if matches!(self.0.try_wait(), Ok(Some(_))) {
                return;
            }
            thread::sleep(Duration::from_millis(50));
        }
        // ponytail: still stuck — leak it rather than block. Only a reboot clears such a process.
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orphan_reaper_matches_only_our_exact_executable() {
        let node = Path::new("/Applications/Bees.app/Contents/MacOS/bees-node");
        assert!(managed_sidecar(Some(node), node));
        assert!(!managed_sidecar(Some(Path::new("/usr/bin/node")), node));
        assert!(!managed_sidecar(None, node));
    }
}
