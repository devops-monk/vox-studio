//! Supervisor for `voxd`, the Python inference daemon.
//!
//! Lifecycle: locate `uv` → pick a port → `uv run python -m voxd --lifeline` → poll
//! `/v1/status` until ready → watch for exits and restart with backoff.
//! voxd's stdin is held open for its whole life; closing it (or our own death) makes
//! voxd exit, so a crashed shell never leaves the daemon running.

use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

const PREFERRED_PORT: u16 = 4870;
const MAX_LOG_LINES: usize = 500;
const MAX_AUTO_RESTARTS: u32 = 3;
/// First launch installs Python + dependencies, so allow a generous budget.
const BOOT_BUDGET: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Starting,
    Booting,
    LoadingEngines,
    Ready,
    Error,
    Stopped,
}

#[derive(Debug, Clone, Serialize)]
pub struct VoxdState {
    pub phase: Phase,
    pub detail: Option<String>,
    pub url: Option<String>,
    pub token: String,
    pub restarts: u32,
}

struct Inner {
    state: VoxdState,
    child: Option<Child>,
    lifeline: Option<ChildStdin>,
    logs: VecDeque<String>,
    generation: u64,
    shutting_down: bool,
}

#[derive(Clone)]
pub struct Voxd {
    app: AppHandle,
    inner: Arc<Mutex<Inner>>,
}

impl Voxd {
    pub fn new(app: AppHandle) -> Self {
        let state = VoxdState {
            phase: Phase::Starting,
            detail: None,
            url: None,
            token: random_token(),
            restarts: 0,
        };
        let inner = Inner {
            state,
            child: None,
            lifeline: None,
            logs: VecDeque::new(),
            generation: 0,
            shutting_down: false,
        };
        Self { app, inner: Arc::new(Mutex::new(inner)) }
    }

    pub fn state(&self) -> VoxdState {
        self.inner.lock().unwrap().state.clone()
    }

    pub fn logs(&self) -> Vec<String> {
        self.inner.lock().unwrap().logs.iter().cloned().collect()
    }

    /// Start (or restart) the daemon on a background thread.
    pub fn start(&self) {
        let generation = {
            let mut inner = self.inner.lock().unwrap();
            inner.shutting_down = false;
            inner.generation += 1;
            inner.generation
        };
        let this = self.clone();
        thread::spawn(move || {
            if let Err(message) = this.launch(generation) {
                this.log(format!("[shell] {message}"));
                this.set_phase(Phase::Error, Some(message));
            }
        });
    }

    /// User-initiated restart: resets the crash counter.
    pub fn restart(&self) {
        self.stop();
        self.inner.lock().unwrap().state.restarts = 0;
        self.start();
    }

    pub fn stop(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.shutting_down = true;
        inner.lifeline.take(); // EOF on stdin → voxd exits on its own
        if let Some(mut child) = inner.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        inner.state.phase = Phase::Stopped;
    }

