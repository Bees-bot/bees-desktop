mod process;
mod startup;

use getrandom::fill;
use process::{
    available_loopback_port, reap_agent_browsers, reap_orphaned_sidecars, Sidecar,
};
use serde::{Deserialize, Serialize};
use std::{
    fmt::Write as _,
    fs,
    net::TcpListener,
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
use tauri_plugin_updater::UpdaterExt;

struct ManagedDsh {
    child: Sidecar,
    runtime_root: PathBuf,
    port: u16,
    token: String,
}

struct DshManager(Mutex<Option<ManagedDsh>>);

static WATCHING_DSH: AtomicBool = AtomicBool::new(false);
static QUIT_PENDING: AtomicBool = AtomicBool::new(false);
static QUIT_CONFIRMED: AtomicBool = AtomicBool::new(false);
static UPDATING: AtomicBool = AtomicBool::new(false);

struct DshRuntimeInfo {
    base_url: String,
    token: String,
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

fn runtime_paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
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
    Ok((node, runtime))
}

/// The profile's own patch document, owned by DSH's settings layer.
const USER_OVERLAY_NAME: &str = "cordis.patch.yml";
/// Empty user overlay, the shape DSH writes back to.
const EMPTY_OVERLAY: &str = "[]\n";

fn copy_profile(runtime: &Path, profile: &Path) -> Result<(), String> {
    fs::create_dir_all(profile).map_err(|error| error.to_string())?;
    fs::copy(runtime.join("profile").join("package.json"), profile.join("package.json"))
        .map_err(|error| error.to_string())?;
    let user = profile.join(USER_OVERLAY_NAME);
    if !user.exists() {
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
const BEES_PLUGINS: [&str; 3] = [
    "dsh-plugin",
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

/// Model credentials, only for the runtime that talks to a model.
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
    if !execution_preferences(app.clone())?.allow_local_execution {
        return Err("Local execution is disabled on this computer.".to_string());
    }
    let _startup = startup::start("runtime.ensure");
    let (node, runtime) = startup::step("runtime.paths", || runtime_paths(app))?;
    let manager = app.state::<DshManager>();
    let mut managed = startup::step("runtime.manager-lock", || manager.0.lock())
        .map_err(|error| error.to_string())?;
    if let Some(current) = managed.as_mut() {
        if current.runtime_root == runtime && current.child.alive()? {
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
    let workspace = app_data.join("workspaces");
    fs::create_dir_all(&workspace).map_err(|error| error.to_string())?;
    startup::step("runtime.profile.prepare", || prepare_profile(&runtime, &home))?;

    let port = stable_loopback_port(app)?;
    let secret = token()?;
    let base_url = format!("http://127.0.0.1:{port}");
    let entry = runtime.join("start.mjs");
    let (log, log_path) = open_log(app)?;
    let errors = log.try_clone().map_err(|error| error.to_string())?;
    let mut command = Command::new(&node);
    command.env_clear();
    inherit_environment(&mut command, &BASE_ENVIRONMENT);
    inherit_environment(&mut command, &RUNTIME_ENVIRONMENT);
    command.env("BEES_ACCOUNT_API_URL", std::env::var("BEES_ACCOUNT_API_URL").unwrap_or_else(|_| {
        if cfg!(debug_assertions) { "http://127.0.0.1:3000" } else { "https://app.bees.bot" }.to_string()
    }));
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
        .env("BEES_FLEET_JOB", "client")
        .env("BEES_DEFAULT_WORKSPACE", &workspace)
        .env("BEES_STATE_DIR", state_dir(app)?)
        .env("BEES_STARTUP_LOG", state_dir(app)?.join("startup.log"))
        .env("BEES_RUNTIME_ROOT", &runtime)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(errors));
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

#[derive(Serialize, Deserialize)]
struct ExecutionPreferences {
    mode: String,
    cloud_url: String,
    allow_local_execution: bool,
}

#[tauri::command]
fn execution_preferences(app: tauri::AppHandle) -> Result<ExecutionPreferences, String> {
    let path = state_dir(&app)?.join("execution.json");
    match fs::read_to_string(path) {
        Ok(value) => serde_json::from_str(&value).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(ExecutionPreferences {
            mode: "local".to_string(), cloud_url: "https://app.bees.bot/app".to_string(), allow_local_execution: true,
        }),
        Err(e) => Err(e.to_string()),
    }
}

fn cloud_url(value: &str) -> Result<tauri::Url, String> {
    let url: tauri::Url = value.parse().map_err(|_| "Enter a valid Bees Cloud URL".to_string())?;
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1"));
    if !(url.scheme() == "https" || (url.scheme() == "http" && loopback)) ||
        !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err("Use an HTTPS Bees Cloud URL, or a loopback development server".to_string());
    }
    Ok(url)
}

#[tauri::command]
fn set_execution_preferences(app: tauri::AppHandle, preferences: ExecutionPreferences) -> Result<(), String> {
    if !matches!(preferences.mode.as_str(), "local" | "cloud" | "choose") {
        return Err("Choose local or cloud execution".to_string());
    }
    cloud_url(&preferences.cloud_url)?;
    if preferences.mode == "local" && !preferences.allow_local_execution {
        return Err("Enable this computer to use private local mode".to_string());
    }
    if !preferences.allow_local_execution && app.state::<DshManager>().0.lock().map_err(|e| e.to_string())?.is_some() {
        return Err("Quit Bees before disabling a running local engine".to_string());
    }
    let path = state_dir(&app)?.join("execution.json");
    fs::write(path, serde_json::to_vec(&preferences).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_cloud(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    let preferences = execution_preferences(app.clone())?;
    if preferences.mode != "cloud" { return Err("Select cloud mode first".to_string()); }
    window.navigate(cloud_url(&preferences.cloud_url)?).map_err(|e| e.to_string())
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
    let execution = MenuItem::with_id(app, "execution", "Execution settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Bees", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &execution, &quit])?;
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
            "execution" => {
                if quit_allowed(app, "change execution settings") {
                    if let Ok(mut preferences) = execution_preferences(app.clone()) {
                        preferences.mode = "choose".to_string();
                        if set_execution_preferences(app.clone(), preferences).is_ok() { app.restart(); }
                    }
                }
            },
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

/// An unavailable run count is not an idle run. Blocks on the network and a dialog, so keep it off the main thread.
fn quit_allowed(app: &tauri::AppHandle, action: &str) -> bool {
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
        return true;
    }
    let detail = count.map_or_else(
        || "Bees could not check whether work is still active.".to_string(),
        |count| format!("Bees has {count} active or queued run(s)."),
    );
    app.dialog().message(format!("{detail} This interrupts work and stops local schedules until Bees opens again."))
        .title(format!("{action}?"))
        .buttons(MessageDialogButtons::OkCancelCustom(action.into(), "Keep working".into()))
        .blocking_show()
}

fn confirm_quit(app: tauri::AppHandle, exit_code: i32) {
    if QUIT_PENDING.swap(true, Ordering::SeqCst) {
        return;
    }
    thread::spawn(move || {
        if quit_allowed(&app, "Quit Bees") {
            QUIT_CONFIRMED.store(true, Ordering::SeqCst);
            app.exit(exit_code);
        }
        QUIT_PENDING.store(false, Ordering::SeqCst);
    });
}

#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<Option<String>, String> {
    // a dev build or a copy run from the disk image has no app folder the updater can replace
    if cfg!(debug_assertions) || std::env::current_exe().is_ok_and(|exe| { let path = exe.to_string_lossy(); path.starts_with("/Volumes/Bees") || path.contains("/AppTranslocation/") }) {
        return Ok(None);
    }
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    Ok(update.map(|update| update.version))
}

/// Asks about active runs once downloaded, since installing swaps the files the running app serves.
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<bool, String> {
    if UPDATING.swap(true, Ordering::SeqCst) {
        return Ok(false);
    }
    let result = install(&app).await;
    if !matches!(result, Ok(true)) {
        UPDATING.store(false, Ordering::SeqCst);
    }
    result
}

async fn install(app: &tauri::AppHandle) -> Result<bool, String> {
    // windows installs by exiting the process outright, which skips RunEvent::Exit
    let handle = app.clone();
    let update = app.updater_builder().on_before_exit(move || { shutdown(&handle); handle.cleanup_before_exit(); }).build().map_err(|e| e.to_string())?
        .check().await.map_err(|e| e.to_string())?
        .ok_or("Bees is already up to date.")?;
    let bytes = update.download(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    let asked = app.clone();
    if !tauri::async_runtime::spawn_blocking(move || quit_allowed(&asked, "Update and restart")).await.map_err(|e| e.to_string())? {
        return Ok(false);
    }
    let installed = update.install(bytes);
    // a failed installer launch on windows comes after the engine stopped, so restart either way
    if installed.is_ok() || cfg!(windows) {
        QUIT_CONFIRMED.store(true, Ordering::SeqCst);
        app.request_restart();
    }
    installed.map(|_| true).map_err(|e| e.to_string())
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
    builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build());
    builder
        .setup(|app| {
            if let Ok(state) = state_dir(app.handle()) {
                startup::open(&state.join("startup.log"));
            }
            let _setup = startup::start("native.setup");
            if let Ok((node, _)) =
                startup::step("native.runtime-paths", || runtime_paths(app.handle()))
            {
                startup::step("native.reap-node", || reap_orphaned_sidecars(&node));
            }
            if let Ok(state) = state_dir(app.handle()) {
                startup::step("native.reap-browser", || reap_agent_browsers(&state));
            }
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
            execution_preferences,
            set_execution_preferences,
            open_cloud,
            ensure_dsh_runtime,
            open_external_url,
            check_for_update,
            install_update
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
                shutdown(handle);
            }
        });
}

fn shutdown(handle: &tauri::AppHandle) {
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
    if let Ok(state) = state_dir(handle) {
        reap_agent_browsers(&state);
    }
}
