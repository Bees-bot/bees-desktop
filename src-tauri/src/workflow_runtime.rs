use crate::process::{available_loopback_port, Sidecar};
use getrandom::fill;
use serde::{Deserialize, Serialize};
use std::{
    fmt::Write as _,
    fs::{self, File, OpenOptions},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::Manager;

struct ManagedWorkflowRuntime {
    /// `None` when this app adopted a Temporal server that another app instance — or a previous
    /// run killed before `Drop` could reap it — left serving the same database. Dropping a handle
    /// we do not own would pull the server out from under its owner.
    temporal: Option<Sidecar>,
    grpc_port: u16,
    worker: Sidecar,
    base_url: String,
    token: String,
}

pub struct WorkflowRuntimeManager(Mutex<Option<ManagedWorkflowRuntime>>);

impl Default for WorkflowRuntimeManager {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRuntimeInfo {
    base_url: String,
    token: String,
}

fn loopback_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    fill(&mut bytes).map_err(|error| error.to_string())?;
    let mut token = String::with_capacity(64);
    for byte in bytes {
        write!(token, "{byte:02x}").map_err(|error| error.to_string())?;
    }
    Ok(token)
}

fn bundled_binary(name: &str) -> Result<PathBuf, String> {
    let extension = if cfg!(windows) { ".exe" } else { "" };
    let path = std::env::current_exe()
        .map_err(|error| error.to_string())?
        .parent()
        .map(|directory| directory.join(format!("{name}{extension}")))
        .filter(|path| path.is_file())
        .ok_or_else(|| format!("The bundled {name} runtime is missing. Reinstall Bees."))?;
    Ok(path)
}

fn workflow_source(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let packaged = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("flue-runtime")
        .join("project")
        .join("workflow");
    let source = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("flue-runtime")
        .join("project")
        .join("workflow");
    let root = if packaged.join("start.mjs").is_file() {
        packaged
    } else {
        source
    };
    if !root.join("start.mjs").is_file() || !root.join("work-item-workflow.ts").is_file() {
        return Err("The bundled workflow worker is missing. Reinstall Bees.".into());
    }
    Ok(root)
}

fn log_file(path: &Path) -> Result<File, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())
}

fn wait_for_socket(child: &mut Sidecar, port: u16, log: &Path) -> Result<(), String> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    for _ in 0..600 {
        if let Some(status) = child
            .child()
            .try_wait()
            .map_err(|error| error.to_string())?
        {
            return Err(format!(
                "The local Temporal service stopped during startup ({status}). See {}.",
                log.display()
            ));
        }
        if TcpStream::connect_timeout(&address, Duration::from_millis(100)).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err(format!(
        "The local Temporal service did not become ready. See {}.",
        log.display()
    ))
}

fn wait_for_http(child: &mut Sidecar, base_url: &str, log: &Path) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(500))
        .build()
        .map_err(|error| error.to_string())?;
    for _ in 0..600 {
        if let Some(status) = child
            .child()
            .try_wait()
            .map_err(|error| error.to_string())?
        {
            return Err(format!(
                "The local workflow worker stopped during startup ({status}). See {}.",
                log.display()
            ));
        }
        if client
            .get(format!("{base_url}/healthz"))
            .send()
            .map(|response| response.status().is_success())
            .unwrap_or(false)
        {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err(format!(
        "The local workflow worker did not become ready. See {}.",
        log.display()
    ))
}

/// Where a running Temporal server records itself, so the next app instance finds it instead of
/// starting a second one.
#[derive(Serialize, Deserialize)]
struct TemporalEndpoint {
    pid: u32,
    port: u16,
}

fn listening(port: u16) -> bool {
    TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(500),
    )
    .is_ok()
}

/// The port of the Temporal server already serving this database, if one still runs.
///
/// One server per `temporal.db` is the rule rather than an optimisation: several servers over one
/// SQLite file is a split brain, and a hard-killed app (or a second window) leaves its server
/// behind, so "did I start it?" is the wrong question to ask.
fn running_temporal(state: &Path) -> Option<u16> {
    let endpoint: TemporalEndpoint =
        serde_json::from_slice(&fs::read(state.join("runtime.json")).ok()?).ok()?;
    let pid = Pid::from_u32(endpoint.pid);
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
    let database = state.join("temporal.db");
    // A recycled PID belongs to something else entirely: only a process still holding our own
    // database file on its command line is the server we wrote down.
    let ours = system
        .process(pid)
        .is_some_and(|process| process.cmd().iter().any(|arg| Path::new(arg) == database));
    (ours && listening(endpoint.port)).then_some(endpoint.port)
}

