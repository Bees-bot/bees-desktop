mod local_models;
mod process;
mod startup;

use getrandom::fill;
use local_models::{
    cancel_local_model_download, delete_local_model, ensure_local_model, local_model_status, local_model_hardware,
    start_local_model, stop_local_model, LocalModelManager,
};
use process::{
    available_loopback_port, reap_agent_browsers, reap_orphan_llama_servers,
    reap_orphaned_sidecars, Sidecar,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fmt::Write as _,
    fs,
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    sync::Mutex,
    thread,
    time::Duration,
};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

struct ManagedDsh {
    child: Sidecar,
    temporal: Sidecar,
    runtime_root: PathBuf,
    port: u16,
    token: String,
}

struct DshManager(Mutex<Option<ManagedDsh>>);

static WATCHING_DSH: AtomicBool = AtomicBool::new(false);
static QUIT_PENDING: AtomicBool = AtomicBool::new(false);
static QUIT_CONFIRMED: AtomicBool = AtomicBool::new(false);

struct DshRuntimeInfo {
    base_url: String,
    token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalModelConnection {
    base_url: String,
    context_window: u32,
}

fn token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    fill(&mut bytes).map_err(|error| error.to_string())?;
    let mut value = String::with_capacity(64);
    for byte in bytes {
        write!(value, "{byte:02x}").map_err(|error| error.to_string())?;
    }
    Ok(value)
}

fn stable_uuid(value: &str) -> String {
    let mut bytes: [u8; 16] = Sha256::digest(value.as_bytes())[..16].try_into().unwrap();
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
    )
}

fn legacy_device_uuid(value: &str) -> Option<String> {
    (value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| stable_uuid(value))
}

fn runtime_paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let node_name = if cfg!(windows) {
        "bees-node.exe"
    } else {
        "bees-node"
    };
    let node = std::env::current_exe()
        .map_err(|error| error.to_string())?
        .parent()
        .map(|directory| directory.join(node_name))
        .filter(|path| path.is_file())
        .ok_or_else(|| "The bundled Node.js runtime is missing. Reinstall Bees.".to_string())?;
    let temporal_name = if cfg!(windows) {
        "temporal.exe"
    } else {
        "temporal"
    };
    let temporal = std::env::current_exe()
        .map_err(|error| error.to_string())?
        .parent()
        .map(|directory| directory.join(temporal_name))
        .filter(|path| path.is_file())
        .ok_or_else(|| "The bundled Temporal runtime is missing. Reinstall Bees.".to_string())?;
    let packaged = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("dsh-runtime");
    let source = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("dsh-runtime");
    let runtime = if cfg!(debug_assertions) {
        if source.is_dir() {
            source
        } else {
            packaged
        }
    } else if packaged.is_dir() {
        packaged
    } else {
        source
    };
    let entry = runtime
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh")
        .join("lib")
        .join("bin.js");
    if !entry.is_file()
        || !runtime.join("start.mjs").is_file()
        || !runtime.join("profile").join("package.json").is_file()
        || !runtime
            .join("node_modules")
            .join("@bees")
            .join("dsh-plugin")
            .join("cordis.patch.yml")
            .is_file()
        || !runtime
            .join("plugin")
            .join("lib")
            .join("index.js")
            .is_file()
        || !runtime.join("freellmapi").join("server.mjs").is_file()
        || BEES_PLUGINS.iter().any(|package| {
            !runtime
                .join("node_modules")
                .join("@bees")
                .join(package)
                .join("lib")
                .join("index.js")
                .is_file()
        })
        || DSH_PROFILE_PLUGINS.iter().any(|package| {
            !runtime
                .join("node_modules")
                .join("@deepseek-ai")
                .join(package)
                .join("lib")
                .join("index.js")
                .is_file()
        })
    {
        return Err("The bundled DeepSeek Harness application is missing. Reinstall Bees.".into());
    }
    Ok((node, temporal, runtime))
}

/// First line of the overlay Bees used to write into a profile. Only used to recognise it.
const LEGACY_OVERLAY_MARKER: &str = "# Bees-owned profile overlay";
/// The profile's own patch document. DSH owns everything in here from 0.1.7 on.
const USER_OVERLAY_NAME: &str = "cordis.patch.yml";
/// Empty user overlay, the shape DSH writes back to.
const EMPTY_OVERLAY: &str = "[]\n";

