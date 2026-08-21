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
    collections::{BTreeMap, BTreeSet},
    fmt::Write as _,
    fs,
    net::TcpListener,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{Manager, State};

use crate::process::{
    available_loopback_port, bind_loopback, reap_orphaned_node_sidecars, Sidecar,
};

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
    description: Option<String>,
    instructions: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RawAgentPluginSkill {
    directory: String,
    path: String,
    contents: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RawAgentPluginPackage {
    manifest: JsonValue,
    skills: Vec<RawAgentPluginSkill>,
    mcp: JsonValue,
    issues: Vec<String>,
    file_count: usize,
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

#[derive(Clone)]
struct CredentialStore(Arc<Mutex<Connection>>);

impl CredentialStore {
    fn open(path: &Path) -> Result<Self, String> {
        let connection = Connection::open(path).map_err(|error| error.to_string())?;
        connection
            .execute_batch(
                "PRAGMA busy_timeout = 5000;
                 CREATE TABLE IF NOT EXISTS connection_secrets (
                   secret_ref TEXT PRIMARY KEY,
                   secret TEXT NOT NULL
                 );",
            )
            .map_err(|error| error.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o600))
                .map_err(|error| error.to_string())?;
        }
        Ok(Self(Arc::new(Mutex::new(connection))))
    }

    fn write(&self, secret_ref: &str, secret: &str) -> Result<(), String> {
        let connection = self.0.lock().map_err(|error| error.to_string())?;
        write_secret(&connection, secret_ref, secret)
    }

    fn read(&self, secret_ref: &str) -> Result<String, String> {
        let connection = self.0.lock().map_err(|error| error.to_string())?;
        read_secret(&connection, secret_ref)
    }

    fn delete(&self, secret_ref: &str) -> Result<(), String> {
        let secret_ref = safe_identifier(secret_ref, "credential reference")?;
        let connection = self.0.lock().map_err(|error| error.to_string())?;
        connection
            .execute(
                "DELETE FROM connection_secrets WHERE secret_ref = ?1",
                [secret_ref],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn token(&self, secret_ref: &str) -> Result<String, String> {
        // Keep the lock through refresh: ChatGPT rotates refresh tokens, so two simultaneous
        // task starts must not both exchange the same one and persist different successors.
        let connection = self.0.lock().map_err(|error| error.to_string())?;
        connection_token(&connection, secret_ref, false)
    }

    fn refreshed_token(&self, secret_ref: &str) -> Result<String, String> {
        // The provider may revoke an access token before the expiry encoded in the JWT.
        let connection = self.0.lock().map_err(|error| error.to_string())?;
        connection_token(&connection, secret_ref, true)
    }
}

fn write_secret(connection: &Connection, secret_ref: &str, secret: &str) -> Result<(), String> {
    let secret_ref = safe_identifier(secret_ref, "credential reference")?;
    if secret.is_empty() || secret.len() > 128_000 {
        return Err("credential must be between 1 byte and 128 KB".into());
    }
    connection
        .execute(
            "INSERT INTO connection_secrets (secret_ref, secret) VALUES (?1, ?2)
             ON CONFLICT(secret_ref) DO UPDATE SET secret = excluded.secret",
            [secret_ref.as_str(), secret],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn read_secret(connection: &Connection, secret_ref: &str) -> Result<String, String> {
    let secret_ref = safe_identifier(secret_ref, "credential reference")?;
    connection
        .query_row(
            "SELECT secret FROM connection_secrets WHERE secret_ref = ?1",
            [secret_ref],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "The connection credential is unavailable.".to_string())
}

fn credential_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn store_connection_secret(
    credentials: State<'_, CredentialStore>,
    secret_ref: String,
    secret: String,
) -> Result<(), String> {
    credentials.write(&secret_ref, &secret)
}

#[tauri::command]
fn delete_connection_secret(
    credentials: State<'_, CredentialStore>,
    secret_ref: String,
) -> Result<Option<String>, String> {
    let warning = credentials
        .read(&secret_ref)
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
    credentials.delete(&secret_ref)?;
    Ok(warning)
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

fn refresh_oauth(
    connection: &Connection,
    secret_ref: &str,
    credential: &mut OAuthCredential,
) -> Result<(), String> {
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
        connection,
        secret_ref,
        &serde_json::to_string(credential).map_err(|error| error.to_string())?,
    )
}

fn connection_token(
    connection: &Connection,
    secret_ref: &str,
    force_refresh: bool,
) -> Result<String, String> {
    let stored = read_secret(connection, secret_ref)?;
    let Ok(mut oauth) = serde_json::from_str::<OAuthCredential>(&stored) else {
        return Ok(stored);
    };
    if force_refresh
        || oauth
            .expires_at
            .is_some_and(|expires| expires <= epoch_seconds() + 60)
    {
        refresh_oauth(connection, secret_ref, &mut oauth)?;
    }
    Ok(oauth.access_token)
}

struct BrokerSecretRequest {
    secret_ref: String,
    team_id: Option<String>,
    organization_id: Option<String>,
    connection_id: String,
    execution_id: Option<String>,
    discovery: bool,
    refresh: bool,
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
    let team_id = params
        .get("teamId")
        .map(|value| safe_identifier(value, "team ID"))
        .transpose()?;
    let organization_id = params
        .get("organizationId")
        .map(|value| safe_identifier(value, "organization ID"))
        .transpose()?;
    if team_id.is_some() == organization_id.is_some() {
        return Err("forbidden".into());
    }
    let connection_id = params.get("connectionId").ok_or("forbidden")?.to_owned();
    let execution_id = params.get("executionId").cloned();
    Ok(BrokerSecretRequest {
        secret_ref: safe_identifier(secret_ref, "credential reference")?,
        team_id,
        organization_id,
        connection_id: safe_identifier(&connection_id, "connection ID")?,
        discovery: params.get("purpose").map(String::as_str) == Some("discovery")
            && execution_id.is_none(),
        refresh: params.get("refresh").map(String::as_str) == Some("true"),
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
    json_connection(value, team_id, connection_id, secret_ref).is_some()
}

fn json_connection<'a>(
    value: &'a JsonValue,
    team_id: Option<&str>,
    connection_id: &str,
    secret_ref: &str,
) -> Option<&'a JsonValue> {
    value.as_array().and_then(|connections| {
        connections.iter().find(|connection| {
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

/// Whether this connection carries no credential at all, once it is known to be a real one.
fn broker_authorized(database_path: &Path, request: &BrokerSecretRequest) -> Result<bool, String> {
    let connection = Connection::open_with_flags(database_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| "forbidden".to_string())?;
    if let Some(organization_id) = request.organization_id.as_deref() {
        let stored: Option<String> = connection
            .query_row(
                "SELECT value_json FROM settings WHERE key = ?1",
                [format!("ai_connections:{organization_id}")],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| "forbidden".to_string())?;
        let catalog = stored
            .as_deref()
            .and_then(|value| serde_json::from_str(value).ok())
            .unwrap_or(JsonValue::Null);
        return json_connection_matches(
            &catalog,
            None,
            &request.connection_id,
            &request.secret_ref,
        )
        .then_some(false)
        .ok_or_else(|| "forbidden".to_string());
    }
    let team_id = request.team_id.as_deref().ok_or("forbidden")?;
    let stored: Option<String> = connection
        .query_row(
            "SELECT value_json FROM settings WHERE key = ?1",
            [format!("mcp_connections:{team_id}")],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "forbidden".to_string())?;
    let catalog = stored
        .as_deref()
        .and_then(|value| serde_json::from_str(value).ok())
        .unwrap_or(JsonValue::Null);
    let Some(entry) = json_connection(
        &catalog,
        Some(team_id),
        &request.connection_id,
        &request.secret_ref,
    ) else {
        return Err("forbidden".into());
    };
    let keyless = json_text(entry, "authType") == "none";
    if request.discovery {
        return Ok(keyless);
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
    if json_text(&seed, "teamId") != team_id
        || !has_granted_tools
        || !json_connection_matches(selected, None, &request.connection_id, &request.secret_ref)
    {
        return Err("forbidden".into());
    }
    Ok(keyless)
}

fn start_credential_broker(
    database_path: PathBuf,
    credentials: CredentialStore,
) -> Result<CredentialBroker, String> {
    use std::io::{Read, Write};
    let (listener, port) = bind_loopback()?;
    let token = loopback_token()?;
    let expected = token.clone();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            // One caller that connects and then stalls used to hold the only broker thread, so
            // every later secret request queued behind it and the agent that asked for it failed
            // with nothing but "an internal error". Each caller now gets its own thread and a
            // deadline.
            let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
            let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
            let expected = expected.clone();
            let database_path = database_path.clone();
            let credentials = credentials.clone();
            thread::spawn(move || {
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
                    // A connection to an API that needs no key has no stored secret, and asking for
                    // one answers "credential unavailable" for a credential that was never meant
                    // to exist.
                    if broker_authorized(&database_path, &request)? {
                        return Ok(String::new());
                    }
                    if request.refresh {
                        credentials.refreshed_token(&request.secret_ref)
                    } else {
                        credentials.token(&request.secret_ref)
                    }
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
            });
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
async fn connection_oauth_await(
    state: State<'_, ConnectionOAuth>,
    credentials: State<'_, CredentialStore>,
) -> Result<(), String> {
    let pending = state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .take()
        .ok_or("no connection authorization in progress")?;
    let credentials = credentials.inner().clone();
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
        credentials.write(
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

struct ManagedDsh {
    child: Sidecar,
    capability_child: Sidecar,
    runtime_root: PathBuf,
    port: u16,
    token: String,
    capability_port: u16,
    capability_token: String,
    /// The local models that were up, with the window each was started with. Ordered so a
    /// model starting, stopping, or coming back with a different window compares unequal and
    /// forces a restart — provider routes are composed once at boot.
    local_routes: BTreeMap<String, local_models::LocalModelRoute>,
    /// Provider credentials the running child was started with. Ordered so a changed
    /// connection compares unequal and forces a restart — the process reads its keys once.
    provider_env: BTreeMap<String, String>,
}

struct DshManager(Mutex<Option<ManagedDsh>>);

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
struct DshRuntimeInfo {
    base_url: String,
    /// Per-launch bearer for the whole DSH host. Binding to loopback is not an authorization
    /// boundary, so the token is handed to the webview only and is never persisted or logged.
    token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KnowledgeRuntimeInfo {
    url: String,
    token: String,
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

fn bundled_binary(name: &str) -> Result<PathBuf, String> {
    let extension = if cfg!(windows) { ".exe" } else { "" };
    std::env::current_exe()
        .map_err(|error| error.to_string())?
        .parent()
        .map(|directory| directory.join(format!("{name}{extension}")))
        .filter(|path| path.is_file())
        .ok_or_else(|| format!("The bundled {name} runtime is missing. Reinstall Bees."))
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

struct ManagedApiBridge {
    child: Sidecar,
    fingerprint: String,
    url: String,
}

struct ApiBridgeManager(Mutex<BTreeMap<String, ManagedApiBridge>>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiBridgeRequest {
    connection_id: String,
    spec_url: String,
    /// The document itself, when the API publishes none.
    spec: Option<String>,
    base_url: String,
    header_name: Option<String>,
    secret_ref: Option<String>,
    /// `all` for one tool per endpoint, `explicit` with `tool_ids`, or `dynamic` for meta-tools.
    tools: Option<String>,
    tool_ids: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiProbe {
    url: String,
    method: String,
    headers: BTreeMap<String, String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiAnswer {
    status: u16,
    body: String,
}

/// Call an address once, for proving a pasted request works or reading what an API says it offers.
///
/// Here rather than through the HTTP plugin: the address is one nobody has seen before, and the
/// plugin's scope would have to name every host on the internet to allow it. That scope is what
/// stops anything running in the window from reaching wherever it likes, and it is worth keeping.
#[tauri::command]
async fn probe_api_endpoint(request: ApiProbe) -> Result<ApiAnswer, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = credential_client()?;
        let method = reqwest::Method::from_bytes(request.method.to_uppercase().as_bytes())
            .map_err(|_| "unsupported HTTP method".to_string())?;
        let mut call = client.request(method, &request.url);
        for (name, value) in &request.headers {
            call = call.header(name, value);
        }
        let response = call.send().map_err(|error| error.to_string())?;
        let status = response.status().as_u16();
        // Enough for any document worth serving, and a ceiling on what one answer can cost.
        let body = response
            .text()
            .map_err(|error| error.to_string())?
            .chars()
            .take(4_000_000)
            .collect();
        Ok(ApiAnswer { status, body })
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Where the running local model answers, for the one call that names a generated endpoint.
#[tauri::command]
fn local_model_base_url(app: tauri::AppHandle) -> Result<String, String> {
    let routes = local_models::local_model_routes(&app)?;
    routes
        .get("active")
        .or_else(|| routes.values().next())
        .map(|route| route.url.trim_end_matches("/v1").to_string())
        .ok_or_else(|| "No local model is running.".to_string())
}

fn bundled_api_bridge(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let packaged = app.path().resource_dir().map_err(|error| error.to_string())?;
    [
        packaged.join("api-bridge/bridge.mjs"),
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../services/api-bridge/bridge.mjs"),
    ]
    .into_iter()
    .find(|path| path.is_file())
    .ok_or_else(|| "The Bees API bridge is missing. Reinstall Bees.".to_string())
}

#[tauri::command]
async fn ensure_api_bridge(
    app: tauri::AppHandle,
    request: ApiBridgeRequest,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || ensure_api_bridge_blocking(&app, request))
        .await
        .map_err(|error| error.to_string())?
}

fn ensure_api_bridge_blocking(
    app: &tauri::AppHandle,
    request: ApiBridgeRequest,
) -> Result<String, String> {
    let node = bundled_binary("bees-node")?;
    let bridge = bundled_api_bridge(app)?;
    let credentials = app.state::<CredentialStore>();
    let secret = request
        .secret_ref
        .as_deref()
        .map(|secret_ref| credentials.read(secret_ref))
        .transpose()?;
    // The key is in here because the bridge reads it once at startup: rotating it must replace
    // the process, not wait for the next restart.
    let fingerprint = serde_json::to_string(&serde_json::json!({
        "specUrl": &request.spec_url,
        "spec": &request.spec,
        "base": &request.base_url,
        "header": &request.header_name,
        "tools": &request.tools,
        "toolIds": &request.tool_ids,
        "secret": &secret,
    }))
    .map_err(|error| error.to_string())?;

    let manager = app.state::<ApiBridgeManager>();
    let mut running = manager.0.lock().map_err(|error| error.to_string())?;
    if let Some(existing) = running.get_mut(&request.connection_id) {
        if existing.fingerprint == fingerprint && existing.child.alive()? {
            return Ok(existing.url.clone());
        }
        running.remove(&request.connection_id);
    }

    let port = available_loopback_port()?;
    let url = format!("http://127.0.0.1:{port}/mcp");
    let logs = app.path().app_log_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&logs).map_err(|error| error.to_string())?;
    let log_path = logs.join("api-bridge.log");
    let log = open_rotating_log(&log_path)?;
    let errors = log.try_clone().map_err(|error| error.to_string())?;

    let mut command = Command::new(node);
    command.env_clear();
    inherit_runtime_environment(&mut command);
    command
        .arg(&bridge)
        .args(["--transport", "http", "--host", "127.0.0.1", "--path", "/mcp"])
        .args(["--port", &port.to_string()])
        .args(["--api-base-url", &request.base_url])
        .args(["--tools", request.tools.as_deref().unwrap_or("all")]);
    // A written document goes through the environment: a spec is far past what an argument holds.
    match request.spec.as_deref() {
        Some(document) => { command.env("OPENAPI_SPEC_INLINE", document); }
        None => { command.args(["--openapi-spec", &request.spec_url]); }
    }
    for id in request.tool_ids.iter().flatten() {
        command.args(["--tool", id]);
    }
    // Environment, not an argument: command lines are readable from `ps`.
    if let (Some(name), Some(value)) = (request.header_name.as_deref(), secret.as_deref()) {
        command.env("API_HEADERS", format!("{name}:{value}"));
    }

    let mut child = Sidecar::new(
        command
            .stdin(Stdio::null())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(errors))
            .spawn()
            .map_err(|error| format!("The API bridge could not start: {error}"))?,
    );
    wait_until_ready(&mut child, &url, &log_path, "The API bridge")?;
    running.insert(
        request.connection_id,
        ManagedApiBridge { child, fingerprint, url: url.clone() },
    );
    Ok(url)
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
        let credentials = app.state::<CredentialStore>();
        let token = match secret_ref
            .as_deref()
            .and_then(|secret_ref| credentials.token(secret_ref).ok())
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
            });
        }
        *managed = None;
    }

    let python = resolve_python().ok_or_else(|| {
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
    // A free port like the other sidecars. On a fixed one an orphan keeps it and every later
    // launch cannot bind.
    let port = available_loopback_port()?;
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
    Ok(KnowledgeRuntimeInfo { url, token })
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

fn bundled_dsh_paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
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
    let runtime = bundled_dsh_runtime(app)?;
    if !runtime
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh")
        .join("lib")
        .join("bin.js")
        .is_file()
        || !runtime.join("capability-server.mjs").is_file()
        || !runtime.join("profile").join("package.json").is_file()
        || !runtime.join("profile").join("cordis.patch.yml").is_file()
        || !runtime.join("plugin").join("lib").join("index.js").is_file()
    {
        return Err("The bundled DeepSeek Harness application is missing. Reinstall Bees.".into());
    }
    Ok((node, runtime))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredAiConnection {
    id: String,
    provider: String,
    secret_ref: String,
    base_url: Option<String>,
}

fn stored_ai_connections(
    app: &tauri::AppHandle,
    organization_id: &str,
) -> Result<Vec<StoredAiConnection>, String> {
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
    Ok(value
        .as_deref()
        .and_then(|value| serde_json::from_str(value).ok())
        .unwrap_or_default())
}

#[tauri::command]
fn available_ai_connection_ids(
    app: tauri::AppHandle,
    organization_id: String,
) -> Result<Vec<String>, String> {
    let organization_id = safe_identifier(&organization_id, "organization ID")?;
    let credentials = app.state::<CredentialStore>();
    Ok(stored_ai_connections(&app, &organization_id)?
        .into_iter()
        .filter(|stored| credentials.read(&stored.secret_ref).is_ok())
        .map(|stored| stored.id)
        .collect())
}

fn provider_environment(
    app: &tauri::AppHandle,
    organization_id: &str,
) -> Result<BTreeMap<String, String>, String> {
    let mut environment = BTreeMap::new();
    let credentials = app.state::<CredentialStore>();
    for stored in stored_ai_connections(app, organization_id)? {
        if stored.provider == "openai-codex" {
            if !environment.contains_key("BEES_OPENAI_CODEX_TOKEN") {
                if let Ok(secret) = credentials.token(&stored.secret_ref) {
                    environment.insert("BEES_OPENAI_CODEX_TOKEN".into(), secret);
                }
            }
            continue;
        }
        let variable = match stored.provider.as_str() {
            "anthropic" => "ANTHROPIC_API_KEY",
            "openai" => "OPENAI_API_KEY",
            "openrouter" => "OPENROUTER_API_KEY",
            "opencode-go" => "OPENCODE_API_KEY",
            "google" => "GEMINI_API_KEY",
            "mistral" => "MISTRAL_API_KEY",
            "groq" => "GROQ_API_KEY",
            "deepseek" => "DEEPSEEK_API_KEY",
            "xai" => "XAI_API_KEY",
            "cerebras" => "CEREBRAS_API_KEY",
            "together" => "TOGETHER_API_KEY",
            "fireworks" => "FIREWORKS_API_KEY",
            "openai-compatible" => "BEES_OPENAI_COMPATIBLE_API_KEY",
            _ => continue,
        };
        if environment.contains_key(variable) {
            continue;
        }
        if let Ok(secret) = credentials.token(&stored.secret_ref) {
            environment.insert(variable.to_string(), secret);
            if stored.provider == "openai-compatible" {
                if let Some(base_url) = stored.base_url.filter(|value| {
                    value.starts_with("https://") || value.starts_with("http://")
                }) {
                    environment.insert("BEES_OPENAI_COMPATIBLE_BASE_URL".into(), base_url);
                }
            }
        }
    }
    Ok(environment)
}

fn dsh_provider_profiles(
    provider_env: &BTreeMap<String, String>,
    local_routes: &BTreeMap<String, local_models::LocalModelRoute>,
) -> JsonValue {
    let mut profiles = Map::new();
    for (provider, variable) in [
        ("anthropic", "ANTHROPIC_API_KEY"),
        ("openai", "OPENAI_API_KEY"),
        ("openrouter", "OPENROUTER_API_KEY"),
        ("opencode-go", "OPENCODE_API_KEY"),
        ("openai-codex", "BEES_OPENAI_CODEX_TOKEN"),
        ("google", "GEMINI_API_KEY"),
        ("mistral", "MISTRAL_API_KEY"),
        ("groq", "GROQ_API_KEY"),
        ("deepseek", "DEEPSEEK_API_KEY"),
        ("xai", "XAI_API_KEY"),
        ("cerebras", "CEREBRAS_API_KEY"),
        ("together", "TOGETHER_API_KEY"),
        ("fireworks", "FIREWORKS_API_KEY"),
    ] {
        if provider_env.contains_key(variable) {
            profiles.insert(provider.into(), serde_json::json!({ "apiKeyEnv": variable }));
        }
    }
    if let Some(route) = local_routes.get("active") {
        let models = local_routes
            .iter()
            .filter(|(id, _)| id.as_str() != "active")
            .map(|(id, model_route)| {
                serde_json::json!({
                    "id": id,
                    "name": id,
                    "contextWindow": model_route.context_size,
                    "maxTokens": std::cmp::min(model_route.context_size / 4, 32_768),
                    "input": ["text"]
                })
            })
            .chain(std::iter::once(serde_json::json!({
                "id": "active",
                "name": "Active local model",
                "contextWindow": route.context_size,
                "maxTokens": std::cmp::min(route.context_size / 4, 32_768),
                "input": ["text"]
            })))
            .collect::<Vec<_>>();
        profiles.insert(
            "bees-local".into(),
            serde_json::json!({
                "displayName": "Bees local",
                "api": "openai-completions",
                "baseURL": route.url,
                "models": models
            }),
        );
    }
    if provider_env.contains_key("BEES_OPENAI_COMPATIBLE_API_KEY") {
        if let Some(base_url) = provider_env.get("BEES_OPENAI_COMPATIBLE_BASE_URL") {
            profiles.insert(
                "openai-compatible".into(),
                serde_json::json!({
                    "displayName": "OpenAI-compatible",
                    "apiKeyEnv": "BEES_OPENAI_COMPATIBLE_API_KEY",
                    "api": "openai-completions",
                    "baseURL": base_url,
                    "models": [{ "id": "default", "name": "Default" }]
                }),
            );
        }
    }
    JsonValue::Object(profiles)
}

// spawn_blocking: booting the local Node processes and probing readiness must not freeze the UI.
#[tauri::command]
async fn ensure_dsh_runtime(
    app: tauri::AppHandle,
    organization_id: String,
    team_id: String,
) -> Result<DshRuntimeInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_dsh_runtime_blocking(&app, &organization_id, &team_id)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn ensure_dsh_runtime_blocking(
    app: &tauri::AppHandle,
    organization_id: &str,
    _team_id: &str,
) -> Result<DshRuntimeInfo, String> {
    let (node, runtime_root) = bundled_dsh_paths(app)?;
    let provider_env = provider_environment(app, organization_id)?;
    let local_routes = local_model_routes(app)?;
    let manager = app.state::<DshManager>();
    let mut managed = manager.0.lock().map_err(|error| error.to_string())?;

    if let Some(runtime) = managed.as_mut() {
        let compatible = runtime.runtime_root == runtime_root
            && runtime.local_routes == local_routes
            && runtime.provider_env == provider_env;
        if compatible && runtime.child.alive()? {
            if !runtime.capability_child.alive()? {
                runtime.capability_child = spawn_capability_host(
                    &node,
                    &runtime_root,
                    &dsh_state_dir(app)?,
                    runtime.capability_port,
                    &runtime.capability_token,
                    &capability_log_path(app)?,
                )?;
            }
            let base_url = format!("http://127.0.0.1:{}", runtime.port);
            wait_until_ready(
                &mut runtime.child,
                &format!("{base_url}/healthz"),
                &runtime_log_path(app)?,
                "DeepSeek Harness",
            )?;
            return Ok(DshRuntimeInfo {
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
    let state_dir = dsh_state_dir(app)?;
    let capability_child = spawn_capability_host(
        &node,
        &runtime_root,
        &state_dir,
        capability_port,
        &capability_token,
        &capability_log_path(app)?,
    )?;
    let app_data = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let dsh_home = app_data.join("dsh");
    let profile = dsh_home.join("profiles").join("bees");
    copy_tree(&runtime_root.join("profile"), &profile, true)?;
    link_runtime_package(
        &runtime_root
            .join("node_modules")
            .join("@deepseek-ai")
            .join("dsh-session-persistence-sqlite"),
        &profile
            .join("node_modules")
            .join("@deepseek-ai")
            .join("dsh-session-persistence-sqlite"),
    )?;
    link_runtime_package(
        &runtime_root
            .join("node_modules")
            .join("@bees")
            .join("dsh-plugin"),
        &profile
            .join("node_modules")
            .join("@bees")
            .join("dsh-plugin"),
    )?;
    let default_workspace = app_data.join("workspaces");
    fs::create_dir_all(&default_workspace).map_err(|error| error.to_string())?;
    let resource_ui = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("bees-ui");
    let source_ui = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("dist");
    let ui_root = if resource_ui.is_dir() { resource_ui } else { source_ui };
    let dsh_bin = runtime_root
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh")
        .join("lib")
        .join("bin.js");
    let providers = serde_json::to_string(&dsh_provider_profiles(&provider_env, &local_routes))
        .map_err(|error| error.to_string())?;
    let broker = app.state::<CredentialBroker>();
    let mut command = Command::new(&node);
    command.env_clear();
    inherit_runtime_environment(&mut command);
    command
        .current_dir(&default_workspace)
        .arg(dsh_bin)
        .arg("--profile")
        .arg("bees")
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("--no-open")
        .env("DSH_HOME", &dsh_home)
        .env("DSH_TELEMETRY_DISABLED", "1")
        .env("BEES_DSH_TOKEN", &token)
        .env(
            "BEES_APP_URL",
            if cfg!(windows) {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            },
        )
        .env("BEES_DSH_PROVIDERS", providers)
        .env("BEES_DSH_SESSIONS_PATH", dsh_home.join("sessions.sqlite"))
        .env("BEES_DSH_QUERY_PATH", dsh_home.join("session-query.sqlite"))
        .env("BEES_DATABASE_PATH", app_data.join("bees.db"))
        .env("BEES_UI_ROOT", ui_root)
        .env("BEES_DEFAULT_WORKSPACE", &default_workspace)
        .env("BEES_CREDENTIAL_BROKER_URL", &broker.url)
        .env("BEES_CREDENTIAL_BROKER_TOKEN", &broker.token)
        .env("BEES_PARENT_PIPE", "1")
        .env("BEES_STATE_DIR", &state_dir)
        .env("BEES_CAPABILITY_HOST_URL", &capability_url)
        .env("BEES_CAPABILITY_TOKEN", &capability_token)
        .envs(&provider_env);
    let log = open_runtime_log(app)?;
    let log_errors = log.try_clone().map_err(|error| error.to_string())?;
    // Both children are Sidecars from here on, so any `?` below reaps whatever already started.
    let mut child = Sidecar::new(
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(log_errors))
            .spawn()
            .map_err(|error| format!("The bundled DeepSeek Harness runtime could not start: {error}"))?,
    );
    wait_until_ready(
        &mut child,
        &format!("{base_url}/healthz"),
        &runtime_log_path(app)?,
        "DeepSeek Harness",
    )?;
    *managed = Some(ManagedDsh {
        child,
        capability_child,
        runtime_root,
        port,
        token: token.clone(),
        capability_port,
        capability_token,
        local_routes,
        provider_env,
    });
    Ok(DshRuntimeInfo { base_url, token })
}

/// Block until the runtime will actually accept work. Readiness is not an open socket: the
/// DSH server binds its port well before it finishes loading agents, and it answers 503
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
            .env("BEES_PARENT_PIPE", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(errors))
            .spawn()
            .map_err(|error| format!("The local capability host could not start: {error}"))?,
    );
    let url = format!("http://127.0.0.1:{port}");
    wait_until_ready(&mut child, &url, log_path, "The local capability host")?;
    Ok(child)
}

/// Absolute path to Python for the optional local knowledge worker. This is unrelated to
/// model providers; native AI agents never use this login-shell lookup.
fn resolve_python() -> Option<String> {
    let output = if cfg!(target_os = "windows") {
        Command::new("where").arg("python3").output().ok()?
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
            .args(["-ilc", "command -v python3"])
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
}

/// An agent CLI Bees can run through.
struct CliTool {
    /// Key the app uses for this tool.
    id: &'static str,
}

const CLI_TOOLS: [CliTool; 1] = [CliTool { id: "claude" }];

/// An explicitly configured CLI the app will run.
#[derive(Serialize)]
struct CliToolPath {
    path: String,
    /// False once the user switches this CLI off by hand; runs stop being offered it.
    enabled: bool,
}

fn read_json_file(path: PathBuf) -> Option<JsonValue> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

fn cli_disabled_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("cli-disabled.json"))
        .map_err(|error| error.to_string())
}

/// Tool ids the user switched off by hand. Kept apart from the path overrides so switching a
/// CLI off does not forget the binary it was pointed at.
fn disabled_cli_tools(app: &tauri::AppHandle) -> BTreeSet<String> {
    cli_disabled_path(app)
        .ok()
        .and_then(read_json_file)
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default()
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

/// The same picks, minus any whose file is gone. Missing means disconnected; there is no scan.
fn usable_cli_overrides(app: &tauri::AppHandle) -> BTreeMap<String, String> {
    drop_missing_binaries(stored_cli_overrides(app))
}

fn drop_missing_binaries(overrides: BTreeMap<String, String>) -> BTreeMap<String, String> {
    overrides
        .into_iter()
        .filter(|(_, path)| Path::new(path).is_file())
        .collect()
}

/// The binary an external provider runs. There is intentionally no fallback or detection.
fn cli_tool_path(
    overrides: &BTreeMap<String, String>,
    tool: &CliTool,
) -> Option<CliToolPath> {
    let path = overrides.get(tool.id)?.clone();
    Some(CliToolPath {
        path,
        enabled: true,
    })
}

/// External agent CLIs explicitly chosen under Settings. This never scans the machine.
#[tauri::command]
fn configured_cli_tools(app: tauri::AppHandle) -> BTreeMap<String, CliToolPath> {
    let overrides = usable_cli_overrides(&app);
    let disabled = disabled_cli_tools(&app);
    CLI_TOOLS
        .iter()
        .filter_map(|tool| {
            cli_tool_path(&overrides, tool).map(|mut found| {
                found.enabled = !disabled.contains(tool.id);
                (tool.id.to_string(), found)
            })
        })
        .collect()
}

/// Switch a CLI off by hand: it stays installed and keeps its chosen binary, but runs stop
/// being offered it and the runtime is no longer told where it is.
#[tauri::command]
fn set_cli_tool_enabled(app: tauri::AppHandle, tool: String, enabled: bool) -> Result<(), String> {
    if !CLI_TOOLS.iter().any(|candidate| candidate.id == tool) {
        return Err(format!("{tool} is not a command-line agent"));
    }
    let mut disabled = disabled_cli_tools(&app);
    if enabled {
        disabled.remove(&tool);
    } else {
        disabled.insert(tool);
    }
    let content = serde_json::to_vec(&disabled).map_err(|error| error.to_string())?;
    write_atomic(&cli_disabled_path(&app)?, &content)
}

/// Point an external provider at a binary the user browsed to. Empty disconnects it.
#[tauri::command]
fn set_cli_tool_path(app: tauri::AppHandle, tool: String, path: String) -> Result<(), String> {
    if !CLI_TOOLS.iter().any(|candidate| candidate.id == tool) {
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
async fn restart_dsh_runtime(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = app.state::<DshManager>();
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
    [app.path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("runs")]
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

fn bundled_dsh_runtime(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let packaged = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("dsh-runtime");
    let source = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("dsh-runtime");
    let runtime = if packaged.is_dir() { packaged } else { source };
    if !runtime.is_dir() {
        return Err("The bundled DeepSeek Harness runtime is missing. Reinstall Bees.".into());
    }
    Ok(runtime)
}

// Trusted local modules execute from immutable run snapshots and resolve only the bundled
// dependency set through this one capability-host link.
fn link_runtime_modules(capability_root: &Path, modules: &Path) -> Result<(), String> {
    if !modules.is_dir() {
        return Err("The bundled DSH node_modules are missing. Reinstall Bees.".into());
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
            Err("Could not link the DSH runtime modules.".into())
        }
    }
}

fn link_runtime_package(source: &Path, link: &Path) -> Result<(), String> {
    if !source.is_dir() {
        return Err(format!("The bundled DSH package {} is missing.", source.display()));
    }
    let target = fs::canonicalize(source).map_err(|error| error.to_string())?;
    if fs::canonicalize(link).ok().as_ref() == Some(&target) {
        return Ok(());
    }
    if let Some(parent) = link.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    if link.symlink_metadata().is_ok() {
        let _ = fs::remove_file(link).or_else(|_| fs::remove_dir_all(link));
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link).map_err(|error| error.to_string())
    }
    #[cfg(windows)]
    {
        let status = Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .status()
            .map_err(|error| error.to_string())?;
        status
            .success()
            .then_some(())
            .ok_or_else(|| "Could not link a DSH profile package.".to_string())
    }
}

/// Mutable runtime state (run pointers, browser profiles), deliberately outside the immutable
/// DSH installation.
fn dsh_state_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("dsh-state");
    fs::create_dir_all(dir.join("instances")).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn runtime_log_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(dsh_state_dir(app)?.join("runtime.log"))
}

fn capability_log_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(dsh_state_dir(app)?.join("capability-host.log"))
}

/// The runtime's stdout and stderr, on disk.
///
/// Load-bearing for diagnosis: a packaged build has no terminal, so the sidecar's only durable
/// startup and agent error detail lives here.
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

fn snapshot_skill(
    capability_ref: String,
    name: String,
    description: String,
    instructions: String,
    directory: &Path,
) -> Result<SkillSnapshot, String> {
    let skill_md =
        fs::read_to_string(directory.join("SKILL.md")).map_err(|error| error.to_string())?;
    if skill_md.len() > 1_000_000 {
        return Err("SKILL.md must be 1 MB or smaller".into());
    }
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
/// One id per run: the Bees execution is also the DSH session, sandbox, and pointer key.
fn bind_dsh_workspace(
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
    let pointer_path = dsh_state_dir(&app)?
        .join("instances")
        .join(format!("{execution_id}.json"));
    let previous_capabilities = fs::read(&pointer_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<JsonValue>(&bytes).ok())
        .and_then(|value| value.get("capabilities").cloned())
        .unwrap_or_else(|| JsonValue::Array(Vec::new()));
    let mut skill_snapshots = Vec::new();
    let capability_pointers = if let Some(capabilities) = capabilities {
        let state = dsh_state_dir(&app)?;
        let capability_root = state.join("capabilities");
        let target = capability_root.join(&execution_id);
        if target.exists() {
            fs::remove_dir_all(&target).map_err(|error| error.to_string())?;
        }
        fs::create_dir_all(&target).map_err(|error| error.to_string())?;
        let modules = bundled_dsh_runtime(&app)?.join("node_modules");
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
                    capability
                        .description
                        .ok_or_else(|| "selected skill has no validated description".to_string())?,
                    capability
                        .instructions
                        .ok_or_else(|| "selected skill has no validated instructions".to_string())?,
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

fn purge_dsh_execution_state_at(state: &Path, execution_id: &str) -> Result<(), String> {
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
fn purge_dsh_execution_state(app: tauri::AppHandle, execution_id: String) -> Result<(), String> {
    purge_dsh_execution_state_at(&dsh_state_dir(&app)?, &execution_id)
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
        .join("dsh-runtime")
        .join("default-registry");
    let source = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("dsh-runtime")
        .join("default-registry");
    let registry = if packaged.is_dir() { packaged } else { source };
    if !registry.is_dir() {
        return Err("The bundled skills and tools folder is missing. Reinstall Bees.".into());
    }
    Ok(registry)
}

const AGENT_PLUGIN_SCHEMA: &str =
    "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";

fn valid_plugin_name(value: &str) -> bool {
    let count = value.chars().count();
    let mut characters = value.chars();
    let first = characters.next();
    let last = value.chars().last();
    (1..=64).contains(&count)
        && first.is_some_and(|character| character.is_ascii_alphanumeric())
        && last.is_some_and(|character| character.is_ascii_alphanumeric())
        && !value.contains("--")
        && !value.contains("..")
        && value.chars().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || character == '-'
                || character == '.'
        })
}

/// Validate from Bees' bundled 1.0.0 rules. Loading a package never fetches its `$schema` URL.
fn agent_plugin_manifest(root: &Path) -> Result<(JsonValue, Vec<String>), String> {
    let root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    let path = fs::canonicalize(root.join("plugin.json"))
        .map_err(|_| "Agent Plugin root must contain plugin.json".to_string())?;
    if !path.starts_with(&root) || !path.is_file() {
        return Err("plugin.json must be a regular file inside the plugin root".into());
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    if bytes.len() > 1_000_000 {
        return Err("plugin.json must be 1 MB or smaller".into());
    }
    let value: JsonValue =
        serde_json::from_slice(&bytes).map_err(|error| format!("plugin.json is invalid JSON: {error}"))?;
    let mut manifest = value
        .as_object()
        .cloned()
        .ok_or_else(|| "plugin.json must contain a JSON object".to_string())?;
    let known = [
        "$schema",
        "name",
        "version",
        "description",
        "author",
        "homepage",
        "repository",
        "license",
        "keywords",
        "extensions",
    ]
    .into_iter()
    .collect::<BTreeSet<_>>();
    let unknown = manifest
        .keys()
        .filter(|key| !known.contains(key.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    let mut issues = unknown
        .iter()
        .map(|field| format!("plugin.json: unknown field {field} was ignored."))
        .collect::<Vec<_>>();
    for field in unknown {
        manifest.remove(&field);
    }
    if manifest.get("$schema").and_then(JsonValue::as_str) != Some(AGENT_PLUGIN_SCHEMA) {
        return Err("plugin.json targets an unsupported Agent Plugins schema".into());
    }
    let name = manifest
        .get("name")
        .and_then(JsonValue::as_str)
        .ok_or_else(|| "plugin.json name must be a string".to_string())?;
    if !valid_plugin_name(name) {
        return Err("plugin.json name does not satisfy Agent Plugins 1.0.0 naming rules".into());
    }
    for field in [
        "version",
        "description",
        "homepage",
        "repository",
        "license",
    ] {
        if manifest.get(field).is_some_and(|value| !value.is_string()) {
            return Err(format!("plugin.json {field} must be a string"));
        }
    }
    if let Some(author) = manifest.get("author") {
        let author = author
            .as_object()
            .ok_or_else(|| "plugin.json author must be an object".to_string())?;
        if author.keys().any(|key| !["name", "email", "url"].contains(&key.as_str()))
            || author.values().any(|value| !value.is_string())
        {
            return Err("plugin.json author may contain only string name, email, and url fields".into());
        }
    }
    if manifest.get("keywords").is_some_and(|value| {
        !value
            .as_array()
            .is_some_and(|keywords| keywords.iter().all(JsonValue::is_string))
    }) {
        return Err("plugin.json keywords must be an array of strings".into());
    }
    if let Some(extensions) = manifest.remove("extensions") {
        if !extensions.is_object() {
            issues.push("plugin.json: non-object extensions field was ignored.".into());
        }
        // Bees implements no client extension namespaces. Values are deliberately not validated.
    }
    Ok((JsonValue::Object(manifest), issues))
}

fn discover_agent_plugin(root: &Path) -> Result<RawAgentPluginPackage, String> {
    let root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    let (manifest, mut issues) = agent_plugin_manifest(&root)?;
    let mut files = Vec::new();
    collect_relative_files(&root, &root, &mut files)?;
    let skills_path = root.join("skills");
    let mut skills = Vec::new();
    if skills_path.exists() {
        let resolved = fs::canonicalize(&skills_path).map_err(|error| error.to_string())?;
        if !resolved.starts_with(&root) || !resolved.is_dir() {
            issues.push("skills/: fixed location is not a directory inside the plugin root; skills were disabled.".into());
        } else {
            for entry in fs::read_dir(&resolved).map_err(|error| error.to_string())? {
                let entry = entry.map_err(|error| error.to_string())?;
                if !entry.file_type().map_err(|error| error.to_string())?.is_dir() {
                    continue;
                }
                let file_name = entry.file_name();
                let display_name = file_name.to_string_lossy().into_owned();
                let Ok(directory) = file_name.into_string() else {
                    issues.push(format!(
                        "skills/{display_name}/SKILL.md has a non-UTF-8 parent directory; skill was skipped."
                    ));
                    continue;
                };
                let skill_path = entry.path().join("SKILL.md");
                let Ok(metadata) = fs::symlink_metadata(&skill_path) else {
                    continue;
                };
                if !metadata.file_type().is_file() {
                    continue;
                }
                let resolved_skill = fs::canonicalize(&skill_path).map_err(|error| error.to_string())?;
                if !resolved_skill.starts_with(&root) {
                    issues.push(format!(
                        "skills/{}/SKILL.md escapes the plugin root; skill was skipped.",
                        display_name
                    ));
                    continue;
                }
                let bytes = fs::read(&resolved_skill).map_err(|error| error.to_string())?;
                if bytes.len() > 1_000_000 {
                    issues.push(format!(
                        "skills/{}/SKILL.md exceeds 1 MB; skill was skipped.",
                        display_name
                    ));
                    continue;
                }
                let Ok(contents) = String::from_utf8(bytes) else {
                    issues.push(format!(
                        "skills/{}/SKILL.md is not UTF-8; skill was skipped.",
                        display_name
                    ));
                    continue;
                };
                skills.push(RawAgentPluginSkill {
                    path: format!("skills/{directory}/SKILL.md"),
                    directory,
                    contents,
                });
            }
        }
    }
    skills.sort_by(|left, right| left.path.cmp(&right.path));
    let mcp_path = root.join("mcp.json");
    let mcp = if mcp_path.exists() {
        let resolved = fs::canonicalize(&mcp_path).map_err(|error| error.to_string())?;
        if !resolved.starts_with(&root) || !resolved.is_file() {
            issues.push("mcp.json: fixed location is not a regular file inside the plugin root; MCP was disabled.".into());
            JsonValue::Null
        } else {
            let bytes = fs::read(resolved).map_err(|error| error.to_string())?;
            if bytes.len() > 1_000_000 {
                issues.push("mcp.json exceeds 1 MB; MCP was disabled.".into());
                JsonValue::Null
            } else {
                serde_json::from_slice(&bytes).unwrap_or_else(|error| {
                    issues.push(format!("mcp.json is invalid JSON ({error}); MCP was disabled."));
                    JsonValue::Null
                })
            }
        }
    } else {
        JsonValue::Null
    };
    Ok(RawAgentPluginPackage {
        manifest,
        skills,
        mcp,
        issues,
        file_count: files.len(),
    })
}

fn install_agent_plugin_from(
    app: &tauri::AppHandle,
    registry_id: &str,
    source: &Path,
) -> Result<RawAgentPluginPackage, String> {
    // Manifest-first on the selected package, before component discovery or copying.
    agent_plugin_manifest(source)?;
    let destination = registry_root(app, registry_id)?;
    let temporary = destination.with_extension("tmp");
    if temporary.exists() {
        fs::remove_dir_all(&temporary).map_err(|error| error.to_string())?;
    }
    copy_tree(source, &temporary, true)?;
    // Validate the immutable installed copy too, closing the source-validation/copy race.
    let package = discover_agent_plugin(&temporary)?;
    if destination.exists() {
        fs::remove_dir_all(&destination).map_err(|error| error.to_string())?;
    }
    fs::rename(&temporary, &destination).map_err(|error| error.to_string())?;
    Ok(package)
}

#[tauri::command]
fn install_agent_plugin(
    app: tauri::AppHandle,
    registry_id: String,
    source_path: String,
) -> Result<RawAgentPluginPackage, String> {
    let source = canonical_directory(&source_path)?;
    install_agent_plugin_from(&app, &registry_id, &source)
}

#[tauri::command]
fn install_bundled_agent_plugin(
    app: tauri::AppHandle,
    registry_id: String,
) -> Result<RawAgentPluginPackage, String> {
    install_agent_plugin_from(&app, &registry_id, &bundled_default_registry(&app)?)
}

#[tauri::command]
fn remove_registry(app: tauri::AppHandle, registry_id: String) -> Result<(), String> {
    let root = registry_root(&app, &registry_id)?;
    if root.exists() {
        fs::remove_dir_all(root).map_err(|error| error.to_string())?;
    }
    Ok(())
}

// Public collections publish Agent Plugins through a Claude Code marketplace manifest, which
// names each plugin and where its files live. Bees stages only the portable Agent Plugins
// 1.0.0 core out of an entry — `skills/` and `mcp.json` — so a repository carrying a client's
// agents, commands, and hooks still installs as the small package the specification describes.

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CatalogEntry {
    name: String,
    description: String,
    /// Repository-relative directory holding this plugin's own files. Empty is the root.
    source: String,
    /// Repository-relative skill directories, listed by the manifest or found in the tree.
    skills: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct McpRegistryServer {
    name: String,
    title: String,
    description: String,
    url: String,
    transport: String,
    /// The entry declares headers it expects, so connecting it takes a key from its publisher.
    requires_key: bool,
}

fn catalog_client(timeout: Duration) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(timeout)
        // The GitHub API answers 403 without one.
        .user_agent("bees-desktop")
        .build()
        .map_err(|error| error.to_string())
}

fn fetch_json(url: &str) -> Result<JsonValue, String> {
    let response = catalog_client(Duration::from_secs(30))?
        .get(url)
        .send()
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("{url} answered {}", response.status()));
    }
    response.json().map_err(|error| error.to_string())
}

fn github_repo(value: &str) -> Result<String, String> {
    let segments = value.split('/').collect::<Vec<_>>();
    let usable = |segment: &&str| {
        (1..=100).contains(&segment.len())
            && !segment.starts_with('.')
            && segment.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
            })
    };
    if segments.len() != 2 || !segments.iter().all(usable) {
        return Err(format!("{value} is not an owner/name GitHub repository"));
    }
    Ok(segments.join("/"))
}

/// A repository-relative path with no traversal, drive root, or Windows separator. An empty
/// result is the repository root, which marketplace entries write as `./`.
fn repo_relative(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_start_matches("./").trim_matches('/');
    if trimmed.is_empty() {
        return Some(String::new());
    }
    let safe = !trimmed.contains('\\')
        && trimmed
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..");
    safe.then(|| trimmed.to_string())
}

fn repo_join(base: &str, suffix: &str) -> String {
    if base.is_empty() {
        suffix.to_string()
    } else {
        format!("{base}/{suffix}")
    }
}

/// Marketplace entries take two shapes: one names its skills outright and keeps them at the
/// repository root, the other points at a self-contained directory. `skill_directories` holds
/// every directory in the repository that has a `SKILL.md`, which settles both.
fn catalog_entries(marketplace: &JsonValue, skill_directories: &BTreeSet<String>) -> Vec<CatalogEntry> {
    let Some(plugins) = marketplace.get("plugins").and_then(JsonValue::as_array) else {
        return Vec::new();
    };
    plugins
        .iter()
        .filter_map(|entry| {
            let name = entry.get("name").and_then(JsonValue::as_str)?;
            // A marketplace may point an entry at some other repository, which arrives as an
            // object rather than a path. Bees installs from the repository it was given.
            let source = repo_relative(entry.get("source").and_then(JsonValue::as_str)?)?;
            let skills = match entry.get("skills").and_then(JsonValue::as_array) {
                Some(listed) => listed
                    .iter()
                    .filter_map(JsonValue::as_str)
                    .filter_map(repo_relative)
                    .filter(|path| skill_directories.contains(path))
                    .collect(),
                None => {
                    let prefix = repo_join(&source, "skills/");
                    skill_directories
                        .iter()
                        .filter(|path| {
                            path.strip_prefix(&prefix)
                                .is_some_and(|skill| !skill.contains('/'))
                        })
                        .cloned()
                        .collect()
                }
            };
            Some(CatalogEntry {
                name: name.to_string(),
                description: entry
                    .get("description")
                    .and_then(JsonValue::as_str)
                    .unwrap_or_default()
                    .to_string(),
                source,
                skills,
            })
        })
        .collect()
}

fn plugin_catalog_blocking(repo: &str) -> Result<Vec<CatalogEntry>, String> {
    let repo = github_repo(repo)?;
    let marketplace = fetch_json(&format!(
        "https://raw.githubusercontent.com/{repo}/HEAD/.claude-plugin/marketplace.json"
    ))?;
    // One recursive tree read answers "which skills does this ship" for every entry at once.
    let tree = fetch_json(&format!(
        "https://api.github.com/repos/{repo}/git/trees/HEAD?recursive=1"
    ))?;
    let skill_directories = tree
        .get("tree")
        .and_then(JsonValue::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| entry.get("path").and_then(JsonValue::as_str))
                .filter_map(|path| path.strip_suffix("/SKILL.md"))
                .map(str::to_string)
                .collect::<BTreeSet<_>>()
        })
        .unwrap_or_default();
    Ok(catalog_entries(&marketplace, &skill_directories))
}

fn download_repository(repo: &str, into: &Path) -> Result<PathBuf, String> {
    let bytes = catalog_client(Duration::from_secs(180))?
        .get(format!("https://codeload.github.com/{repo}/tar.gz/HEAD"))
        .send()
        .and_then(|response| response.error_for_status())
        .and_then(|response| response.bytes())
        .map_err(|error| format!("{repo} could not be downloaded: {error}"))?;
    let archive = into.join("source.tar.gz");
    fs::write(&archive, &bytes).map_err(|error| error.to_string())?;
    // Every desktop Bees supports ships tar; unpacking in-process would cost two crates.
    let output = Command::new("tar")
        .arg("-xzf")
        .arg(&archive)
        .arg("-C")
        .arg(into)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("tar could not start: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "tar could not read the {repo} archive: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    fs::remove_file(&archive).ok();
    // codeload names the single extracted directory `{repository}-{ref}`.
    fs::read_dir(into)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .find(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| entry.path())
        .ok_or_else(|| format!("the {repo} archive held no directory"))
}

/// Resolve a repository-relative path inside the extracted archive. The paths arrive from the
/// window, so containment is checked here rather than assumed.
fn contained_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative =
        repo_relative(relative).ok_or_else(|| format!("{relative} is not a repository path"))?;
    let candidate = root.join(&relative);
    let Ok(resolved) = fs::canonicalize(&candidate) else {
        // Nothing is there to copy. Callers test existence; an absent path cannot escape.
        return Ok(candidate);
    };
    if !resolved.starts_with(root) {
        return Err(format!("{relative} escapes the downloaded repository"));
    }
    Ok(resolved)
}

fn stage_catalog_plugin(root: &Path, entry: &CatalogEntry, staging: &Path) -> Result<(), String> {
    let root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    if !valid_plugin_name(&entry.name) {
        return Err(format!(
            "{} does not satisfy Agent Plugins 1.0.0 naming rules",
            entry.name
        ));
    }
    fs::create_dir_all(staging).map_err(|error| error.to_string())?;
    let mut manifest = Map::new();
    manifest.insert(
        "$schema".into(),
        JsonValue::String(AGENT_PLUGIN_SCHEMA.into()),
    );
    manifest.insert("name".into(), JsonValue::String(entry.name.clone()));
    if !entry.description.is_empty() {
        manifest.insert(
            "description".into(),
            JsonValue::String(entry.description.clone()),
        );
    }
    fs::write(
        staging.join("plugin.json"),
        serde_json::to_vec_pretty(&JsonValue::Object(manifest)).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    for skill in &entry.skills {
        let source = contained_path(&root, skill)?;
        let Some(directory) = source.file_name() else {
            continue;
        };
        if source.is_dir() {
            copy_tree(&source, &staging.join("skills").join(directory), true)?;
        }
    }
    let mcp = contained_path(&root, &repo_join(&entry.source, "mcp.json"))?;
    if mcp.is_file() {
        fs::copy(&mcp, staging.join("mcp.json")).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn plugin_catalog(repo: String) -> Result<Vec<CatalogEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || plugin_catalog_blocking(&repo))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn install_catalog_plugin(
    app: tauri::AppHandle,
    registry_id: String,
    repo: String,
    entry: CatalogEntry,
) -> Result<RawAgentPluginPackage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo = github_repo(&repo)?;
        let workspace = std::env::temp_dir().join(format!("bees-catalog-{}", loopback_token()?));
        fs::create_dir_all(&workspace).map_err(|error| error.to_string())?;
        let installed = (|| {
            let root = download_repository(&repo, &workspace)?;
            let staging = workspace.join("plugin");
            stage_catalog_plugin(&root, &entry, &staging)?;
            install_agent_plugin_from(&app, &registry_id, &staging)
        })();
        fs::remove_dir_all(&workspace).ok();
        installed
    })
    .await
    .map_err(|error| error.to_string())?
}

fn search_mcp_registry_blocking(query: &str) -> Result<Vec<McpRegistryServer>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("Say what the server should do, for example \"salesforce\".".into());
    }
    // `version=latest` collapses the one-row-per-published-version the registry returns.
    let url = reqwest::Url::parse_with_params(
        "https://registry.modelcontextprotocol.io/v0/servers",
        &[("search", query), ("version", "latest"), ("limit", "50")],
    )
    .map_err(|error| error.to_string())?;
    let page = fetch_json(url.as_str())?;
    let servers = page
        .get("servers")
        .and_then(JsonValue::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(servers
        .iter()
        .filter_map(|found| {
            let server = found.get("server")?;
            let name = server.get("name").and_then(JsonValue::as_str)?;
            // Bees connects to hosted endpoints. An entry shipping only a local package has
            // no URL to connect to, and Bees runs no stdio MCP servers.
            let remote = server
                .get("remotes")
                .and_then(JsonValue::as_array)?
                .iter()
                .find(|remote| {
                    matches!(
                        remote.get("type").and_then(JsonValue::as_str),
                        Some("streamable-http" | "sse")
                    )
                })?;
            Some(McpRegistryServer {
                title: server
                    .get("title")
                    .and_then(JsonValue::as_str)
                    .unwrap_or(name)
                    .to_string(),
                name: name.to_string(),
                description: server
                    .get("description")
                    .and_then(JsonValue::as_str)
                    .unwrap_or_default()
                    .to_string(),
                url: remote.get("url").and_then(JsonValue::as_str)?.to_string(),
                transport: remote.get("type").and_then(JsonValue::as_str)?.to_string(),
                requires_key: remote
                    .get("headers")
                    .and_then(JsonValue::as_array)
                    .is_some_and(|headers| !headers.is_empty()),
            })
        })
        .collect())
}

#[tauri::command]
async fn search_mcp_registry(query: String) -> Result<Vec<McpRegistryServer>, String> {
    tauri::async_runtime::spawn_blocking(move || search_mcp_registry_blocking(&query))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn validate_directory(path: String) -> Result<String, String> {
    canonical_directory(&path).map(|path| path.to_string_lossy().into_owned())
}

/// Folders nobody picks a work-item input from, and that would dominate the walk if kept.
const PICKER_SKIPPED: [&str; 3] = ["node_modules", "target", "dist"];
const PICKER_LIMIT: usize = 5_000;

/// Symlinks are skipped rather than followed: a link out of the folder would list files the
/// picker cannot reference anyway, and a link back into it would loop.
fn collect_picker_files(
    root: &Path,
    directory: &Path,
    files: &mut Vec<String>,
) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        if files.len() >= PICKER_LIMIT {
            return Ok(());
        }
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || PICKER_SKIPPED.contains(&name.as_str()) {
            continue;
        }
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            collect_picker_files(root, &entry.path(), files)?;
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

/// The file tree behind the work-item file picker: paths relative to a mapped folder, which is
/// exactly the form a logical file reference takes. Capped at PICKER_LIMIT so a huge folder
/// cannot hang the page — an unreadable subfolder fails the whole call, as with the other walks.
#[tauri::command]
fn list_location_files(path: String) -> Result<Vec<String>, String> {
    let root = canonical_directory(&path)?;
    let mut files = Vec::new();
    collect_picker_files(&root, &root, &mut files)?;
    files.sort();
    Ok(files)
}

/// Reads one file inside a mapped folder as text, for the kanban card's inline Files tab.
/// `None` means the file does not exist yet (a work item can reference a file before it is
/// created).
#[tauri::command]
fn read_location_file(root: String, relative: String) -> Result<Option<String>, String> {
    let root = canonical_directory(&root)?;
    let path = root.join(safe_relative(&relative)?);
    if !path.exists() {
        return Ok(None);
    }
    let canonical = fs::canonicalize(&path).map_err(|error| error.to_string())?;
    if !canonical.starts_with(&root) || !canonical.is_file() {
        return Err("file is outside the configured folder".into());
    }
    let (content, truncated) = text_preview(&canonical)?;
    if truncated {
        return Err("file is too large to edit here".into());
    }
    content.ok_or_else(|| "file is not text".into()).map(Some)
}

/// Writes one file inside a mapped folder, creating parent folders as needed — the save side of
/// the kanban card's inline Files tab.
#[tauri::command]
fn write_location_file(root: String, relative: String, contents: String) -> Result<(), String> {
    let root = canonical_directory(&root)?;
    let relative = safe_relative(&relative)?;
    let path = root.join(&relative);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&path, contents).map_err(|error| error.to_string())?;
    let canonical = fs::canonicalize(&path).map_err(|error| error.to_string())?;
    if !canonical.starts_with(&root) {
        return Err("file is outside the configured folder".into());
    }
    Ok(())
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

fn team_skills_plugin_root(team_root: &str) -> Result<PathBuf, String> {
    let team = canonical_directory(team_root)?;
    let plugin = team.join("plugins").join("team-skills");
    fs::create_dir_all(plugin.join("skills")).map_err(|error| error.to_string())?;
    let plugin = fs::canonicalize(plugin).map_err(|error| error.to_string())?;
    if !plugin.starts_with(&team) {
        return Err("team skills plugin escapes the team folder".into());
    }
    let manifest = plugin.join("plugin.json");
    if !manifest.exists() {
        write_atomic(
            &manifest,
            br#"{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "team-skills",
  "description": "Reusable skills created by this Bees team"
}
"#,
        )?;
    }
    Ok(plugin)
}

fn valid_skill_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && !value.contains("--")
        && value
            .chars()
            .all(|character| character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-')
        && !value.starts_with('-')
        && !value.ends_with('-')
}

#[tauri::command]
fn ensure_team_skills_plugin(team_root: String) -> Result<String, String> {
    team_skills_plugin_root(&team_root).map(|path| path.to_string_lossy().into_owned())
}

/// Skills written by Bees live inside a standard team-owned Agent Plugin package.
#[tauri::command]
fn write_team_skill(team_root: String, slug: String, contents: String) -> Result<String, String> {
    if contents.is_empty() || contents.len() > 1_000_000 {
        return Err("skill file must be between 1 byte and 1 MB".into());
    }
    if !valid_skill_name(&slug) {
        return Err("skill name does not satisfy the Agent Skills naming rules".into());
    }
    let directory = team_skills_plugin_root(&team_root)?.join("skills").join(&slug);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    write_atomic(&directory.join("SKILL.md"), contents.as_bytes())?;
    Ok(format!("plugins/team-skills/skills/{slug}/SKILL.md"))
}

#[tauri::command]
fn update_team_skill_rule(
    team_root: String,
    slug: String,
    reason: String,
    remove: Option<bool>,
) -> Result<(), String> {
    if !valid_skill_name(&slug) {
        return Err("skill name does not satisfy the Agent Skills naming rules".into());
    }
    let reason = reason.split_whitespace().collect::<Vec<_>>().join(" ");
    if reason.is_empty() {
        return Err("feedback reason must not be empty".into());
    }
    let directory = team_skills_plugin_root(&team_root)?.join("skills").join(&slug);
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

/// Retires a skill by moving it under the team plugin's skills/.archive/<slug>. A move, not
/// a delete: the curator proposes retirement from usage alone, so the recovery for a wrong call
/// has to be dragging one folder back. An existing archived copy is replaced.
#[tauri::command]
fn archive_team_skill(team_root: String, slug: String) -> Result<String, String> {
    if !valid_skill_name(&slug) {
        return Err("skill name does not satisfy the Agent Skills naming rules".into());
    }
    let skills = team_skills_plugin_root(&team_root)?.join("skills");
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
    Ok(format!("plugins/team-skills/skills/.archive/{slug}"))
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
    database: State<'_, Database>,
    team_root: String,
    workspace_root: String,
    logical_paths: Vec<String>,
    destination_prefix: String,
    project_work_item_id: Option<String>,
) -> Result<Vec<String>, String> {
    let team_root = canonical_directory(&team_root)?;
    // A Software Project run works in the user's own worktree, which is not Bees run data and
    // has no inputs/ folder. Its inputs go to a Bees-owned folder Git is told to ignore.
    let (workspace_root, input_root) = match project_work_item_id {
        Some(work_item_id) => {
            let worktree = processes::software_project::canonical_project_workspace(
                &database,
                &work_item_id,
                &workspace_root,
            )?;
            let inputs = worktree.join(processes::software_project::PROJECT_INPUT_PREFIX);
            fs::create_dir_all(&inputs).map_err(|error| error.to_string())?;
            processes::software_project::ignore_bees_directory(&worktree)?;
            let inputs = fs::canonicalize(inputs).map_err(|error| error.to_string())?;
            (worktree, inputs)
        }
        None => {
            let workspace = canonical_workspace(&app, &workspace_root)?;
            let inputs =
                fs::canonicalize(workspace.join("inputs")).map_err(|error| error.to_string())?;
            (workspace, inputs)
        }
    };
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

/// Columns schema.sql declares, per table. Tracks paren depth to find each table body.
fn declared_columns(schema: &str) -> Vec<(String, Vec<(String, String)>)> {
    const MARKER: &str = "CREATE TABLE IF NOT EXISTS ";
    let uncommented = schema
        .lines()
        .filter(|line| !line.trim_start().starts_with("--"))
        .collect::<Vec<_>>()
        .join("\n");
    let mut tables = Vec::new();
    let mut rest = uncommented.as_str();
    while let Some(marker) = rest.find(MARKER) {
        rest = &rest[marker + MARKER.len()..];
        let Some(open) = rest.find('(') else { break };
        let table = rest[..open].trim().to_string();
        let mut depth = 0usize;
        let mut close = None;
        for (offset, character) in rest[open..].char_indices() {
            match character {
                '(' => depth += 1,
                ')' => {
                    depth = depth.saturating_sub(1);
                    if depth == 0 {
                        close = Some(open + offset);
                        break;
                    }
                }
                _ => {}
            }
        }
        let Some(close) = close else { break };
        tables.push((table, split_columns(&rest[open + 1..close])));
        rest = &rest[close..];
    }
    tables
}

/// Splits a table body on its top-level commas, dropping table-level constraints.
fn split_columns(body: &str) -> Vec<(String, String)> {
    let mut columns = Vec::new();
    let mut depth = 0usize;
    let mut current = String::new();
    for character in body.chars() {
        match character {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            ',' if depth == 0 => {
                collect_column(&mut columns, &current);
                current.clear();
                continue;
            }
            _ => {}
        }
        current.push(character);
    }
    collect_column(&mut columns, &current);
    columns
}

fn collect_column(columns: &mut Vec<(String, String)>, raw: &str) {
    const CONSTRAINTS: [&str; 5] = ["PRIMARY", "FOREIGN", "UNIQUE", "CHECK", "CONSTRAINT"];
    let definition = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let Some(name) = definition.split_whitespace().next() else {
        return;
    };
    if CONSTRAINTS
        .iter()
        .any(|keyword| name.eq_ignore_ascii_case(keyword))
    {
        return;
    }
    columns.push((name.to_string(), definition));
}

/// CREATE TABLE IF NOT EXISTS does nothing to a table that exists, so a column added after a
/// release never reaches an older database. Add it first, before the indexes and triggers.
fn add_missing_columns(
    connection: &Connection,
    schema: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    for (table, columns) in declared_columns(schema) {
        let existing = connection
            .prepare(&format!("PRAGMA table_info({table})"))?
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?;
        // New table; the batch below creates it.
        if existing.is_empty() {
            continue;
        }
        for (name, definition) in columns {
            if existing.iter().any(|column| column == &name) {
                continue;
            }
            // SQLite is the authority on what it can add: it refuses UNIQUE and PRIMARY KEY
            // outright, and NOT NULL without a default once the table has rows. Stop on those
            // rather than half-apply a schema.
            connection
                .execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {definition}"))
                .map_err(|error| format!("{table}.{name} needs a hand-written migration: {error}"))?;
        }
    }
    Ok(())
}

/// listProcesses joins process_definitions, so a workflow made before that table existed drops out
/// of the join and the team looks empty. Rebuild the row it is missing.
///
/// Before definitions existed, a bundled workflow carried its identity as a `module:<id>` tag, and
/// those tags are still there. Keep it: a Goals or Code workflow that comes back as hand-made loses
/// the renderer and the capabilities its module declares, and an interactive one starts reading as
/// automatic, which is the difference between agents waiting and agents running on their own.
fn backfill_process_definitions(connection: &Connection) -> Result<(), Box<dyn std::error::Error>> {
    connection.execute(
        r#"INSERT INTO process_definitions (process_id, definition_json)
           SELECT p.id, json_set(?1, '$.moduleId',
                    (SELECT substr(t.tag, 8) FROM tags t
                      WHERE t.entity = 'process' AND t.entity_id = p.id AND t.tag LIKE 'module:%'
                      LIMIT 1))
             FROM processes p
            WHERE NOT EXISTS (SELECT 1 FROM process_definitions d WHERE d.process_id = p.id)"#,
        [r#"{"moduleId":null,"version":1,"automation":"automatic","renderer":"default","stateIds":{},"capabilities":[],"roleBindings":[]}"#],
    )?;
    Ok(())
}

fn initialize_database(app: &tauri::App) -> Result<Database, Box<dyn std::error::Error>> {
    let app_data = app.path().app_data_dir()?;
    fs::create_dir_all(&app_data)?;
    let connection = Connection::open(app_data.join("bees.db"))?;
    let schema = include_str!("../schema.sql");
    add_missing_columns(&connection, schema)?;
    connection.execute_batch(schema)?;
    backfill_process_definitions(&connection)?;
    Ok(Database(Mutex::new(connection)))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();
    // A second copy shares the database, models and ports, and its reap kills the running
    // llama-server. Raise the existing window instead. Release only, so tauri dev still works.
    #[cfg(all(desktop, not(debug_assertions)))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _directory| {
            // Linux and Windows start a new process for a bees:// link, and that is the one
            // being turned away here, so pass it on or the OAuth callback is lost.
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().handle_cli_arguments(argv.iter());
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if let Ok((node, _)) = bundled_dsh_paths(app.handle()) {
                reap_orphaned_node_sidecars(&node);
            }
            let app_data = app.path().app_data_dir()?;
            let database_path = app_data.join("bees.db");
            let database = initialize_database(app)?;
            app.manage(database);
            let credentials = CredentialStore::open(&app_data.join("credentials.db"))?;
            app.manage(credentials.clone());
            app.manage(start_credential_broker(database_path, credentials)?);
            app.manage(DshManager(Mutex::new(None)));
            app.manage(KnowledgeWorkerManager(Mutex::new(None)));
            app.manage(ApiBridgeManager(Mutex::new(BTreeMap::new())));
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
            list_location_files,
            read_location_file,
            write_location_file,
            list_agent_files,
            write_agent_file,
            ensure_team_skills_plugin,
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
            bind_dsh_workspace,
            purge_dsh_execution_state,
            install_agent_plugin,
            install_bundled_agent_plugin,
            plugin_catalog,
            install_catalog_plugin,
            search_mcp_registry,
            remove_registry,
            local_model_status,
            ensure_local_model,
            start_local_model,
            stop_local_model,
            cancel_local_model_download,
            delete_local_model,
            ensure_dsh_runtime,
            ensure_knowledge_worker,
            ensure_api_bridge,
            local_model_base_url,
            probe_api_endpoint,
            restart_dsh_runtime,
            configured_cli_tools,
            set_cli_tool_path,
            set_cli_tool_enabled,
            oauth_start,
            oauth_await,
            connection_oauth_start,
            connection_oauth_await,
            store_connection_secret,
            delete_connection_secret,
            available_ai_connection_ids,
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

    /// The two marketplace shapes in the wild: an entry that lists its skills and keeps them at
    /// the repository root, and one that points at a self-contained plugin directory.
    #[test]
    fn a_catalog_reads_both_marketplace_shapes_and_keeps_traversal_out() {
        let directories = ["skills/xlsx", "skills/docx", "plugins/debug/skills/tracing"]
            .into_iter()
            .map(str::to_string)
            .collect::<BTreeSet<_>>();
        let marketplace = serde_json::json!({
            "plugins": [
                { "name": "documents", "source": "./", "skills": ["./skills/xlsx", "./skills/docx"] },
                { "name": "debug", "source": "./plugins/debug" },
                { "name": "agents-only", "source": "./plugins/agents-only" },
                { "name": "escaping", "source": "./", "skills": ["../../etc/passwd"] },
                { "name": "elsewhere", "source": { "repo": "other/repo" } }
            ]
        });
        let entries = catalog_entries(&marketplace, &directories);
        // The entry pointing at another repository is not installable from this one.
        assert_eq!(entries.len(), 4);
        // A listed entry keeps the order its publisher wrote; a derived one is tree order.
        assert_eq!(entries[0].skills, ["skills/xlsx", "skills/docx"]);
        assert_eq!(entries[1].skills, ["plugins/debug/skills/tracing"]);
        // Nothing to install, so the window can grey it out instead of staging an empty plugin.
        assert!(entries[2].skills.is_empty());
        assert!(entries[3].skills.is_empty());
        assert_eq!(repo_relative("../secrets"), None);
        assert_eq!(repo_relative("skills/../../etc"), None);
        assert_eq!(repo_relative("./"), Some(String::new()));
        assert!(github_repo("owner/name/extra").is_err());
        assert!(github_repo("owner/../name").is_err());
    }

    /// v0.1.1 shipped without stages.is_terminal and re-running the schema does not add it.
    #[test]
    fn an_older_database_gains_a_column_added_after_its_release() {
        let connection = Connection::open_in_memory().expect("database");
        connection
            .execute_batch("CREATE TABLE IF NOT EXISTS stages (id TEXT PRIMARY KEY, name TEXT);")
            .expect("the schema that shipped");
        connection
            .execute_batch("INSERT INTO stages (id, name) VALUES ('review', 'Review');")
            .expect("a row the user already has");

        let schema = "CREATE TABLE IF NOT EXISTS stages (\n  id TEXT PRIMARY KEY,\n  name TEXT,\n  -- added after the release\n  is_terminal INTEGER NOT NULL DEFAULT 0 CHECK (is_terminal IN (0, 1))\n);";
        add_missing_columns(&connection, schema).expect("column added");
        connection.execute_batch(schema).expect("schema reapplied");

        let terminal: i64 = connection
            .query_row("SELECT is_terminal FROM stages WHERE id = 'review'", [], |row| row.get(0))
            .expect("the existing row keeps its place and takes the default");
        assert_eq!(terminal, 0);

        // Running it again must do nothing rather than fail on a duplicate column.
        add_missing_columns(&connection, schema).expect("second run is a no-op");
    }

    /// A workflow made before process_definitions existed is dropped by the join that lists them.
    #[test]
    fn a_workflow_made_before_its_definition_table_still_lists() {
        let connection = Connection::open_in_memory().expect("database");
        connection
            .execute_batch(
                "CREATE TABLE processes (id TEXT PRIMARY KEY, name TEXT);\
                 CREATE TABLE process_definitions (process_id TEXT PRIMARY KEY, definition_json TEXT NOT NULL);\
                 CREATE TABLE tags (entity TEXT NOT NULL, entity_id TEXT NOT NULL, tag TEXT NOT NULL);\
                 INSERT INTO processes (id, name) VALUES ('bidding', 'Bidding'), ('goals', 'Goals');\
                 INSERT INTO tags (entity, entity_id, tag) VALUES ('process', 'goals', 'module:goals');",
            )
            .expect("a hand-made workflow and a bundled one, both from before the table existed");

        backfill_process_definitions(&connection).expect("backfill");

        let listed: i64 = connection
            .query_row(
                "SELECT count(*) FROM processes p JOIN process_definitions d ON d.process_id = p.id",
                [],
                |row| row.get(0),
            )
            .expect("the join that lists workflows");
        assert_eq!(listed, 2);

        let module = |id: &str| -> Option<String> {
            connection
                .query_row(
                    "SELECT json_extract(definition_json, '$.moduleId') FROM process_definitions WHERE process_id = ?1",
                    [id],
                    |row| row.get(0),
                )
                .expect("the definition just written")
        };
        // The tag is the only thing left that says this one came from the library.
        assert_eq!(module("goals").as_deref(), Some("goals"));
        assert_eq!(module("bidding"), None);

        backfill_process_definitions(&connection).expect("second run is a no-op");
    }

    /// ALTER TABLE cannot add these to a table with rows.
    #[test]
    fn a_column_needing_a_real_migration_is_refused() {
        let connection = Connection::open_in_memory().expect("database");
        connection
            .execute_batch("CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY);")
            .expect("existing table");

        let schema = "CREATE TABLE IF NOT EXISTS teams (\n  id TEXT PRIMARY KEY,\n  slug TEXT UNIQUE\n);";
        assert!(add_missing_columns(&connection, schema).is_err());
    }

    /// Constraints are not columns, and a table the batch has yet to create is left alone.
    #[test]
    fn table_constraints_and_absent_tables_are_skipped() {
        let parsed = declared_columns(
            "CREATE TABLE IF NOT EXISTS runs (\n  id TEXT PRIMARY KEY,\n  team_id TEXT NOT NULL,\n  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'done')),\n  FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE\n);",
        );
        let (table, columns) = parsed.first().expect("one table");
        assert_eq!(table, "runs");
        let names = columns.iter().map(|(name, _)| name.as_str()).collect::<Vec<_>>();
        assert_eq!(names, ["id", "team_id", "state"]);

        let connection = Connection::open_in_memory().expect("database");
        add_missing_columns(&connection, "CREATE TABLE IF NOT EXISTS runs (\n  id TEXT PRIMARY KEY\n);")
            .expect("an absent table is the batch's job, not ours");
    }

    #[test]
    fn agent_plugin_manifest_is_closed_but_unknown_fields_are_non_fatal() {
        let root = std::env::temp_dir().join(format!(
            "bees-agent-plugin-{}",
            loopback_token().expect("random name")
        ));
        fs::create_dir_all(root.join("skills").join("summarize")).expect("plugin root");
        fs::write(
            root.join("plugin.json"),
            r#"{"$schema":"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json","name":"acme.tools","unknown":true,"extensions":"ignored"}"#,
        )
        .expect("manifest");
        fs::write(
            root.join("skills/summarize/SKILL.md"),
            "---\nname: summarize\ndescription: Summarize things\n---\n\nDo it.\n",
        )
        .expect("skill");

        let package = discover_agent_plugin(&root).expect("valid plugin");
        assert_eq!(package.skills.len(), 1);
        assert_eq!(package.issues.len(), 2);
        assert!(package.manifest.get("unknown").is_none());
        assert!(package.manifest.get("extensions").is_none());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn agent_plugin_manifest_rejects_fatal_schema_violations() {
        let root = std::env::temp_dir().join(format!(
            "bees-invalid-agent-plugin-{}",
            loopback_token().expect("random name")
        ));
        fs::create_dir_all(&root).expect("plugin root");
        fs::write(
            root.join("plugin.json"),
            r#"{"$schema":"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json","name":"Invalid--Name"}"#,
        )
        .expect("manifest");
        assert!(agent_plugin_manifest(&root).is_err());
        fs::remove_dir_all(root).expect("cleanup");
    }

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
        let path = root.join("plugins/team-skills/skills/review-work/SKILL.md");
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
    fn an_external_cli_uses_only_an_explicit_existing_pick() {
        let home = std::env::temp_dir().join(format!(
            "bees-cli-home-{}",
            loopback_token().expect("random name")
        ));
        fs::create_dir_all(&home).expect("home");
        let chosen = home.join("my-claude");
        fs::write(&chosen, b"#!/bin/sh\n").expect("chosen binary");
        let claude = &CLI_TOOLS[0];
        let picked = BTreeMap::from([("claude".to_string(), chosen.display().to_string())]);
        let found = cli_tool_path(&picked, claude).expect("chosen binary");
        assert_eq!(found.path, chosen.display().to_string());
        let stale = drop_missing_binaries(BTreeMap::from([(
            "claude".to_string(),
            "/nowhere/claude".to_string(),
        )]));
        assert!(cli_tool_path(&stale, claude).is_none());
        assert!(cli_tool_path(&BTreeMap::new(), claude).is_none());
        fs::remove_dir_all(home).expect("cleanup");
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
    fn local_credential_store_round_trips_without_an_os_vault() {
        let path = std::env::temp_dir().join(format!(
            "bees-credentials-{}.db",
            loopback_token().expect("random name")
        ));
        let store = CredentialStore::open(&path).expect("credential store");
        store.write("connection-1", "first").expect("write");
        assert_eq!(store.read("connection-1").unwrap(), "first");
        store.write("connection-1", "second").expect("replace");
        assert_eq!(store.read("connection-1").unwrap(), "second");
        store.delete("connection-1").expect("delete");
        assert!(store.read("connection-1").is_err());
        drop(store);
        fs::remove_file(path).expect("cleanup");
    }

    #[test]
    fn production_dsh_server_is_authenticated() {
        let plugin = include_str!("../../dsh-runtime/plugin/lib/index.js");
        assert!(plugin.contains("BEES_DSH_TOKEN"));
        assert!(plugin.contains("http://127.0.0.1"));
        assert!(plugin.contains("timingSafeEqual"));
    }

    #[test]
    fn trusted_capabilities_have_a_separate_authenticated_process() {
        let host = include_str!("../../dsh-runtime/capability-server.mjs");
        let agent = include_str!("../../dsh-runtime/plugin/lib/agent-runtime.js");
        assert!(host.contains("BEES_CAPABILITY_TOKEN"));
        assert!(!host.contains("BEES_CREDENTIAL_BROKER_TOKEN"));
        assert!(agent.contains("BEES_CAPABILITY_HOST_URL"));
        assert!(!agent.contains("BEES_SELF_URL}/capabilities"));
    }

    #[test]
    fn deleting_a_run_removes_only_its_immutable_dsh_state() {
        let state = std::env::temp_dir().join(format!(
            "bees-dsh-state-{}",
            loopback_token().expect("random name")
        ));
        let instances = state.join("instances");
        let capabilities = state.join("capabilities");
        fs::create_dir_all(capabilities.join("run-1")).expect("capabilities");
        fs::create_dir_all(capabilities.join("run-2")).expect("peer capabilities");
        fs::create_dir_all(&instances).expect("instances");
        fs::write(instances.join("run-1.json"), b"{}").expect("pointer");
        fs::write(instances.join("run-2.json"), b"{}").expect("peer pointer");

        purge_dsh_execution_state_at(&state, "run-1").expect("purge");

        assert!(!capabilities.join("run-1").exists());
        assert!(!instances.join("run-1.json").exists());
        assert!(capabilities.join("run-2").is_dir());
        assert!(instances.join("run-2.json").is_file());
        fs::remove_dir_all(state).expect("cleanup");
    }

    #[test]
    fn workspace_boundary_accepts_only_persistent_run_roots() {
        let base = std::env::temp_dir().join(format!(
            "bees-workspace-roots-{}",
            loopback_token().expect("random name")
        ));
        let persistent = base.join("data").join("runs");
        let outside = base.join("outside");
        let persistent_run = persistent.join("run-new");
        for directory in [&persistent_run, &outside] {
            fs::create_dir_all(directory).expect("workspace fixture");
        }
        let roots = vec![fs::canonicalize(&persistent).expect("persistent root")];

        assert_eq!(
            canonical_workspace_in_roots(persistent_run.to_str().unwrap(), &roots)
                .expect("new persistent workspace"),
            fs::canonicalize(&persistent_run).unwrap()
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
            "/secrets/secret-1?teamId=team-1&connectionId=connection-1&executionId=run-1&refresh=true",
        )
        .expect("request");
        assert!(request.refresh);
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

#[cfg(test)]
mod real_database_tests {
    use super::*;

    /// Real schema.sql against a copy of this machine's database, when there is one. Skipped
    /// elsewhere. A fixture cannot catch schema.sql drifting past a database from an old release.
    #[test]
    fn upgrades_the_database_this_machine_already_has() {
        let Some(home) = std::env::var_os("HOME") else {
            return;
        };
        let live =
            PathBuf::from(home).join("Library/Application Support/bot.bees.desktop/bees.db");
        if !live.exists() {
            return;
        }

        // A copy, so the real one is untouched.
        let copy = std::env::temp_dir().join(format!(
            "bees-upgrade-{}.db",
            loopback_token().expect("random name")
        ));
        fs::copy(&live, &copy).expect("copy the live database");
        let connection = Connection::open(&copy).expect("open the copy");

        let stages_before: i64 = connection
            .query_row("SELECT count(*) FROM stages", [], |row| row.get(0))
            .unwrap_or(0);

        let schema = include_str!("../schema.sql");
        add_missing_columns(&connection, schema).expect("missing columns are addable");
        connection.execute_batch(schema).expect("schema applies");
        backfill_process_definitions(&connection).expect("definitions are backfilled");

        // Every workflow has to survive the join that lists them, or the team reads as empty.
        let orphans: i64 = connection
            .query_row(
                "SELECT count(*) FROM processes p
                  WHERE NOT EXISTS (SELECT 1 FROM process_definitions d WHERE d.process_id = p.id)",
                [],
                |row| row.get(0),
            )
            .expect("orphan count");
        assert_eq!(orphans, 0, "a workflow with no definition disappears from the app");

        for (table, columns) in declared_columns(schema) {
            let present = connection
                .prepare(&format!("PRAGMA table_info({table})"))
                .expect("table info")
                .query_map([], |row| row.get::<_, String>(1))
                .expect("column names")
                .collect::<Result<Vec<_>, _>>()
                .expect("column names");
            if present.is_empty() {
                continue;
            }
            for (name, _) in columns {
                assert!(present.contains(&name), "{table}.{name} missing after upgrade");
            }
        }

        let stages_after: i64 = connection
            .query_row("SELECT count(*) FROM stages", [], |row| row.get(0))
            .unwrap_or(0);
        assert_eq!(stages_before, stages_after, "an upgrade must not lose rows");

        // The query that fails on a v0.1.1 database has to work on the upgraded one.
        connection
            .prepare("SELECT id, position, is_terminal FROM stages WHERE archived_at IS NULL")
            .expect("the approval path's query")
            .query_map([], |row| row.get::<_, String>(0))
            .expect("rows")
            .collect::<Result<Vec<_>, _>>()
            .expect("rows");

        let _ = fs::remove_file(&copy);
    }
}
