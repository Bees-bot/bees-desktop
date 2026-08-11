use reqwest::{
    blocking::Client,
    header::{CONTENT_LENGTH, RANGE},
    StatusCode,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Read, Write},
    net::SocketAddr,
    path::{Path, PathBuf},
    process::{Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

use crate::process::{available_loopback_port, Sidecar};

const GIB: u64 = 1024 * 1024 * 1024;
/// Below this a window is too small to run an agent turn in, so it is asked for even when the
/// budget says no. Better a server that fails to boot loudly than one that silently serves a
/// window nothing fits in.
const MIN_CONTEXT: u32 = 4_096;
/// Ceiling on the *derived* window only. Past this the arithmetic keeps saying yes while
/// prompt processing time and attention quality both say no, and no local model Bees ships
/// benefits. An administrator who knows better overrides it per model; the override is not
/// clamped to this.
const MAX_DERIVED_CONTEXT: u32 = 131_072;
/// Share of system memory the KV cache and weights together may claim. The rest is the OS,
/// Bees itself, and llama.cpp's own compute buffers.
const MEMORY_SHARE: f64 = 0.33;

/// The GGUF header fields that decide what a context window costs in memory.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ModelShape {
    /// The context the model was trained for: the ceiling worth asking llama-server for.
    context_length: u32,
    /// Bytes of KV cache one token occupies, at the f16 cache llama-server defaults to.
    bytes_per_token: u64,
}

/// How much context llama-server is given for one model, and with it how much room an agent
/// has before Bees starts summarizing its own history away.
///
/// This is a memory decision, not a preference, and it is per model rather than per machine.
/// The KV cache is allocated up front and grows linearly with the window, but the cost of a
/// token is set by the model's layer count and KV head count — not by its parameter count.
/// The 3B Bees seeds costs 88 KiB per token and was trained for 262144 of them, which is
/// 23.6 GB of cache if taken literally: `--ctx-size 0` is not a safe default.
///
/// Kept in step with `BEES_LOCAL_CTX`, which hands the same numbers to the Flue runtime so the
/// windows it declares to pi-ai match the ones actually allocated here. Declaring more than
/// was allocated turns ordinary compaction into hard overflow errors.
fn context_size_for_model(
    shape: Option<ModelShape>,
    weights_bytes: u64,
    total_memory_bytes: u64,
    override_context: Option<u32>,
) -> u32 {
    // An administrator who sets a window has hardware knowledge this function does not, so it
    // is obeyed above the trained length and above the derived ceiling alike. Only the floor
    // holds, because a window under it cannot carry a turn.
    if let Some(requested) = override_context {
        return requested.max(MIN_CONTEXT);
    }
    let Some(shape) = shape else {
        return context_size_for_unknown_model(total_memory_bytes);
    };
    let budget = ((total_memory_bytes as f64 * MEMORY_SHARE) as u64).saturating_sub(weights_bytes);
    let affordable = budget / shape.bytes_per_token.max(1);
    let wanted = affordable.min(shape.context_length as u64).min(MAX_DERIVED_CONTEXT as u64);
    // llama.cpp batches in blocks; a ragged window buys nothing and reads like a bug.
    ((wanted as u32) / 256 * 256).max(MIN_CONTEXT)
}

/// Fallback for a GGUF whose header could not be read — a format newer than this parser, or a
/// file being written while it is inspected. Thresholds sit under the round numbers they
/// stand for: macOS reports a 16 GB machine as exactly 16 GiB, but Linux subtracts what the
/// kernel reserved, and a 16 GB box that reads as 15.6 is not an 8 GB one.
fn context_size_for_unknown_model(total_memory_bytes: u64) -> u32 {
    match total_memory_bytes {
        memory if memory >= 30 * GIB => 32_768,
        memory if memory >= 15 * GIB => 16_384,
        _ => 8_192,
    }
}

fn total_memory() -> u64 {
    sysinfo::System::new_with_specifics(
        sysinfo::RefreshKind::nothing().with_memory(sysinfo::MemoryRefreshKind::everything()),
    )
    .total_memory()
}

/// A GGUF file opens with a metadata block of typed key/value pairs, so a model's shape can be
/// read without loading a byte of weights. Everything is read sequentially from the front of
/// the file and nothing is trusted: an implausible length, a truncated read, or a missing key
/// all mean "unknown", and the caller sizes the window off system memory instead.
///
/// Used only for sizing. A model whose header cannot be parsed still runs.
fn read_model_shape(path: &Path) -> Option<ModelShape> {
    let mut cursor = GgufCursor {
        reader: BufReader::new(File::open(path).ok()?),
        // The tokenizer vocabulary lives in this block too and runs to tens of MB. Past this
        // the file is not shaped like anything this parser understands.
        remaining: 256 * 1024 * 1024,
    };
    if cursor.bytes(4)? != b"GGUF" {
        return None;
    }
    // v1 sized its lengths as u32. Nothing ships it any more, and guessing wrong misreads
    // every field after the first, so refuse it rather than produce a plausible wrong number.
    if !matches!(cursor.u32()?, 2 | 3) {
        return None;
    }
    let _tensor_count = cursor.u64()?;
    let kv_count = cursor.u64()?;
    if kv_count > 100_000 {
        return None;
    }

    let mut architecture = String::new();
    let mut numbers: HashMap<String, u64> = HashMap::new();
    for _ in 0..kv_count {
        let key = cursor.string()?;
        let value_type = cursor.u32()?;
        match cursor.value(value_type)? {
            MetadataValue::Text(text) if key == "general.architecture" => architecture = text,
            MetadataValue::Number(number) => {
                numbers.insert(key, number);
            }
            _ => {}
        }
    }

    let field = |suffix: &str| numbers.get(&format!("{architecture}.{suffix}")).copied();
    let context_length = u32::try_from(field("context_length")?).ok()?;
    let layers = field("block_count")?;
    let heads = field("attention.head_count")?;
    // Multi-head attention is grouped-query with one group per head, so a model that predates
    // the distinction simply reports no KV head count.
    let kv_heads = field("attention.head_count_kv").unwrap_or(heads);
    // Most architectures carry explicit K/V widths; the rest split the embedding across heads.
    let key_length = field("attention.key_length")
        .or_else(|| field("embedding_length").map(|width| width / heads.max(1)))?;
    let value_length = field("attention.value_length").unwrap_or(key_length);
    let bytes_per_token = layers
        .checked_mul(kv_heads)?
        .checked_mul(key_length.checked_add(value_length)?)?
        // f16, the cache type llama-server is started with.
        .checked_mul(2)?;
    (bytes_per_token > 0 && context_length >= MIN_CONTEXT).then_some(ModelShape {
        context_length,
        bytes_per_token,
    })
}