fn ensure_blocking(app: &tauri::AppHandle) -> Result<WorkflowRuntimeInfo, String> {
    let manager = app.state::<WorkflowRuntimeManager>();
    let mut managed = manager.0.lock().map_err(|error| error.to_string())?;
    if let Some(runtime) = managed.as_mut() {
        let temporal_alive = match runtime.temporal.as_mut() {
            Some(sidecar) => sidecar.alive()?,
            None => listening(runtime.grpc_port)
        };
        if temporal_alive && runtime.worker.alive()? {
            return Ok(WorkflowRuntimeInfo {
                base_url: runtime.base_url.clone(),
                token: runtime.token.clone(),
            });
        }
        *managed = None;
    }

    let temporal_binary = bundled_binary("temporal")?;
    let node = bundled_binary("bees-node")?;
    let workflow = workflow_source(app)?;
    let app_data = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let state = app_data.join("temporal");
    fs::create_dir_all(&state).map_err(|error| error.to_string())?;
    let temporal_log = app_data.join("logs").join("temporal.log");
    let worker_log = app_data.join("logs").join("workflow-worker.log");
    let adopted = running_temporal(&state);
    let grpc_port = match adopted {
        Some(port) => port,
        None => available_loopback_port()?
    };
    let gateway_port = loop {
        let port = available_loopback_port()?;
        if port != grpc_port {
            break port;
        }
    };

    let temporal = match adopted {
        Some(_) => None,
        None => {
            let temporal_stdout = log_file(&temporal_log)?;
            let temporal_stderr = temporal_stdout
                .try_clone()
                .map_err(|error| error.to_string())?;
            let mut temporal = Sidecar::new(
                Command::new(temporal_binary)
                    .args([
                        "server",
                        "start-dev",
                        "--headless",
                        "--ip",
                        "127.0.0.1",
                        "--port",
                        &grpc_port.to_string(),
                        "--db-filename",
                    ])
                    .arg(state.join("temporal.db"))
                    .args([
                        "--sqlite-pragma",
                        "journal_mode=WAL",
                        "--sqlite-pragma",
                        "synchronous=FULL",
                        "--sqlite-pragma",
                        "busy_timeout=5000",
                        "--disable-config-file",
                        "--disable-config-env",
                    ])
                    .stdin(Stdio::null())
                    .stdout(Stdio::from(temporal_stdout))
                    .stderr(Stdio::from(temporal_stderr))
                    .spawn()
                    .map_err(|error| {
                        format!("The bundled Temporal service could not start: {error}")
                    })?,
            );
            wait_for_socket(&mut temporal, grpc_port, &temporal_log)?;
            let endpoint = TemporalEndpoint {
                pid: temporal.child().id(),
                port: grpc_port
            };
            fs::write(
                state.join("runtime.json"),
                serde_json::to_vec(&endpoint).map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
            Some(temporal)
        }
    };

    let token = loopback_token()?;
    let base_url = format!("http://127.0.0.1:{gateway_port}");
    let worker_stdout = log_file(&worker_log)?;
    let worker_stderr = worker_stdout
        .try_clone()
        .map_err(|error| error.to_string())?;
    let mut worker = Sidecar::new(
        Command::new(node)
            .current_dir(&workflow)
            .arg("--experimental-strip-types")
            .arg(workflow.join("start.mjs"))
            .env("PORT", gateway_port.to_string())
            .env("BEES_TEMPORAL_ADDRESS", format!("127.0.0.1:{grpc_port}"))
            .env("BEES_DATABASE_PATH", app_data.join("bees.db"))
            .env("BEES_WORKFLOW_TOKEN", &token)
            .stdin(Stdio::null())
            .stdout(Stdio::from(worker_stdout))
            .stderr(Stdio::from(worker_stderr))
            .spawn()
            .map_err(|error| format!("The bundled workflow worker could not start: {error}"))?,
    );
    wait_for_http(&mut worker, &base_url, &worker_log)?;

    *managed = Some(ManagedWorkflowRuntime {
        temporal,
        grpc_port,
        worker,
        base_url: base_url.clone(),
        token: token.clone(),
    });
    Ok(WorkflowRuntimeInfo { base_url, token })
}

#[tauri::command]
pub async fn ensure_local_workflow_runtime(
    app: tauri::AppHandle,
) -> Result<WorkflowRuntimeInfo, String> {
    tauri::async_runtime::spawn_blocking(move || ensure_blocking(&app))
        .await
        .map_err(|error| error.to_string())?
}