    fn launch(&self, generation: u64) -> Result<(), String> {
        self.set_phase(Phase::Starting, Some("Preparing voice engine".into()));

        let uv = find_uv().ok_or("Couldn't find `uv`. Install it from https://docs.astral.sh/uv/ and restart VoxStudio.")?;
        let project = self.project_dir().ok_or("voxd sources are missing from this build")?;
        let data_dir = self.app.path().app_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
        let port = pick_port().ok_or("No free local port for the voice engine")?;
        let token = self.state().token;

        self.log(format!("[shell] starting voxd on 127.0.0.1:{port} ({})", project.display()));
        let bundled = !project.starts_with(Path::new(env!("CARGO_MANIFEST_DIR")).join(".."));
        let runtime = data_dir.join("runtime");
        let mut cmd = if bundled {
            // The app bundle is read-only (and signed). Install only the locked dependencies —
            // voxd itself is imported straight from the bundle, so nothing is ever built — then
            // run the environment's Python directly, with the bytecode cache kept outside.
            self.set_phase(Phase::Starting, Some("Preparing voice engine".into()));
            let sync = Command::new(&uv)
                .args(["sync", "--frozen", "--no-install-project", "--no-dev", "--quiet", "--project"])
                .arg(&project)
                .env("UV_PROJECT_ENVIRONMENT", &runtime)
                .output()
                .map_err(|e| format!("Couldn't prepare the voice engine: {e}"))?;
            for line in String::from_utf8_lossy(&sync.stderr).lines() {
                self.log(format!("[uv] {line}"));
            }
            if !sync.status.success() {
                return Err("Couldn't install the voice engine's components (see Logs)".into());
            }
            let python = if cfg!(windows) { runtime.join("Scripts").join("python.exe") } else { runtime.join("bin").join("python") };
            let mut c = Command::new(python);
            c.env("PYTHONPATH", project.join("src")).env("PYTHONPYCACHEPREFIX", data_dir.join("pycache"));
            c
        } else {
            let mut c = Command::new(&uv);
            c.args(["run", "--no-dev", "--quiet", "--project"]).arg(&project).arg("python").env("UV_PROJECT_ENVIRONMENT", &runtime);
            c
        };
        let mut child = cmd
            .args(["-m", "voxd", "--lifeline", "--port", &port.to_string(), "--data-dir"])
            .arg(&data_dir)
            .env("VOXD_TOKEN", &token)
            .env("PYTHONUNBUFFERED", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Couldn't start voxd: {e}"))?;

        for stream in [child.stdout.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
                       child.stderr.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>)]
            .into_iter()
            .flatten()
        {
            let this = self.clone();
            thread::spawn(move || {
                for line in BufReader::new(stream).lines().map_while(Result::ok) {
                    this.log(line);
                }
            });
        }

        {
            let mut inner = self.inner.lock().unwrap();
            if inner.generation != generation || inner.shutting_down {
                let _ = child.kill();
                return Ok(());
            }
            inner.lifeline = child.stdin.take();
            inner.child = Some(child);
            inner.state.url = Some(format!("http://127.0.0.1:{port}"));
        }
        self.set_phase(Phase::Booting, Some("Setting up the Python runtime (first launch takes a minute)".into()));
        self.monitor(generation, port);
        Ok(())
    }

    /// Poll status until ready, then keep watching for the process to exit.
    fn monitor(&self, generation: u64, port: u16) {
        let started = Instant::now();
        let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(2)).build();
        let status_url = format!("http://127.0.0.1:{port}/v1/status");

