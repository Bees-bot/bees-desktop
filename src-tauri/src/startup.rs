use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::Path,
    sync::{Mutex, OnceLock},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

static STARTED: OnceLock<Instant> = OnceLock::new();
static LOG: Mutex<Option<File>> = Mutex::new(None);
static EARLY: Mutex<Vec<String>> = Mutex::new(Vec::new());

pub fn mark(phase: &str) {
    record(phase, "mark", None);
}

fn record(phase: &str, event: &str, duration_ms: Option<u128>) {
    let elapsed = STARTED.get_or_init(Instant::now).elapsed().as_millis();
    let at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    // Labels are fixed by the application; never log URLs, credentials, or error text.
    let duration = duration_ms
        .map(|ms| format!(",\"durationMs\":{ms}"))
        .unwrap_or_default();
    let line = format!(
        "[bees-startup] {{\"atMs\":{at},\"pid\":{},\"source\":\"native\",\"phase\":\"{phase}\",\"event\":\"{event}\",\"elapsedMs\":{elapsed}{duration}}}\n",
        std::process::id()
    );
    let _ = std::io::stderr().write_all(line.as_bytes());
    if let Ok(mut log) = LOG.lock() {
        if let Some(file) = log.as_mut() {
            let _ = file.write_all(line.as_bytes());
        } else if let Ok(mut early) = EARLY.lock() {
            // Keep the buffer bounded if the diagnostic file cannot be opened.
            if early.len() < 128 {
                early.push(line);
            }
        }
    }
}

pub fn open(path: &Path) {
    let _ = fs::rename(path, path.with_extension("log.1"));
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        if let Ok(mut log) = LOG.lock() {
            if let Ok(mut early) = EARLY.lock() {
                for line in early.drain(..) {
                    let _ = file.write_all(line.as_bytes());
                }
            }
            *log = Some(file);
        }
    }
}

pub struct Step<'a> {
    phase: &'a str,
    started: Instant,
}

pub fn start(phase: &str) -> Step<'_> {
    record(phase, "start", None);
    Step {
        phase,
        started: Instant::now(),
    }
}

impl Drop for Step<'_> {
    fn drop(&mut self) {
        // "end" also covers an early return; it does not assert successful startup.
        record(self.phase, "end", Some(self.started.elapsed().as_millis()));
    }
}

pub fn step<T>(phase: &str, run: impl FnOnce() -> T) -> T {
    let _step = start(phase);
    run()
}
