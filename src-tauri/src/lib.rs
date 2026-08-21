mod process;

use getrandom::fill;
use process::{available_loopback_port, reap_orphaned_node_sidecars, Sidecar};
use serde::Serialize;
use std::{
    fmt::Write as _,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};
use tauri::Manager;

struct ManagedDsh {
    child: Sidecar,
    runtime_root: PathBuf,
    port: u16,
    token: String,
}

struct DshManager(Mutex<Option<ManagedDsh>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
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
        || !runtime.join("plugin").join("lib").join("index.js").is_file()
    {
        return Err("The bundled DeepSeek Harness application is missing. Reinstall Bees.".into());
    }
    Ok((node, runtime))
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
        return Err(format!("The bundled DSH package {} is missing.", source.display()));
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
    for (scope, package) in [
        ("@deepseek-ai", "dsh-session-persistence-sqlite"),
        ("@bees", "dsh-plugin"),
    ] {
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
            .is_ok_and(|response| response.status().is_success())
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

fn inherit_environment(command: &mut Command) {
    for key in [
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
        "DEEPSEEK_API_KEY",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "GEMINI_API_KEY",
    ] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
}

fn ensure_dsh_runtime_blocking(app: &tauri::AppHandle) -> Result<DshRuntimeInfo, String> {
    let (node, runtime) = runtime_paths(app)?;
    let manager = app.state::<DshManager>();
    let mut managed = manager.0.lock().map_err(|error| error.to_string())?;
    if let Some(current) = managed.as_mut() {
        if current.runtime_root == runtime && current.child.alive()? {
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

    let app_data = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let home = app_data.join("dsh");
    let workspace = app_data.join("workspaces");
    fs::create_dir_all(&workspace).map_err(|error| error.to_string())?;
    prepare_profile(&runtime, &home)?;

    let port = available_loopback_port()?;
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
    let mut command = Command::new(&node);
    command.env_clear();
    inherit_environment(&mut command);
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
        runtime_root: runtime,
        port,
        token: secret.clone(),
    });
    Ok(DshRuntimeInfo {
        base_url,
        token: secret,
    })
}

#[tauri::command]
async fn ensure_dsh_runtime(app: tauri::AppHandle) -> Result<DshRuntimeInfo, String> {
    tauri::async_runtime::spawn_blocking(move || ensure_dsh_runtime_blocking(&app))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();
    #[cfg(all(desktop, not(debug_assertions)))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }
    builder
        .setup(|app| {
            if let Ok((node, _)) = runtime_paths(app.handle()) {
                reap_orphaned_node_sidecars(&node);
            }
            app.manage(DshManager(Mutex::new(None)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ensure_dsh_runtime])
        .run(tauri::generate_context!())
        .expect("error while running Bees");
}