enum MetadataValue {
    Number(u64),
    Text(String),
    Other,
}

/// A forward-only reader over the metadata block with a hard cap on how much it will consume,
/// so a corrupt or hostile length cannot turn into a multi-gigabyte allocation.
struct GgufCursor {
    reader: BufReader<File>,
    remaining: u64,
}

impl GgufCursor {
    fn bytes(&mut self, count: u64) -> Option<Vec<u8>> {
        self.remaining = self.remaining.checked_sub(count)?;
        let mut bytes = vec![0u8; usize::try_from(count).ok()?];
        self.reader.read_exact(&mut bytes).ok()?;
        Some(bytes)
    }

    fn skip(&mut self, count: u64) -> Option<()> {
        self.bytes(count).map(|_| ())
    }

    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.bytes(4)?.try_into().ok()?))
    }

    fn u64(&mut self) -> Option<u64> {
        Some(u64::from_le_bytes(self.bytes(8)?.try_into().ok()?))
    }

    fn string(&mut self) -> Option<String> {
        let length = self.u64()?;
        if length > 1024 * 1024 {
            return None;
        }
        String::from_utf8(self.bytes(length)?).ok()
    }

    /// One typed value. Arrays are walked past rather than collected — the only large one is
    /// the tokenizer vocabulary, and nothing here needs it.
    fn value(&mut self, value_type: u32) -> Option<MetadataValue> {
        match value_type {
            // Integer types, read as counts. Signed values only appear where a count is
            // expected, so a negative one is nonsense and is clamped to fail later checks.
            0 => Some(MetadataValue::Number(u64::from(self.bytes(1)?[0]))),
            2 => Some(MetadataValue::Number(u64::from(u16::from_le_bytes(
                self.bytes(2)?.try_into().ok()?,
            )))),
            4 => Some(MetadataValue::Number(u64::from(self.u32()?))),
            5 => Some(MetadataValue::Number(
                i32::from_le_bytes(self.bytes(4)?.try_into().ok()?)
                    .try_into()
                    .unwrap_or(0),
            )),
            10 => Some(MetadataValue::Number(self.u64()?)),
            11 => Some(MetadataValue::Number(
                i64::from_le_bytes(self.bytes(8)?.try_into().ok()?)
                    .try_into()
                    .unwrap_or(0),
            )),
            8 => Some(MetadataValue::Text(self.string()?)),
            9 => {
                let element_type = self.u32()?;
                let count = self.u64()?;
                if element_type == 8 {
                    // Strings are individually length-prefixed, so they can only be walked.
                    for _ in 0..count {
                        let length = self.u64()?;
                        self.skip(length)?;
                    }
                } else {
                    self.skip(count.checked_mul(fixed_width(element_type)?)?)?;
                }
                Some(MetadataValue::Other)
            }
            other => {
                self.skip(fixed_width(other)?)?;
                Some(MetadataValue::Other)
            }
        }
    }
}

/// Byte width of the fixed-size GGUF types. Strings (8) and arrays (9) have none.
fn fixed_width(value_type: u32) -> Option<u64> {
    match value_type {
        0 | 1 | 7 => Some(1),
        2 | 3 => Some(2),
        4..=6 => Some(4),
        10..=12 => Some(8),
        _ => None,
    }
}

/// A model the user added in Preferences → AI. The list lives in the frontend's settings store, so
/// every command carries the whole spec rather than looking one up in a fixed catalog here.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSpec {
    id: String,
    /// File name inside the managed models directory. Unused when `local_path` is set.
    #[serde(default)]
    file_name: String,
    #[serde(default)]
    url: Option<String>,
    /// A .gguf the user picked off their own disk. We read it in place and never delete it.
    #[serde(default)]
    local_path: Option<String>,
    /// Expected size, 0 when unknown — user-added models learn it from Content-Length.
    #[serde(default)]
    bytes: u64,
    /// Only the seeded model pins a digest; user URLs are verified by size alone.
    #[serde(default)]
    sha256: Option<String>,
    #[serde(default)]
    chat_template: Option<String>,
    /// Administrator override for the context window, in tokens. Unset means Bees derives one
    /// from the model's own header and the machine's memory, which is right on hardware it can
    /// measure and wrong on hardware it cannot — a shared inference box, a GPU whose memory is
    /// not the system's, a deployment that wants a smaller window than it could afford.
    #[serde(default)]
    context_size: Option<u32>,
}

