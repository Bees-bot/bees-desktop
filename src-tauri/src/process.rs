//! Shared plumbing for the child processes Bees supervises: the Flue runtime, its capability
//! host, the knowledge worker, and one llama-server per running local model.

use std::net::TcpListener;
use std::process::Child;
use std::thread;
use std::time::Duration;

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
