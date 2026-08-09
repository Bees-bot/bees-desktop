//! Ownership of the Bees half of a run.
//!
//! Flue 2 recovers the agent's work across crashes, but it cannot finish Bees' application
//! transaction: create the receipt, collect the workspace outputs, validate them, and settle
//! into exactly one terminal status. That used to live in a webview promise, so reloading the
//! page abandoned it. It lives here instead, for the life of the Tauri process.
//!
//! The webview is a disposable client: it starts and stops work and renders stored state.
//!
//! ponytail: settlement is discovered by polling `?view=history` for the submission's entry in
//! `settlements[]`, not by holding the durable stream open. Settlement is durable, so polling
//! is correct — just up to one interval late. The webview keeps `@flue/sdk` for live token
//! rendering, which is where latency actually shows. Swap in a streaming read here only if a
//! settled run visibly lags.

use crate::{
    canonical_workspace, collect_relative_files,
    processes::goals::validate_run as validate_task_plan_run, Database,
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::{
    collections::HashSet,
    fmt::Write as _,
    path::Path,
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

const POLL_INTERVAL: Duration = Duration::from_millis(1_200);
/// Ceiling on one submission. Matches the durability timeout the agents declare.
const RUN_TIMEOUT: Duration = Duration::from_secs(60 * 60);

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    pub execution_id: String,
    pub delivery_id: String,
    pub agent_name: String,
    pub prompt: String,
    pub workspace: String,
    pub base_url: String,
    pub token: String,
    #[serde(default)]
    pub instance_uid: Option<String>,
    pub continuation: bool,
    #[serde(default)]
    pub initial_data: Option<JsonValue>,
    /// Agent validation rules, e.g. `require-output`, `extension:.md`.
    #[serde(default)]
    pub validation_rules: Vec<String>,
    #[serde(default)]
    pub task_plan: Option<TaskPlanRunContext>,
    #[serde(default)]
    pub project_mode: bool,
    #[serde(default)]
    pub manual_projection: bool,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskPlanRunContext {
    pub state: String,
    pub output: String,
    #[serde(default)]
    pub output_blocked_states: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RunSettled {
    pub execution_id: String,
    pub status: String,
    pub outputs: Vec<String>,
    pub status_id: String,
    pub error: Option<String>,
}

#[derive(Default)]
pub struct RunService(Mutex<HashSet<String>>);

impl RunService {
    pub fn new() -> Self {
        Self::default()
    }

    fn register(&self, execution_id: &str) -> Result<(), String> {
        let mut active = self.0.lock().map_err(|error| error.to_string())?;
        if !active.insert(execution_id.to_owned()) {
            return Err("This run is already in flight".into());
        }
        Ok(())
    }

    fn finish(&self, execution_id: &str) {
        if let Ok(mut active) = self.0.lock() {
            active.remove(execution_id);
        }
    }

    pub fn is_active(&self, execution_id: &str) -> bool {
        self.0
            .lock()
            .map(|active| active.contains(execution_id))
            .unwrap_or(false)
    }
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        // Admission and history are short control-plane requests; model work happens after the
        // 202 receipt. A short timeout keeps the one-hour settlement deadline honest.
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| error.to_string())
}

fn conversation_url(request: &RunRequest) -> String {
    format!(
        "{}/agents/{}/{}",
        request.base_url.trim_end_matches('/'),
        urlencode(&request.agent_name),
        urlencode(&request.execution_id)
    )
}

fn urlencode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

#[derive(Clone)]
struct Admission {
    submission_id: String,
    uid: String,
}

fn admit(request: &RunRequest) -> Result<Admission, String> {
    let uid = if request.continuation {
        JsonValue::String(
            request
                .instance_uid
                .clone()
                .filter(|uid| !uid.is_empty())
                .ok_or_else(|| "A follow-up requires the conversation's Flue uid".to_string())?,
        )
    } else {
        // Create-only prevents an initial message from accidentally continuing stale state.
        JsonValue::Null
    };
    let mut payload = serde_json::json!({
        "kind": "user",
        "body": request.prompt,
        "uid": uid,
        // One key names one message delivery. A crash resend converges; a follow-up gets a
        // fresh key and therefore a fresh settlement in this same conversation.
        "idempotencyKey": request.delivery_id,
    });
    if !request.continuation {
        payload["initialData"] = request.initial_data.clone().ok_or_else(|| {
            "A new Bees conversation requires its immutable run configuration".to_string()
        })?;
    }
    let response = client()?
        .post(conversation_url(request))
        .bearer_auth(&request.token)
        .json(&payload)
        .send()
        .map_err(|_| format!("Can't reach the local runtime at {}", request.base_url))?;
    let status = response.status();
    let body: JsonValue = response
        .json()
        .map_err(|error| format!("The runtime returned an unreadable response: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "Flue returned {status}: {}",
            body.get("error")
                .and_then(|error| error.get("message"))
                .and_then(JsonValue::as_str)
                .unwrap_or("no detail")
        ));
    }
    Ok(Admission {
        submission_id: text(&body, "submissionId"),
        uid: text(&body, "uid"),
    })
}

fn text(value: &JsonValue, key: &str) -> String {
    value
        .get(key)
        .and_then(JsonValue::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn history(request: &RunRequest) -> Result<JsonValue, String> {
    let response = client()?
        .get(format!("{}?view=history", conversation_url(request)))
        .bearer_auth(&request.token)
        .send()
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Flue history returned {}", response.status()));
    }
    response.json().map_err(|error| error.to_string())
}

/// The submission's terminal outcome, or `None` while it is still running.
fn settlement(conversation: &JsonValue, submission_id: &str) -> Option<(String, Option<String>)> {
    conversation
        .get("settlements")?
        .as_array()?
        .iter()
        .find(|entry| text(entry, "submissionId") == submission_id)
        .map(|entry| {
            let error = entry
                .get("error")
                .and_then(|value| {
                    value
                        .get("message")
                        .and_then(JsonValue::as_str)
                        .map(str::to_owned)
                        .or_else(|| value.as_str().map(str::to_owned))
                })
                .filter(|message| !message.is_empty());
            (text(entry, "outcome"), error)
        })
}

/// The plain-text search projection: visible text and tool names only. Reasoning, tool
/// arguments, tool results, local paths, and attachment bytes are deliberately excluded —
/// same contract as `snapshotText` on the TypeScript side.
fn conversation_text(conversation: &JsonValue) -> String {
    let mut lines = Vec::new();
    for message in conversation
        .get("messages")
        .and_then(JsonValue::as_array)
        .unwrap_or(&Vec::new())
    {
        for part in message
            .get("parts")
            .and_then(JsonValue::as_array)
            .unwrap_or(&Vec::new())
        {
            match part.get("type").and_then(JsonValue::as_str) {
                Some("text") => {
                    let value = text(part, "text");
                    if !value.trim().is_empty() {
                        lines.push(value.trim().to_owned());
                    }
                }
                Some("dynamic-tool") | Some("tool") => {
                    let name = match part.get("toolName").and_then(JsonValue::as_str) {
                        Some(name) => name.to_owned(),
                        None => text(part, "name"),
                    };
                    lines.push(format!("[tool: {name}]"));
                }
                _ => {}
            }
        }
    }
    lines.join("\n")
}

// ---------------------------------------------------------------------------
// Shared output validation; process-specific settlement rules live under `processes/`.
// ---------------------------------------------------------------------------

/// Mirrors `logicalPath` in domain.ts: relative paths inside the team folder, nothing else.
pub fn validate_logical_path(value: &str) -> Result<String, String> {
    let path = value.replace('\\', "/");
    let drive_prefixed = path
        .as_bytes()
        .first()
        .is_some_and(|byte| byte.is_ascii_alphabetic())
        && path.get(1..3) == Some(":/");
    if path.is_empty()
        || path.len() > 1_024
        || path.starts_with('/')
        || drive_prefixed
        || path
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err("File references must be relative paths inside the team folder".into());
    }
    Ok(path)
}

pub fn validate_collected_outputs(outputs: &[String], rules: &[String]) -> Result<(), String> {
    for output in outputs {
        validate_logical_path(output)?;
    }
    if rules.iter().any(|rule| rule == "require-output") && outputs.is_empty() {
        return Err("Agent validation requires at least one output file".into());
    }
    if rules.iter().any(|rule| rule == "action-receipt")
        && !outputs.iter().any(|output| output == ACTION_RECEIPT_OUTPUT)
    {
        return Err(format!(
            "An external action must produce {ACTION_RECEIPT_OUTPUT}"
        ));
    }
    if let Some(rule) = rules.iter().find(|rule| rule.starts_with("extension:")) {
        let extension = &rule["extension:".len()..];
        if !extension.starts_with('.') || outputs.iter().any(|output| !output.ends_with(extension))
        {
            return Err(format!("Agent outputs must use the {extension} extension"));
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

const STATUS_OUTPUT: &str = ".status";
const ACTION_RECEIPT_OUTPUT: &str = "action-receipt.json";

fn receipt_text<'a>(receipt: &'a JsonValue, field: &str) -> Result<&'a str, String> {
    receipt
        .get(field)
        .and_then(JsonValue::as_str)
        .filter(|value| value.len() <= 2_048)
        .ok_or_else(|| format!("Action receipt field {field} must be text"))
}

fn validate_action_receipt_value(receipt: &JsonValue) -> Result<(), String> {
    let fields = receipt
        .as_object()
        .ok_or_else(|| "Action receipt must be a JSON object".to_string())?;
    let accepted = ["status", "destination", "externalId", "url", "timestamp"];
    if fields.len() != accepted.len() || fields.keys().any(|key| !accepted.contains(&key.as_str()))
    {
        return Err("Action receipt fields do not match the required schema".into());
    }
    if receipt.get("status").and_then(JsonValue::as_str) != Some("succeeded") {
        return Err("Action receipt status must be succeeded".into());
    }
    if receipt_text(receipt, "destination")?.trim().is_empty() {
        return Err("Action receipt destination is required".into());
    }
    let external_id = receipt_text(receipt, "externalId")?;
    let url = receipt_text(receipt, "url")?;
    if external_id.trim().is_empty() && url.trim().is_empty() {
        return Err("Action receipt needs an externalId or URL".into());
    }
    let timestamp = receipt_text(receipt, "timestamp")?;
    if timestamp.len() > 40 || !timestamp.contains('T') || !timestamp.ends_with('Z') {
        return Err("Action receipt timestamp must be ISO-8601 UTC".into());
    }
    Ok(())
}

fn validate_action_receipt(workspace: &str) -> Result<(), String> {
    let value = std::fs::read_to_string(
        Path::new(workspace)
            .join("outputs")
            .join(ACTION_RECEIPT_OUTPUT),
    )
    .map_err(|_| format!("An external action must produce {ACTION_RECEIPT_OUTPUT}"))?;
    let receipt: JsonValue = serde_json::from_str(&value)
        .map_err(|_| "Action receipt must be valid JSON".to_string())?;
    validate_action_receipt_value(&receipt)
}

fn collect(workspace: &str) -> Result<Vec<String>, String> {
    let root = Path::new(workspace).join("outputs");
    let mut files = Vec::new();
    collect_relative_files(&root, &root, &mut files)?;
    files.sort();
    Ok(files)
}

fn read_status_id(workspace: &str) -> String {
    std::fs::read_to_string(Path::new(workspace).join("outputs").join(STATUS_OUTPUT))
        .map(|value| value.trim().to_owned())
        .unwrap_or_default()
}

fn record(
    database: &Database,
    execution_id: &str,
    status: &str,
    conversation: Option<&JsonValue>,
    error: Option<&str>,
    outputs: &[String],
    status_id: &str,
) -> Result<(), String> {
    let mut connection = database.0.lock().map_err(|error| error.to_string())?;
    let transaction = connection.transaction().map_err(|e| e.to_string())?;
    let stored_result: Option<String> = transaction
        .query_row(
            "SELECT result_json FROM executions WHERE id = ?1",
            params![execution_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .flatten();
    let mut result = stored_result
        .and_then(|value| serde_json::from_str::<JsonValue>(&value).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    // The prompt only exists for crash-before-admission recovery. A terminal receipt needs the
    // compact outcome and its two-step projection marker, not another copy of user content.
    result.remove("prompt");
    result.insert("outputs".into(), serde_json::json!(outputs));
    result.insert("statusId".into(), serde_json::json!(status_id));
    result.insert("projectionState".into(), serde_json::json!("pending"));
    let now = chrono_now();
    let changed = transaction
        .execute(
            "UPDATE executions
             SET status = ?1,
                 error_text = COALESCE(?2, error_text),
                 conversation_snapshot_json = COALESCE(?3, conversation_snapshot_json),
                 conversation_text = COALESCE(?4, conversation_text),
                 result_json = ?5,
                 started_at = COALESCE(started_at, ?6),
                 ended_at = ?6
             WHERE id = ?7 AND status IN ('queued', 'running')",
            params![
                status,
                error,
                conversation.map(|value| value.to_string()),
                conversation.map(conversation_text),
                JsonValue::Object(result).to_string(),
                now,
                execution_id
            ],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        transaction.commit().map_err(|error| error.to_string())?;
        return Ok(());
    }
    // Idempotent by (execution, output): a recovered attempt must not duplicate candidates.
    for output in outputs {
        transaction
            .execute(
                "INSERT INTO execution_outputs
                 (id, execution_id, logical_output, logical_destination, created_at)
                 VALUES (?1, ?2, ?3, ?3, ?4)
                 ON CONFLICT(execution_id, logical_output) DO NOTHING",
                params![uuid_like(), execution_id, output, now],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

fn chrono_now() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    // The TypeScript side writes ISO-8601; keep the format identical so ordering still works.
    let seconds = (millis / 1000) as i64;
    let days = seconds / 86_400;
    let time = seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        time / 3600,
        (time % 3600) / 60,
        time % 60,
        millis % 1000
    )
}

/// Howard Hinnant's civil-from-days. Avoids a date dependency for one timestamp format.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn uuid_like() -> String {
    let mut bytes = [0u8; 16];
    let _ = getrandom::fill(&mut bytes);
    let mut id = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(id, "{byte:02x}");
    }
    id
}

/// The whole Bees-side transaction for one submission. Runs on its own thread and owns the
/// receipt: a webview reload, a navigation, or a closed run page changes nothing here.
fn settle(app: &tauri::AppHandle, request: RunRequest, resume_from: Option<Admission>) {
    let database = app.state::<Database>();
    let outcome = run_to_settlement(app, &database, &request, resume_from);
    let settled = match outcome {
        Ok(settled) => settled,
        Err(error) => {
            let _ = record(
                &database,
                &request.execution_id,
                "failed",
                None,
                Some(&error),
                &[],
                "",
            );
            RunSettled {
                execution_id: request.execution_id.clone(),
                status: "failed".into(),
                outputs: Vec::new(),
                status_id: String::new(),
                error: Some(error),
            }
        }
    };
    app.state::<RunService>().finish(&request.execution_id);
    // Disposable notification: the webview re-reads SQLite, it does not trust this event.
    let _ = app.emit("run-settled", settled);
}

fn run_to_settlement(
    app: &tauri::AppHandle,
    database: &Database,
    request: &RunRequest,
    resume_from: Option<Admission>,
) -> Result<RunSettled, String> {
    let admission = match resume_from {
        Some(admission) => admission,
        None => admit(request)?,
    };
    {
        let connection = database.0.lock().map_err(|error| error.to_string())?;
        connection
            .execute(
                "UPDATE executions
                 SET status = 'running', submission_id = ?1, instance_uid = ?2,
                     result_json = json_remove(result_json, '$.prompt'),
                     started_at = COALESCE(started_at, ?3)
                 WHERE id = ?4 AND status IN ('queued', 'running')
                   AND json_extract(result_json, '$.deliveryId') = ?5",
                params![
                    admission.submission_id,
                    admission.uid,
                    chrono_now(),
                    request.execution_id,
                    request.delivery_id
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    let _ = app.emit("run-accepted", request.execution_id.clone());

    let mut conversation = JsonValue::Null;
    let mut outcome = String::new();
    let mut settle_error = None;
    let deadline = Instant::now() + RUN_TIMEOUT;
    let mut last_transport_error = None;
    while Instant::now() < deadline {
        match history(request) {
            Ok(value) => {
                if let Some((result, error)) = settlement(&value, &admission.submission_id) {
                    conversation = value;
                    outcome = result;
                    settle_error = error;
                    break;
                }
                conversation = value;
            }
            // A broken connection is a transport condition, not a business failure: the
            // submission is admitted and durable, so keep reading until it settles.
            Err(error) => last_transport_error = Some(error),
        }
        thread::sleep(POLL_INTERVAL);
    }
    if outcome.is_empty() {
        return Err(last_transport_error
            .unwrap_or_else(|| "The run did not settle before its time limit".into()));
    }
    if outcome != "completed" {
        let status = if outcome == "aborted" {
            "cancelled"
        } else {
            "failed"
        };
        return finish_terminal(
            database,
            request,
            status,
            Some(&conversation),
            settle_error
                .as_deref()
                .or(Some("The agent stopped before finishing")),
        );
    }

    let collected = if request.project_mode || request.manual_projection {
        Vec::new()
    } else {
        collect(&request.workspace)?
    };
    let status_id = if collected.iter().any(|output| output == STATUS_OUTPUT) {
        read_status_id(&request.workspace)
    } else {
        String::new()
    };
    let outputs: Vec<String> = collected
        .into_iter()
        .filter(|output| output != STATUS_OUTPUT)
        .collect();

    if let Some(task_plan) = &request.task_plan {
        if let Err(error) = validate_task_plan_run(
            &task_plan.state,
            &task_plan.output,
            &task_plan.output_blocked_states,
            &outputs,
        ) {
            return finish_terminal(
                database,
                request,
                "failed",
                Some(&conversation),
                Some(&error),
            );
        }
    }
    if let Err(error) = validate_collected_outputs(&outputs, &request.validation_rules) {
        return finish_terminal(
            database,
            request,
            "failed",
            Some(&conversation),
            Some(&error),
        );
    }
    if request
        .validation_rules
        .iter()
        .any(|rule| rule == "action-receipt")
    {
        if let Err(error) = validate_action_receipt(&request.workspace) {
            return finish_terminal(
                database,
                request,
                "failed",
                Some(&conversation),
                Some(&error),
            );
        }
    }

    record(
        database,
        &request.execution_id,
        "completed",
        Some(&conversation),
        None,
        &outputs,
        &status_id,
    )?;
    Ok(RunSettled {
        execution_id: request.execution_id.clone(),
        status: "completed".into(),
        outputs,
        status_id,
        error: None,
    })
}

fn finish_terminal(
    database: &Database,
    request: &RunRequest,
    status: &str,
    conversation: Option<&JsonValue>,
    error: Option<&str>,
) -> Result<RunSettled, String> {
    record(
        database,
        &request.execution_id,
        status,
        conversation,
        error,
        &[],
        "",
    )?;
    Ok(RunSettled {
        execution_id: request.execution_id.clone(),
        status: status.to_owned(),
        outputs: Vec::new(),
        status_id: String::new(),
        error: error.map(str::to_owned),
    })
}

/** The webview names a run; SQLite remains authoritative for what it may execute. */
fn validate_request(app: &tauri::AppHandle, request: &RunRequest) -> Result<(), String> {
    if request.delivery_id.is_empty() || request.delivery_id.len() > 256 {
        return Err("The delivery ID is invalid".into());
    }
    let manager = app.state::<crate::FlueManager>();
    let managed = manager.0.lock().map_err(|error| error.to_string())?;
    let runtime = managed
        .as_ref()
        .ok_or_else(|| "The Bees runtime is not running".to_string())?;
    if request.base_url != format!("http://127.0.0.1:{}", runtime.port)
        || request.token != runtime.token
    {
        return Err("Runs may use only the authenticated Bees loopback runtime".into());
    }
    drop(managed);
    let database = app.state::<Database>();
    let connection = database.0.lock().map_err(|error| error.to_string())?;
    let (_agent_id, work_item_id, workspace, stored_uid, status, result_json): (
        String,
        String,
        Option<String>,
        Option<String>,
        String,
        Option<String>,
    ) = connection
        .query_row(
            "SELECT agent_id, work_item_id, workspace_ref, instance_uid, status, result_json
                 FROM executions WHERE id = ?1",
            params![request.execution_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .map_err(|_| "Execution not found".to_string())?;
    drop(connection);
    if !matches!(status.as_str(), "queued" | "running") {
        return Err("This execution is already settled".into());
    }
    if request.agent_name != "bees-run" {
        return Err("The requested agent does not own this execution".into());
    }
    let stored_result = result_json
        .and_then(|value| serde_json::from_str::<JsonValue>(&value).ok())
        .ok_or_else(|| "The execution has no recovery context".to_string())?;
    if text(&stored_result, "deliveryId") != request.delivery_id
        || stored_result
            .get("continuation")
            .and_then(JsonValue::as_bool)
            != Some(request.continuation)
        || stored_result
            .get("prompt")
            .and_then(JsonValue::as_str)
            .is_some_and(|prompt| prompt != request.prompt)
    {
        return Err("The requested delivery does not match this execution".into());
    }
    if stored_result
        .get("projectMode")
        .and_then(JsonValue::as_bool)
        .unwrap_or(false)
        != request.project_mode
        || stored_result
            .get("manualProjection")
            .and_then(JsonValue::as_bool)
            .unwrap_or(false)
            != request.manual_projection
    {
        return Err("The requested execution mode does not match this execution".into());
    }
    if !request.continuation
        && (request.initial_data.is_none()
            || stored_result.get("initialData") != request.initial_data.as_ref())
    {
        return Err("The immutable run configuration does not match this execution".into());
    }
    let expected = workspace.ok_or_else(|| "The execution has no workspace".to_string())?;
    let (expected, offered) = if request.project_mode {
        (
            crate::processes::software_project::canonical_project_workspace(
                &database,
                &work_item_id,
                &expected,
            )?,
            crate::processes::software_project::canonical_project_workspace(
                &database,
                &work_item_id,
                &request.workspace,
            )?,
        )
    } else {
        (
            canonical_workspace(app, &expected)
                .map_err(|_| "The execution workspace is unavailable")?,
            canonical_workspace(app, &request.workspace)
                .map_err(|_| "The requested execution workspace is unavailable")?,
        )
    };
    if offered != expected {
        return Err("The requested workspace does not belong to this execution".into());
    }
    if request.continuation {
        let offered_uid = request
            .instance_uid
            .as_deref()
            .filter(|uid| !uid.is_empty());
        if offered_uid.is_none() || offered_uid != stored_uid.as_deref() {
            return Err("The conversation's Flue uid does not match this execution".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn start_run(app: tauri::AppHandle, request: RunRequest) -> Result<(), String> {
    validate_request(&app, &request)?;
    app.state::<RunService>().register(&request.execution_id)?;
    let handle = app.clone();
    thread::spawn(move || settle(&handle, request, None));
    Ok(())
}

/// Adopt a run that was already admitted before this process started.
///
/// A known submission is adopted. If admission crashed before its receipt reached SQLite, the
/// persisted prompt and delivery key are resent and Flue deduplicates them to the same receipt.
#[tauri::command]
pub fn resume_run(
    app: tauri::AppHandle,
    request: RunRequest,
    submission_id: String,
) -> Result<(), String> {
    validate_request(&app, &request)?;
    let service = app.state::<RunService>();
    if service.is_active(&request.execution_id) {
        return Ok(());
    }
    let resume_from = (!submission_id.is_empty()).then(|| Admission {
        submission_id,
        uid: request.instance_uid.clone().unwrap_or_default(),
    });
    if resume_from.is_none() && request.prompt.is_empty() {
        // Nothing was admitted and there is no prompt to admit. Do not leave it running.
        return record(
            &app.state::<Database>(),
            &request.execution_id,
            "interrupted",
            None,
            Some("Bees stopped before this run reached the agent. Restart it with the current agent configuration."),
            &[],
            "",
        );
    }
    service.register(&request.execution_id)?;
    let handle = app.clone();
    thread::spawn(move || settle(&handle, request, resume_from));
    Ok(())
}

/// Tell Flue to abort, then keep reading its authoritative settlement. Completion may win the
/// race, so Bees never stamps `cancelled` over a result Flue already completed.
#[tauri::command]
pub fn stop_run(
    app: tauri::AppHandle,
    request: RunRequest,
    submission_id: String,
) -> Result<(), String> {
    validate_request(&app, &request)?;
    let aborted = client()?
        .post(format!("{}/abort", conversation_url(&request)))
        .bearer_auth(&request.token)
        .send()
        .map_err(|error| error.to_string())?;
    let not_found = aborted.status().as_u16() == 404;
    if !aborted.status().is_success() && !not_found {
        return Err(format!("Flue abort returned {}", aborted.status()));
    }
    let service = app.state::<RunService>();
    if service.is_active(&request.execution_id) {
        // The owner keeps polling until Flue reports whether abort or completion won the race.
        return Ok(());
    }
    if not_found {
        let (status, error) = if submission_id.is_empty() {
            ("cancelled", "Stopped by user")
        } else {
            ("interrupted", "Flue no longer has this conversation")
        };
        return record(
            &app.state::<Database>(),
            &request.execution_id,
            status,
            None,
            Some(error),
            &[],
            "",
        );
    }
    let resume_from = (!submission_id.is_empty()).then(|| Admission {
        submission_id,
        uid: request.instance_uid.clone().unwrap_or_default(),
    });
    service.register(&request.execution_id)?;
    let handle = app.clone();
    thread::spawn(move || settle(&handle, request, resume_from));
    Ok(())
}

#[tauri::command]
pub fn run_is_active(app: tauri::AppHandle, execution_id: String) -> bool {
    app.state::<RunService>().is_active(&execution_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_output_paths_that_escape_the_team_folder() {
        assert!(validate_logical_path("notes/draft.md").is_ok());
        assert!(validate_logical_path("/etc/passwd").is_err());
        assert!(validate_logical_path("../secrets").is_err());
        assert!(validate_logical_path("a/./b").is_err());
        assert!(validate_logical_path("C:/Windows").is_err());
        assert!(validate_logical_path("").is_err());
    }

    #[test]
    fn enforces_agent_output_rules() {
        let require = vec!["require-output".to_owned()];
        assert!(validate_collected_outputs(&[], &require).is_err());
        assert!(validate_collected_outputs(&["a.md".to_owned()], &require).is_ok());

        let markdown = vec!["extension:.md".to_owned()];
        assert!(validate_collected_outputs(&["a.md".to_owned()], &markdown).is_ok());
        assert!(validate_collected_outputs(&["a.txt".to_owned()], &markdown).is_err());
        // A malformed rule must fail closed rather than silently allowing anything.
        assert!(
            validate_collected_outputs(&["a.md".to_owned()], &["extension:md".to_owned()]).is_err()
        );
        let action = vec!["action-receipt".to_owned()];
        assert!(validate_collected_outputs(&[ACTION_RECEIPT_OUTPUT.to_owned()], &action).is_ok());
        assert!(validate_collected_outputs(&["reply.md".to_owned()], &action).is_err());
    }

    #[test]
    fn validates_confirmed_external_action_receipts() {
        assert!(validate_action_receipt_value(&serde_json::json!({
            "status": "succeeded",
            "destination": "LinkedIn",
            "externalId": "post-123",
            "url": "https://example.com/post-123",
            "timestamp": "2026-08-05T12:00:00.000Z"
        }))
        .is_ok());
        assert!(validate_action_receipt_value(&serde_json::json!({
            "status": "uncertain",
            "destination": "LinkedIn",
            "externalId": "",
            "url": "",
            "timestamp": "2026-08-05T12:00:00.000Z"
        }))
        .is_err());
        assert!(validate_action_receipt_value(&serde_json::json!({
            "status": "succeeded",
            "destination": "LinkedIn",
            "externalId": "post-123",
            "url": "",
            "timestamp": "2026-08-05T12:00:00.000Z",
            "unexpected": true
        }))
        .is_err());
    }

    #[test]
    fn reads_the_settlement_for_one_submission_only() {
        let conversation = serde_json::json!({
            "settlements": [
                { "submissionId": "other", "outcome": "failed" },
                { "submissionId": "mine", "outcome": "completed" }
            ]
        });
        assert_eq!(settlement(&conversation, "mine").unwrap().0, "completed");
        assert!(settlement(&conversation, "absent").is_none());
        assert!(settlement(&serde_json::json!({}), "mine").is_none());
    }

    #[test]
    fn projects_only_visible_text_and_tool_names_for_search() {
        let conversation = serde_json::json!({
            "messages": [
                { "parts": [
                    { "type": "text", "text": "The invoice totals 400." },
                    { "type": "reasoning", "text": "HIDDEN" },
                    { "type": "dynamic-tool", "toolName": "read", "input": { "path": "/Users/x" } }
                ] }
            ]
        });
        let projection = conversation_text(&conversation);
        assert_eq!(projection, "The invoice totals 400.\n[tool: read]");
        assert!(!projection.contains("HIDDEN"));
        assert!(!projection.contains("/Users/x"));
    }

    #[test]
    fn formats_timestamps_the_way_the_typescript_side_does() {
        let now = chrono_now();
        assert_eq!(now.len(), 24, "{now}");
        assert!(now.ends_with('Z'));
        assert_eq!(&now[4..5], "-");
        assert_eq!(&now[10..11], "T");
    }

    #[test]
    fn a_late_stop_cannot_overwrite_a_terminal_receipt() {
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE executions (
                    id TEXT PRIMARY KEY, status TEXT NOT NULL, error_text TEXT,
                    conversation_snapshot_json TEXT, conversation_text TEXT, result_json TEXT,
                    started_at TEXT, ended_at TEXT
                 );
                 CREATE TABLE execution_outputs (
                    id TEXT PRIMARY KEY, execution_id TEXT NOT NULL, logical_output TEXT NOT NULL,
                    logical_destination TEXT NOT NULL, created_at TEXT NOT NULL,
                    UNIQUE(execution_id, logical_output)
                 );
                 INSERT INTO executions
                 VALUES ('run', 'completed', NULL, NULL, NULL, '{}', NULL, 'already');",
            )
            .unwrap();
        let database = Database(Mutex::new(connection));

        record(
            &database,
            "run",
            "cancelled",
            None,
            Some("Stopped by user"),
            &[],
            "",
        )
        .unwrap();

        let connection = database.0.lock().unwrap();
        let row: (String, Option<String>, String) = connection
            .query_row(
                "SELECT status, error_text, ended_at FROM executions WHERE id = 'run'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(row, ("completed".into(), None, "already".into()));
    }
}
