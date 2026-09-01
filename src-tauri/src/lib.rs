mod local_models;
mod process;

use getrandom::fill;
use local_models::{
    cancel_local_model_download, delete_local_model, ensure_local_model, local_model_status,
    start_local_model, stop_local_model, LocalModelManager,
};
use process::{
    available_loopback_port, reap_orphan_llama_servers, reap_orphaned_sidecars, Sidecar,
};
use serde::Serialize;
use std::{
    fmt::Write as _,
    fs,
    net::TcpStream,
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

struct ManagedDsh {
    child: Sidecar,
    temporal: Sidecar,
    runtime_root: PathBuf,
    port: u16,
    token: String,
}

struct DshManager(Mutex<Option<ManagedDsh>>);

static WATCHING_DSH: AtomicBool = AtomicBool::new(false);

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
    let runtime = if packaged.is_dir() { packaged } else { source };
    let entry = runtime
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh")
        .join("lib")
        .join("bin.js");
    if !entry.is_file()
        || !runtime.join("profile").join("package.json").is_file()
        || !runtime.join("profile").join("cordis.patch.yml").is_file()
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
    {
        return Err("The bundled DeepSeek Harness application is missing. Reinstall Bees.".into());
    }
    Ok((node, temporal, runtime))
}

fn copy_profile(runtime: &Path, profile: &Path) -> Result<(), String> {
    fs::create_dir_all(profile).map_err(|error| error.to_string())?;
    for name in ["package.json", "cordis.patch.yml"] {
        fs::copy(runtime.join("profile").join(name), profile.join(name))
            .map_err(|error| error.to_string())?;
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
    let packages = [("@deepseek-ai", "dsh-session-persistence-sqlite")]
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

fn wait_ready(child: &mut Sidecar, url: &str, log: &Path) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(500))
        .build()
        .map_err(|error| error.to_string())?;
    for _ in 0..300 {
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
    let (node, temporal_binary, runtime) = runtime_paths(app)?;
    let manager = app.state::<DshManager>();
    let mut managed = manager.0.lock().map_err(|error| error.to_string())?;
    if let Some(current) = managed.as_mut() {
        if current.runtime_root == runtime && current.child.alive()? && current.temporal.alive()? {
            let base_url = format!("http://127.0.0.1:{}", current.port);
            wait_ready(
                &mut current.child,
                &format!("{base_url}/healthz"),
                &state_dir(app)?.join("runtime.log"),
            )?;
            return Ok(DshRuntimeInfo {
                base_url,
                token: current.token.clone(),
            });
        }
        *managed = None;
    }

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let home = app_data.join("dsh");
    let workspace = app_data.join("workspaces");
    fs::create_dir_all(&workspace).map_err(|error| error.to_string())?;
    prepare_profile(&runtime, &home)?;

    let port = available_loopback_port()?;
    let temporal_port = loop {
        let candidate = available_loopback_port()?;
        if candidate != port {
            break candidate;
        }
    };
    let temporal_address = format!("127.0.0.1:{temporal_port}");
    let secret = token()?;
    let base_url = format!("http://127.0.0.1:{port}");
    let entry = runtime
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh")
        .join("lib")
        .join("bin.js");
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
        .arg(temporal_root.join("processes-v3.db"))
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
        temporal_command
            .spawn()
            .map_err(|error| format!("Temporal could not start: {error}"))?,
    );
    wait_temporal(&mut temporal, &temporal_address, &log_path)?;
    let mut command = Command::new(&node);
    command.env_clear();
    inherit_environment(&mut command, &BASE_ENVIRONMENT);
    inherit_environment(&mut command, &RUNTIME_ENVIRONMENT);
    command
        .current_dir(&workspace)
        .arg(entry)
        .args(["--profile", "bees", "--host", "127.0.0.1", "--port"])
        .arg(port.to_string())
        .arg("--no-open")
        .env("DSH_HOME", &home)
        .env("DSH_TELEMETRY_DISABLED", "1")
        .env("BEES_DSH_TOKEN", &secret)
        .env("BEES_DSH_SESSIONS_PATH", home.join("sessions.sqlite"))
        .env("BEES_DSH_QUERY_PATH", home.join("session-query.sqlite"))
        .env("BEES_DATABASE_PATH", app_data.join("bees-stage1.db"))
        .env("BEES_DEFAULT_WORKSPACE", &workspace)
        .env("BEES_STATE_DIR", state_dir(app)?)
        .env("BEES_RUNTIME_ROOT", &runtime)
        .env("BEES_TEMPORAL_ADDRESS", &temporal_address)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(errors));
    let mut child = Sidecar::new(
        command
            .spawn()
            .map_err(|error| format!("DeepSeek Harness could not start: {error}"))?,
    );
    wait_ready(&mut child, &format!("{base_url}/healthz"), &log_path)?;
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