impl ModelSpec {
    fn validate(&self) -> Result<(), String> {
        if self.id.trim().is_empty() {
            return Err("The model is missing an id".into());
        }
        if let Some(path) = &self.local_path {
            if !Path::new(path).is_absolute() {
                return Err("Choose a model file by its full path".into());
            }
            return Ok(());
        }
        if !self
            .url
            .as_deref()
            .unwrap_or_default()
            .starts_with("https://")
        {
            return Err("Model downloads must use an https:// link".into());
        }
        // The name is joined onto our models directory, so it has to stay a plain file name:
        // no separators, no parent hops, nothing but the characters below.
        let name_ok = !self.file_name.is_empty()
            && self.file_name.len() <= 120
            && self.file_name.ends_with(".gguf")
            && self.file_name.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
            });
        if !name_ok {
            return Err("The model file name must be a plain .gguf name".into());
        }
        Ok(())
    }
}

/// Kill any llama-server left running by a previous app instance. The manager tracks the child
/// only in memory, so an app restart or crash orphans the server: the new process sees no runtime,
/// reports "not running", and spawns a duplicate. Reaping at startup gives the manager a clean slate.
/// Every server we launch carries `--alias active`, so that pattern won't match unrelated llama use.
pub fn reap_orphan_llama_servers() {
    #[cfg(windows)]
    let _ = Command::new("taskkill")
        .args(["/F", "/IM", "llama-server.exe"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    #[cfg(not(windows))]
    let _ = Command::new("pkill")
        .args(["-f", "llama-server.*--alias active"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

struct ManagedLlama {
    child: Sidecar,
    port: u16,
    /// What this server was actually started with. The runtime declares the same number to
    /// pi-ai, so the two can never drift into "compaction thinks there is room, the server
    /// disagrees".
    context_size: u32,
}

/// Where one running local model lives and how much context it has.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalModelRoute {
    pub url: String,
    pub context_size: u32,
}

#[derive(Default)]
struct LocalModelRuntimes {
    by_id: HashMap<String, ManagedLlama>,
    active_id: Option<String>,
}

#[derive(Default)]
pub struct LocalModelManager {
    runtimes: Mutex<LocalModelRuntimes>,
    downloads: Mutex<HashMap<String, Arc<AtomicBool>>>,
    // Starts queue behind one another. Concurrent first-launches of the ad-hoc binaries are what
    // pile up as unkillable dyld-stuck zombies under macOS Gatekeeper assessment.
    starting: Mutex<()>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalModelProgress {
    model_id: String,
    state: String,
    downloaded_bytes: u64,
    total_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelStatus {
    model_id: String,
    state: String,
    downloaded_bytes: u64,
    total_bytes: u64,
    running: bool,
}

pub fn models_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("models"))
        .map_err(|error| error.to_string())
}

fn model_path(app: &AppHandle, spec: &ModelSpec) -> Result<PathBuf, String> {
    spec.validate()?;
    if let Some(path) = &spec.local_path {
        return Ok(PathBuf::from(path));
    }
    models_directory(app).map(|directory| directory.join(&spec.file_name))
}

fn file_len(path: &Path) -> u64 {
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
}

/// A pinned model is complete only at its exact size. A user-added one has no expected size until
/// the first download reports Content-Length, so any non-empty file at the target path counts —
/// the target only ever gets the `.part` renamed onto it after a whole transfer.
fn is_complete(path: &Path, expected: u64) -> bool {
    let length = file_len(path);
    if expected > 0 {
        length == expected
    } else {
        length > 0 && path.is_file()
    }
}

fn downloaded_bytes(path: &Path, part: &Path, expected: u64) -> u64 {
    if is_complete(path, expected) {
        return file_len(path);
    }
    let partial = file_len(part);
    if expected > 0 {
        partial.min(expected)
    } else {
        partial
    }
}

fn runtime_is_running(runtime: &mut ManagedLlama) -> Result<bool, String> {
    runtime.child.alive()
}

fn repair_active_runtime(runtimes: &mut LocalModelRuntimes) {
    if runtimes
        .active_id
        .as_ref()
        .map(|id| runtimes.by_id.contains_key(id))
        .unwrap_or(false)
    {
        return;
    }
    runtimes.active_id = runtimes.by_id.keys().min().cloned();
}

fn local_model_status_inner(app: &AppHandle, spec: &ModelSpec) -> Result<LocalModelStatus, String> {
    let path = model_path(app, spec)?;
    let part = path.with_extension("gguf.part");
    let manager = app.state::<LocalModelManager>();
    let downloading = manager
        .downloads
        .lock()
        .map_err(|error| error.to_string())?
        .contains_key(&spec.id);
    let mut runtimes = manager.runtimes.lock().map_err(|error| error.to_string())?;
    let running = runtimes
        .by_id
        .get_mut(&spec.id)
        .map(runtime_is_running)
        .transpose()?
        .unwrap_or(false);
    if !running {
        runtimes.by_id.remove(&spec.id);
        repair_active_runtime(&mut runtimes);
    }
    let complete = is_complete(&path, spec.bytes);
    let bytes = downloaded_bytes(&path, &part, spec.bytes);
    let state = if running {
        "running"
    } else if downloading {
        "downloading"
    } else if complete {
        "ready"
    } else {
        "not-downloaded"
    };
    Ok(LocalModelStatus {
        model_id: spec.id.clone(),
        state: state.to_owned(),
        downloaded_bytes: bytes,
        total_bytes: if spec.bytes > 0 { spec.bytes } else { bytes },
        running,
    })
}

// spawn_blocking: status reads child process state and may briefly wait on the runtime mutex.
#[tauri::command]
pub async fn local_model_status(
    app: AppHandle,
    spec: ModelSpec,
) -> Result<LocalModelStatus, String> {
    tauri::async_runtime::spawn_blocking(move || local_model_status_inner(&app, &spec))
        .await
        .map_err(|error| error.to_string())?
}

fn emit_progress(
    app: &AppHandle,
    spec: &ModelSpec,
    state: &str,
    bytes: u64,
    total: u64,
    error: Option<String>,
) {
    let _ = app.emit(
        "local-model-progress",
        LocalModelProgress {
            model_id: spec.id.clone(),
            state: state.to_owned(),
            downloaded_bytes: bytes,
            total_bytes: total,
            error,
        },
    );
}

fn sha256(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn finalize_download(part: &Path, target: &Path, spec: &ModelSpec) -> Result<(), String> {
    if let Some(expected) = &spec.sha256 {
        if &sha256(part)? != expected {
            let _ = fs::remove_file(part);
            return Err("The downloaded model failed its SHA-256 integrity check".into());
        }
    }
    // Replace only once a verified file exists, so an interrupted download leaves the old one
    // alone. Windows rename needs the destination clear.
    if target.exists() {
        fs::remove_file(target).map_err(|error| error.to_string())?;
    }
    fs::rename(part, target).map_err(|error| error.to_string())
}

fn download_model(app: &AppHandle, spec: &ModelSpec, cancelled: &AtomicBool) -> Result<(), String> {
    let target = model_path(app, spec)?;
    if is_complete(&target, spec.bytes) {
        return Ok(());
    }
    let directory = target
        .parent()
        .ok_or_else(|| "Local model path has no parent directory".to_string())?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let part = target.with_extension("gguf.part");
    let mut offset = file_len(&part);
    if spec.bytes > 0 && offset > spec.bytes {
        fs::remove_file(&part).map_err(|error| error.to_string())?;
        offset = 0;
    }
    if spec.bytes > 0 && offset == spec.bytes {
        finalize_download(&part, &target, spec)?;
        emit_progress(app, spec, "ready", spec.bytes, spec.bytes, None);
        return Ok(());
    }

    let url = spec
        .url
        .as_deref()
        .ok_or_else(|| "This model has no download link".to_string())?;
    let client = Client::builder()
        .user_agent("Bees local model manager")
        .build()
        .map_err(|error| error.to_string())?;
    let mut request = client.get(url);
    if offset > 0 {
        request = request.header(RANGE, format!("bytes={offset}-"));
    }
    let mut response = request.send().map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "The model host returned {} while downloading",
            response.status()
        ));
    }
    let resumed = offset > 0 && response.status() == StatusCode::PARTIAL_CONTENT;
    if offset > 0 && !resumed {
        offset = 0;
    }
    let mut output = OpenOptions::new()
        .create(true)
        .write(true)
        .append(resumed)
        .truncate(!resumed)
        .open(&part)
        .map_err(|error| error.to_string())?;
    let response_bytes = response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    // A pinned model must match its expected size exactly; a user-added one adopts whatever the
    // host reports, and falls back to "however much arrived" when the header is missing.
    let total = match response_bytes {
        Some(bytes) => offset.saturating_add(bytes),
        None => spec.bytes,
    };
    if spec.bytes > 0 && total != spec.bytes {
        return Err(format!(
            "Unexpected model download size: expected {} bytes, got {total}",
            spec.bytes
        ));
    }
    // No size from the host, none pinned, no checksum: a cut connection looks the same as a
    // finished download. Say so instead of guessing.
    if total == 0 && spec.sha256.is_none() {
        return Err(
            "This host does not report a file size, so Bees cannot tell a finished download from \
             an interrupted one. Download the file yourself and add it from disk instead."
                .into(),
        );
    }

    let mut bytes = offset;
    let mut last_emitted = bytes;
    let mut buffer = vec![0_u8; 1024 * 1024];
    emit_progress(app, spec, "downloading", bytes, total, None);
    loop {
        if cancelled.load(Ordering::Relaxed) {
            emit_progress(app, spec, "cancelled", bytes, total, None);
            return Err("Model download cancelled".into());
        }
        let read = response
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        output
            .write_all(&buffer[..read])
            .map_err(|error| error.to_string())?;
        bytes += read as u64;
        if bytes.saturating_sub(last_emitted) >= 4 * 1024 * 1024 || bytes == total {
            emit_progress(app, spec, "downloading", bytes, total, None);
            last_emitted = bytes;
        }
    }
    output.flush().map_err(|error| error.to_string())?;
    if total > 0 && bytes != total {
        return Err(format!(
            "Incomplete model download: expected {total} bytes, got {bytes}"
        ));
    }
    if bytes == 0 {
        return Err("The model download was empty".into());
    }
    finalize_download(&part, &target, spec)?;
    emit_progress(app, spec, "ready", bytes, bytes, None);
    Ok(())
}

/// Block until the download registered for `id` leaves the map. Errors when it was cancelled, so a
/// Run waiting on a download the user stopped doesn't quietly start its own.
fn wait_for_download(
    downloads: &Mutex<HashMap<String, Arc<AtomicBool>>>,
    id: &str,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    // ponytail: polled, no condvar — what it waits on runs for minutes.
    while downloads
        .lock()
        .map_err(|error| error.to_string())?
        .contains_key(id)
    {
        if cancelled.load(Ordering::Relaxed) {
            return Err("Model download cancelled".into());
        }
        thread::sleep(Duration::from_millis(250));
    }
    Ok(())
}

fn ensure_local_model_blocking(
    app: &AppHandle,
    spec: &ModelSpec,
) -> Result<LocalModelStatus, String> {
    let target = model_path(app, spec)?;
    if is_complete(&target, spec.bytes) {
        return local_model_status_inner(app, spec);
    }
    if spec.local_path.is_some() {
        return Err("That model file is missing. Choose it again.".into());
    }
    let manager = app.state::<LocalModelManager>();
    let cancelled = {
        let mut downloads = manager
            .downloads
            .lock()
            .map_err(|error| error.to_string())?;
        // Both toggles, the ready event and the first-launch autostart all ask for the same file.
        // Wait on the fetch already in flight rather than refusing — Run pressed during a download
        // means "start it when the bytes land", not "that's an error".
        if let Some(existing) = downloads.get(&spec.id).cloned() {
            drop(downloads);
            wait_for_download(&manager.downloads, &spec.id, &existing)?;
            if !is_complete(&target, spec.bytes) {
                return Err("The model download did not finish".into());
            }
            return local_model_status_inner(app, spec);
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        downloads.insert(spec.id.clone(), cancelled.clone());
        cancelled
    };
    let result = download_model(app, spec, &cancelled);
    manager
        .downloads
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&spec.id);
    if let Err(error) = &result {
        if error != "Model download cancelled" {
            let part = target.with_extension("gguf.part");
            emit_progress(
                app,
                spec,
                "error",
                downloaded_bytes(&target, &part, spec.bytes),
                spec.bytes,
                Some(error.clone()),
            );
        }
    }
    result?;
    local_model_status_inner(app, spec)
}

#[tauri::command]
pub async fn ensure_local_model(
    app: AppHandle,
    spec: ModelSpec,
) -> Result<LocalModelStatus, String> {
    tauri::async_runtime::spawn_blocking(move || ensure_local_model_blocking(&app, &spec))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn cancel_local_model_download(app: AppHandle, model_id: String) -> Result<(), String> {
    if let Some(cancelled) = app
        .state::<LocalModelManager>()
        .downloads
        .lock()
        .map_err(|error| error.to_string())?
        .get(&model_id)
    {
        cancelled.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// Forget a model: stop it, cancel any download, and drop the bytes we downloaded for it. A file
/// the user picked off their own disk is left alone — we only ever read it in place.
#[tauri::command]
pub async fn delete_local_model(app: AppHandle, spec: ModelSpec) -> Result<(), String> {
    cancel_local_model_download(app.clone(), spec.id.clone())?;
    stop_local_model(app.clone(), spec.id.clone())?;
    tauri::async_runtime::spawn_blocking(move || {
        if spec.local_path.is_some() {
            return Ok(());
        }
        let target = model_path(&app, &spec)?;
        let _ = fs::remove_file(target.with_extension("gguf.part"));
        let _ = fs::remove_file(&target);
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn bundled_llama_server(app: &AppHandle) -> Result<PathBuf, String> {
    let executable = if cfg!(windows) {
        "llama-server.exe"
    } else {
        "llama-server"
    };
    let packaged = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("llama-runtime")
        .join(executable);
    let source = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("llama-runtime")
        .join(executable);
    [packaged, source]
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| "The bundled llama-server runtime is missing. Reinstall Bees.".into())
}

fn running_status(model_id: &str, bytes: u64) -> LocalModelStatus {
    LocalModelStatus {
        model_id: model_id.to_owned(),
        state: "running".into(),
        downloaded_bytes: bytes,
        total_bytes: bytes,
        running: true,
    }
}

/// Turn what llama-server printed before it quit into something the user can act on.
fn startup_failure(log: &Mutex<VecDeque<String>>, status: ExitStatus) -> String {
    let lines: Vec<String> = log
        .lock()
        .map(|log| log.iter().cloned().collect())
        .unwrap_or_default();
    startup_failure_message(&lines)
        .unwrap_or_else(|| format!("llama-server stopped during startup ({status})"))
}

fn startup_failure_message(lines: &[String]) -> Option<String> {
    if lines
        .iter()
        .any(|line| line.contains("newer than running OS") || line.contains("Symbol not found"))
    {
        return Some(
            "This model's runtime needs a newer operating system than this computer runs. \
Update the operating system, or run this model on a newer machine."
                .into(),
        );
    }
    if let Some(line) = lines
        .iter()
        .rev()
        .find(|line| line.contains("unknown model architecture"))
    {
        return Some(format!(
            "This model needs a newer local runtime than this version of Bees ships. Update Bees, or pick another model. ({})",
            line.trim()
        ));
    }
    lines
        .iter()
        .rev()
        .find(|line| line.contains(" E "))
        .map(|line| format!("llama-server could not start: {}", line.trim()))
}

fn start_local_model_blocking(
    app: &AppHandle,
    spec: &ModelSpec,
) -> Result<LocalModelStatus, String> {
    let path = model_path(app, spec)?;
    if !is_complete(&path, spec.bytes) {
        return Err("Load the model before starting it".into());
    }
    let size = file_len(&path);
    let manager = app.state::<LocalModelManager>();
    // Queue starts for macOS first-launch safety, but never hold the runtime lock across boot.
    let _starting = manager.starting.lock().map_err(|error| error.to_string())?;
    {
        let mut runtimes = manager.runtimes.lock().map_err(|error| error.to_string())?;
        if let Some(current) = runtimes.by_id.get_mut(&spec.id) {
            if runtime_is_running(current)? {
                runtimes.active_id = Some(spec.id.clone());
                return Ok(running_status(&spec.id, size));
            }
            runtimes.by_id.remove(&spec.id);
        }
    }

    let executable = bundled_llama_server(app)?;
    let working_directory = executable
        .parent()
        .ok_or_else(|| "llama-server path has no parent directory".to_string())?;
    let port = available_loopback_port()?;
    // Sized from this model's own header rather than a table: a 3B and a 235B cost wildly
    // different amounts per token, and the file on disk is the only thing that knows which.
    let context = context_size_for_model(
        read_model_shape(&path),
        file_len(&path),
        total_memory(),
        spec.context_size,
    );
    let mut command = Command::new(&executable);
    command
        .current_dir(working_directory)
        .arg("--model")
        .arg(&path)
        .args(["--host", "127.0.0.1", "--port"])
        .arg(port.to_string())
        .args(["--alias", "active", "--ctx-size"])
        .arg(context.to_string());
    // Gemma's embedded Jinja template is strict and raises "Conversation roles must alternate" on a
    // system role or non-alternating turns, which the OpenAI-style messages flue sends trip; its
    // built-in llama.cpp template merges system into the first user turn. Models that carry a usable
    // template of their own leave this unset and llama-server uses theirs.
    if let Some(template) = &spec.chat_template {
        command.args(["--chat-template", template]);
    }
    let mut child = Sidecar::new(
        command
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                format!("The bundled llama-server runtime could not start: {error}")
            })?,
    );
    // llama-server explains a failed boot on stderr — an unsupported model architecture, a dyld
    // error on an OS too old for the runtime — and none of that reaches the user through an exit
    // status. Keep the tail of it, still echoing every line for the app log.
    let log = Arc::new(Mutex::new(VecDeque::<String>::new()));
    if let Some(stream) = child.child().stderr.take() {
        let log = log.clone();
        thread::spawn(move || {
            for line in BufReader::new(stream).lines().map_while(Result::ok) {
                eprintln!("{line}");
                let mut log = log.lock().unwrap_or_else(|error| error.into_inner());
                if log.len() == 40 {
                    log.pop_front();
                }
                log.push_back(line);
            }
        });
    }
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let health = format!("http://{address}/health");
    let client = Client::builder()
        .timeout(Duration::from_millis(500))
        .build()
        .map_err(|error| error.to_string())?;
    for _ in 0..240 {
        if let Some(status) = child.child().try_wait().map_err(|error| error.to_string())? {
            // Give the reader thread a moment to drain the pipe before we read its tail.
            thread::sleep(Duration::from_millis(100));
            return Err(startup_failure(&log, status));
        }
        if client
            .get(&health)
            .send()
            .map(|response| response.status().is_success())
            .unwrap_or(false)
        {
            let mut runtimes = manager.runtimes.lock().map_err(|error| error.to_string())?;
            if let Some(current) = runtimes.by_id.get_mut(&spec.id) {
                if runtime_is_running(current)? {
                    runtimes.active_id = Some(spec.id.clone());
                    drop(runtimes);
                    drop(child);
                    return Ok(running_status(&spec.id, size));
                }
                runtimes.by_id.remove(&spec.id);
            }
            runtimes
                .by_id
                .insert(
                    spec.id.clone(),
                    ManagedLlama {
                        child,
                        port,
                        context_size: context,
                    },
                );
            runtimes.active_id = Some(spec.id.clone());
            return Ok(running_status(&spec.id, size));
        }
        thread::sleep(Duration::from_millis(250));
    }
    // Alive but not answering, and the child is about to be dropped and killed, so the tail it
    // printed is the only account of what it was doing. Say that instead of a bare timeout.
    Err(startup_failure_message(
        &log.lock()
            .map(|log| log.iter().cloned().collect::<Vec<String>>())
            .unwrap_or_default(),
    )
    .unwrap_or_else(|| "The local model did not become ready within 60 seconds".into()))
}

#[tauri::command]
pub async fn start_local_model(
    app: AppHandle,
    spec: ModelSpec,
) -> Result<LocalModelStatus, String> {
    tauri::async_runtime::spawn_blocking(move || start_local_model_blocking(&app, &spec))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn stop_local_model(app: AppHandle, model_id: String) -> Result<(), String> {
    let manager = app.state::<LocalModelManager>();
    let mut runtimes = manager.runtimes.lock().map_err(|error| error.to_string())?;
    let current = runtimes.by_id.remove(&model_id);
    repair_active_runtime(&mut runtimes);
    drop(runtimes);
    drop(current);
    Ok(())
}

pub fn local_model_routes(app: &AppHandle) -> Result<BTreeMap<String, LocalModelRoute>, String> {
    let manager = app.state::<LocalModelManager>();
    let mut runtimes = manager.runtimes.lock().map_err(|error| error.to_string())?;
    let ids: Vec<String> = runtimes.by_id.keys().cloned().collect();
    for id in ids {
        let running = runtimes
            .by_id
            .get_mut(&id)
            .map(runtime_is_running)
            .transpose()?
            .unwrap_or(false);
        if !running {
            runtimes.by_id.remove(&id);
        }
    }
    repair_active_runtime(&mut runtimes);

    let mut routes: BTreeMap<String, LocalModelRoute> = runtimes
        .by_id
        .iter()
        .map(|(id, runtime)| {
            (
                id.clone(),
                LocalModelRoute {
                    url: format!("http://127.0.0.1:{}/v1", runtime.port),
                    context_size: runtime.context_size,
                },
            )
        })
        .collect();
    if let Some(route) = runtimes
        .active_id
        .as_ref()
        .and_then(|id| routes.get(id))
        .cloned()
    {
        routes.insert("active".into(), route);
    }
    Ok(routes)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The seeded 3B: 22 layers, 8 KV heads, 128-wide keys and values, trained for 262144
    /// tokens. 22 * 8 * 256 * 2 = 90112 bytes per token, so its full trained window is 23.6 GB
    /// of KV cache — the concrete reason `--ctx-size 0` is not a safe default.
    fn seeded_3b() -> ModelShape {
        ModelShape {
            context_length: 262_144,
            bytes_per_token: 90_112,
        }
    }

    /// A 70B-class model: 80 layers, 8 KV heads, 128 wide. Five times the seeded model's
    /// cost per token, which is why parameter count cannot stand in for it.
    fn large_70b() -> ModelShape {
        ModelShape {
            context_length: 131_072,
            bytes_per_token: 80 * 8 * 256 * 2,
        }
    }

    #[test]
    fn window_fits_the_machine_that_has_to_hold_it() {
        // 16 GB laptop, 3.4 GB of weights: 70% of 16 GiB leaves ~7.6 GB for cache, which buys
        // far less than the 262144 tokens the model was trained for.
        let laptop = context_size_for_model(Some(seeded_3b()), 3_424_947_040, 16 * GIB, None);
        assert!(laptop > MIN_CONTEXT && laptop < 131_072, "got {laptop}");
        assert_eq!(laptop % 256, 0, "windows are batch-aligned");

        // The same model on a 512 GB server is no longer memory-bound, so the trained length
        // becomes the limit — never more than the model can actually attend over.
        let server = context_size_for_model(Some(seeded_3b()), 3_424_947_040, 512 * GIB, None);
        assert_eq!(server, MAX_DERIVED_CONTEXT);
    }

    /// The heart of it: the same machine gives two models different windows, because the
    /// models cost different amounts per token. A single machine-wide number cannot do this.
    #[test]
    fn window_follows_the_model_not_just_the_machine() {
        // MEMORY_SHARE lends a third of RAM, and 40 GB does not fit in a third of 64 GB, so that
        // machine has no window to divide. Needs one that holds both models.
        let workstation = 192 * GIB;
        let small = context_size_for_model(Some(seeded_3b()), 3 * GIB, workstation, None);
        let large = context_size_for_model(Some(large_70b()), 40 * GIB, workstation, None);
        assert!(small > large, "3B got {small}, 70B got {large}");
        // The 70B is still given a usable window rather than being squeezed to the floor.
        assert!(large > MIN_CONTEXT, "got {large}");
    }

    /// A model whose weights leave no room still gets the floor. llama-server may refuse to
    /// boot, which is the honest outcome — a window nothing fits in is not a working model.
    #[test]
    fn window_never_drops_below_a_usable_turn() {
        assert_eq!(
            context_size_for_model(Some(large_70b()), 60 * GIB, 64 * GIB, None),
            MIN_CONTEXT
        );
    }

    /// The administrator override outranks both the trained length and the derived ceiling:
    /// they know about hardware this process cannot measure.
    #[test]
    fn administrator_override_wins() {
        let shape = Some(seeded_3b());
        assert_eq!(context_size_for_model(shape, 3 * GIB, 8 * GIB, Some(200_000)), 200_000);
        // Below the floor is a typo, not an intention.
        assert_eq!(context_size_for_model(shape, 3 * GIB, 512 * GIB, Some(64)), MIN_CONTEXT);
        // And it applies even when the header could not be read at all.
        assert_eq!(context_size_for_model(None, 0, 8 * GIB, Some(48_000)), 48_000);
    }

    /// An unreadable header falls back to sizing off memory alone. Thresholds sit under the
    /// round numbers they stand for: Linux subtracts what the kernel reserved, so a 16 GB box
    /// reporting 15.6 GiB is not an 8 GB one.
    #[test]
    fn unknown_model_falls_back_to_memory() {
        assert_eq!(context_size_for_model(None, 0, 8 * GIB, None), 8_192);
        assert_eq!(context_size_for_model(None, 0, 16 * GIB, None), 16_384);
        assert_eq!(context_size_for_model(None, 0, 64 * GIB, None), 32_768);
        assert_eq!(context_size_for_unknown_model(15 * GIB + GIB / 2), 16_384);
    }

    #[test]
    fn rejects_a_file_that_is_not_a_gguf() {
        let directory = std::env::temp_dir().join(format!("bees-gguf-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("not-a-model.gguf");
        fs::write(&path, b"this is not a model file at all").unwrap();
        assert_eq!(read_model_shape(&path), None);
        let _ = fs::remove_dir_all(&directory);
    }

    /// Parses a header written to the real GGUF layout, including a string array to walk past
    /// — the tokenizer vocabulary sits between the fields we want in every actual model.
    #[test]
    fn reads_the_shape_out_of_a_gguf_header() {
        fn string(bytes: &mut Vec<u8>, value: &str) {
            bytes.extend((value.len() as u64).to_le_bytes());
            bytes.extend(value.as_bytes());
        }
        fn entry(bytes: &mut Vec<u8>, key: &str, value: u32) {
            string(bytes, key);
            bytes.extend(4u32.to_le_bytes()); // u32 value
            bytes.extend(value.to_le_bytes());
        }

        let mut header = Vec::new();
        header.extend(b"GGUF");
        header.extend(3u32.to_le_bytes());
        header.extend(0u64.to_le_bytes()); // tensor count
        header.extend(7u64.to_le_bytes()); // kv count
        string(&mut header, "general.architecture");
        header.extend(8u32.to_le_bytes());
        string(&mut header, "nanbeige");
        // A vocabulary-shaped array in the middle, exactly where a real file puts it.
        string(&mut header, "tokenizer.ggml.tokens");
        header.extend(9u32.to_le_bytes());
        header.extend(8u32.to_le_bytes()); // of strings
        header.extend(2u64.to_le_bytes());
        string(&mut header, "hello");
        string(&mut header, "world");
        entry(&mut header, "nanbeige.context_length", 262_144);
        entry(&mut header, "nanbeige.block_count", 22);
        entry(&mut header, "nanbeige.attention.head_count", 48);
        entry(&mut header, "nanbeige.attention.head_count_kv", 8);
        entry(&mut header, "nanbeige.attention.key_length", 128);
        entry(&mut header, "nanbeige.attention.value_length", 128);

        let directory = std::env::temp_dir().join(format!("bees-gguf-ok-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("model.gguf");
        fs::write(&path, &header).unwrap();
        assert_eq!(read_model_shape(&path), Some(seeded_3b()));
        let _ = fs::remove_dir_all(&directory);
    }

    fn spec(file_name: &str, url: &str) -> ModelSpec {
        ModelSpec {
            id: "model".into(),
            file_name: file_name.into(),
            url: Some(url.into()),
            local_path: None,
            bytes: 0,
            sha256: None,
            chat_template: None,
            context_size: None,
        }
    }

    #[test]
    fn rejects_file_names_that_escape_the_models_directory() {
        assert!(spec("gemma.gguf", "https://example.com/m.gguf")
            .validate()
            .is_ok());
        for name in [
            "../evil.gguf",
            "sub/dir.gguf",
            "..\\evil.gguf",
            "notgguf",
            "",
        ] {
            assert!(
                spec(name, "https://example.com/m.gguf").validate().is_err(),
                "accepted {name}"
            );
        }
    }

    #[test]
    fn waits_for_a_download_already_in_flight() {
        let downloads: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>> = Arc::default();
        let cancelled = Arc::new(AtomicBool::new(false));
        downloads
            .lock()
            .unwrap()
            .insert("model".into(), cancelled.clone());

        let finisher = {
            let downloads = downloads.clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(300));
                downloads.lock().unwrap().remove("model");
            })
        };
        assert!(wait_for_download(&downloads, "model", &cancelled).is_ok());
        finisher.join().unwrap();

        // A cancelled download hands the error back instead of letting the waiter start its own.
        downloads
            .lock()
            .unwrap()
            .insert("model".into(), cancelled.clone());
        cancelled.store(true, Ordering::Relaxed);
        assert_eq!(
            wait_for_download(&downloads, "model", &cancelled),
            Err("Model download cancelled".into())
        );
    }

    #[test]
    fn explains_why_llama_server_quit() {
        let lines = |raw: &[&str]| {
            raw.iter()
                .map(|line| (*line).into())
                .collect::<Vec<String>>()
        };

        let too_old = lines(&[
            "dyld[1]: Symbol not found: _posix_spawn_file_actions_addchdir",
            "  Referenced from: libllama-server-impl.dylib (built for macOS 26.0 which is newer than running OS)",
        ]);
        assert!(startup_failure_message(&too_old)
            .unwrap()
            .contains("newer operating system"));

        let unsupported = lines(&[
            "0.00.140 E llama_model_load: error loading model: unknown model architecture: 'nanbeige'",
            "0.00.217 E srv    load_model: failed to load model",
        ]);
        assert!(startup_failure_message(&unsupported)
            .unwrap()
            .contains("newer local runtime"));

        let other = lines(&["0.00.217 E srv  llama_server: exiting due to model loading error"]);
        assert!(startup_failure_message(&other)
            .unwrap()
            .contains("exiting due to model loading error"));

        assert!(startup_failure_message(&lines(&["0.00.060 I srv  init: fine"])).is_none());
    }

    #[test]
    fn rejects_non_https_downloads() {
        assert!(spec("m.gguf", "http://example.com/m.gguf")
            .validate()
            .is_err());
        assert!(spec("m.gguf", "file:///etc/passwd").validate().is_err());
    }

    #[test]
    fn local_files_need_an_absolute_path() {
        let mut local = spec("", "");
        local.local_path = Some("models/m.gguf".into());
        assert!(local.validate().is_err());
        local.local_path = Some("/models/m.gguf".into());
        assert!(local.validate().is_ok());
    }

    #[test]
    fn completeness_uses_the_pinned_size_when_there_is_one() {
        let directory = std::env::temp_dir().join(format!("bees-models-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("m.gguf");
        fs::write(&path, b"1234").unwrap();
        assert!(is_complete(&path, 0));
        assert!(is_complete(&path, 4));
        assert!(!is_complete(&path, 5));
        assert!(!is_complete(&directory.join("missing.gguf"), 0));
        fs::remove_dir_all(&directory).unwrap();
    }

    #[test]
    fn dropping_a_sidecar_returns_without_blocking() {
        let child = Command::new("sleep")
            .arg("30")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn sleep");
        let start = std::time::Instant::now();
        drop(Sidecar::new(child));
        assert!(start.elapsed() < Duration::from_secs(2));
    }
}

#[cfg(test)]
mod real_model_tests {
    use super::*;

    /// Reads the actual seeded GGUF when this machine happens to have downloaded it. Skipped
    /// everywhere else, so it never turns CI red — its job is to catch a parser that agrees
    /// with a handcrafted fixture but not with a file llama.cpp produced.
    #[test]
    fn matches_the_real_seeded_model_when_present() {
        let Some(home) = std::env::var_os("HOME") else {
            return;
        };
        let path = PathBuf::from(home).join(
            "Library/Application Support/bot.bees.desktop/models/Nanbeige4.2-3B-Q6_K.gguf",
        );
        if !path.exists() {
            return;
        }
        let shape = read_model_shape(&path).expect("the seeded model's header should parse");
        assert_eq!(shape.context_length, 262_144);
        assert_eq!(shape.bytes_per_token, 90_112);
    }
}
