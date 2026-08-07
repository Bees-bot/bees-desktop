mod local_models;
mod process;
mod processes;
mod runs;

use base64::{
    engine::general_purpose::{STANDARD as BASE64, URL_SAFE_NO_PAD},
    Engine as _,
};
use local_models::{
    cancel_local_model_download, delete_local_model, ensure_local_model, local_model_routes,
    local_model_status, reap_orphan_llama_servers, start_local_model, stop_local_model,
    LocalModelManager,
};
use processes::software_project::{
    software_project_commit, software_project_get, software_project_merge,
    software_project_select_folder, software_project_snapshot, software_project_workspace,
};
use runs::{resume_run, run_is_active, start_run, stop_run, RunService};
use rusqlite::{
    params_from_iter, types::Value as SqlValue, Connection, OpenFlags, OptionalExtension,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value as JsonValue};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fmt::Write as _,
    fs,
    net::TcpListener,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};
use tauri::{Manager, State};

use crate::process::{available_loopback_port, bind_loopback, Sidecar};

struct Database(Mutex<Connection>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OutputPreview {
    before: Option<String>,
    after: Option<String>,
    truncated: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryCapabilityFile {
    #[serde(rename = "ref")]
    capability_ref: String,
    registry_id: String,
    path: String,
    kind: String,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillSnapshotFile {
    encoding: String,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillSnapshot {
    #[serde(rename = "ref")]
    capability_ref: String,
    name: String,
    description: String,
    instructions: String,
    files: BTreeMap<String, SkillSnapshotFile>,
}

/// Holds the loopback listener between `oauth_start` (bind) and `oauth_await` (capture),
/// so browser-based social sign-in can hand the session token back over plain http —
/// no custom URL scheme, which does not work under `tauri dev`.
struct OAuth(Mutex<Option<TcpListener>>);

const CREDENTIAL_SERVICE: &str = "bot.bees.desktop.connections";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OAuthCredential {
    access_token: String,
    refresh_token: Option<String>,
    expires_at: Option<u64>,
    token_url: String,
    client_id: String,
    client_secret: Option<String>,
    revocation_url: Option<String>,
}

struct PendingConnectionOAuth {
    listener: TcpListener,
    state: String,
    verifier: String,
    token_url: String,
    client_id: String,
    client_secret: Option<String>,
    revocation_url: Option<String>,
    secret_ref: String,
    redirect_uri: String,
}

struct ConnectionOAuth(Mutex<Option<PendingConnectionOAuth>>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionOAuthRequest {
    authorization_url: String,
    token_url: String,
    client_id: String,
    client_secret: Option<String>,
    revocation_url: Option<String>,
    scopes: String,
    secret_ref: String,
}

#[derive(Clone)]
struct CredentialBroker {
    url: String,
    token: String,
}

fn vault_entry(secret_ref: &str) -> Result<keyring::Entry, String> {
    let secret_ref = safe_identifier(secret_ref, "credential reference")?;
    keyring::Entry::new(CREDENTIAL_SERVICE, &secret_ref).map_err(|error| error.to_string())
}

fn write_secret(secret_ref: &str, secret: &str) -> Result<(), String> {
    if secret.is_empty() || secret.len() > 128_000 {
        return Err("credential must be between 1 byte and 128 KB".into());
    }
    vault_entry(secret_ref)?
        .set_password(secret)
        .map_err(|error| error.to_string())
}

fn credential_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn store_connection_secret(secret_ref: String, secret: String) -> Result<(), String> {
    write_secret(&secret_ref, &secret)
}

#[tauri::command]
fn delete_connection_secret(secret_ref: String) -> Result<Option<String>, String> {
    let entry = vault_entry(&secret_ref)?;
    let warning = entry
        .get_password()
        .ok()
        .and_then(|stored| serde_json::from_str::<OAuthCredential>(&stored).ok())
        .and_then(|credential| {
            let url = credential.revocation_url?;
            let token = credential.refresh_token.as_deref().unwrap_or(&credential.access_token);
            let mut form = vec![("token", token), ("client_id", credential.client_id.as_str())];
            if let Some(secret) = credential.client_secret.as_deref() {
                form.push(("client_secret", secret));
            }
            match credential_client().and_then(|client| {
                client.post(url).form(&form).send().map_err(|error| error.to_string())
            }) {
                Ok(response) if response.status().is_success() => None,
                _ => Some(
                    "The local credential was deleted, but remote revocation could not be confirmed. Revoke Bees in the provider too."
                        .to_string(),
                ),
            }
        });
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(warning),
        Err(error) => Err(error.to_string()),
    }
}

fn epoch_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
}

fn refresh_oauth(secret_ref: &str, credential: &mut OAuthCredential) -> Result<(), String> {
    let refresh = credential
        .refresh_token
        .as_deref()
        .ok_or_else(|| "The OAuth connection must be authorized again".to_string())?;
    let mut form = vec![
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh),
        ("client_id", credential.client_id.as_str()),
    ];
    if let Some(secret) = credential.client_secret.as_deref() {
        form.push(("client_secret", secret));
    }
    let response = credential_client()?
        .post(&credential.token_url)
        .form(&form)
        .send()
        .map_err(|error| format!("OAuth refresh failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("OAuth refresh failed: HTTP {}", response.status()));
    }
    let token: TokenResponse = response.json().map_err(|error| error.to_string())?;
    credential.access_token = token.access_token;
    if token.refresh_token.is_some() {
        credential.refresh_token = token.refresh_token;
    }
    credential.expires_at = token.expires_in.map(|seconds| epoch_seconds() + seconds);
    write_secret(
        secret_ref,
        &serde_json::to_string(credential).map_err(|error| error.to_string())?,
    )
}

fn connection_token(secret_ref: &str) -> Result<String, String> {
    let stored = vault_entry(secret_ref)?
        .get_password()
        .map_err(|error| error.to_string())?;
    let Ok(mut oauth) = serde_json::from_str::<OAuthCredential>(&stored) else {
        return Ok(stored);
    };
    if oauth
        .expires_at
        .is_some_and(|expires| expires <= epoch_seconds() + 60)
    {
        refresh_oauth(secret_ref, &mut oauth)?;
    }
    Ok(oauth.access_token)
}

struct BrokerSecretRequest {
    secret_ref: String,
    team_id: String,
    connection_id: String,
    execution_id: Option<String>,
    discovery: bool,
}

fn broker_secret_request(path: &str) -> Result<BrokerSecretRequest, String> {
    let url = reqwest::Url::parse(&format!("http://127.0.0.1{path}"))
        .map_err(|_| "forbidden".to_string())?;
    let secret_ref = url
        .path()
        .strip_prefix("/secrets/")
        .ok_or_else(|| "forbidden".to_string())?;
    let params = url
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<BTreeMap<_, _>>();
    let team_id = params.get("teamId").ok_or("forbidden")?.to_owned();
    let connection_id = params.get("connectionId").ok_or("forbidden")?.to_owned();
    let execution_id = params.get("executionId").cloned();
    Ok(BrokerSecretRequest {
        secret_ref: safe_identifier(secret_ref, "credential reference")?,
        team_id: safe_identifier(&team_id, "team ID")?,
        connection_id: safe_identifier(&connection_id, "connection ID")?,
        discovery: params.get("purpose").map(String::as_str) == Some("discovery")
            && execution_id.is_none(),
        execution_id: execution_id
            .map(|value| safe_identifier(&value, "execution ID"))
            .transpose()?,
    })
}

fn json_connection_matches(
    value: &JsonValue,
    team_id: Option<&str>,
    connection_id: &str,
    secret_ref: &str,
) -> bool {
    value.as_array().is_some_and(|connections| {
        connections.iter().any(|connection| {
            json_text(connection, "id") == connection_id
                && team_id.is_none_or(|team| json_text(connection, "teamId") == team)
                && json_text(connection, "secretRef") == secret_ref
        })
    })
}

fn json_text<'a>(value: &'a JsonValue, key: &str) -> &'a str {
    value
        .get(key)
        .and_then(JsonValue::as_str)
        .unwrap_or_default()
}

fn broker_authorized(database_path: &Path, request: &BrokerSecretRequest) -> Result<(), String> {
    let connection = Connection::open_with_flags(database_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| "forbidden".to_string())?;
    let stored: Option<String> = connection
        .query_row(
            "SELECT value_json FROM settings WHERE key = ?1",
            [format!("mcp_connections:{}", request.team_id)],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "forbidden".to_string())?;
    let catalog = stored
        .as_deref()
        .and_then(|value| serde_json::from_str(value).ok())
        .unwrap_or(JsonValue::Null);
    if !json_connection_matches(
        &catalog,
        Some(&request.team_id),
        &request.connection_id,
        &request.secret_ref,
    ) {
        return Err("forbidden".into());
    }
    if request.discovery {
        return Ok(());
    }
    let execution_id = request.execution_id.as_deref().ok_or("forbidden")?;
    let result: Option<String> = connection
        .query_row(
            "SELECT result_json FROM executions WHERE id = ?1 AND status IN ('queued', 'running')",
            [execution_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "forbidden".to_string())?
        .flatten();
    let seed = result
        .as_deref()
        .and_then(|value| serde_json::from_str::<JsonValue>(value).ok())
        .and_then(|value| value.get("initialData").cloned())
        .ok_or("forbidden")?;
    let selected = seed.get("mcpConnections").ok_or("forbidden")?;
    let has_granted_tools = selected.as_array().is_some_and(|connections| {
        connections.iter().any(|connection| {
            json_text(connection, "id") == request.connection_id
                && json_text(connection, "secretRef") == request.secret_ref
                && connection
                    .get("tools")
                    .and_then(JsonValue::as_array)
                    .is_some_and(|tools| !tools.is_empty())
        })
    });
    if json_text(&seed, "teamId") != request.team_id
        || !has_granted_tools
        || !json_connection_matches(selected, None, &request.connection_id, &request.secret_ref)
    {
        return Err("forbidden".into());
    }
    Ok(())
}

fn start_credential_broker(database_path: PathBuf) -> Result<CredentialBroker, String> {
    use std::io::{Read, Write};
    let (listener, port) = bind_loopback()?;
    let token = loopback_token()?;
    let expected = token.clone();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut bytes = [0u8; 8192];
            let length = stream.read(&mut bytes).unwrap_or(0);
            let request = String::from_utf8_lossy(&bytes[..length]);
            let mut lines = request.lines();
            let path = lines
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .unwrap_or("");
            let authorized = lines.any(|line| {
                line.eq_ignore_ascii_case(&format!("Authorization: Bearer {expected}"))
            });
            let result = authorized
                .then_some(())
                .ok_or_else(|| "unauthorized".to_string())
                .and_then(|()| broker_secret_request(path))
                .and_then(|request| {
                    broker_authorized(&database_path, &request)?;
                    connection_token(&request.secret_ref)
                });
            let (status, body) = match result {
                Ok(value) => ("200 OK", serde_json::json!({ "token": value }).to_string()),
                Err(error) if error == "unauthorized" => {
                    ("401 Unauthorized", "{\"error\":\"unauthorized\"}".into())
                }
                Err(error) if error == "forbidden" => {
                    ("403 Forbidden", "{\"error\":\"forbidden\"}".into())
                }
                Err(_) => (
                    "404 Not Found",
                    "{\"error\":\"credential unavailable\"}".into(),
                ),
            };
            let response = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
        }
    });
    Ok(CredentialBroker {
        url: format!("http://127.0.0.1:{port}"),
        token,
    })
}