/// False once the harness sidecar is gone, or once there is nothing left to watch.
fn dsh_alive(app: &tauri::AppHandle) -> bool {
    let Some(state) = app.try_state::<DshManager>() else {
        return false;
    };
    let Ok(mut managed) = state.0.lock() else {
        return false;
    };
    managed
        .as_mut()
        .is_some_and(|dsh| dsh.child.alive().unwrap_or(false))
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
        while dsh_alive(&app) {
            thread::sleep(Duration::from_secs(2));
        }
        let _ = window.navigate(home);
        WATCHING_DSH.store(false, Ordering::SeqCst);
    });
}

#[tauri::command]
async fn ensure_dsh_runtime(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    let home = window.url().map_err(|error| error.to_string())?;
    let handle = app.clone();
    let runtime =
        tauri::async_runtime::spawn_blocking(move || ensure_dsh_runtime_blocking(&handle))
            .await
            .map_err(|error| error.to_string())??;
    let url: tauri::Url = format!("{}/bees-auth?token={}", runtime.base_url, runtime.token)
        .parse()
        .map_err(|error| format!("Could not build the local Bees URL: {error}"))?;
    window
        .navigate(url)
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

/// Closing the window only hides it, so this is how the window comes back: the tray, the dock,
/// and a second launch all route here.
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_main_window(app);
        }));
    }
    builder
        .setup(|app| {
            reap_orphan_llama_servers();
            if let Ok((node, temporal, _)) = runtime_paths(app.handle()) {
                reap_orphaned_sidecars(&node);
                reap_orphaned_sidecars(&temporal);
            }
            app.manage(LocalModelManager::default());
            app.manage(DshManager(Mutex::new(None)));
            build_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Agents keep running with the window shut, so closing it hides the window and leaves
            // the tray as the way back in. Quit from the tray is what actually ends the process.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            ensure_dsh_runtime,
            local_model_status,
            ensure_local_model,
            start_local_model,
            stop_local_model,
            cancel_local_model_download,
            delete_local_model,
            local_model_connection,
            open_external_url
        ])
        .build(tauri::generate_context!())
        .expect("error while running Bees")
        .run(|handle, event| {
            #[cfg(target_os = "macos")]
            if matches!(event, tauri::RunEvent::Reopen { .. }) {
                show_main_window(handle);
            }
            // Tauri exits the process directly on quit, so the children are dropped by hand here.
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(dsh) = handle.try_state::<DshManager>() {
                    if let Ok(mut managed) = dsh.0.lock() {
                        managed.take();
                    }
                }
                if let Some(models) = handle.try_state::<LocalModelManager>() {
                    models.shutdown();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::validated_external_url;

    #[test]
    fn external_links_must_be_secure_websites() {
        assert_eq!(
            validated_external_url(" https://console.x.ai/team/default/api-keys "),
            Ok("https://console.x.ai/team/default/api-keys")
        );
        assert_eq!(
            validated_external_url("http://localhost:3000/api/auth/desktop/start"),
            Ok("http://localhost:3000/api/auth/desktop/start")
        );
        assert_eq!(
            validated_external_url("http://127.0.0.1:3000/callback"),
            Ok("http://127.0.0.1:3000/callback")
        );
        assert!(validated_external_url("http://example.com").is_err());
        assert!(validated_external_url("http://localhost.example.com").is_err());
        assert!(validated_external_url("https://").is_err());
        assert!(validated_external_url("https://example.com\nmalicious").is_err());
    }
}