        loop {
            let ready = self.state().phase == Phase::Ready;
            thread::sleep(Duration::from_millis(if ready { 1000 } else { 300 }));

            let exit = {
                let mut inner = self.inner.lock().unwrap();
                if inner.generation != generation || inner.shutting_down {
                    return;
                }
                match inner.child.as_mut().map(|c| c.try_wait()) {
                    Some(Ok(Some(status))) => Some(status.to_string()),
                    Some(Err(e)) => Some(e.to_string()),
                    _ => None,
                }
            };
            if let Some(status) = exit {
                return self.on_exit(status);
            }
            if ready {
                continue;
            }
            if started.elapsed() > BOOT_BUDGET {
                self.stop();
                return self.set_phase(Phase::Error, Some("The voice engine took too long to start".into()));
            }
            if let Ok(resp) = agent.get(&status_url).call() {
                if let Ok(body) = resp.into_json::<serde_json::Value>() {
                    let detail = body["detail"].as_str().map(str::to_owned);
                    match body["phase"].as_str() {
                        Some("ready") => self.set_phase(Phase::Ready, None),
                        Some("loading_engines") => self.set_phase(Phase::LoadingEngines, detail),
                        Some("error") => self.set_phase(Phase::Error, detail),
                        _ => {}
                    }
                }
            }
        }
    }

    fn on_exit(&self, status: String) {
        let restarts = {
            let mut inner = self.inner.lock().unwrap();
            inner.child = None;
            inner.lifeline = None;
            inner.state.restarts += 1;
            inner.state.restarts
        };
        self.log(format!("[shell] voxd exited ({status})"));
        if restarts > MAX_AUTO_RESTARTS {
            return self.set_phase(Phase::Error, Some(format!("The voice engine keeps stopping ({status})")));
        }
        let backoff = Duration::from_secs(1 << (restarts - 1));
        self.set_phase(Phase::Starting, Some(format!("Restarting voice engine (attempt {restarts})")));
        thread::sleep(backoff);
        if !self.inner.lock().unwrap().shutting_down {
            self.start();
        }
    }

    fn project_dir(&self) -> Option<PathBuf> {
        let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("../voxd");
        if cfg!(debug_assertions) && dev.join("pyproject.toml").exists() {
            return Some(dev);
        }
        let bundled = self.app.path().resource_dir().ok()?.join("voxd");
        bundled.join("pyproject.toml").exists().then_some(bundled)
    }

    fn set_phase(&self, phase: Phase, detail: Option<String>) {
        let snapshot = {
            let mut inner = self.inner.lock().unwrap();
            if inner.state.phase == phase && inner.state.detail == detail {
                return;
            }
            inner.state.phase = phase;
            inner.state.detail = detail;
            inner.state.clone()
        };
        let _ = self.app.emit("voxd://state", snapshot);
    }

    pub fn log(&self, line: String) {
        if cfg!(debug_assertions) {
            eprintln!("[voxd] {line}");
        }
        {
            let mut inner = self.inner.lock().unwrap();
            if inner.logs.len() == MAX_LOG_LINES {
                inner.logs.pop_front();
            }
            inner.logs.push_back(line.clone());
        }
        self.append_to_file(&line);
        let _ = self.app.emit("voxd://log", line);
    }

    /// Also keep the log on disk (app log folder, rotated at 5 MB) for bug reports.
    fn append_to_file(&self, line: &str) {
        use std::io::Write;
        const MAX_BYTES: u64 = 5 * 1024 * 1024;
        let Ok(dir) = self.app.path().app_log_dir() else { return };
        if std::fs::create_dir_all(&dir).is_err() {
            return;
        }
        let path = dir.join("voxstudio.log");
        if std::fs::metadata(&path).map(|m| m.len() > MAX_BYTES).unwrap_or(false) {
            let _ = std::fs::rename(&path, dir.join("voxstudio.1.log"));
        }
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
            let _ = writeln!(f, "{line}");
        }
    }

    pub fn log_path(&self) -> Option<PathBuf> {
        self.app.path().app_log_dir().ok().map(|d| d.join("voxstudio.log"))
    }
}

fn find_uv() -> Option<PathBuf> {
    let exe = if cfg!(windows) { "uv.exe" } else { "uv" };
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(explicit) = std::env::var_os("VOXSTUDIO_UV") {
        candidates.push(explicit.into());
    }
    // Bundled sidecar sits next to our own executable.
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) {
        candidates.push(dir.join(exe));
    }
    // GUI apps on macOS don't inherit the shell PATH, so check the usual install spots.
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        candidates.push(home.join(".local/bin").join(exe));
        candidates.push(home.join(".cargo/bin").join(exe));
    }
    candidates.push("/opt/homebrew/bin/uv".into());
    candidates.push("/usr/local/bin/uv".into());
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|d| d.join(exe)));
    }
    candidates.into_iter().find(|p| p.is_file())
}

fn pick_port() -> Option<u16> {
    TcpListener::bind(("127.0.0.1", PREFERRED_PORT))
        .or_else(|_| TcpListener::bind(("127.0.0.1", 0)))
        .ok()?
        .local_addr()
        .ok()
        .map(|a| a.port())
}

fn random_token() -> String {
    let mut bytes = [0u8; 24];
    getrandom::fill(&mut bytes).expect("OS randomness unavailable");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_is_48_hex_chars_and_unique() {
        let (a, b) = (random_token(), random_token());
        assert_eq!(a.len(), 48);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn picks_a_bindable_port() {
        let port = pick_port().expect("port");
        assert!(TcpListener::bind(("127.0.0.1", port)).is_ok());
    }
}
