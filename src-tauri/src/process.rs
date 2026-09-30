//! Lifecycle plumbing for the single DSH Node sidecar supervised by Bees.

use std::net::TcpListener;
use std::path::Path;
use std::process::Child;
use std::thread;
use std::time::Duration;
use sysinfo::{Pid, Process, ProcessRefreshKind, ProcessesToUpdate, Signal, System, UpdateKind};

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

/// Kill every process the predicate picks. The plain `refresh_processes` fills neither `exe`
/// nor `cmd`, so both are asked for here or nothing would ever match.
fn reap(matches: impl Fn(&System, &Process) -> bool) {
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_exe(UpdateKind::Always)
            .with_cmd(UpdateKind::Always),
    );
    for process in system.processes().values() {
        if matches(&system, process) {
            process.kill();
        }
    }
}

/// Remove a bundled sidecar whose Bees parent was hard-killed before `Drop` could reap it.
/// The exact executable path keeps this from touching another app's process.
pub fn reap_orphaned_sidecars(executable: &Path) {
    reap(|system, process| {
        let orphaned = process
            .parent()
            .is_none_or(|parent| parent.as_u32() == 1 || system.process(parent).is_none());
        orphaned && process.exe() == Some(executable)
    });
}

/// Remove a llama-server left behind by a previous app instance. The model manager tracks its
/// child only in memory, so a crash orphans the server and the next launch reports "not running"
/// and spawns a duplicate. Matched on the `--alias active` we always pass and on the parent being
/// gone, so another app's llama-server, or one a person is running themselves, is left alone.
pub fn reap_orphan_llama_servers() {
    reap(|system, process| {
        let orphaned = process
            .parent()
            .is_none_or(|parent| parent.as_u32() == 1 || system.process(parent).is_none());
        orphaned
            && process
                .exe()
                .and_then(Path::file_stem)
                .is_some_and(|name| name == "llama-server")
            && process
                .cmd()
                .windows(2)
                .any(|a| a[0] == "--alias" && a[1] == "active")
    });
}

/// End the browsers the agent browses in: Bees' own, and the copy of the person's default browser a
/// team asked for. DSH starts them, but DSH is hard-killed on quit so its own cleanup never runs, and
/// a browser left behind sits in the Dock and holds the profile lock. Matched on the exact profile
/// argument, so the browser the person is using themselves is left alone. Each is asked to quit first,
/// so it writes out the cookies it holds, and killed only if it is still there a few seconds later.
pub fn reap_agent_browsers(state: &Path) {
    let profiles = ["browser-profile", "browser-profile-personal"]
        .map(|profile| format!("--user-data-dir={}", state.join(profile).display()));
    let ours = |_: &System, process: &Process| {
        process
            .cmd()
            .iter()
            .any(|arg| profiles.iter().any(|profile| arg == profile.as_str()))
    };
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always),
    );
    // the main process only: its helpers carry the same profile, and one of them holds the cookie store
    let browsers: Vec<Pid> = system
        .processes()
        .values()
        .filter(|process| {
            ours(&system, process)
                && !process
                    .cmd()
                    .iter()
                    .any(|arg| arg.to_string_lossy().starts_with("--type="))
        })
        .map(|process| {
            process.kill_with(Signal::Term);
            process.pid()
        })
        .collect();
    for _ in 0..30 {
        system.refresh_processes(ProcessesToUpdate::Some(&browsers), true);
        if browsers.iter().all(|pid| system.process(*pid).is_none()) {
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }
    reap(ours);
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