fn copy_profile(runtime: &Path, profile: &Path) -> Result<(), String> {
    fs::create_dir_all(profile).map_err(|error| error.to_string())?;
    fs::copy(runtime.join("profile").join("package.json"), profile.join("package.json"))
        .map_err(|error| error.to_string())?;
    let user = profile.join(USER_OVERLAY_NAME);
    // Before 0.1.7 this was Bees' own overlay, rewritten on every launch and never holding anything
    // of the user's. It now belongs to DSH's settings layer, so an old copy has to go: it pins
    // entries the settings screens are expected to write.
    let legacy = fs::read_to_string(&user)
        .map(|current| current.starts_with(LEGACY_OVERLAY_MARKER))
        .unwrap_or(false);
    if !user.exists() || legacy {
        fs::write(&user, EMPTY_OVERLAY).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn link_package(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.is_dir() {
        return Err(format!(
            "The bundled DSH package {} is missing.",
            source.display()
        ));
    }
    let source = fs::canonicalize(source).map_err(|error| error.to_string())?;
    if fs::canonicalize(destination).ok().as_ref() == Some(&source) {
        return Ok(());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    if destination.symlink_metadata().is_ok() {
        fs::remove_file(destination)
            .or_else(|_| fs::remove_dir_all(destination))
            .map_err(|error| error.to_string())?;
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(source, destination).map_err(|error| error.to_string())
    }
    #[cfg(windows)]
    {
        let status = Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(destination)
            .arg(source)
            .status()
            .map_err(|error| error.to_string())?;
        status
            .success()
            .then_some(())
            .ok_or_else(|| "Could not link a DSH profile package.".to_string())
    }
}

fn prepare_profile(runtime: &Path, home: &Path) -> Result<(), String> {
    let profile = home.join("profiles").join("bees");
    copy_profile(runtime, &profile)?;
    let packages = DSH_PROFILE_PLUGINS
        .map(|package| ("@deepseek-ai", package))
        .into_iter()
        .chain(BEES_PLUGINS.map(|package| ("@bees", package)));
    for (scope, package) in packages {
        link_package(
            &runtime.join("node_modules").join(scope).join(package),
            &profile.join("node_modules").join(scope).join(package),
        )?;
    }
    let settings = home.join("settings.yaml");
    if !settings.exists() {
        fs::create_dir_all(home).map_err(|error| error.to_string())?;
        fs::write(
            settings,
            "ui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1\n",
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Every plugin Bees ships. The launch check and the profile links both read this, so a new
/// plugin cannot be staged without also being verified and linked.
const BEES_PLUGINS: [&str; 5] = [
    "dsh-plugin",
    "dsh-local-ai",
    "dsh-free-ai",
    "dsh-custom-ai",
    "dsh-subscriptions",
];

const DSH_PROFILE_PLUGINS: [&str; 3] = [
    "dsh-experimental-client-ui-agent-team",
    "dsh-experimental-agent-team",
    "dsh-experimental-tool-agent-team",
];

fn stable_loopback_port(app: &tauri::AppHandle) -> Result<u16, String> {
    let path = state_dir(app)?.join("port");
    let remembered = fs::read_to_string(&path).ok().and_then(|text| text.trim().parse().ok());
    let port = match remembered {
        Some(port) if port != 0 && TcpListener::bind(("127.0.0.1", port)).is_ok() => port,
        _ => available_loopback_port()?,
    };
    let _ = fs::write(&path, port.to_string());
    Ok(port)
}

/// Where the work lives: this computer's folder, or one the person shares between computers.
fn data_dir(app_data: &Path) -> Result<PathBuf, String> {
    let pointer = app_data.join("data-folder");
    let chosen = fs::read_to_string(&pointer).unwrap_or_default();
    if chosen.trim().is_empty() {
        return Ok(app_data.to_path_buf());
    }
    let path = PathBuf::from(chosen.trim());
    // falling back to the old folder would split the work across two copies
    if !path.is_dir() {
        return Err(format!(
            "Bees keeps your work in {}, and that folder is not on this computer right now. Reconnect it and open Bees again, or delete {} to go back to this computer's own copy.",
            path.display(),
            pointer.display()
        ));
    }
    Ok(path)
}

/// This computer's id, kept outside the database since several computers share one.
fn device_id(app_data: &Path) -> Result<String, String> {
    let path = app_data.join("device-id");
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let existing = existing.trim();
    if !existing.is_empty() {
        if let Some(id) = legacy_device_uuid(existing) {
            fs::write(&path, &id).map_err(|error| error.to_string())?;
            return Ok(id);
        }
        return Ok(existing.to_string());
    }
    let id = stable_uuid(&token()?);
    fs::write(&path, &id).map_err(|error| error.to_string())?;
    Ok(id)
}

/// The lock this launch holds, so quit releases ours and never a folder we were refused.
static CLAIMED: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Armed by Settings → Removing Bees, emptied as the app exits. Deleting the folder while the
/// sidecars still run only removes what they recreate a second later.
static REMOVE_ON_EXIT: Mutex<Option<PathBuf>> = Mutex::new(None);

/// One computer at a time, and no expiry since Google Drive can carry a lock slower than any wait.
fn claim_data_folder(data: &Path, app_data: &Path) -> Result<(), String> {
    // written either way, the plugin reads it on every launch
    let me = device_id(app_data)?;
    if data == app_data {
        return Ok(());
    }
    let lock = data.join("in-use");
    // a lock that will not read counts as held
    if lock.exists() {
        let held = fs::read_to_string(&lock).unwrap_or_default();
        let mut lines = held.lines();
        let holder = lines.next().unwrap_or_default().trim();
        if holder != me && legacy_device_uuid(holder).as_deref() != Some(me.as_str()) {
            let computer = lines.next().map(str::trim).filter(|name| !name.is_empty());
            // named, since a crashed computer leaves it behind and deleting it is the way back in
            return Err(format!(
                "{} has this Bees folder open. Quit Bees there, let Google Drive finish, then open it here. If that computer is gone, delete {}.",
                computer.unwrap_or("Another computer"),
                lock.display()
            ));
        }
    }
    let computer = sysinfo::System::host_name().unwrap_or_default();
    fs::write(&lock, format!("{me}\n{computer}")).map_err(|error| error.to_string())?;
    // release a lock from an earlier claim, or a switch that never restarted would strand it
    if let Ok(mut claimed) = CLAIMED.lock() {
        if let Some(stale) = claimed.replace(lock.clone()).filter(|held| *held != lock) {
            let _ = fs::remove_file(stale);
        }
    }
    Ok(())
}

fn state_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("dsh-state");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn open_log(app: &tauri::AppHandle) -> Result<(fs::File, PathBuf), String> {
    let path = state_dir(app)?.join("runtime.log");
    let _ = fs::rename(&path, path.with_extension("log.1"));
    let file = fs::File::create(&path).map_err(|error| error.to_string())?;
    Ok((file, path))
}

/// `attempts` are 200ms apart. A cold start needs the long wait; re-checking a sidecar we
/// already started does not, and that check happens under the manager lock that quitting
/// needs, so a slow answer there used to make Quit look hung for a minute.
fn wait_ready(child: &mut Sidecar, url: &str, log: &Path, attempts: u32) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(500))
        .build()
        .map_err(|error| error.to_string())?;
    for _ in 0..attempts {
        if let Some(status) = child
            .child()
            .try_wait()
            .map_err(|error| error.to_string())?
        {
            return Err(format!(
                "DeepSeek Harness stopped during startup ({status}). See {}.",
                log.display()
            ));
        }
        if client
            .get(url)
            .send()
            .ok()
            .filter(|response| response.status().is_success())
            .and_then(|response| response.text().ok())
            .is_some_and(|body| body.contains(r#""product":"bees""#))
        {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(200));
    }
    Err(format!(
        "DeepSeek Harness did not become ready. See {}.",
        log.display()
    ))
}

fn wait_temporal(child: &mut Sidecar, address: &str, log: &Path) -> Result<(), String> {
    for _ in 0..300 {
        if let Some(status) = child
            .child()
            .try_wait()
            .map_err(|error| error.to_string())?
        {
            return Err(format!(
                "Temporal stopped during startup ({status}). See {}.",
                log.display()
            ));
        }
        if TcpStream::connect(address).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(200));
    }
    Err(format!(
        "Temporal did not become ready. See {}.",
        log.display()
    ))
}

/// What any sidecar needs to find its files and trust a certificate.
const BASE_ENVIRONMENT: [&str; 16] = [
    "PATH",
    "HOME",
    "USER",
    "USERNAME",
    "SHELL",
    "TEMP",
    "TMP",
    "TMPDIR",
    "APPDATA",
    "LOCALAPPDATA",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
];

/// Model credentials. Only the runtime that talks to a model gets these; Temporal has no use for them.
const RUNTIME_ENVIRONMENT: [&str; 5] = [
    "DEEPSEEK_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "BEES_ACCOUNT_API_URL",
];

fn inherit_environment(command: &mut Command, keys: &[&str]) {
    for key in keys {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
}

fn ensure_dsh_runtime_blocking(app: &tauri::AppHandle) -> Result<DshRuntimeInfo, String> {
    let _startup = startup::start("runtime.ensure");
    let (node, temporal_binary, runtime) = startup::step("runtime.paths", || runtime_paths(app))?;
    let manager = app.state::<DshManager>();
    let mut managed = startup::step("runtime.manager-lock", || manager.0.lock())
        .map_err(|error| error.to_string())?;
    if let Some(current) = managed.as_mut() {
        if current.runtime_root == runtime && current.child.alive()? && current.temporal.alive()? {
            let base_url = format!("http://127.0.0.1:{}", current.port);
            // A sidecar whose process is alive but has stopped answering has to be replaced.
            // Returning the error here left it in state, so every retry waited on the same dead
            // process again and a fresh one was never started until the app was quit.
            if wait_ready(
                &mut current.child,
                &format!("{base_url}/healthz"),
                &state_dir(app)?.join("runtime.log"),
                10,
            )
            .is_ok()
            {
                return Ok(DshRuntimeInfo {
                    base_url,
                    token: current.token.clone(),
                });
            }
        }
        *managed = None;
    }

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let home = app_data.join("dsh");
    let data = data_dir(&app_data)?;
    startup::step("bees.data.claim", || claim_data_folder(&data, &app_data))?;
    let workspace = data.join("workspaces");
    fs::create_dir_all(&workspace).map_err(|error| error.to_string())?;
    startup::step("runtime.profile.prepare", || prepare_profile(&runtime, &home))?;

    let port = stable_loopback_port(app)?;
    let temporal_port = loop {
        let candidate = available_loopback_port()?;
        if candidate != port {
            break candidate;
        }
    };
    let temporal_address = format!("127.0.0.1:{temporal_port}");
    let secret = token()?;
    let base_url = format!("http://127.0.0.1:{port}");
    let entry = runtime.join("start.mjs");
    let (log, log_path) = open_log(app)?;
    let errors = log.try_clone().map_err(|error| error.to_string())?;
    let temporal_log = log.try_clone().map_err(|error| error.to_string())?;
    let temporal_errors = log.try_clone().map_err(|error| error.to_string())?;
    let temporal_root = app_data.join("temporal");
    fs::create_dir_all(&temporal_root).map_err(|error| error.to_string())?;
    let mut temporal_command = Command::new(&temporal_binary);
    temporal_command.env_clear();
    inherit_environment(&mut temporal_command, &BASE_ENVIRONMENT);
    temporal_command
        .args([
            "server",
            "start-dev",
            "--headless",
            "--ip",
            "127.0.0.1",
            "--port",
        ])
        .arg(temporal_port.to_string())
        .arg("--db-filename")
        .arg(temporal_root.join("processes-v4.db"))
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
        .stdout(Stdio::from(temporal_log))
        .stderr(Stdio::from(temporal_errors));
    let mut temporal = Sidecar::new(
        startup::step("temporal.spawn", || temporal_command.spawn())
            .map_err(|error| format!("Temporal could not start: {error}"))?,
    );
    startup::step("temporal.wait-port", || {
        wait_temporal(&mut temporal, &temporal_address, &log_path)
    })?;
    let mut command = Command::new(&node);
    command.env_clear();
    inherit_environment(&mut command, &BASE_ENVIRONMENT);
    inherit_environment(&mut command, &RUNTIME_ENVIRONMENT);
    command
        .current_dir(&workspace)
        // Node stops reading at 16 KiB of headers and answers 431, which the webview shows as a
        // blank window. Loopback callers are our own webview, so the header is ours to trust and
        // the size of it is never a reason to refuse the app its own interface.
        .arg("--max-http-header-size=65536")
        .arg(entry)
        .args(["--profile", "bees", "--host", "127.0.0.1", "--port"])
        .arg(port.to_string())
        .arg("--no-open")
        .env("DSH_HOME", &home)
        .env("DSH_TELEMETRY_DISABLED", "1")
        .env("BEES_DSH_TOKEN", &secret)
        .env("BEES_DSH_QUERY_PATH", home.join("session-query.sqlite"))
        .env("BEES_DATABASE_PATH", data.join("bees-stage1.db"))
        .env("BEES_DATA_DIR", &data)
        .env("BEES_APP_DATA", &app_data)
        .env("BEES_DEFAULT_WORKSPACE", &workspace)
        .env("BEES_STATE_DIR", state_dir(app)?)
        .env("BEES_STARTUP_LOG", state_dir(app)?.join("startup.log"))
        .env("BEES_RUNTIME_ROOT", &runtime)
        .env("BEES_TEMPORAL_ADDRESS", &temporal_address)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(errors));
    // Only development builds can write shipped defaults back into the source checkout.
    #[cfg(debug_assertions)]
    command.env(
        "BEES_PRODUCT_SOURCE",
        Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap(),
    );
    let mut child = Sidecar::new(
        startup::step("node.spawn", || command.spawn())
            .map_err(|error| format!("DeepSeek Harness could not start: {error}"))?,
    );
    startup::step("runtime.wait-health", || {
        wait_ready(&mut child, &format!("{base_url}/healthz"), &log_path, 300)
    })?;
    startup::mark("runtime.healthy");
    *managed = Some(ManagedDsh {
        child,
        temporal,
        runtime_root: runtime,
        port,
        token: secret.clone(),
    });
    Ok(DshRuntimeInfo {
        base_url,
        token: secret,
    })
}

/// The health endpoint of a live sidecar, or None once it is gone. The port is copied out under
/// the lock so the request that follows never holds it.
fn dsh_healthz(app: &tauri::AppHandle) -> Option<String> {
    let state = app.try_state::<DshManager>()?;
    let mut managed = state.0.lock().ok()?;
    let dsh = managed.as_mut()?;
    dsh.child
        .alive()
        .unwrap_or(false)
        .then(|| format!("http://127.0.0.1:{}/healthz", dsh.port))
}

fn healthz_answers(url: &str) -> bool {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(500))
        .build()
        .ok()
        .and_then(|client| client.get(url).send().ok())
        .is_some_and(|response| response.status().is_success())
}

fn is_dsh_auth_cookie(name: &str) -> bool {
    name.starts_with("bees_dsh_") || name.starts_with("dsh-auth-")
}

fn clear_dsh_auth_cookies(window: &tauri::WebviewWindow) -> Result<(), String> {
    for cookie in window.cookies().map_err(|error| error.to_string())? {
        if is_dsh_auth_cookie(cookie.name()) {
            window
                .delete_cookie(cookie)
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

/// The webview ends up on the harness's own URL, so a sidecar that dies leaves the window
/// stranded on a dead page. Put it back on the start screen, which asks for the runtime again.
fn watch_dsh(app: tauri::AppHandle, window: tauri::WebviewWindow, home: tauri::Url) {
    // ensure_dsh_runtime returns early when the sidecar is already healthy, so without this a
    // second call would leave another thread polling for the rest of the session.
    if WATCHING_DSH.swap(true, Ordering::SeqCst) {
        return;
    }
    thread::spawn(move || {
        // Watching the process alone was not enough: a harness that is running but has stopped
        // answering leaves the window on a dead page with no way back except quitting the app.
        // Not being able to read the sidecar's state is not the same as the sidecar being gone,
        // and it used to leave the loop on the first try and send the window back to the start
        // screen while the harness was serving perfectly well, so it still gets three tries.
        let mut misses = 0;
        loop {
            let url = dsh_healthz(&app);
            misses = if url.as_deref().is_some_and(healthz_answers) { 0 } else { misses + 1 };
            // a live harness that is only slow (a swapping machine) gets ~30s, since replacing it ends every run in flight
            if misses >= if url.is_some() { 12 } else { 3 } {
                break;
            }
            thread::sleep(Duration::from_secs(2));
        }
        let _ = window.set_title_bar_style(tauri::TitleBarStyle::Overlay);
        let _ = window.navigate(home);
        WATCHING_DSH.store(false, Ordering::SeqCst);
    });
}

#[tauri::command]
async fn ensure_dsh_runtime(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    startup::mark("ui.splash.invoke");
    let home = window.url().map_err(|error| error.to_string())?;
    let handle = app.clone();
    let runtime =
        tauri::async_runtime::spawn_blocking(move || ensure_dsh_runtime_blocking(&handle))
            .await
            .map_err(|error| error.to_string())??;
    let url: tauri::Url = format!("{}/bees-auth?token={}", runtime.base_url, runtime.token)
        .parse()
        .map_err(|error| format!("Could not build the local Bees URL: {error}"))?;
    startup::step("ui.clear-auth-cookies", || clear_dsh_auth_cookies(&window))?;
    // only the runtime's own port may call app commands, not every page on this computer
    app.add_capability(tauri::ipc::CapabilityBuilder::new("dsh-ui").remote(runtime.base_url.clone()).window("main")
        .permission("allow-bees-ui").permission("core:default").permission("dialog:allow-open"))
        .map_err(|error| error.to_string())?;
    let _ = window.set_title_bar_style(tauri::TitleBarStyle::Visible);
    startup::step("ui.navigate", || window.navigate(url))
        .map_err(|error| format!("Could not open the local Bees interface: {error}"))?;
    watch_dsh(app, window, home);
    Ok(())
}

#[tauri::command]
fn local_model_connection(
    app: tauri::AppHandle,
    model_id: Option<String>,
) -> Result<LocalModelConnection, String> {
    let route = model_id.as_deref().unwrap_or("active");
    local_models::local_model_routes(&app)?
        .get(route)
        .map(|route| LocalModelConnection {
            base_url: route.url.clone(),
            context_window: route.context_size,
        })
        .ok_or_else(|| match model_id {
            Some(id) => format!("Local model {id} is not running."),
            None => "No local model is running.".to_string(),
        })
}

fn validated_external_url(url: &str) -> Result<&str, String> {
    let url = url.trim();
    let secure_host = url
        .strip_prefix("https://")
        .and_then(|rest| rest.split(['/', '?', '#']).next())
        .filter(|host| !host.is_empty() && !host.chars().any(char::is_whitespace));
    let loopback_host = url
        .strip_prefix("http://")
        .and_then(|rest| rest.split(['/', '?', '#']).next())
        .and_then(|authority| authority.split(':').next())
        .filter(|host| matches!(*host, "localhost" | "127.0.0.1"));
    if (secure_host.is_none() && loopback_host.is_none()) || url.chars().any(char::is_control) {
        return Err("Bees can only open secure website links.".to_string());
    }
    Ok(url)
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let url = validated_external_url(&url)?;
    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "windows"))]
    {
        #[cfg(target_os = "macos")]
        let mut command = Command::new("open");
        #[cfg(target_os = "linux")]
        let mut command = Command::new("xdg-open");
        #[cfg(target_os = "windows")]
        let mut command = {
            let mut command = Command::new("rundll32");
            command.arg("url.dll,FileProtocolHandler");
            command
        };
        command
            .arg(url)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("Could not open the website: {error}"))
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    Err("Opening website links is not supported on this device.".to_string())
}

/// A new data folder is only picked up at launch.
#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.request_restart();
}

/// Recursive so the confirmation can name what it is about to remove.
fn folder_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| match entry.file_type() {
            // a symlink is neither, which is what stops the walk following one out of the folder
            Ok(kind) if kind.is_dir() => folder_size(&entry.path()),
            _ => entry.metadata().map(|meta| meta.len()).unwrap_or(0),
        })
        .sum()
}

/// The folder the app owns, and how much is in it. Its own copy of the identifier check is the
/// point: the settings screen names the path, so it has to be the path that goes.
fn bees_data_folder(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let named = data.file_name().and_then(|name| name.to_str()) == Some(app.config().identifier.as_str());
    // the parent check rules out a home directory, which would otherwise be deleted whole
    if !named || data.parent().is_none() {
        return Err(format!("{} is not the Bees data folder.", data.display()));
    }
    Ok(data)
}

#[derive(Serialize)]
struct DataFolder {
    path: String,
    bytes: u64,
}

// walks the whole data folder, so it must not block the main thread
#[tauri::command(async)]
fn bees_data_size(app: tauri::AppHandle) -> Result<DataFolder, String> {
    let data = bees_data_folder(&app)?;
    Ok(DataFolder { bytes: folder_size(&data), path: data.display().to_string() })
}

/// Settings → Removing Bees. Nothing is deleted here: the app quits, the exit hook takes the
/// sidecars down, and the removal runs after them.
// the confirm is native so no page script can skip it; async keeps the wait off the main thread
#[tauri::command(async)]
fn uninstall_bees(app: tauri::AppHandle) -> Result<bool, String> {
    let data = bees_data_folder(&app)?;
    let confirmed = app.dialog()
        .message(format!("Bees quits and deletes everything in {}. Your own folders are left alone, and nothing here can be recovered.", data.display()))
        .title("Remove Bees and its data?")
        .buttons(MessageDialogButtons::OkCancelCustom("Remove Bees".into(), "Keep Bees".into()))
        .blocking_show();
    if !confirmed {
        return Ok(false);
    }
    *REMOVE_ON_EXIT.lock().map_err(|error| error.to_string())? = Some(data);
    QUIT_CONFIRMED.store(true, Ordering::SeqCst);
    app.exit(0);
    Ok(true)
}

/// The memory server runs detached and outlives DSH, so find it by its port like local-memory.js does.
#[cfg(unix)]
fn kill_local_memory_server() {
    let Ok(listeners) = Command::new("lsof")
        .args(["-t", "-i", "tcp:8898", "-sTCP:LISTEN"])
        .output()
    else {
        return;
    };
    for pid in String::from_utf8_lossy(&listeners.stdout).split_whitespace() {
        // the group first, then the pid alone in case the listener is not the group leader
        let _ = Command::new("kill").args(["-9", &format!("-{pid}"), pid]).status();
    }
}
#[cfg(not(unix))]
fn kill_local_memory_server() {}

/// Closing the window only hides it, so this is how the window comes back: the tray, the dock,
/// and a second launch all route here.
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.maximize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// A menu-bar entry so a person can tell Bees is still working with no window on screen, and can
/// end it deliberately. Quit goes through `app.exit`, which raises `RunEvent::Exit` and takes the
/// sidecars down with it.
fn build_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open = MenuItem::with_id(app, "open", "Open Bees", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Bees", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    TrayIconBuilder::with_id("bees")
        .icon(
            app.default_window_icon()
                .cloned()
                .ok_or("Bees has no window icon")?,
        )
        .tooltip("Bees is running")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

/// Check the authenticated sidecar off the UI thread; an unavailable count is not an idle run.
fn confirm_quit(app: tauri::AppHandle, exit_code: i32) {
    if QUIT_PENDING.swap(true, Ordering::SeqCst) {
        return;
    }
    thread::spawn(move || {
        let connection = app.try_state::<DshManager>().and_then(|state| {
            state.0.lock().ok().and_then(|managed| managed.as_ref()
                .map(|dsh| (dsh.port, dsh.token.clone())))
        });
        let count = match connection {
            None => Some(0),
            Some((port, token)) => reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(2)).build().ok()
                .and_then(|client| client.get(format!("http://127.0.0.1:{port}/bees-api/active-runs"))
                    .bearer_auth(token).send().ok())
                .and_then(|response| response.error_for_status().ok())
                .and_then(|response| response.text().ok())
                .and_then(|text| text.parse::<usize>().ok()),
        };
        if count == Some(0) {
            QUIT_CONFIRMED.store(true, Ordering::SeqCst);
            app.exit(exit_code);
            return;
        }
        let detail = count.map_or_else(
            || "Bees could not check whether work is still active.".to_string(),
            |count| format!("Bees has {count} active or queued run(s)."),
        );
        app.dialog().message(format!("{detail} Quitting interrupts work and stops local schedules until Bees opens again. Close the window to keep working in the background."))
            .title("Quit Bees?")
            .buttons(MessageDialogButtons::OkCancelCustom("Quit Bees".into(), "Keep working".into()))
            .show(move |confirmed| {
                QUIT_PENDING.store(false, Ordering::SeqCst);
                if confirmed {
                    QUIT_CONFIRMED.store(true, Ordering::SeqCst);
                    app.exit(exit_code);
                }
            });
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    startup::mark("native.entry");
    let native_build = startup::start("native.build-app");
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_main_window(app);
        }));
    }
    builder = builder.plugin(tauri_plugin_dialog::init());
    builder
        .setup(|app| {
            if let Ok(state) = state_dir(app.handle()) {
                startup::open(&state.join("startup.log"));
            }
            let _setup = startup::start("native.setup");
            startup::step("native.reap-llama", reap_orphan_llama_servers);
            if let Ok((node, temporal, _)) =
                startup::step("native.runtime-paths", || runtime_paths(app.handle()))
            {
                startup::step("native.reap-node", || reap_orphaned_sidecars(&node));
                startup::step("native.reap-temporal", || reap_orphaned_sidecars(&temporal));
            }
            if let Ok(state) = state_dir(app.handle()) {
                startup::step("native.reap-browser", || reap_agent_browsers(&state));
            }
            app.manage(LocalModelManager::default());
            app.manage(DshManager(Mutex::new(None)));
            // a linux desktop without a tray library used to stop Bees from opening at all
            if startup::step("native.tray", || build_tray(app.handle())).is_err() {
                startup::mark("native.tray.failed");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Agents keep running with the window shut, so closing it hides the window and leaves
            // the tray as the way back in. Quit from the tray is what actually ends the process.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // with no tray there's no way back to a hidden window, so let it close
                if window.label() == "main" && window.app_handle().tray_by_id("bees").is_some() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            ensure_dsh_runtime,
            restart_app,
            local_model_status,
            local_model_hardware,
            ensure_local_model,
            start_local_model,
            stop_local_model,
            cancel_local_model_download,
            delete_local_model,
            local_model_connection,
            open_external_url,
            bees_data_size,
            uninstall_bees
        ])
        .on_page_load(|_window, payload| {
            // Do not log the URL: the initial handoff carries an authentication token.
            startup::mark(match payload.event() {
                tauri::webview::PageLoadEvent::Started => "webview.load-started",
                tauri::webview::PageLoadEvent::Finished => "webview.load-finished",
            });
        })
        .build(tauri::generate_context!())
        .map(|app| {
            drop(native_build);
            app
        })
        .expect("error while running Bees")
        .run(|handle, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = &event {
                if !QUIT_CONFIRMED.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    confirm_quit(handle.clone(), code.unwrap_or(0));
                }
            }
            if matches!(event, tauri::RunEvent::Ready) {
                startup::mark("native.event-loop-ready");
            }
            #[cfg(target_os = "macos")]
            if matches!(event, tauri::RunEvent::Reopen { .. }) {
                show_main_window(handle);
            }
            // Tauri exits the process directly on quit, so the children are dropped by hand here.
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(dsh) = handle.try_state::<DshManager>() {
                    // startup holds this lock through its waits; give up after ~2 s and let the next launch reap
                    for _ in 0..20 {
                        match dsh.0.try_lock() {
                            Ok(mut managed) => {
                                managed.take();
                                break;
                            }
                            Err(std::sync::TryLockError::Poisoned(poisoned)) => {
                                poisoned.into_inner().take();
                                break;
                            }
                            Err(std::sync::TryLockError::WouldBlock) => thread::sleep(Duration::from_millis(100)),
                        }
                    }
                }
                if let Some(models) = handle.try_state::<LocalModelManager>() {
                    models.shutdown();
                }
                if let Ok(state) = state_dir(handle) {
                    reap_agent_browsers(&state);
                }
                // the only place the folder lock comes off, since quitting kills the harness outright
                if let Some(lock) = CLAIMED.lock().unwrap_or_else(|e| e.into_inner()).take() {
                    let _ = fs::remove_file(lock);
                }
                // last, so the files the sidecars were holding are closed before the folder goes
                if let Some(folder) = REMOVE_ON_EXIT.lock().unwrap_or_else(|e| e.into_inner()).take() {
                    kill_local_memory_server();
                    let _ = fs::remove_dir_all(folder);
                }
            }
        });
}