#[tauri::command]
fn oauth_start(state: State<OAuth>) -> Result<u16, String> {
    // Port 0: the browser is handed whichever ephemeral port the OS gives us.
    let (listener, port) = bind_loopback()?;
    *state.0.lock().map_err(|e| e.to_string())? = Some(listener);
    Ok(port)
}

#[tauri::command]
async fn oauth_await(state: State<'_, OAuth>) -> Result<String, String> {
    let listener = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or("no sign-in in progress")?;
    tauri::async_runtime::spawn_blocking(move || wait_for_oauth_callback(listener))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn connection_oauth_start(
    state: State<'_, ConnectionOAuth>,
    request: ConnectionOAuthRequest,
) -> Result<String, String> {
    safe_identifier(&request.secret_ref, "credential reference")?;
    let (listener, port) = bind_loopback()?;
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");
    let state_value = loopback_token()?;
    let verifier = loopback_token()?;
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut url =
        reqwest::Url::parse(&request.authorization_url).map_err(|error| error.to_string())?;
    if url.scheme() != "https" {
        return Err("OAuth authorization URLs must use HTTPS".into());
    }
    let token = reqwest::Url::parse(&request.token_url).map_err(|error| error.to_string())?;
    if token.scheme() != "https" {
        return Err("OAuth token URLs must use HTTPS".into());
    }
    let revocation_url = request
        .revocation_url
        .filter(|value| !value.trim().is_empty())
        .map(|value| -> Result<String, String> {
            let url = reqwest::Url::parse(&value).map_err(|error| error.to_string())?;
            if url.scheme() != "https" {
                return Err("OAuth revocation URLs must use HTTPS".into());
            }
            Ok(url.to_string())
        })
        .transpose()?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &request.client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("state", &state_value)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256");
    if !request.scopes.trim().is_empty() {
        url.query_pairs_mut()
            .append_pair("scope", request.scopes.trim());
    }
    *state.0.lock().map_err(|error| error.to_string())? = Some(PendingConnectionOAuth {
        listener,
        state: state_value,
        verifier,
        token_url: request.token_url,
        client_id: request.client_id,
        client_secret: request.client_secret.filter(|value| !value.is_empty()),
        revocation_url,
        secret_ref: request.secret_ref,
        redirect_uri,
    });
    Ok(url.to_string())
}

#[tauri::command]
async fn connection_oauth_await(state: State<'_, ConnectionOAuth>) -> Result<(), String> {
    let pending = state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .take()
        .ok_or("no connection authorization in progress")?;
    tauri::async_runtime::spawn_blocking(move || {
        let query = wait_for_oauth_callback(pending.listener)?;
        let callback = reqwest::Url::parse(&format!("http://localhost/?{query}"))
            .map_err(|error| error.to_string())?;
        let values = callback.query_pairs().collect::<BTreeMap<_, _>>();
        if values.get("state").map(|value| value.as_ref()) != Some(pending.state.as_str()) {
            return Err("OAuth state did not match".into());
        }
        let code = values
            .get("code")
            .map(|value| value.as_ref())
            .ok_or("OAuth returned no authorization code")?;
        let mut form = vec![
            ("grant_type", "authorization_code"),
            ("code", code),
            ("client_id", pending.client_id.as_str()),
            ("redirect_uri", pending.redirect_uri.as_str()),
            ("code_verifier", pending.verifier.as_str()),
        ];
        if let Some(secret) = pending.client_secret.as_deref() {
            form.push(("client_secret", secret));
        }
        let response = credential_client()?
            .post(&pending.token_url)
            .form(&form)
            .send()
            .map_err(|error| format!("OAuth token exchange failed: {error}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "OAuth token exchange failed: HTTP {}",
                response.status()
            ));
        }
        let token: TokenResponse = response.json().map_err(|error| error.to_string())?;
        let credential = OAuthCredential {
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            expires_at: token.expires_in.map(|seconds| epoch_seconds() + seconds),
            token_url: pending.token_url,
            client_id: pending.client_id,
            client_secret: pending.client_secret,
            revocation_url: pending.revocation_url,
        };
        write_secret(
            &pending.secret_ref,
            &serde_json::to_string(&credential).map_err(|error| error.to_string())?,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Accept one loopback request and return its raw query string (without the leading
/// `?`). Callers parse whatever they need — `token` for social sign-in, `code`+`state`
/// for OAuth authorization-code flows.
fn wait_for_oauth_callback(listener: TcpListener) -> Result<String, String> {
    use std::io::{Read, Write};
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = std::time::Instant::now() + Duration::from_secs(300);
    loop {
        if std::time::Instant::now() > deadline {
            return Err("timed out waiting for browser sign-in".into());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]);
                let path = request
                    .lines()
                    .next()
                    .unwrap_or("")
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or("");
                let query = path.split_once('?').map(|(_, q)| q.to_string());
                // Success = a token or an authorization code came back (not an ?error=).
                let ok = query
                    .as_deref()
                    .map(|q| (q.contains("token=") || q.contains("code=")) && !q.contains("error="))
                    .unwrap_or(false);
                let body = if ok {
                    "<html><body style='font-family:system-ui;text-align:center;margin-top:4rem'><h3>Signed in</h3><p>You can close this tab and return to Bees.</p></body></html>"
                } else {
                    "<html><body style='font-family:system-ui;text-align:center;margin-top:4rem'><h3>Sign-in failed</h3><p>Return to Bees and try again.</p></body></html>"
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
                return if ok {
                    Ok(query.unwrap_or_default())
                } else {
                    Err("sign-in was cancelled".into())
                };
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(150));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

struct ManagedFlue {
    child: Sidecar,
    capability_child: Sidecar,
    project_root: PathBuf,
    port: u16,
    token: String,
    capability_port: u16,
    capability_token: String,
    /// The local models that were up, with the window each was started with. Ordered so a
    /// model starting, stopping, or coming back with a different window compares unequal and
    /// forces a restart — the runtime reads both once, at boot.
    local_routes: BTreeMap<String, local_models::LocalModelRoute>,
    /// Provider credentials the running child was started with. Ordered so a changed
    /// connection compares unequal and forces a restart — the process reads its keys once.
    provider_env: BTreeMap<String, String>,
}

struct FlueManager(Mutex<Option<ManagedFlue>>);

struct ManagedKnowledgeWorker {
    child: Sidecar,
    source_fingerprint: String,
    url: String,
    tokens_by_team: BTreeMap<String, String>,
}

struct KnowledgeWorkerManager(Mutex<Option<ManagedKnowledgeWorker>>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DbStatement {
    sql: String,
    #[serde(default)]
    params: Vec<JsonValue>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FlueRuntimeInfo {
    base_url: String,
    /// Per-launch bearer for the agent mount. Binding to loopback is not a boundary: any
    /// local process can otherwise read a conversation, send work, or abort a run. Handed to
    /// the webview client only, never persisted and never logged.
    token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KnowledgeRuntimeInfo {
    url: String,
    token: String,
    source_count: usize,
}

/// 32 bytes of OS entropy, hex encoded.
fn loopback_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
    let mut token = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(token, "{byte:02x}").map_err(|error| error.to_string())?;
    }
    Ok(token)
}

fn bundled_knowledge_worker(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let packaged = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("knowledge-worker");
    let source = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("services")
        .join("knowledge-worker");
    let worker = if packaged.is_dir() { packaged } else { source };
    if !worker
        .join("bees_knowledge_worker")
        .join("__main__.py")
        .is_file()
    {
        return Err("The Bees knowledge worker is missing. Reinstall Bees.".into());
    }
    Ok(worker)
}

fn knowledge_state_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("knowledge");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn knowledge_log_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(knowledge_state_dir(app)?.join("worker.log"))
}

struct LocalKnowledgeConfiguration {
    sources: Vec<JsonValue>,
    source_ids_by_team: BTreeMap<String, Vec<String>>,
    tokens_by_team: BTreeMap<String, String>,
}

fn local_knowledge_configuration(
    app: &tauri::AppHandle,
    organization_id: &str,
    team_id: &str,
) -> Result<LocalKnowledgeConfiguration, String> {
    safe_identifier(organization_id, "organization ID")?;
    safe_identifier(team_id, "team ID")?;
    let database = app.state::<Database>();
    let connection = database.0.lock().map_err(|error| error.to_string())?;
    let belongs: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM teams WHERE id = ?1 AND organization_id = ?2 AND archived_at IS NULL)",
            [team_id, organization_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !belongs {
        return Err("The active team does not belong to this organization".into());
    }
    let team_ids = {
        let mut statement = connection
            .prepare(
                "SELECT id FROM teams
                 WHERE organization_id = ?1 AND archived_at IS NULL
                 ORDER BY id",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([organization_id], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?
    };
    let mut statement = connection
        .prepare(
            "SELECT l.id, l.team_id, l.name, m.local_path
             FROM file_locations l
             JOIN file_location_mappings m ON m.location_id = l.id AND m.missing = 0
             WHERE l.organization_id = ?1 AND l.deleted_at IS NULL
             ORDER BY l.id",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([organization_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    let mut sources = Vec::new();
    let mut source_scopes = Vec::new();
    for row in rows {
        let (id, source_team_id, name, local_path) = row.map_err(|error| error.to_string())?;
        let Ok(path) = canonical_directory(&local_path) else {
            continue;
        };
        source_scopes.push((id.clone(), source_team_id.clone()));
        sources.push(serde_json::json!({
            "id": id,
            "organizationId": organization_id,
            "teamId": source_team_id,
            "name": name,
            "path": path,
            "enabled": true
        }));
    }
    let mut source_ids_by_team = BTreeMap::new();
    let mut tokens_by_team = BTreeMap::new();
    for authorized_team_id in team_ids {
        let source_ids = source_scopes
            .iter()
            .filter(|(_, source_team_id)| {
                source_team_id
                    .as_deref()
                    .is_none_or(|source_team_id| source_team_id == authorized_team_id)
            })
            .map(|(source_id, _)| source_id.clone())
            .collect::<Vec<_>>();
        if source_ids.is_empty() {
            continue;
        }
        let stored: Option<String> = connection
            .query_row(
                "SELECT value_json FROM settings WHERE key = ?1",
                [format!("mcp_connections:{authorized_team_id}")],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let secret_ref = stored
            .as_deref()
            .and_then(|value| serde_json::from_str::<Vec<JsonValue>>(value).ok())
            .and_then(|connections| {
                connections.into_iter().find_map(|connection| {
                    (json_text(&connection, "id") == "knowledge")
                        .then(|| json_text(&connection, "secretRef").to_string())
                })
            });
        let token = match secret_ref
            .as_deref()
            .and_then(|secret_ref| connection_token(secret_ref).ok())
        {
            Some(token) => token,
            None => loopback_token()?,
        };
        source_ids_by_team.insert(authorized_team_id.clone(), source_ids);
        tokens_by_team.insert(authorized_team_id, token);
    }
    if !source_ids_by_team.contains_key(team_id) {
        return Err("Link at least one available organization or team folder before enabling local knowledge".into());
    }
    Ok(LocalKnowledgeConfiguration {
        sources,
        source_ids_by_team,
        tokens_by_team,
    })
}

// spawn_blocking: importing the embedding runtime and loading its model can take seconds.
#[tauri::command]
async fn ensure_knowledge_worker(
    app: tauri::AppHandle,
    organization_id: String,
    team_id: String,
) -> Result<KnowledgeRuntimeInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_knowledge_worker_blocking(&app, &organization_id, &team_id)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn ensure_knowledge_worker_blocking(
    app: &tauri::AppHandle,
    organization_id: &str,
    team_id: &str,
) -> Result<KnowledgeRuntimeInfo, String> {
    let local = local_knowledge_configuration(app, organization_id, team_id)?;
    let source_count = local.source_ids_by_team[team_id].len();
    let source_bytes = serde_json::to_vec(&serde_json::json!({
        "sources": &local.sources,
        "sourceIdsByTeam": &local.source_ids_by_team,
    }))
    .map_err(|error| error.to_string())?;
    let source_fingerprint = format!("{:x}", Sha256::digest(&source_bytes));
    let manager = app.state::<KnowledgeWorkerManager>();
    let mut managed = manager.0.lock().map_err(|error| error.to_string())?;
    if let Some(worker) = managed.as_mut() {
        if worker.child.alive()? && worker.source_fingerprint == source_fingerprint {
            return Ok(KnowledgeRuntimeInfo {
                url: worker.url.clone(),
                token: worker.tokens_by_team[team_id].clone(),
                source_count,
            });
        }
        *managed = None;
    }

    let python = resolve_cli("python3").ok_or_else(|| {
        "Python 3 is required for local knowledge. Install Python 3 and the knowledge-worker dependencies."
            .to_string()
    })?;
    let worker_root = bundled_knowledge_worker(app)?;
    let mut dependency_check = Command::new(&python);
    dependency_check.env_clear();
    inherit_runtime_environment(&mut dependency_check);
    let dependencies_ready = dependency_check
        .args([
            "-c",
            "import llama_index.core; import llama_index.embeddings.huggingface",
        ])
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if !dependencies_ready {
        return Err(
            "Local knowledge dependencies are missing. Install the bees-knowledge-worker package for this Bees build."
                .into(),
        );
    }
    let state = knowledge_state_dir(app)?;
    let config_path = state.join("config.json");
    let token = local.tokens_by_team[team_id].clone();
    let token_scopes = local
        .source_ids_by_team
        .iter()
        .map(|(authorized_team_id, source_ids)| {
            let digest = format!(
                "{:x}",
                Sha256::digest(local.tokens_by_team[authorized_team_id].as_bytes())
            );
            serde_json::json!({
                "tokenSha256": digest,
                "organizationId": organization_id,
                "teamId": authorized_team_id,
                "sourceIds": source_ids
            })
        })
        .collect::<Vec<_>>();
    let config = serde_json::json!({
        "indexRoot": state.join("indexes"),
        "rebuildIntervalHours": 24,
        "sources": local.sources,
        "tokens": token_scopes
    });
    write_atomic(
        &config_path,
        &serde_json::to_vec_pretty(&config).map_err(|error| error.to_string())?,
    )?;
    let port = 18788;
    let health_url = format!("http://127.0.0.1:{port}/health");
    let url = format!("http://127.0.0.1:{port}/mcp");
    let log_path = knowledge_log_path(app)?;
    let log = open_rotating_log(&log_path)?;
    let errors = log.try_clone().map_err(|error| error.to_string())?;
    let mut command = Command::new(python);
    command.env_clear();
    inherit_runtime_environment(&mut command);
    let mut child = Sidecar::new(
        command
            .current_dir(&worker_root)
            .arg("-m")
            .arg("bees_knowledge_worker")
            .arg("serve")
            .arg("--config")
            .arg(&config_path)
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(port.to_string())
            .env("PYTHONPATH", &worker_root)
            .stdin(Stdio::null())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(errors))
            .spawn()
            .map_err(|error| format!("The local knowledge worker could not start: {error}"))?,
    );
    wait_until_ready(
        &mut child,
        &health_url,
        &log_path,
        "The local knowledge worker",
    )?;
    *managed = Some(ManagedKnowledgeWorker {
        child,
        source_fingerprint,
        url: url.clone(),
        tokens_by_team: local.tokens_by_team,
    });
    Ok(KnowledgeRuntimeInfo {
        url,
        token,
        source_count,
    })
}

fn inherit_runtime_environment(command: &mut Command) {
    for key in [
        "PATH",
        "HOME",
        "USER",
        "LOGNAME",
        "SHELL",
        "LANG",
        "LC_ALL",
        "TMPDIR",
        "TEMP",
        "TMP",
        "SystemRoot",
        "WINDIR",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "XDG_CACHE_HOME",
        "XDG_RUNTIME_DIR",
        "DISPLAY",
        "WAYLAND_DISPLAY",
        "XAUTHORITY",
        "DBUS_SESSION_BUS_ADDRESS",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "NODE_EXTRA_CA_CERTS",
    ] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
}

fn bundled_flue_paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
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
    let project = bundled_flue_project(app)?;
    if !project.join("start.mjs").is_file()
        || !project.join("capability-server.mjs").is_file()
        || !project.join("dist").join("app.mjs").is_file()
    {
        return Err("The bundled Flue application is missing. Reinstall Bees.".into());
    }
    Ok((node, project))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredAiConnection {
    provider: String,
    secret_ref: String,
}

fn provider_environment(
    app: &tauri::AppHandle,
    organization_id: &str,
) -> Result<BTreeMap<String, String>, String> {
    let database = app.state::<Database>();
    let connection = database.0.lock().map_err(|error| error.to_string())?;
    let value: Option<String> = connection
        .query_row(
            "SELECT value_json FROM settings WHERE key = ?1",
            [format!("ai_connections:{organization_id}")],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let connections = value
        .as_deref()
        .and_then(|value| serde_json::from_str::<Vec<StoredAiConnection>>(value).ok())
        .unwrap_or_default();
    let mut environment = BTreeMap::new();
    for stored in connections {
        let variable = match stored.provider.as_str() {
            "anthropic" => "ANTHROPIC_API_KEY",
            "openai" => "OPENAI_API_KEY",
            "openrouter" => "OPENROUTER_API_KEY",
            "opencode-go" => "OPENCODE_API_KEY",
            _ => continue,
        };
        if environment.contains_key(variable) {
            continue;
        }
        if let Ok(secret) = connection_token(&stored.secret_ref) {
            environment.insert(variable.to_string(), secret);
        }
    }
    Ok(environment)
}

// spawn_blocking: booting the local Node processes and probing readiness must not freeze the UI.
#[tauri::command]
async fn ensure_flue_runtime(
    app: tauri::AppHandle,
    organization_id: String,
    team_id: String,
) -> Result<FlueRuntimeInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_flue_runtime_blocking(&app, &organization_id, &team_id)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn ensure_flue_runtime_blocking(
    app: &tauri::AppHandle,
    organization_id: &str,
    _team_id: &str,
) -> Result<FlueRuntimeInfo, String> {
    let (node, project_root) = bundled_flue_paths(app)?;
    let provider_env = provider_environment(app, organization_id)?;
    let local_routes = local_model_routes(app)?;
    let manager = app.state::<FlueManager>();
    let mut managed = manager.0.lock().map_err(|error| error.to_string())?;

    if let Some(runtime) = managed.as_mut() {
        let compatible = runtime.project_root == project_root
            && runtime.local_routes == local_routes
            && runtime.provider_env == provider_env;
        if compatible && runtime.child.alive()? {
            if !runtime.capability_child.alive()? {
                runtime.capability_child = spawn_capability_host(
                    &node,
                    &project_root,
                    &flue_state_dir(app)?,
                    runtime.capability_port,
                    &runtime.capability_token,
                    &capability_log_path(app)?,
                )?;
            }
            // Not just "the process is alive": Flue can be draining while shutting down.
            let base_url = format!("http://127.0.0.1:{}", runtime.port);
            wait_until_ready(
                &mut runtime.child,
                &base_url,
                &runtime_log_path(app)?,
                "Flue",
            )?;
            return Ok(FlueRuntimeInfo {
                base_url,
                token: runtime.token.clone(),
            });
        }
        *managed = None;
    }

    let port = available_loopback_port()?;
    let token = loopback_token()?;
    let base_url = format!("http://127.0.0.1:{port}");
    let capability_port = loop {
        let candidate = available_loopback_port()?;
        if candidate != port {
            break candidate;
        }
    };
    let capability_token = loopback_token()?;
    let capability_url = format!("http://127.0.0.1:{capability_port}");
    let state_dir = flue_state_dir(app)?;
    let capability_child = spawn_capability_host(
        &node,
        &project_root,
        &state_dir,
        capability_port,
        &capability_token,
        &capability_log_path(app)?,
    )?;
    let broker = app.state::<CredentialBroker>();
    let mut command = Command::new(&node);
    command.env_clear();
    inherit_runtime_environment(&mut command);
    command
        .current_dir(&project_root)
        .arg("--experimental-strip-types")
        .arg(project_root.join("start.mjs"))
        .env("PORT", port.to_string())
        .env("BEES_FLUE_ROOT", &project_root)
        // Guards the whole agent mount. Regenerated every launch, so a leaked token dies
        // with the process it was issued for.
        .env("BEES_FLUE_TOKEN", &token)
        .env("BEES_CREDENTIAL_BROKER_URL", &broker.url)
        .env("BEES_CREDENTIAL_BROKER_TOKEN", &broker.token)
        // Run pointers and browser profiles are mutable runtime state, not build inputs.
        .env("BEES_STATE_DIR", &state_dir)
        // Trusted local modules live in a separate process with no provider or broker secrets.
        .env("BEES_CAPABILITY_HOST_URL", &capability_url)
        .env("BEES_CAPABILITY_TOKEN", &capability_token)
        // The CLI-backed providers are served by this same process, so app.ts needs the
        // address it was started on to point their registrations at itself.
        .env("BEES_SELF_URL", &base_url)
        // Cloud provider keys reach a run only here: pi-ai resolves a catalog provider's
        // credential from this process's environment.
        .envs(&provider_env)
        .env(
            "BEES_LOCAL_AI_URLS",
            serde_json::to_string(
                &local_routes
                    .iter()
                    .map(|(id, route)| (id, &route.url))
                    .collect::<BTreeMap<_, _>>(),
            )
            .map_err(|error| error.to_string())?,
        )
        // The window each llama-server was actually started with, so the runtime declares the
        // same one to pi-ai per model instead of a constant that drifts from what was
        // allocated. Sizes differ per model: a 3B and a 235B do not cost the same per token.
        .env(
            "BEES_LOCAL_CTX",
            serde_json::to_string(
                &local_routes
                    .iter()
                    .map(|(id, route)| (id, route.context_size))
                    .collect::<BTreeMap<_, _>>(),
            )
            .map_err(|error| error.to_string())?,
        );
    // A GUI app's PATH does not include the per-user bin dirs the CLIs install into, so
    // resolve them here and hand the runtime absolute paths.
    let overrides = usable_cli_overrides(app);
    for (id, name, variable) in CLI_TOOLS {
        if let Some(tool) = cli_tool_path(&overrides, id, name) {
            command.env(variable, tool.path);
        }
    }
    let log = open_runtime_log(app)?;
    let log_errors = log.try_clone().map_err(|error| error.to_string())?;
    // Both children are Sidecars from here on, so any `?` below reaps whatever already started.
    let mut child = Sidecar::new(
        command
            .stdin(Stdio::null())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(log_errors))
            .spawn()
            .map_err(|error| format!("The bundled Flue runtime could not start: {error}"))?,
    );
    wait_until_ready(&mut child, &base_url, &runtime_log_path(app)?, "Flue")?;
    *managed = Some(ManagedFlue {
        child,
        capability_child,
        project_root,
        port,
        token: token.clone(),
        capability_port,
        capability_token,
        local_routes,
        provider_env,
    });
    Ok(FlueRuntimeInfo { base_url, token })
}

/// Block until the runtime will actually accept work. Readiness is not an open socket: the
/// flue server binds its port well before it finishes loading agents, and it answers 503
/// runtime_unavailable both while loading and while draining for a reload. Poll an HTTP GET
/// until the gate stops returning 503.
fn wait_until_ready(
    child: &mut Sidecar,
    base_url: &str,
    log_path: &Path,
    process_name: &str,
) -> Result<(), String> {
    let probe = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(500))
        .build()
        .map_err(|error| error.to_string())?;
    for _ in 0..300 {
        if let Some(status) = child.child().try_wait().map_err(|error| error.to_string())? {
            return Err(format!(
                "{process_name} stopped during startup ({status}). See {}.",
                log_path.display()
            ));
        }
        if probe
            .get(base_url)
            .send()
            .map(|response| response.status() != reqwest::StatusCode::SERVICE_UNAVAILABLE)
            .unwrap_or(false)
        {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err(format!(
        "{process_name} did not become ready. Check {} and try again.",
        log_path.display()
    ))
}

fn spawn_capability_host(
    node: &Path,
    project_root: &Path,
    state_dir: &Path,
    port: u16,
    token: &str,
    log_path: &Path,
) -> Result<Sidecar, String> {
    let log = open_rotating_log(log_path)?;
    let errors = log.try_clone().map_err(|error| error.to_string())?;
    let mut command = Command::new(node);
    command.env_clear();
    inherit_runtime_environment(&mut command);
    let mut child = Sidecar::new(
        command
            .current_dir(project_root)
            .arg("--experimental-strip-types")
            .arg(project_root.join("capability-server.mjs"))
            .env("PORT", port.to_string())
            .env("BEES_STATE_DIR", state_dir)
            .env("BEES_CAPABILITY_TOKEN", token)
            .stdin(Stdio::null())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(errors))
            .spawn()
            .map_err(|error| format!("The local capability host could not start: {error}"))?,
    );
    let url = format!("http://127.0.0.1:{port}");
    wait_until_ready(&mut child, &url, log_path, "The local capability host")?;
    Ok(child)
}

/// Absolute path to a CLI the user installed, or None when it is not on the machine.
/// Resolved through a login shell because a GUI app inherits a bare PATH that misses the
/// per-user bin dirs these CLIs install into (~/.local/bin, ~/.bun/bin, nvm, Homebrew).
fn resolve_cli(name: &str) -> Option<String> {
    let output = if cfg!(target_os = "windows") {
        Command::new("where").arg(name).output().ok()?
    } else {
        // Launched from Finder there is no SHELL and no terminal PATH: launchd hands the app a
        // bare `/usr/bin:/bin`. The shell has to be interactive as well as login, because nvm,
        // pnpm and homebrew all write their PATH into ~/.zshrc, which a login shell alone skips.
        let shell = std::env::var("SHELL").unwrap_or_else(|_| {
            if cfg!(target_os = "macos") { "/bin/zsh".into() } else { "/bin/sh".into() }
        });
        // `npm run` exports npm_config_prefix, and nvm refuses to load when it is set — the
        // shell then comes up without the nvm bin dir and finds nothing. Bees started from a
        // terminal (`npm run tauri:dev`) inherits that, so the probe drops it to see the same
        // PATH a shell of the user's own would have.
        Command::new(shell)
            .args(["-ilc", &format!("command -v {name}")])
            .env_remove("npm_config_prefix")
            .env_remove("NPM_CONFIG_PREFIX")
            .output()
            .ok()?
    };
    // An interactive shell may greet us first, so take the first line that is a real path
    // rather than assuming the output starts with the answer.
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with('/') && Path::new(line).exists())
        .map(str::to_string)
        .or_else(|| bundled_cli(name))
}

/// A CLI that ships inside a desktop app instead of installing onto PATH. The Codex app was
/// renamed ChatGPT and now carries `codex` in its bundle, so a machine with it installed has
/// the CLI but nothing `command -v` can see.
fn bundled_cli(name: &str) -> Option<String> {
    if name != "codex" {
        return None;
    }
    let home = std::env::var("HOME").unwrap_or_default();
    [
        "/Applications/ChatGPT.app/Contents/Resources/codex".to_string(),
        format!("{home}/Applications/ChatGPT.app/Contents/Resources/codex"),
    ]
    .into_iter()
    .find(|path| Path::new(path).exists())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemCapacity {
    total_memory_bytes: u64,
    free_disk_bytes: u64,
    /// "macOS", "Windows", "Linux", … as reported by the OS.
    os_name: String,
    /// Product version, e.g. "26.1" on macOS. Empty when the OS does not report one.
    os_version: String,
}

/// What this machine can carry, used to pick which seeded model to start on first launch.
/// Free space is measured on the volume the downloaded models land on, not the boot volume.
#[tauri::command]
fn system_capacity(app: tauri::AppHandle) -> Result<SystemCapacity, String> {
    let models = local_models::models_directory(&app)?;
    let system = sysinfo::System::new_with_specifics(
        sysinfo::RefreshKind::nothing().with_memory(sysinfo::MemoryRefreshKind::everything()),
    );
    // The mount point that is the longest prefix of the models path owns that path.
    let free_disk_bytes = sysinfo::Disks::new_with_refreshed_list()
        .iter()
        .filter(|disk| models.starts_with(disk.mount_point()))
        .max_by_key(|disk| disk.mount_point().as_os_str().len())
        .map(|disk| disk.available_space())
        .unwrap_or(0);
    Ok(SystemCapacity {
        total_memory_bytes: system.total_memory(),
        free_disk_bytes,
        os_name: sysinfo::System::name().unwrap_or_default(),
        os_version: sysinfo::System::os_version().unwrap_or_default(),
    })
}

/// The agent CLIs Bees can run: tool id, the command name on PATH, and the environment
/// variable the Flue runtime reads the binary's path from.
const CLI_TOOLS: [(&str, &str, &str); 2] = [
    ("claude", "claude", "BEES_CLAUDE_CLI"),
    ("codex", "codex", "BEES_CODEX_CLI"),
];

/// A CLI the app will run: where it is, and whether the user picked it themselves.
#[derive(Serialize)]
struct CliToolPath {
    path: String,
    custom: bool,
}

fn cli_overrides_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("cli-tools.json"))
        .map_err(|error| error.to_string())
}

/// Binaries the user picked by hand, keyed by tool id, exactly as stored.
fn stored_cli_overrides(app: &tauri::AppHandle) -> BTreeMap<String, String> {
    cli_overrides_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// The same picks, minus any whose file is gone: a binary that was moved or uninstalled
/// falls back to PATH detection instead of failing every run that names the tool.
fn usable_cli_overrides(app: &tauri::AppHandle) -> BTreeMap<String, String> {
    drop_missing_binaries(stored_cli_overrides(app))
}

fn drop_missing_binaries(overrides: BTreeMap<String, String>) -> BTreeMap<String, String> {
    overrides
        .into_iter()
        .filter(|(_, path)| Path::new(path).is_file())
        .collect()
}

/// The binary a CLI-backed provider runs: the user's own pick first, else what is on PATH.
fn cli_tool_path(
    overrides: &BTreeMap<String, String>,
    id: &str,
    name: &str,
) -> Option<CliToolPath> {
    match overrides.get(id) {
        Some(path) => Some(CliToolPath {
            path: path.clone(),
            custom: true,
        }),
        None => resolve_cli(name).map(|path| CliToolPath {
            path,
            custom: false,
        }),
    }
}

/// Which agent CLIs this computer has, for the Preferences → Cloud connections list.
#[tauri::command]
fn detect_cli_tools(app: tauri::AppHandle) -> BTreeMap<String, CliToolPath> {
    let overrides = usable_cli_overrides(&app);
    CLI_TOOLS
        .into_iter()
        .filter_map(|(id, name, _)| {
            cli_tool_path(&overrides, id, name).map(|tool| (id.to_string(), tool))
        })
        .collect()
}

/// Point a CLI-backed provider at a binary the user browsed to. An empty path drops the
/// pick and goes back to PATH detection.
#[tauri::command]
fn set_cli_tool_path(app: tauri::AppHandle, tool: String, path: String) -> Result<(), String> {
    if !CLI_TOOLS.iter().any(|(id, _, _)| *id == tool) {
        return Err(format!("{tool} is not a command-line agent"));
    }
    // Read what is stored rather than what is usable, so another tool's pick is not dropped
    // here only because its binary happens to be missing right now.
    let mut overrides = stored_cli_overrides(&app);
    let path = path.trim().to_string();
    if path.is_empty() {
        overrides.remove(&tool);
    } else {
        if !Path::new(&path).is_file() {
            return Err(format!("{path} is not a file on this computer"));
        }
        overrides.insert(tool, path);
    }
    let content = serde_json::to_vec(&overrides).map_err(|error| error.to_string())?;
    write_atomic(&cli_overrides_path(&app)?, &content)
}

#[tauri::command]
async fn restart_flue_runtime(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = app.state::<FlueManager>();
        let mut managed = manager.0.lock().map_err(|error| error.to_string())?;
        drop(managed.take());
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn json_to_sql(value: JsonValue) -> Result<SqlValue, String> {
    match value {
        JsonValue::Null => Ok(SqlValue::Null),
        JsonValue::Bool(value) => Ok(SqlValue::Integer(i64::from(value))),
        JsonValue::Number(value) => {
            if let Some(integer) = value.as_i64() {
                Ok(SqlValue::Integer(integer))
            } else if let Some(float) = value.as_f64() {
                Ok(SqlValue::Real(float))
            } else {
                Err("unsupported numeric database parameter".into())
            }
        }
        JsonValue::String(value) => Ok(SqlValue::Text(value)),
        value => serde_json::to_string(&value)
            .map(SqlValue::Text)
            .map_err(|error| error.to_string()),
    }
}

fn sql_to_json(value: rusqlite::types::ValueRef<'_>) -> JsonValue {
    match value {
        rusqlite::types::ValueRef::Null => JsonValue::Null,
        rusqlite::types::ValueRef::Integer(value) => JsonValue::Number(value.into()),
        rusqlite::types::ValueRef::Real(value) => Number::from_f64(value)
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::Null),
        rusqlite::types::ValueRef::Text(value) => {
            JsonValue::String(String::from_utf8_lossy(value).into_owned())
        }
        rusqlite::types::ValueRef::Blob(value) => {
            JsonValue::String(format!("[{} bytes]", value.len()))
        }
    }
}

#[tauri::command]
fn db_query(
    database: State<'_, Database>,
    sql: String,
    params: Vec<JsonValue>,
) -> Result<Vec<JsonValue>, String> {
    let connection = database.0.lock().map_err(|error| error.to_string())?;
    let values = params
        .into_iter()
        .map(json_to_sql)
        .collect::<Result<Vec<_>, _>>()?;
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| error.to_string())?;
    let column_names = statement
        .column_names()
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let rows = statement
        .query_map(params_from_iter(values), |row| {
            let mut object = Map::new();
            for (index, name) in column_names.iter().enumerate() {
                object.insert(name.clone(), sql_to_json(row.get_ref(index)?));
            }
            Ok(JsonValue::Object(object))
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn db_execute(
    database: State<'_, Database>,
    sql: String,
    params: Vec<JsonValue>,
) -> Result<usize, String> {
    let connection = database.0.lock().map_err(|error| error.to_string())?;
    let values = params
        .into_iter()
        .map(json_to_sql)
        .collect::<Result<Vec<_>, _>>()?;
    connection
        .execute(&sql, params_from_iter(values))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn db_transaction(
    database: State<'_, Database>,
    statements: Vec<DbStatement>,
) -> Result<Vec<usize>, String> {
    let mut connection = database.0.lock().map_err(|error| error.to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let mut affected = Vec::with_capacity(statements.len());
    for statement in statements {
        let values = statement
            .params
            .into_iter()
            .map(json_to_sql)
            .collect::<Result<Vec<_>, _>>()?;
        affected.push(
            transaction
                .execute(&statement.sql, params_from_iter(values))
                .map_err(|error| error.to_string())?,
        );
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(affected)
}

fn safe_relative(path: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(path);
    if candidate.as_os_str().is_empty()
        || candidate.is_absolute()
        || candidate
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("path must be a non-empty logical path without traversal".into());
    }
    Ok(candidate.to_path_buf())
}

fn canonical_directory(path: &str) -> Result<PathBuf, String> {
    let path = fs::canonicalize(path).map_err(|error| error.to_string())?;
    if !path.is_dir() {
        return Err("selected path is not a directory".into());
    }
    Ok(path)
}

fn canonical_workspace_in_roots(path: &str, roots: &[PathBuf]) -> Result<PathBuf, String> {
    let workspace = canonical_directory(path)?;
    if roots
        .iter()
        .any(|root| workspace != *root && workspace.starts_with(root))
    {
        return Ok(workspace);
    }
    Err("workspace is outside Bees run data".into())
}

fn allowed_workspace_roots(app: &tauri::AppHandle) -> Result<Vec<PathBuf>, String> {
    let candidates = [
        app.path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join("runs"),
        // Read old pending outputs in place until the user settles or deletes them.
        app.path()
            .app_cache_dir()
            .map_err(|error| error.to_string())?
            .join("workspaces"),
    ];
    candidates
        .into_iter()
        .filter(|root| root.exists())
        .map(|root| fs::canonicalize(root).map_err(|error| error.to_string()))
        .collect()
}

fn canonical_workspace(app: &tauri::AppHandle, path: &str) -> Result<PathBuf, String> {
    canonical_workspace_in_roots(path, &allowed_workspace_roots(app)?)
}

fn safe_identifier(value: &str, field: &str) -> Result<String, String> {
    if value.is_empty()
        || value.len() > 120
        || !value.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
    {
        return Err(format!(
            "{field} must use lowercase letters, numbers, and hyphens"
        ));
    }
    Ok(value.to_owned())
}

/// Whether two files already hold the same bytes. Anything unreadable counts as different,
/// so the copy still happens.
fn same_file(source: &Path, target: &Path) -> bool {
    let (Ok(left), Ok(right)) = (fs::metadata(source), fs::metadata(target)) else {
        return false;
    };
    if left.len() != right.len() {
        return false;
    }
    match (fs::read(source), fs::read(target)) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

fn copy_tree(source: &Path, destination: &Path, overwrite: bool) -> Result<(), String> {
    if !source.is_dir() {
        return Err("source is not a directory".into());
    }
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() {
            return Err("directory copies may not contain symbolic links".into());
        }
        let target = destination.join(entry.file_name());
        if file_type.is_dir() {
            copy_tree(&entry.path(), &target, overwrite)?;
        } else if file_type.is_file() && (overwrite || !target.exists()) {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            // Skip a file that is already byte-identical; unchanged app-owned sources should
            // not make a later production build do needless filesystem work.
            if !same_file(&entry.path(), &target) {
                fs::copy(entry.path(), target).map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(())
}

fn bundled_flue_project(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let packaged = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("flue-runtime")
        .join("project");
    let source = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("flue-runtime")
        .join("project");
    let project = if packaged.is_dir() { packaged } else { source };
    if !project.is_dir() {
        return Err("The bundled Flue project is missing. Reinstall Bees.".into());
    }
    Ok(project)
}

// Trusted local modules execute from immutable run snapshots and resolve only the bundled
// dependency set through this one capability-host link.
fn link_runtime_modules(capability_root: &Path, modules: &Path) -> Result<(), String> {
    if !modules.is_dir() {
        return Err("The bundled Flue node_modules are missing. Reinstall Bees.".into());
    }
    let link = capability_root.join("node_modules");
    let target = fs::canonicalize(modules).map_err(|error| error.to_string())?;
    if fs::canonicalize(&link).ok().as_ref() == Some(&target) {
        return Ok(());
    }
    // Repoint only after an app upgrade. Concurrent run starts share an already-correct link.
    if link.symlink_metadata().is_ok() {
        let _ = fs::remove_file(&link).or_else(|_| fs::remove_dir_all(&link));
    }
    #[cfg(unix)]
    {
        match std::os::unix::fs::symlink(&target, &link) {
            Ok(()) => Ok(()),
            Err(error)
                if error.kind() == std::io::ErrorKind::AlreadyExists
                    && fs::canonicalize(&link).ok().as_ref() == Some(&target) =>
            {
                Ok(())
            }
            Err(error) => Err(error.to_string()),
        }
    }
    #[cfg(windows)]
    {
        // Directory junction — needs no admin/developer mode, unlike a symlink.
        let status = Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&target)
            .status()
            .map_err(|error| error.to_string())?;
        if status.success() {
            Ok(())
        } else if fs::canonicalize(&link).ok().as_ref() == Some(&target) {
            Ok(())
        } else {
            Err("Could not link the Flue runtime modules.".into())
        }
    }
}

/// Mutable runtime state (run pointers, browser profiles), deliberately outside the immutable
/// Flue build project.
fn flue_state_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("flue-state");
    fs::create_dir_all(dir.join("instances")).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn runtime_log_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(flue_state_dir(app)?.join("runtime.log"))
}

fn capability_log_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(flue_state_dir(app)?.join("capability-host.log"))
}

/// The runtime's stdout and stderr, on disk.
///
/// Load-bearing for diagnosis, not a nicety: Flue scrubs the detail out of any failure that is
/// not a `FlueError`, so a submission that dies inside project code settles as "The agent
/// submission failed because of an internal error" and the only copy of the real stack is what
/// the process printed. Inheriting the parent's streams sent that to whatever terminal launched
/// Bees — nothing at all in a packaged build — which made that whole class of failure
/// unreportable and made "check the team runtime logs" name a file that did not exist.
///
/// ponytail: one previous launch is kept and older ones are dropped. Size-based rotation when
/// two launches stop being enough to catch a failure.
fn open_runtime_log(app: &tauri::AppHandle) -> Result<fs::File, String> {
    open_rotating_log(&runtime_log_path(app)?)
}

fn open_rotating_log(path: &Path) -> Result<fs::File, String> {
    let _ = fs::rename(path, path.with_extension("log.1"));
    fs::File::create(path).map_err(|error| error.to_string())
}

fn write_atomic(path: &Path, content: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "file has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = parent.join(format!(
        ".{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "invalid file name".to_string())?
    ));
    fs::write(&temporary, content).map_err(|error| error.to_string())?;
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

fn skill_frontmatter(contents: &str, fallback: &str) -> (String, String, String) {
    let Some(rest) = contents.strip_prefix("---\n") else {
        return (
            fallback.to_string(),
            fallback.to_string(),
            contents.to_string(),
        );
    };
    let Some((frontmatter, body)) = rest.split_once("\n---\n") else {
        return (
            fallback.to_string(),
            fallback.to_string(),
            contents.to_string(),
        );
    };
    let value = |key: &str| {
        frontmatter.lines().find_map(|line| {
            let (name, value) = line.split_once(':')?;
            (name.trim() == key).then(|| value.trim().trim_matches(['\'', '"']).to_string())
        })
    };
    let name = value("name")
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback.into());
    let description = value("description")
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| name.clone());
    (name, description, body.to_string())
}

fn snapshot_skill(
    capability_ref: String,
    fallback_name: String,
    directory: &Path,
) -> Result<SkillSnapshot, String> {
    let skill_md =
        fs::read_to_string(directory.join("SKILL.md")).map_err(|error| error.to_string())?;
    if skill_md.len() > 1_000_000 {
        return Err("SKILL.md must be 1 MB or smaller".into());
    }
    let (name, description, instructions) = skill_frontmatter(&skill_md, &fallback_name);
    let mut paths = Vec::new();
    collect_relative_files(directory, directory, &mut paths)?;
    if paths.len() > 101 {
        return Err("A skill may contain at most 100 supporting files".into());
    }
    let mut files = BTreeMap::new();
    let mut total_size = 0usize;
    for relative in paths {
        if relative == "SKILL.md" {
            continue;
        }
        let bytes = fs::read(directory.join(&relative)).map_err(|error| error.to_string())?;
        total_size = total_size.saturating_add(bytes.len());
        if total_size > 5_000_000 {
            return Err("A skill's supporting files may total at most 5 MB".into());
        }
        let file = match String::from_utf8(bytes.clone()) {
            Ok(content) => SkillSnapshotFile {
                encoding: "utf8".into(),
                content,
            },
            Err(_) => SkillSnapshotFile {
                encoding: "base64".into(),
                content: BASE64.encode(bytes),
            },
        };
        files.insert(relative, file);
    }
    Ok(SkillSnapshot {
        capability_ref,
        name,
        description,
        instructions,
        files,
    })
}

#[tauri::command]
/// One id per run: the Bees execution is also the Flue conversation, the sandbox, and this
/// pointer's key. The sandbox factory resolves it from the agent route's `:id`.
fn bind_flue_workspace(
    app: tauri::AppHandle,
    database: State<'_, Database>,
    execution_id: String,
    workspace: String,
    team_root: Option<String>,
    capabilities: Option<Vec<RegistryCapabilityFile>>,
    granted_capability_refs: Option<Vec<String>>,
    project_work_item_id: Option<String>,
) -> Result<Vec<SkillSnapshot>, String> {
    let execution_id = safe_identifier(&execution_id, "execution ID")?;
    let workspace = if let Some(work_item_id) = project_work_item_id {
        processes::software_project::canonical_project_workspace(
            &database,
            &work_item_id,
            &workspace,
        )?
    } else {
        canonical_workspace(&app, &workspace)?
    };
    let pointer_path = flue_state_dir(&app)?
        .join("instances")
        .join(format!("{execution_id}.json"));
    let previous_capabilities = fs::read(&pointer_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<JsonValue>(&bytes).ok())
        .and_then(|value| value.get("capabilities").cloned())
        .unwrap_or_else(|| JsonValue::Array(Vec::new()));
    let mut skill_snapshots = Vec::new();
    let capability_pointers = if let Some(capabilities) = capabilities {
        let state = flue_state_dir(&app)?;
        let capability_root = state.join("capabilities");
        let target = capability_root.join(&execution_id);
        if target.exists() {
            fs::remove_dir_all(&target).map_err(|error| error.to_string())?;
        }
        fs::create_dir_all(&target).map_err(|error| error.to_string())?;
        let project = bundled_flue_project(&app)?;
        let modules = project
            .parent()
            .ok_or_else(|| "The Flue runtime path is invalid.".to_string())?
            .join("node_modules");
        link_runtime_modules(&capability_root, &modules)?;
        let granted = granted_capability_refs.unwrap_or_default();
        let mut pointers = Vec::new();
        for capability in capabilities {
            let registry_id = safe_identifier(&capability.registry_id, "registry ID")?;
            let registry = fs::canonicalize(registry_root(&app, &registry_id)?)
                .map_err(|error| error.to_string())?;
            let relative = safe_relative(&capability.path)?;
            let source =
                fs::canonicalize(registry.join(&relative)).map_err(|error| error.to_string())?;
            if !source.starts_with(&registry) {
                return Err("capability escapes its registry copy".into());
            }
            let destination = target.join(&registry_id).join(&relative);
            if capability.kind == "skill" {
                let source_directory = source
                    .parent()
                    .ok_or_else(|| "skill file has no directory".to_string())?;
                let destination_directory = destination
                    .parent()
                    .ok_or_else(|| "skill target has no directory".to_string())?;
                copy_tree(source_directory, destination_directory, true)?;
                skill_snapshots.push(snapshot_skill(
                    capability.capability_ref,
                    capability.name,
                    destination_directory,
                )?);
            } else if capability.kind == "tool" && source.is_file() {
                if let Some(parent) = destination.parent() {
                    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                }
                fs::copy(source, &destination).map_err(|error| error.to_string())?;
                pointers.push(serde_json::json!({
                    "ref": capability.capability_ref,
                    "path": destination.to_string_lossy(),
                    "granted": granted.contains(&capability.capability_ref)
                }));
            } else if capability.kind == "tool" {
                return Err("selected tool capability is not a file".into());
            } else {
                return Err("capability kind must be skill or tool".into());
            }
        }
        JsonValue::Array(pointers)
    } else {
        previous_capabilities
    };
    // teamRoot is the stable per-team folder; the browser profile keys off it so logins
    // persist across runs. Capability paths point only to immutable per-execution copies.
    let pointer = serde_json::to_vec(&serde_json::json!({
        "workspace": workspace.to_string_lossy(),
        "teamRoot": team_root,
        "capabilities": capability_pointers
    }))
    .map_err(|error| error.to_string())?;
    write_atomic(&pointer_path, &pointer)?;
    Ok(skill_snapshots)
}

fn purge_flue_execution_state_at(state: &Path, execution_id: &str) -> Result<(), String> {
    let execution_id = safe_identifier(execution_id, "execution ID")?;
    let capabilities = state.join("capabilities").join(&execution_id);
    if capabilities.exists() {
        fs::remove_dir_all(capabilities).map_err(|error| error.to_string())?;
    }
    let pointer = state.join("instances").join(format!("{execution_id}.json"));
    if pointer.exists() {
        fs::remove_file(pointer).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn purge_flue_execution_state(app: tauri::AppHandle, execution_id: String) -> Result<(), String> {
    purge_flue_execution_state_at(&flue_state_dir(&app)?, &execution_id)
}

fn registry_root(app: &tauri::AppHandle, registry_id: &str) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("registries")
        .join(safe_identifier(registry_id, "registry ID")?))
}

fn bundled_default_registry(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let packaged = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("flue-runtime")
        .join("default-registry");
    let source = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("flue-runtime")
        .join("default-registry");
    let registry = if packaged.is_dir() { packaged } else { source };
    if !registry.is_dir() {
        return Err("The bundled skills and tools folder is missing. Reinstall Bees.".into());
    }
    Ok(registry)
}

#[tauri::command]
fn copy_registry(
    app: tauri::AppHandle,
    registry_id: String,
    source_path: String,
) -> Result<Vec<String>, String> {
    let source = canonical_directory(&source_path)?;
    let destination = registry_root(&app, &registry_id)?;
    let temporary = destination.with_extension("tmp");
    if temporary.exists() {
        fs::remove_dir_all(&temporary).map_err(|error| error.to_string())?;
    }
    copy_tree(&source, &temporary, true)?;
    if destination.exists() {
        fs::remove_dir_all(&destination).map_err(|error| error.to_string())?;
    }
    fs::rename(&temporary, &destination).map_err(|error| error.to_string())?;
    let mut files = Vec::new();
    collect_relative_files(&destination, &destination, &mut files)?;
    files.sort();
    Ok(files)
}

#[tauri::command]
fn copy_bundled_registry(
    app: tauri::AppHandle,
    registry_id: String,
) -> Result<Vec<String>, String> {
    let source = bundled_default_registry(&app)?;
    let destination = registry_root(&app, &registry_id)?;
    if destination.exists() {
        fs::remove_dir_all(&destination).map_err(|error| error.to_string())?;
    }
    copy_tree(&source, &destination, true)?;
    let mut files = Vec::new();
    collect_relative_files(&destination, &destination, &mut files)?;
    files.sort();
    Ok(files)
}

#[tauri::command]
fn inventory_registry(app: tauri::AppHandle, registry_id: String) -> Result<Vec<String>, String> {
    let root = registry_root(&app, &registry_id)?;
    let root = canonical_directory(&root.to_string_lossy())?;
    let mut files = Vec::new();
    collect_relative_files(&root, &root, &mut files)?;
    files.sort();
    Ok(files)
}

#[tauri::command]
fn remove_registry(app: tauri::AppHandle, registry_id: String) -> Result<(), String> {
    let root = registry_root(&app, &registry_id)?;
    if root.exists() {
        fs::remove_dir_all(root).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn validate_directory(path: String) -> Result<String, String> {
    canonical_directory(&path).map(|path| path.to_string_lossy().into_owned())
}

/// Agents are JSON files in <teamRoot>/agents, so they ride whatever sync the team
/// folder already has (Dropbox, iCloud, git) instead of a second sync channel.
fn agents_directory(team_root: &str) -> Result<PathBuf, String> {
    let directory = canonical_directory(team_root)?.join("agents");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn agent_file(team_root: &str, agent_id: &str) -> Result<PathBuf, String> {
    let id = safe_identifier(agent_id, "agent ID")?;
    Ok(agents_directory(team_root)?.join(format!("{id}.json")))
}

/// Returns the file contents, not the paths: the caller always wants every agent, so
/// one command beats a list followed by a read per file.
#[tauri::command]
fn list_agent_files(team_root: String) -> Result<Vec<String>, String> {
    let directory = agents_directory(&team_root)?;
    let mut agents = Vec::new();
    for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            continue;
        }
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
            continue;
        }
        agents.push(fs::read_to_string(&path).map_err(|error| error.to_string())?);
    }
    Ok(agents)
}

#[tauri::command]
fn write_agent_file(team_root: String, agent_id: String, contents: String) -> Result<(), String> {
    if contents.is_empty() || contents.len() > 1_000_000 {
        return Err("agent file must be between 1 byte and 1 MB".into());
    }
    write_atomic(&agent_file(&team_root, &agent_id)?, contents.as_bytes())
}

/// Skills are SKILL.md files in <teamRoot>/skills/<slug>, so an evolved skill rides the same
/// team-folder sync as agents and keeps whatever history that folder already has.
#[tauri::command]
fn write_team_skill(team_root: String, slug: String, contents: String) -> Result<String, String> {
    if contents.is_empty() || contents.len() > 1_000_000 {
        return Err("skill file must be between 1 byte and 1 MB".into());
    }
    let slug = safe_identifier(&slug, "skill name")?;
    let directory = canonical_directory(&team_root)?.join("skills").join(&slug);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    write_atomic(&directory.join("SKILL.md"), contents.as_bytes())?;
    Ok(format!("skills/{slug}/SKILL.md"))
}

#[tauri::command]
fn update_team_skill_rule(
    team_root: String,
    slug: String,
    reason: String,
    remove: Option<bool>,
) -> Result<(), String> {
    let slug = safe_identifier(&slug, "skill name")?;
    let reason = reason.split_whitespace().collect::<Vec<_>>().join(" ");
    if reason.is_empty() {
        return Err("feedback reason must not be empty".into());
    }
    let directory = canonical_directory(&team_root)?.join("skills").join(&slug);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join("SKILL.md");
    let line = format!("- {reason}\n");
    let mut contents = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            format!("---\nname: {slug}\ndescription: Rules learned from review feedback\n---\n\n")
        }
        Err(error) => return Err(error.to_string()),
    };
    if remove.unwrap_or(false) {
        if let Some(index) = contents.rfind(&line) {
            contents.replace_range(index..index + line.len(), "");
        }
    } else {
        if !contents.ends_with('\n') {
            contents.push('\n');
        }
        contents.push_str(&line);
    }
    write_atomic(&path, contents.as_bytes())
}

/// Retires a skill by moving <teamRoot>/skills/<slug> under skills/.archive/<slug>. A move, not
/// a delete: the curator proposes retirement from usage alone, so the recovery for a wrong call
/// has to be dragging one folder back. An existing archived copy is replaced.
#[tauri::command]
fn archive_team_skill(team_root: String, slug: String) -> Result<String, String> {
    let slug = safe_identifier(&slug, "skill name")?;
    let skills = canonical_directory(&team_root)?.join("skills");
    let source = skills.join(&slug);
    if !source.is_dir() {
        return Err(format!("skill folder not found: {slug}"));
    }
    let archive = skills.join(".archive");
    fs::create_dir_all(&archive).map_err(|error| error.to_string())?;
    let destination = archive.join(&slug);
    if destination.exists() {
        fs::remove_dir_all(&destination).map_err(|error| error.to_string())?;
    }
    fs::rename(&source, &destination).map_err(|error| error.to_string())?;
    Ok(format!("skills/.archive/{slug}"))
}

#[tauri::command]
fn delete_agent_file(team_root: String, agent_id: String) -> Result<(), String> {
    let path = agent_file(&team_root, &agent_id)?;
    if !path.exists() {
        return Ok(());
    }
    fs::remove_file(path).map_err(|error| error.to_string())
}

/// Which coordination server this launch talks to, when it is not the one baked into the
/// build. Read from `--server <value>` or `BEES_API_URL`, with `dev` and `prod` as shorthands.
/// Empty string means "no override" — the frontend keeps its build-time default.
///
/// A launch flag rather than a setting in the app: pointing at a different API is something
/// people working on the server do, and it should not survive as state that a later run
/// silently inherits. Whatever the webview may actually reach is still decided by the CSP
/// in tauri.conf.json.
#[tauri::command]
fn api_server_override() -> String {
    server_override_from(
        std::env::args().collect::<Vec<_>>(),
        std::env::var("BEES_API_URL").ok(),
    )
}

fn server_override_from(args: Vec<String>, variable: Option<String>) -> String {
    let flagged = args.iter().enumerate().find_map(|(index, argument)| {
        argument
            .strip_prefix("--server=")
            .map(str::to_owned)
            .or_else(|| (argument == "--server").then(|| args.get(index + 1).cloned())?)
    });
    let value = flagged.or(variable).unwrap_or_default();
    match value.trim() {
        "" => String::new(),
        "dev" | "local" => "http://localhost:3000".into(),
        "prod" => "https://app.bees.bot".into(),
        url => url.trim_end_matches('/').to_owned(),
    }
}

/// Default workspace root: <home>/Bees. Not created here — the caller ensures it.
#[tauri::command]
fn default_workspace_root(app: tauri::AppHandle) -> Result<String, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    Ok(home.join("Bees").to_string_lossy().into_owned())
}

/// Create the directory (and parents) if missing, then return its canonical path.
#[tauri::command]
fn ensure_directory(path: String) -> Result<String, String> {
    if path.trim().is_empty() {
        return Err("path must not be empty".into());
    }
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    canonical_directory(&path).map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn create_workspace(app: tauri::AppHandle, execution_id: String) -> Result<String, String> {
    if execution_id.is_empty()
        || !execution_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("invalid execution identifier".into());
    }
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("runs")
        .join(execution_id);
    fs::create_dir_all(root.join("inputs")).map_err(|error| error.to_string())?;
    fs::create_dir_all(root.join("outputs")).map_err(|error| error.to_string())?;
    Ok(root.to_string_lossy().into_owned())
}

#[tauri::command]
fn copy_input_files(
    app: tauri::AppHandle,
    team_root: String,
    workspace_root: String,
    logical_paths: Vec<String>,
    destination_prefix: String,
) -> Result<Vec<String>, String> {
    let team_root = canonical_directory(&team_root)?;
    let workspace_root = canonical_workspace(&app, &workspace_root)?;
    let input_root =
        fs::canonicalize(workspace_root.join("inputs")).map_err(|error| error.to_string())?;
    if !input_root.starts_with(&workspace_root) {
        return Err("workspace input folder escapes Bees run data".into());
    }
    let destination_root = if destination_prefix.is_empty() {
        input_root.clone()
    } else {
        let destination = input_root.join(safe_relative(&destination_prefix)?);
        fs::create_dir_all(&destination).map_err(|error| error.to_string())?;
        fs::canonicalize(destination).map_err(|error| error.to_string())?
    };
    if !destination_root.starts_with(&input_root) {
        return Err("workspace input destination escapes the input folder".into());
    }
    let mut copied = Vec::with_capacity(logical_paths.len());
    for logical_path in logical_paths {
        let relative = safe_relative(&logical_path)?;
        let source = fs::canonicalize(team_root.join(&relative))
            .map_err(|_| format!("input file not found in the team folder: {logical_path}"))?;
        if !source.starts_with(&team_root) || !source.is_file() {
            return Err(format!("input is outside the team folder: {logical_path}"));
        }
        let destination = destination_root.join(&relative);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            let canonical_parent = fs::canonicalize(parent).map_err(|error| error.to_string())?;
            if !canonical_parent.starts_with(&destination_root) {
                return Err("workspace input escapes the input folder".into());
            }
        }
        fs::copy(source, destination).map_err(|error| error.to_string())?;
        copied.push(logical_path);
    }
    Ok(copied)
}

#[tauri::command]
fn write_workspace_output(
    app: tauri::AppHandle,
    workspace_root: String,
    output: String,
    contents: String,
) -> Result<String, String> {
    if contents.is_empty() || contents.len() > 1_000_000 {
        return Err("workspace output must be between 1 byte and 1 MB".into());
    }
    let workspace = canonical_workspace(&app, &workspace_root)?;
    let output_root =
        fs::canonicalize(workspace.join("outputs")).map_err(|error| error.to_string())?;
    if !output_root.starts_with(&workspace) {
        return Err("workspace output folder escapes Bees run data".into());
    }
    let destination = output_root.join(safe_relative(&output)?);
    let parent = destination
        .parent()
        .ok_or_else(|| "workspace output has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let canonical_parent = fs::canonicalize(parent).map_err(|error| error.to_string())?;
    if !canonical_parent.starts_with(&output_root) {
        return Err("workspace output escapes the output folder".into());
    }
    write_atomic(&destination, contents.as_bytes())?;
    Ok(output)
}

fn collect_relative_files(
    root: &Path,
    directory: &Path,
    files: &mut Vec<String>,
) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() {
            return Err("workspace outputs may not contain symbolic links".into());
        }
        if file_type.is_dir() {
            collect_relative_files(root, &entry.path(), files)?;
        } else if file_type.is_file() {
            files.push(
                entry
                    .path()
                    .strip_prefix(root)
                    .map_err(|error| error.to_string())?
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
        }
    }
    Ok(())
}

#[tauri::command]
fn collect_outputs(app: tauri::AppHandle, workspace_root: String) -> Result<Vec<String>, String> {
    let workspace = canonical_workspace(&app, &workspace_root)?;
    let output_root =
        fs::canonicalize(workspace.join("outputs")).map_err(|error| error.to_string())?;
    if !output_root.starts_with(&workspace) {
        return Err("workspace output folder escapes Bees run data".into());
    }
    let mut files = Vec::new();
    collect_relative_files(&output_root, &output_root, &mut files)?;
    files.sort();
    Ok(files)
}

fn text_preview(path: &Path) -> Result<(Option<String>, bool), String> {
    const LIMIT: usize = 256 * 1024;
    if !path.exists() {
        return Ok((None, false));
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let truncated = bytes.len() > LIMIT;
    let sample = &bytes[..bytes.len().min(LIMIT)];
    Ok((String::from_utf8(sample.to_vec()).ok(), truncated))
}

#[tauri::command]
fn preview_output(
    app: tauri::AppHandle,
    workspace_root: String,
    relative_output: String,
    team_root: String,
    logical_destination: String,
) -> Result<OutputPreview, String> {
    let workspace = canonical_workspace(&app, &workspace_root)?;
    let output_root =
        fs::canonicalize(workspace.join("outputs")).map_err(|error| error.to_string())?;
    if !output_root.starts_with(&workspace) {
        return Err("workspace output folder escapes Bees run data".into());
    }
    let output = fs::canonicalize(output_root.join(safe_relative(&relative_output)?))
        .map_err(|error| error.to_string())?;
    if !output.starts_with(&output_root) || !output.is_file() {
        return Err("output is outside the temporary workspace".into());
    }
    let team_root = canonical_directory(&team_root)?;
    let destination = team_root.join(safe_relative(&logical_destination)?);
    if destination.exists() {
        let canonical = fs::canonicalize(&destination).map_err(|error| error.to_string())?;
        if !canonical.starts_with(&team_root) || !canonical.is_file() {
            return Err("destination is outside the team folder".into());
        }
    }
    let (after, after_truncated) = text_preview(&output)?;
    let (before, before_truncated) = text_preview(&destination)?;
    Ok(OutputPreview {
        before,
        after,
        truncated: before_truncated || after_truncated,
    })
}

#[tauri::command]
fn publish_output(
    app: tauri::AppHandle,
    workspace_root: String,
    relative_output: String,
    team_root: String,
    logical_destination: String,
) -> Result<String, String> {
    let workspace = canonical_workspace(&app, &workspace_root)?;
    let output_root =
        fs::canonicalize(workspace.join("outputs")).map_err(|error| error.to_string())?;
    if !output_root.starts_with(&workspace) {
        return Err("workspace output folder escapes Bees run data".into());
    }
    let source = fs::canonicalize(output_root.join(safe_relative(&relative_output)?))
        .map_err(|error| error.to_string())?;
    if !source.starts_with(&output_root) || !source.is_file() {
        return Err("approved output is outside the temporary workspace".into());
    }

    let team_root = canonical_directory(&team_root)?;
    let destination = team_root.join(safe_relative(&logical_destination)?);
    let parent = destination
        .parent()
        .ok_or_else(|| "destination has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let canonical_parent = fs::canonicalize(parent).map_err(|error| error.to_string())?;
    if !canonical_parent.starts_with(&team_root) {
        return Err("destination escapes the team folder".into());
    }
    fs::copy(source, &destination).map_err(|error| error.to_string())?;
    Ok(logical_destination)
}

#[tauri::command]
fn cleanup_workspace(app: tauri::AppHandle, workspace_root: String) -> Result<(), String> {
    let workspace = canonical_workspace(&app, &workspace_root)?;
    fs::remove_dir_all(workspace).map_err(|error| error.to_string())
}

/// Columns `executions` gained after the app shipped. `schema.sql` is all
/// `CREATE TABLE IF NOT EXISTS`, so it does nothing to a table that already exists: a column
/// added to that file never reaches an install that already has the table, and the statements
/// at the bottom of the same file then select it and take the app down at startup. Adding it
/// here is the migration. `schema.sql` still has to carry the column for fresh installs.
const EXECUTION_ADDED_COLUMNS: &[(&str, &str)] = &[
    // Runs moved from a stream (`instance_id`, `stream_url`, `stream_offset`) to a
    // conversation. The three stale columns are left alone: dropping them buys nothing.
    ("conversation_id", "TEXT NOT NULL DEFAULT ''"),
    ("instance_uid", "TEXT"),
    ("conversation_snapshot_json", "TEXT"),
    ("conversation_text", "TEXT"),
    ("restarted_from_execution_id", "TEXT"),
];

const WORK_ITEM_ADDED_COLUMNS: &[(&str, &str)] = &[("goal_json", "TEXT NOT NULL DEFAULT 'null'")];

const SCHEDULE_ADDED_COLUMNS: &[(&str, &str)] =
    &[("mode", "TEXT NOT NULL DEFAULT 'run'"), ("role", "TEXT")];

fn column_exists(
    connection: &Connection,
    table: &str,
    column: &str,
) -> Result<bool, rusqlite::Error> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        if row.get::<_, String>(1)? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Runs before `schema.sql` so the statements at the bottom of it see every column.
/// Checking each column rather than keeping a version number makes this safe on a database
/// of any age, including one a crashed build already half-migrated.
fn migrate_database(connection: &Connection) -> Result<(), rusqlite::Error> {
    let table_exists = |table: &str| -> Result<bool, rusqlite::Error> {
        connection
            .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1")?
            .exists([table])
    };
    let has_executions = table_exists("executions")?;
    // A fresh database has no tables yet; `schema.sql` creates them already correct.
    if !has_executions {
        return Ok(());
    }

    for (column, definition) in EXECUTION_ADDED_COLUMNS {
        if !column_exists(connection, "executions", column)? {
            connection.execute_batch(&format!(
                "ALTER TABLE executions ADD COLUMN {column} {definition}"
            ))?;
        }
    }

    for (table, columns) in [
        ("work_items", WORK_ITEM_ADDED_COLUMNS),
        ("schedules", SCHEDULE_ADDED_COLUMNS),
    ] {
        if !table_exists(table)? {
            continue;
        }
        for (column, definition) in columns {
            if !column_exists(connection, table, column)? {
                connection.execute_batch(&format!(
                    "ALTER TABLE {table} ADD COLUMN {column} {definition}"
                ))?;
            }
        }
    }

    // `instance_id` became `instance_uid`. Carrying the values across is a no-op once done,
    // so it is safe on every launch.
    if column_exists(connection, "executions", "instance_id")? {
        connection.execute_batch(
            "UPDATE executions SET instance_uid = instance_id WHERE instance_uid IS NULL",
        )?;
    }
    Ok(())
}

fn initialize_database(app: &tauri::App) -> Result<Database, Box<dyn std::error::Error>> {
    let app_data = app.path().app_data_dir()?;
    fs::create_dir_all(&app_data)?;
    let connection = Connection::open(app_data.join("bees.db"))?;
    migrate_database(&connection)?;
    connection.execute_batch(include_str!("../schema.sql"))?;
    Ok(Database(Mutex::new(connection)))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let database_path = app.path().app_data_dir()?.join("bees.db");
            let database = initialize_database(app)?;
            app.manage(database);
            app.manage(start_credential_broker(database_path)?);
            app.manage(FlueManager(Mutex::new(None)));
            app.manage(KnowledgeWorkerManager(Mutex::new(None)));
            // Clear any llama-server orphaned by a prior crash/restart before the manager takes over.
            reap_orphan_llama_servers();
            app.manage(LocalModelManager::default());
            app.manage(OAuth(Mutex::new(None)));
            app.manage(ConnectionOAuth(Mutex::new(None)));
            app.manage(RunService::new());
            // Register the bees:// scheme at runtime so dev builds catch the OAuth
            // callback (packaged macOS builds also declare it in tauri.conf.json).
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_query,
            db_execute,
            db_transaction,
            validate_directory,
            list_agent_files,
            write_agent_file,
            write_team_skill,
            update_team_skill_rule,
            archive_team_skill,
            delete_agent_file,
            default_workspace_root,
            ensure_directory,
            create_workspace,
            copy_input_files,
            write_workspace_output,
            collect_outputs,
            preview_output,
            publish_output,
            cleanup_workspace,
            bind_flue_workspace,
            purge_flue_execution_state,
            copy_registry,
            copy_bundled_registry,
            inventory_registry,
            remove_registry,
            local_model_status,
            ensure_local_model,
            start_local_model,
            stop_local_model,
            cancel_local_model_download,
            delete_local_model,
            ensure_flue_runtime,
            ensure_knowledge_worker,
            restart_flue_runtime,
            detect_cli_tools,
            set_cli_tool_path,
            system_capacity,
            oauth_start,
            oauth_await,
            connection_oauth_start,
            connection_oauth_await,
            store_connection_secret,
            delete_connection_secret,
            api_server_override,
            start_run,
            stop_run,
            run_is_active,
            resume_run,
            software_project_get,
            software_project_select_folder,
            software_project_workspace,
            software_project_commit,
            software_project_snapshot,
            software_project_merge
        ])
        .run(tauri::generate_context!())
        .expect("error while running Bees");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standing_feedback_can_be_undone() {
        let root = std::env::temp_dir().join(format!(
            "bees-skill-rule-{}",
            loopback_token().expect("random name")
        ));
        fs::create_dir_all(&root).expect("team root");

        update_team_skill_rule(
            root.to_string_lossy().into_owned(),
            "review-work".into(),
            "Use fewer words".into(),
            None,
        )
        .expect("append rule");
        let path = root.join("skills/review-work/SKILL.md");
        assert!(fs::read_to_string(&path)
            .unwrap()
            .contains("- Use fewer words\n"));

        update_team_skill_rule(
            root.to_string_lossy().into_owned(),
            "review-work".into(),
            "Use fewer words".into(),
            Some(true),
        )
        .expect("remove rule");
        assert!(!fs::read_to_string(path)
            .unwrap()
            .contains("Use fewer words"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn a_chosen_cli_wins_until_its_binary_disappears() {
        let binary = std::env::temp_dir().join(format!(
            "bees-cli-{}",
            loopback_token().expect("random name")
        ));
        fs::write(&binary, b"#!/bin/sh\n").expect("binary");
        let chosen = BTreeMap::from([
            ("claude".to_string(), binary.display().to_string()),
            ("codex".to_string(), "/nowhere/codex".to_string()),
        ]);

        let usable = drop_missing_binaries(chosen);

        let claude = cli_tool_path(&usable, "claude", "claude").expect("chosen binary");
        assert_eq!(claude.path, binary.display().to_string());
        assert!(claude.custom);
        // The missing pick is ignored, so this falls through to PATH detection.
        assert!(cli_tool_path(&usable, "codex", "codex").is_none_or(|tool| !tool.custom));
        fs::remove_file(binary).expect("cleanup");
    }

    #[test]
    fn issues_a_distinct_high_entropy_token_per_launch() {
        let first = loopback_token().expect("token");
        let second = loopback_token().expect("token");
        assert_eq!(first.len(), 64);
        assert!(first.chars().all(|character| character.is_ascii_hexdigit()));
        assert_ne!(first, second);
    }

    #[test]
    fn production_flue_server_is_loopback_only() {
        let entry = include_str!("../../flue-runtime/project/start.mjs");
        assert!(entry.contains("hostname: \"127.0.0.1\""));
        assert!(entry.contains("process.env.PORT"));
    }

    #[test]
    fn trusted_capabilities_have_a_separate_authenticated_process() {
        let host = include_str!("../../flue-runtime/project/capability-server.mjs");
        let agent = include_str!("../../flue-runtime/project/.flue/agents/bees-run.ts");
        assert!(host.contains("BEES_CAPABILITY_TOKEN"));
        assert!(!host.contains("BEES_CREDENTIAL_BROKER_TOKEN"));
        assert!(agent.contains("BEES_CAPABILITY_HOST_URL"));
        assert!(!agent.contains("BEES_SELF_URL}/capabilities"));
    }

    #[test]
    fn deleting_a_run_removes_only_its_immutable_flue_state() {
        let state = std::env::temp_dir().join(format!(
            "bees-flue-state-{}",
            loopback_token().expect("random name")
        ));
        let instances = state.join("instances");
        let capabilities = state.join("capabilities");
        fs::create_dir_all(capabilities.join("run-1")).expect("capabilities");
        fs::create_dir_all(capabilities.join("run-2")).expect("peer capabilities");
        fs::create_dir_all(&instances).expect("instances");
        fs::write(instances.join("run-1.json"), b"{}").expect("pointer");
        fs::write(instances.join("run-2.json"), b"{}").expect("peer pointer");

        purge_flue_execution_state_at(&state, "run-1").expect("purge");

        assert!(!capabilities.join("run-1").exists());
        assert!(!instances.join("run-1.json").exists());
        assert!(capabilities.join("run-2").is_dir());
        assert!(instances.join("run-2.json").is_file());
        fs::remove_dir_all(state).expect("cleanup");
    }

    #[test]
    fn workspace_boundary_accepts_persistent_and_legacy_roots_only() {
        let base = std::env::temp_dir().join(format!(
            "bees-workspace-roots-{}",
            loopback_token().expect("random name")
        ));
        let persistent = base.join("data").join("runs");
        let legacy = base.join("cache").join("workspaces");
        let outside = base.join("outside");
        let persistent_run = persistent.join("run-new");
        let legacy_run = legacy.join("run-old");
        for directory in [&persistent_run, &legacy_run, &outside] {
            fs::create_dir_all(directory).expect("workspace fixture");
        }
        let roots = vec![
            fs::canonicalize(&persistent).expect("persistent root"),
            fs::canonicalize(&legacy).expect("legacy root"),
        ];

        assert_eq!(
            canonical_workspace_in_roots(persistent_run.to_str().unwrap(), &roots)
                .expect("new persistent workspace"),
            fs::canonicalize(&persistent_run).unwrap()
        );
        assert_eq!(
            canonical_workspace_in_roots(legacy_run.to_str().unwrap(), &roots)
                .expect("legacy pending workspace"),
            fs::canonicalize(&legacy_run).unwrap()
        );
        assert!(canonical_workspace_in_roots(persistent.to_str().unwrap(), &roots).is_err());
        assert!(canonical_workspace_in_roots(outside.to_str().unwrap(), &roots).is_err());

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, persistent.join("escaped"))
                .expect("escape symlink");
            assert!(canonical_workspace_in_roots(
                persistent.join("escaped").to_str().unwrap(),
                &roots
            )
            .is_err());
        }
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[test]
    fn broker_requires_the_catalog_and_immutable_run_grant() {
        let path = std::env::temp_dir().join(format!(
            "bees-broker-{}.sqlite",
            loopback_token().expect("random name")
        ));
        let connection = Connection::open(&path).expect("database");
        connection
            .execute_batch(
                "CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
                 CREATE TABLE executions (
                   id TEXT PRIMARY KEY, status TEXT NOT NULL, result_json TEXT
                 );",
            )
            .expect("schema");
        connection
            .execute(
                "INSERT INTO settings VALUES (?1, ?2)",
                [
                    "mcp_connections:team-1",
                    r#"[{"id":"connection-1","teamId":"team-1","secretRef":"secret-1"}]"#,
                ],
            )
            .expect("catalog");
        connection
            .execute(
                "INSERT INTO executions VALUES (?1, 'queued', ?2)",
                [
                    "run-1",
                    r#"{"initialData":{"teamId":"team-1","mcpConnections":[{"id":"connection-1","secretRef":"secret-1","tools":["read"]}]}}"#,
                ],
            )
            .expect("run");
        let request = broker_secret_request(
            "/secrets/secret-1?teamId=team-1&connectionId=connection-1&executionId=run-1",
        )
        .expect("request");
        assert!(broker_authorized(&path, &request).is_ok());
        let denied = BrokerSecretRequest {
            connection_id: "connection-2".into(),
            ..request
        };
        assert!(broker_authorized(&path, &denied).is_err());
        drop(connection);
        let _ = fs::remove_file(path);
    }

    fn args(list: &[&str]) -> Vec<String> {
        std::iter::once("bees-desktop")
            .chain(list.iter().copied())
            .map(str::to_owned)
            .collect()
    }

    #[test]
    fn reads_the_server_override_from_a_flag_or_the_environment() {
        // Both spellings of the flag, and both shorthands.
        assert_eq!(
            server_override_from(args(&["--server", "dev"]), None),
            "http://localhost:3000"
        );
        assert_eq!(
            server_override_from(args(&["--server=prod"]), None),
            "https://app.bees.bot"
        );
        assert_eq!(
            server_override_from(args(&[]), Some("http://127.0.0.1:4000/".into())),
            "http://127.0.0.1:4000"
        );
        // The flag wins over the variable, and no override is an empty string.
        assert_eq!(
            server_override_from(
                args(&["--server=prod"]),
                Some("http://localhost:3000".into())
            ),
            "https://app.bees.bot"
        );
        assert_eq!(server_override_from(args(&[]), None), "");
        // A trailing `--server` with nothing after it must not panic on the missing value.
        assert_eq!(server_override_from(args(&["--server"]), None), "");
    }
}
