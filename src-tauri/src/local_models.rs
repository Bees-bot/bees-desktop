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
/// window nothing fits in. Bees sends about 4.5k tokens of instructions and tool schemas before
/// the work even starts, and the runtime holds back the model's whole output allowance on top of
/// that, so anything under this leaves the model one token to answer in.
const MIN_CONTEXT: u32 = 16_384;
/// A memory-fit window alone is too aggressive on a desktop: Qwen 4B on 32 GiB derived
/// nearly 60k tokens, taking over 8 GiB for KV before compute buffers and other apps.
/// Cap automatic windows; an explicit per-model override can still request more.
const MAX_DERIVED_CONTEXT: u32 = 32_768;
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
/// Kept in step with `BEES_LOCAL_CTX`, which hands the same numbers to the DSH runtime so the
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
    let wanted = affordable
        .min(shape.context_length as u64)
        .min(MAX_DERIVED_CONTEXT as u64);
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

/// Preserve prompt reuse between workers without adding an unbudgeted 8 GiB.
/// Reserve at least half of RAM for compute buffers, Bees and other applications.
fn prompt_cache_mib_for_model(
    shape: Option<ModelShape>,
    weights_bytes: u64,
    total_memory_bytes: u64,
    context: u32,
) -> u64 {
    let Some(shape) = shape else { return 0 };
    (total_memory_bytes / 2)
        .saturating_sub(weights_bytes)
        .saturating_sub(shape.bytes_per_token.saturating_mul(context as u64))
        .min(8 * GIB)
        / (1024 * 1024)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn automatic_context_bounds_qwen_memory_without_clamping_explicit_overrides() {
        let qwen = Some(ModelShape {
            context_length: 262_144,
            bytes_per_token: 144 * 1024,
        });
        let weights = 2_497_281_120;
        assert_eq!(
            context_size_for_model(qwen, weights, 32 * GIB, None),
            32_768
        );
        assert_eq!(
            context_size_for_model(qwen, weights, 128 * GIB, None),
            32_768
        );
        assert_eq!(
            context_size_for_model(qwen, weights, 16 * GIB, None),
            21_504
        );
        assert_eq!(context_size_for_model(qwen, weights, 8 * GIB, None), 16_384);
        assert_eq!(
            context_size_for_model(qwen, weights, 32 * GIB, Some(65_536)),
            65_536
        );
        assert_eq!(
            context_size_for_model(None, weights, 32 * GIB, None),
            32_768
        );
        assert_eq!(
            prompt_cache_mib_for_model(qwen, weights, 32 * GIB, 32_768),
            8192
        );
        assert_eq!(
            prompt_cache_mib_for_model(qwen, weights, 8 * GIB, 16_384),
            0
        );
        let smaller_cache = prompt_cache_mib_for_model(qwen, weights, 16 * GIB, 21_504);
        assert!(smaller_cache > 0 && smaller_cache < 4096);
        assert_eq!(
            prompt_cache_mib_for_model(qwen, weights, 32 * GIB, 131_072),
            0
        );
        assert_eq!(
            prompt_cache_mib_for_model(None, weights, 32 * GIB, 32_768),
            0
        );
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
    let mut layer_sums: HashMap<String, u64> = HashMap::new();
    for _ in 0..kv_count {
        let key = cursor.string()?;
        let value_type = cursor.u32()?;
        match cursor.value(value_type)? {
            MetadataValue::Text(text) if key == "general.architecture" => architecture = text,
            MetadataValue::Number(number) => {
                numbers.insert(key, number);
            }
            MetadataValue::LayerSum(total) => {
                layer_sums.insert(key, total);
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
    // Hybrid models keep a cache on only some layers: LFM2 lists heads per layer, Qwen3.5
    // puts full attention on every Nth layer. Charging every layer starves them of context.
    let cached_heads = match layer_sums.get(&format!("{architecture}.attention.head_count_kv")) {
        Some(total) => *total,
        None => {
            (layers / field("full_attention_interval").unwrap_or(1).max(1)).checked_mul(kv_heads)?
        }
    };
    let bytes_per_token = cached_heads
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
    LayerSum(u64),
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
                } else if matches!(element_type, 4 | 5) && count <= 1024 {
                    // hybrid models list KV heads per layer, with 0 on layers that keep no cache
                    let mut total = 0u64;
                    for _ in 0..count {
                        total += u64::try_from(i32::from_le_bytes(self.bytes(4)?.try_into().ok()?))
                            .unwrap_or(0);
                    }
                    return Some(MetadataValue::LayerSum(total));
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

/// A model the user added under Settings → Local AI. The list lives in the frontend's settings store, so
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
    starts: Mutex<HashMap<String, Arc<AtomicBool>>>,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelHardware {
    total_memory: u64,
    available_memory: u64,
    available_disk: Option<u64>,
    architecture: &'static str,
}

#[tauri::command]
pub fn local_model_hardware(app: AppHandle) -> Result<LocalModelHardware, String> {
    let system = sysinfo::System::new_with_specifics(
        sysinfo::RefreshKind::nothing().with_memory(sysinfo::MemoryRefreshKind::everything()),
    );
    let directory = models_directory(&app)?;
    let available_disk = available_disk_space(&directory);
    Ok(LocalModelHardware {
        total_memory: system.total_memory(),
        // sysinfo 0.36 subtracts compressed pages from free + inactive memory on macOS,
        // which can clamp availability to zero. Total - used counts the compressor once.
        // ponytail: this is a conservative estimate until sysinfo's macOS fix can be adopted.
        available_memory: if cfg!(target_os = "macos") {
            system.total_memory().saturating_sub(system.used_memory())
        } else {
            system.available_memory()
        },
        available_disk,
        architecture: std::env::consts::ARCH,
    })
}

fn available_disk_space(path: &Path) -> Option<u64> {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    disks
        .list()
        .iter()
        .filter(|disk| path.starts_with(disk.mount_point()))
        .max_by_key(|disk| disk.mount_point().components().count())
        .map(|disk| disk.available_space())
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
    let starting = manager
        .starts
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
    // dropped after the lock is released, since dropping a llama child can wait up to a second
    let mut stale = None;
    if !running {
        stale = runtimes.by_id.remove(&spec.id);
        repair_active_runtime(&mut runtimes);
    }
    drop(runtimes);
    drop(stale);
    let complete = is_complete(&path, spec.bytes);
    let bytes = downloaded_bytes(&path, &part, spec.bytes);
    let state = if running {
        "running"
    } else if starting {
        "starting"
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
        if !sha256(part)?.eq_ignore_ascii_case(expected.trim()) {
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
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?;
    let mut request = client.get(url);
    if offset > 0 {
        request = request.header(RANGE, format!("bytes={offset}-"));
    }
    let mut response = request.send().map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        // 416: the half-downloaded file no longer matches the host, so the next try starts over
        if response.status() == StatusCode::RANGE_NOT_SATISFIABLE {
            let _ = fs::remove_file(&part);
        }
        let retry = if matches!(response.status().as_u16(), 416 | 429 | 500..=599) {
            " Try the download again in a moment."
        } else {
            ""
        };
        return Err(format!(
            "The model host returned {} while downloading.{retry}",
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
        drop(output);
        let _ = fs::remove_file(&part);
        return Err(format!(
            "Unexpected model download size: expected {} bytes, got {total}. Try the download again.",
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

    if let Some(available) = available_disk_space(directory) {
        if total > 0 && available < total.saturating_sub(offset).saturating_add(GIB) {
            return Err("Not enough free disk space for this model and 1 GiB of headroom. Free some space and retry; your partial download is saved.".into());
        }
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
            "Incomplete model download: expected {total} bytes, got {bytes}. Start the download again."
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
    stop_local_model(app.clone(), spec.id.clone()).await?;
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
    llama_runtime_candidates(packaged, source)
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| "The bundled llama-server runtime is missing. Reinstall Bees.".into())
}

fn llama_runtime_candidates(packaged: PathBuf, source: PathBuf) -> [PathBuf; 2] {
    if cfg!(debug_assertions) {
        // Tauri's copied debug resource can be reassessed by macOS and wedge before main; the
        // preparation script signs the source runtime directly. Release apps use their bundled,
        // Developer-ID-signed resource first.
        [source, packaged]
    } else {
        [packaged, source]
    }
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

/// A poisoned log still holds what was printed, so read it either way.
fn log_lines(log: &Mutex<VecDeque<String>>) -> Vec<String> {
    log.lock()
        .unwrap_or_else(|error| error.into_inner())
        .iter()
        .cloned()
        .collect()
}

/// Turn what llama-server printed before it quit into something the user can act on.
fn startup_failure(log: &Mutex<VecDeque<String>>, status: ExitStatus) -> String {
    startup_failure_message(&log_lines(log))
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

fn start_local_model_blocking_inner(
    app: &AppHandle,
    spec: &ModelSpec,
    cancelled: &AtomicBool,
) -> Result<LocalModelStatus, String> {
    let _startup = crate::startup::start("background.local-model.start");
    let path = model_path(app, spec)?;
    if !is_complete(&path, spec.bytes) {
        return Err("Load the model before starting it".into());
    }
    let size = file_len(&path);
    let manager = app.state::<LocalModelManager>();
    // Queue starts for macOS first-launch safety, but never hold the runtime lock across boot.
    let _starting = manager.starting.lock().map_err(|error| error.to_string())?;
    if cancelled.load(Ordering::Relaxed) {
        return Err("Model start cancelled".into());
    }
    let mut stale = None;
    {
        let mut runtimes = manager.runtimes.lock().map_err(|error| error.to_string())?;
        if let Some(current) = runtimes.by_id.get_mut(&spec.id) {
            if runtime_is_running(current)? {
                runtimes.active_id = Some(spec.id.clone());
                return Ok(running_status(&spec.id, size));
            }
            stale = runtimes.by_id.remove(&spec.id);
        }
    }
    drop(stale);

    let executable = bundled_llama_server(app)?;
    let working_directory = executable
        .parent()
        .ok_or_else(|| "llama-server path has no parent directory".to_string())?;
    let port = available_loopback_port()?;
    // Sized from this model's own header rather than a table: a 3B and a 235B cost wildly
    // different amounts per token, and the file on disk is the only thing that knows which.
    let shape = read_model_shape(&path);
    let weights = file_len(&path);
    let memory = total_memory();
    let context = context_size_for_model(shape, weights, memory, spec.context_size);
    let prompt_cache = prompt_cache_mib_for_model(shape, weights, memory, context);
    let mut command = Command::new(&executable);
    // llama-server needs none of our environment, and the parent's may hold model credentials.
    command.env_clear();
    command
        .current_dir(working_directory)
        .arg("--model")
        .arg(&path)
        .args(["--host", "127.0.0.1", "--port"])
        .arg(port.to_string())
        .args(["--alias", "active", "--ctx-size"])
        .arg(context.to_string())
        // llama.cpp defaults to four slots sharing one unified KV cache, so two agents running at
        // once overrun a context sized for one and the second dies on "Context size has been
        // exceeded". One slot gives each request the whole context and queues the rest.
        .args(["--parallel", "1"])
        // Switching workers should reuse saved prompts when the memory budget allows it.
        .arg("--cache-ram")
        .arg(prompt_cache.to_string())
        // Without --jinja llama.cpp falls back to its legacy template handling and parses tool calls
        // by guesswork, which is most of why a local model answers in prose instead of calling a tool.
        .arg("--jinja")
        // llama.cpp keeps every layer on the CPU unless asked. On this Mac that halves generation
        // speed for nothing: the GPU shares the same memory the layers were already costing.
        .args(["--n-gpu-layers", "99"]);
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
    // Large contexts can spend well over a minute allocating their KV cache, especially while
    // macOS verifies a freshly installed runtime. Keep waiting while the child is healthy.
    for _ in 0..1_200 {
        if cancelled.load(Ordering::Relaxed) {
            return Err("Model start cancelled".into());
        }
        if let Some(status) = child
            .child()
            .try_wait()
            .map_err(|error| error.to_string())?
        {
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
            if cancelled.load(Ordering::Relaxed) {
                return Err("Model start cancelled".into());
            }
            let mut runtimes = manager.runtimes.lock().map_err(|error| error.to_string())?;
            let mut stale = None;
            if let Some(current) = runtimes.by_id.get_mut(&spec.id) {
                if runtime_is_running(current)? {
                    runtimes.active_id = Some(spec.id.clone());
                    drop(runtimes);
                    drop(child);
                    return Ok(running_status(&spec.id, size));
                }
                stale = runtimes.by_id.remove(&spec.id);
            }
            runtimes.by_id.insert(
                spec.id.clone(),
                ManagedLlama {
                    child,
                    port,
                    context_size: context,
                },
            );
            runtimes.active_id = Some(spec.id.clone());
            drop(runtimes);
            drop(stale);
            return Ok(running_status(&spec.id, size));
        }
        thread::sleep(Duration::from_millis(250));
    }
    // The child is about to be dropped and killed, so its tail is the only account of the stall.
    let lines = log_lines(&log);
    Err(startup_failure_message(&lines).unwrap_or_else(|| {
        lines
            .last()
            .map(|line| {
                format!(
                    "The local model did not become ready within 5 minutes. Last message: {line}"
                )
            })
            .unwrap_or_else(|| "The local model did not become ready within 5 minutes".into())
    }))
}

fn start_local_model_blocking(
    app: &AppHandle,
    spec: &ModelSpec,
) -> Result<LocalModelStatus, String> {
    let manager = app.state::<LocalModelManager>();
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut starts = manager.starts.lock().map_err(|error| error.to_string())?;
        if starts.contains_key(&spec.id) {
            return Err("Model is already starting".into());
        }
        starts.insert(spec.id.clone(), cancelled.clone());
    }
    let result = start_local_model_blocking_inner(app, spec, &cancelled);
    manager
        .starts
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&spec.id);
    result
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

impl LocalModelManager {
    /// Quitting exits the process outright, so every llama-server is dropped here first.
    pub fn shutdown(&self) {
        if let Ok(starts) = self.starts.lock() {
            for cancelled in starts.values() {
                cancelled.store(true, Ordering::Relaxed);
            }
        }
        if let Ok(mut runtimes) = self.runtimes.lock() {
            runtimes.by_id.clear();
            runtimes.active_id = None;
        }
    }
}

// spawn_blocking: Sidecar::drop can sleep up to a second waiting for a stubborn llama-server, and
// every other command that drops one already keeps that off the command thread. This one did not,
// so stopping a model froze the UI for as long as the process took to die.
#[tauri::command]
pub async fn stop_local_model(app: AppHandle, model_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || stop_local_model_blocking(&app, &model_id))
        .await
        .map_err(|error| error.to_string())?
}

fn stop_local_model_blocking(app: &AppHandle, model_id: &str) -> Result<(), String> {
    let manager = app.state::<LocalModelManager>();
    if let Some(cancelled) = manager
        .starts
        .lock()
        .map_err(|error| error.to_string())?
        .get(model_id)
    {
        cancelled.store(true, Ordering::Relaxed);
    }
    let mut runtimes = manager.runtimes.lock().map_err(|error| error.to_string())?;
    let current = runtimes.by_id.remove(model_id);
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
