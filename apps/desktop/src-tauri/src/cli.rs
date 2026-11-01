//! Runs the Claude Code or Codex CLI for an AI request. This is the app's only
//! process spawning, so it is a security boundary:
//!
//! - only `claude` and `codex`, resolved to an absolute path (an override must be
//!   absolute and name a file called exactly `claude` or `codex`);
//! - a fixed argument list passed straight to the program, never through a shell;
//!   the prompt goes on stdin;
//! - each run gets a fresh, empty temporary directory as its working directory,
//!   removed when the run ends;
//! - the timeout, the stdout cap and `ai_cli_cancel` kill the whole process group.
//!
//! The server builds the prompt and unwraps the CLI output; this module returns raw
//! stdout and the exit code. Never log the prompt, system prompt, schema or output.

use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

pub const RUN_TIMEOUT: Duration = Duration::from_secs(120);
pub const MAX_OUTPUT: usize = 1_048_576;
const RUN_LIMITS: Limits = Limits { timeout: RUN_TIMEOUT, max_output: MAX_OUTPUT };
/// `--version` and the sign-in check: short, small output.
const STATUS_LIMITS: Limits = Limits { timeout: Duration::from_secs(15), max_output: 64 * 1024 };
const POLL: Duration = Duration::from_millis(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    Claude,
    Codex,
}

impl Provider {
    pub fn parse(name: &str) -> Result<Self, CliError> {
        match name {
            "claude" => Ok(Self::Claude),
            "codex" => Ok(Self::Codex),
            _ => Err(CliError::new("spawn_failed", "Only the claude and codex programs can be run.")),
        }
    }

    /// The only file name this provider's program may have.
    fn binary(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }
}

/// Returned to the frontend as `{ code, message }`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct CliError {
    /// `not_installed` | `timeout` | `too_large` | `spawn_failed` | `cancelled`
    pub code: &'static str,
    pub message: String,
}

impl CliError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
}

/// A finished run. A non-zero exit is not an error: the server maps it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct CliOutput {
    pub stdout: String,
    pub exit_code: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct CliStatus {
    pub installed: bool,
    pub signed_in: bool,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub timeout: Duration,
    /// Bytes of stdout (or Codex's last-message file) before the run is killed.
    pub max_output: usize,
}

/// Finds the program for `provider` (`claude` or `codex` only): the override if
/// given (absolute, no `.`/`..`, file name exactly the program's), else `PATH`.
pub fn resolve_binary(provider: &str, path_override: Option<&str>) -> Result<PathBuf, CliError> {
    let name = Provider::parse(provider)?.binary();
    let not_installed = || CliError::new("not_installed", format!("`{name}` isn't installed on this computer."));
    let path = match path_override.filter(|p| !p.is_empty()) {
        Some(p) => {
            let p = PathBuf::from(p);
            let plain = p.components().all(|c| !matches!(c, Component::CurDir | Component::ParentDir));
            if !p.is_absolute() || !plain || p.file_name() != Some(OsStr::new(name)) {
                return Err(CliError::new(
                    "not_installed",
                    format!("The program path must be an absolute path to a file named `{name}`."),
                ));
            }
            p
        }
        None => which::which(name).map_err(|_| not_installed())?,
    };
    // `which` can return a relative path when PATH has a relative entry.
    if !path.is_absolute() || !path.is_file() {
        return Err(not_installed());
    }
    Ok(path)
}

/// Claude Code: print mode, JSON output, structured output, every tool, MCP
/// server, slash command and session file turned off. Flags checked against
/// `claude --help` 2.1.295.
pub fn claude_args(system: &str, schema: &str) -> Vec<OsString> {
    [
        "-p",
        "--output-format",
        "json",
        "--json-schema",
        schema,
        "--system-prompt",
        system,
        "--tools",
        "",
        "--strict-mcp-config",
        "--no-session-persistence",
        "--disable-slash-commands",
    ]
    .into_iter()
    .map(OsString::from)
    .collect()
}

/// Codex: read-only sandbox, prompt on stdin (`-`), final message to `out.txt`.
/// UNVERIFIED: no `codex` binary was available to check these flags against.
fn codex_args(dir: &Path) -> Vec<OsString> {
    vec![
        "exec".into(),
        "--sandbox".into(),
        "read-only".into(),
        "--skip-git-repo-check".into(),
        "--output-schema".into(),
        dir.join("schema.json").into(),
        "--output-last-message".into(),
        dir.join("out.txt").into(),
        "-".into(),
    ]
}

fn spawn_failed(what: &str, e: impl std::fmt::Display) -> CliError {
    CliError::new("spawn_failed", format!("{what}: {e}"))
}

/// A fresh, empty working directory, removed when dropped.
fn temp_dir() -> Result<tempfile::TempDir, CliError> {
    tempfile::Builder::new().prefix("dlh-ai-").tempdir().map_err(|e| spawn_failed("Couldn't create a temporary folder", e))
}

/// Runs one AI request. `system`, `prompt` and `schema` are never passed
/// through a shell; the prompt goes on stdin.
pub fn run_cli(
    provider: Provider,
    bin: &Path,
    system: &str,
    prompt: &str,
    schema: &str,
    limits: Limits,
    cancel: &AtomicBool,
) -> Result<CliOutput, CliError> {
    let dir = temp_dir()?;
    match provider {
        Provider::Claude => {
            let done = run_process(bin, &claude_args(system, schema), prompt.as_bytes().to_vec(), dir.path(), limits, cancel)?;
            Ok(CliOutput { stdout: String::from_utf8_lossy(&done.stdout).into_owned(), exit_code: done.exit_code })
        }
        Provider::Codex => {
            fs::write(dir.path().join("schema.json"), schema).map_err(|e| spawn_failed("Couldn't write the schema", e))?;
            let stdin = format!("{system}\n\n{prompt}").into_bytes();
            let done = run_process(bin, &codex_args(dir.path()), stdin, dir.path(), limits, cancel)?;
            let stdout = read_capped_file(&dir.path().join("out.txt"), limits.max_output)?;
            Ok(CliOutput { stdout, exit_code: done.exit_code })
        }
    }
    // `dir` is dropped here on every path, which removes it.
}

/// Codex's last message; missing means empty (the exit code tells the server why).
fn read_capped_file(path: &Path, max: usize) -> Result<String, CliError> {
    let Ok(file) = fs::File::open(path) else { return Ok(String::new()) };
    let mut buf = Vec::new();
    file.take(max as u64 + 1).read_to_end(&mut buf).map_err(|e| spawn_failed("Couldn't read the answer", e))?;
    if buf.len() > max {
        return Err(too_large(max));
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

fn too_large(max: usize) -> CliError {
    CliError::new("too_large", format!("The answer was larger than {max} bytes."))
}

/// `<bin> --version`, then the sign-in check (`claude auth status` /
/// `codex login status`). Never fails: anything unexpected reads as not ready.
pub fn status_of(provider: Provider, bin: &Path, limits: Limits) -> CliStatus {
    let never = AtomicBool::new(false);
    let run = |args: &[&str]| -> Option<Finished> {
        let dir = temp_dir().ok()?;
        let args: Vec<OsString> = args.iter().map(OsString::from).collect();
        run_process(bin, &args, Vec::new(), dir.path(), limits, &never).ok()
    };
    let version = match run(&["--version"]) {
        Some(f) if f.exit_code == 0 => String::from_utf8_lossy(&f.stdout).lines().map(str::trim).find(|l| !l.is_empty()).map(str::to_owned),
        _ => return CliStatus { installed: false, signed_in: false, version: None },
    };
    let signed_in = match provider {
        Provider::Claude => run(&["auth", "status"]).is_some_and(|f| f.exit_code == 0 && claude_logged_in(&f.stdout)),
        Provider::Codex => run(&["login", "status"]).is_some_and(|f| f.exit_code == 0),
    };
    CliStatus { installed: true, signed_in, version }
}

/// `claude auth status` prints `{"loggedIn": …}`; output that isn't JSON (a
/// future format) counts as signed in, since the exit code was 0.
fn claude_logged_in(stdout: &[u8]) -> bool {
    match serde_json::from_slice::<serde_json::Value>(stdout) {
        Ok(v) => v.get("loggedIn") == Some(&serde_json::Value::Bool(true)),
        Err(_) => true,
    }
}

struct Finished {
    stdout: Vec<u8>,
    exit_code: i32,
}

#[cfg(unix)]
extern "C" {
    fn killpg(pgrp: i32, sig: i32) -> i32;
}

/// Kills the child's whole process group (the CLI and anything it started),
/// then the child itself, and reaps it.
fn kill_all(child: &mut Child) {
    #[cfg(unix)]
    if let Ok(pgid) = i32::try_from(child.id()) {
        const SIGKILL: i32 = 9;
        // SAFETY: plain libc call with no memory arguments. The group id is the
        // child's pid (`process_group(0)`); it cannot be reused while any member
        // of the group, or the unreaped child, exists.
        unsafe {
            killpg(pgid, SIGKILL);
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Reads stdout until EOF; stops (returning `None`) once more than `max` bytes arrive.
fn read_capped(mut from: impl Read, max: usize) -> Option<Vec<u8>> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 16 * 1024];
    loop {
        match from.read(&mut chunk) {
            Ok(0) | Err(_) => return Some(buf),
            Ok(n) => {
                if buf.len() + n > max {
                    return None;
                }
                buf.extend_from_slice(&chunk[..n]);
            }
        }
    }
}

/// Spawns `bin args` in `cwd` (its own process group on Unix), writes `stdin` and
/// closes it, and waits for the exit and the end of stdout. The deadline, the
/// stdout cap and `cancel` are checked every `POLL` and kill the group. Stdin and
/// stderr are handled on their own threads so a full pipe can never block us.
fn run_process(
    bin: &Path,
    args: &[OsString],
    stdin: Vec<u8>,
    cwd: &Path,
    limits: Limits,
    cancel: &AtomicBool,
) -> Result<Finished, CliError> {
    let mut cmd = Command::new(bin);
    // The environment is inherited on purpose: the CLIs need PATH and HOME for their sign-in.
    cmd.args(args).current_dir(cwd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let mut child = cmd.spawn().map_err(|e| spawn_failed(&format!("Couldn't start {}", bin.display()), e))?;
    let deadline = Instant::now() + limits.timeout;

    let (Some(mut child_in), Some(child_out), Some(mut child_err)) = (child.stdin.take(), child.stdout.take(), child.stderr.take())
    else {
        kill_all(&mut child);
        return Err(CliError::new("spawn_failed", "The program's pipes weren't available."));
    };
    // Dropping `child_in` at the end of the thread closes stdin (EOF for the CLI).
    // A write error just means the CLI exited or closed stdin early.
    thread::spawn(move || {
        let _ = child_in.write_all(&stdin);
    });
    thread::spawn(move || {
        let _ = std::io::copy(&mut child_err, &mut std::io::sink());
    });
    let max = limits.max_output;
    let mut reader = Some(thread::spawn(move || read_capped(child_out, max)));

    let mut stdout = None;
    let mut status = None;
    loop {
        if cancel.load(Ordering::SeqCst) {
            kill_all(&mut child);
            return Err(CliError::new("cancelled", "The request was cancelled."));
        }
        if reader.as_ref().is_some_and(|r| r.is_finished()) {
            match reader.take().map(|r| r.join()) {
                Some(Ok(Some(buf))) => stdout = Some(buf),
                Some(Ok(None)) => {
                    kill_all(&mut child);
                    return Err(too_large(max));
                }
                _ => {
                    kill_all(&mut child);
                    return Err(CliError::new("spawn_failed", "Reading the program's output failed."));
                }
            }
        }
        if status.is_none() {
            match child.try_wait() {
                Ok(s) => status = s,
                Err(e) => {
                    kill_all(&mut child);
                    return Err(spawn_failed("Waiting for the program failed", e));
                }
            }
        }
        if let (Some(s), Some(out)) = (status, stdout.take()) {
            // Leftover background processes the CLI started don't outlive the run.
            kill_all(&mut child);
            // Killed by a signal has no code; report -1.
            return Ok(Finished { stdout: out, exit_code: s.code().unwrap_or(-1) });
        }
        if Instant::now() >= deadline {
            kill_all(&mut child);
            return Err(CliError::new(
                "timeout",
                format!("The program didn't finish within {} seconds.", limits.timeout.as_secs_f32()),
            ));
        }
        thread::sleep(POLL);
    }
}

/// Managed state: a cancel flag per in-flight run id.
#[derive(Default)]
pub struct CliState {
    runs: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

/// Registers a run id for `ai_cli_cancel`; unregisters it when dropped.
pub struct RunGuard {
    state: Arc<CliState>,
    run_id: String,
    cancel: Arc<AtomicBool>,
}

impl RunGuard {
    pub fn cancel_flag(&self) -> &AtomicBool {
        &self.cancel
    }
}

impl Drop for RunGuard {
    fn drop(&mut self) {
        if let Ok(mut runs) = self.state.runs.lock() {
            runs.remove(&self.run_id);
        }
    }
}

impl CliState {
    pub fn register(self: &Arc<Self>, run_id: &str) -> Result<RunGuard, CliError> {
        let mut runs = self.runs.lock().map_err(|e| spawn_failed("Run registry", e))?;
        if runs.contains_key(run_id) {
            return Err(CliError::new("spawn_failed", "A run with this id is already in progress."));
        }
        let cancel = Arc::new(AtomicBool::new(false));
        runs.insert(run_id.to_owned(), cancel.clone());
        Ok(RunGuard { state: self.clone(), run_id: run_id.to_owned(), cancel })
    }

    /// Kills the run with this id, if one is in flight; otherwise does nothing.
    pub fn cancel(&self, run_id: &str) {
        if let Ok(runs) = self.runs.lock() {
            if let Some(flag) = runs.get(run_id) {
                flag.store(true, Ordering::SeqCst);
            }
        }
    }
}

#[tauri::command]
pub async fn ai_cli_status(provider: String, path_override: Option<String>) -> Result<CliStatus, CliError> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = Provider::parse(&provider)?;
        match resolve_binary(&provider, path_override.as_deref()) {
            Ok(bin) => Ok(status_of(p, &bin, STATUS_LIMITS)),
            Err(e) if e.code == "not_installed" => Ok(CliStatus { installed: false, signed_in: false, version: None }),
            Err(e) => Err(e),
        }
    })
    .await
    .map_err(|e| spawn_failed("Status check", e))?
}

#[tauri::command]
pub async fn ai_cli_run(
    state: tauri::State<'_, Arc<CliState>>,
    run_id: String,
    provider: String,
    path_override: Option<String>,
    system: String,
    prompt: String,
    schema: String,
) -> Result<CliOutput, CliError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let guard = state.register(&run_id)?;
        let p = Provider::parse(&provider)?;
        let bin = resolve_binary(&provider, path_override.as_deref())?;
        run_cli(p, &bin, &system, &prompt, &schema, RUN_LIMITS, guard.cancel_flag())
    })
    .await
    .map_err(|e| spawn_failed("Run", e))?
}

#[tauri::command]
pub fn ai_cli_cancel(state: tauri::State<'_, Arc<CliState>>, run_id: String) {
    state.cancel(&run_id);
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::atomic::Ordering;
    use std::thread;
    use std::time::Instant;

    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }

    fn alive(pid: i32) -> bool {
        // SAFETY: signal 0 only checks that the process exists.
        unsafe { kill(pid, 0) == 0 }
    }

    const FAST: Limits = Limits { timeout: Duration::from_secs(10), max_output: MAX_OUTPUT };
    const SHORT: Limits = Limits { timeout: Duration::from_millis(200), max_output: MAX_OUTPUT };

    /// Writes an executable stand-in for the CLI as `<dir>/<name>` and runs it once.
    /// The warm-up matters on macOS: the first exec of a new file can wait on a
    /// security scan for over a second when many run at once, which would eat the
    /// short timeouts below before the script's first line.
    fn stand_in(dir: &Path, name: &str, body: &str) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, format!("#!/bin/sh\n[ \"$1\" = __warmup ] && exit 0\n{body}\n")).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        let _ = std::process::Command::new(&path).arg("__warmup").status();
        path
    }

    fn run(bin: &Path, provider: Provider, system: &str, prompt: &str, limits: Limits) -> Result<CliOutput, CliError> {
        run_cli(provider, bin, system, prompt, "{\"type\":\"object\"}", limits, &AtomicBool::new(false))
    }

    fn read_pid(file: &Path) -> i32 {
        let until = Instant::now() + Duration::from_secs(5);
        loop {
            if let Ok(s) = fs::read_to_string(file) {
                if let Ok(p) = s.trim().parse() {
                    return p;
                }
            }
            assert!(Instant::now() < until, "pid file never written");
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn assert_dies(pid: i32) {
        let until = Instant::now() + Duration::from_secs(3);
        while alive(pid) {
            assert!(Instant::now() < until, "process {pid} outlived the run");
            thread::sleep(Duration::from_millis(20));
        }
    }

    // --- resolve_binary ---

    #[test]
    fn resolve_refuses_other_programs() {
        assert_eq!(resolve_binary("bash", None).unwrap_err().code, "spawn_failed");
        assert!(resolve_binary("bash", Some("/bin/bash")).is_err());
        assert!(resolve_binary("", None).is_err());
    }

    #[test]
    fn resolve_refuses_relative_overrides() {
        for p in ["claude", "./claude", "bin/claude", "~/claude"] {
            assert_eq!(resolve_binary("claude", Some(p)).unwrap_err().code, "not_installed", "{p}");
        }
    }

    #[test]
    fn resolve_refuses_spoofed_names_and_parent_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let evil = stand_in(dir.path(), "claude-evil", "exit 0");
        stand_in(dir.path(), "claude", "exit 0");
        let sub = dir.path().join("sub");
        fs::create_dir(&sub).unwrap();
        let dotdot = format!("{}/../claude", sub.display());
        for p in ["/tmp/claude-evil", evil.to_str().unwrap(), dotdot.as_str(), "/bin/sh"] {
            assert_eq!(resolve_binary("claude", Some(p)).unwrap_err().code, "not_installed", "{p}");
        }
        // The codex name is not accepted for the claude provider and vice versa.
        let codex = stand_in(dir.path(), "codex", "exit 0");
        assert!(resolve_binary("claude", Some(codex.to_str().unwrap())).is_err());
    }

    #[test]
    fn resolve_refuses_a_missing_file_or_a_directory() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("claude")).unwrap();
        let as_dir = dir.path().join("claude");
        assert_eq!(resolve_binary("claude", Some(as_dir.to_str().unwrap())).unwrap_err().code, "not_installed");
        assert_eq!(resolve_binary("codex", Some("/nonexistent/codex")).unwrap_err().code, "not_installed");
    }

    #[test]
    fn resolve_accepts_an_absolute_override_named_like_the_cli() {
        let dir = tempfile::tempdir().unwrap();
        let claude = stand_in(dir.path(), "claude", "exit 0");
        assert_eq!(resolve_binary("claude", Some(claude.to_str().unwrap())).unwrap(), claude);
        let codex = stand_in(dir.path(), "codex", "exit 0");
        assert_eq!(resolve_binary("codex", Some(codex.to_str().unwrap())).unwrap(), codex);
    }

    // --- arguments and stdin ---

    const ECHO_ARGS: &str = r#"for a in "$@"; do printf '[%s]\n' "$a"; done; printf 'STDIN:'; cat"#;

    #[test]
    fn claude_gets_the_fixed_arguments_and_the_prompt_on_stdin() {
        let dir = tempfile::tempdir().unwrap();
        let bin = stand_in(dir.path(), "claude", ECHO_ARGS);
        // Shell metacharacters must arrive verbatim: nothing goes through a shell.
        let system = "be brief; echo $HOME `id`";
        let prompt = "hello $(touch /tmp/dlh-pwned) prompt";
        let out = run(&bin, Provider::Claude, system, prompt, FAST).unwrap();
        assert_eq!(out.exit_code, 0);
        assert_eq!(
            out.stdout,
            "[-p]\n[--output-format]\n[json]\n[--json-schema]\n[{\"type\":\"object\"}]\n\
             [--system-prompt]\n[be brief; echo $HOME `id`]\n[--tools]\n[]\n[--strict-mcp-config]\n\
             [--no-session-persistence]\n[--disable-slash-commands]\n\
             STDIN:hello $(touch /tmp/dlh-pwned) prompt"
        );
        let args = claude_args(system, "{}");
        assert!(!args.iter().any(|a| a.to_string_lossy().contains("hello")));
    }

    #[test]
    fn codex_gets_the_fixed_arguments_and_returns_the_last_message_file() {
        let dir = tempfile::tempdir().unwrap();
        let record = dir.path().join("args.txt");
        let schema_copy = dir.path().join("schema-copy.json");
        let body = format!(
            r#"prev=""; out=""; schema=""
for a in "$@"; do
  printf '[%s]\n' "$a" >> '{rec}'
  [ "$prev" = "--output-last-message" ] && out="$a"
  [ "$prev" = "--output-schema" ] && schema="$a"
  prev="$a"
done
cp "$schema" '{copy}'
cat > "$out"
echo "progress noise on stdout""#,
            rec = record.display(),
            copy = schema_copy.display()
        );
        let bin = stand_in(dir.path(), "codex", &body);
        let out = run(&bin, Provider::Codex, "SYS", "PROMPT", FAST).unwrap();
        assert_eq!(out, CliOutput { stdout: "SYS\n\nPROMPT".into(), exit_code: 0 });
        assert_eq!(fs::read_to_string(&schema_copy).unwrap(), "{\"type\":\"object\"}");
        let args: Vec<String> = fs::read_to_string(&record).unwrap().lines().map(|l| l.to_string()).collect();
        assert_eq!(args.len(), 9, "{args:?}");
        assert_eq!(args[..5], ["[exec]", "[--sandbox]", "[read-only]", "[--skip-git-repo-check]", "[--output-schema]"]);
        assert!(args[5].starts_with("[/") && args[5].ends_with("/schema.json]"));
        assert_eq!(args[6], "[--output-last-message]");
        assert!(args[7].starts_with("[/") && args[7].ends_with("/out.txt]"));
        assert_eq!(args[8], "[-]");
    }

    #[test]
    fn a_non_zero_exit_is_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let bin = stand_in(dir.path(), "claude", "cat > /dev/null; echo partial; exit 3");
        let out = run(&bin, Provider::Claude, "s", "p", FAST).unwrap();
        assert_eq!(out, CliOutput { stdout: "partial\n".into(), exit_code: 3 });
    }

    #[test]
    fn a_program_that_cannot_start_is_spawn_failed() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("claude");
        fs::write(&bin, "not executable").unwrap();
        assert_eq!(run(&bin, Provider::Claude, "s", "p", FAST).unwrap_err().code, "spawn_failed");
    }

    // --- limits ---

    #[test]
    fn timeout_kills_the_process() {
        let dir = tempfile::tempdir().unwrap();
        let (pid_file, child_file) = (dir.path().join("pid"), dir.path().join("child"));
        let body = format!(
            "echo $$ > '{}'; sleep 30 & echo $! > '{}'; wait",
            pid_file.display(),
            child_file.display()
        );
        let bin = stand_in(dir.path(), "claude", &body);
        let began = Instant::now();
        let err = run(&bin, Provider::Claude, "s", "p", SHORT).unwrap_err();
        assert_eq!(err.code, "timeout");
        assert!(began.elapsed() < Duration::from_secs(3), "took {:?}", began.elapsed());
        // The CLI and anything it started are gone.
        assert_dies(read_pid(&pid_file));
        assert_dies(read_pid(&child_file));
    }

    #[test]
    fn a_prompt_the_cli_never_reads_does_not_block_the_timeout() {
        let dir = tempfile::tempdir().unwrap();
        let bin = stand_in(dir.path(), "claude", "sleep 30");
        let prompt = "x".repeat(4 * 1024 * 1024);
        let began = Instant::now();
        assert_eq!(run(&bin, Provider::Claude, "s", &prompt, SHORT).unwrap_err().code, "timeout");
        assert!(began.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn output_over_the_cap_kills_the_process() {
        let dir = tempfile::tempdir().unwrap();
        let pid_file = dir.path().join("pid");
        let body = format!("echo $$ > '{}'; head -c 4096 /dev/zero; sleep 30", pid_file.display());
        let bin = stand_in(dir.path(), "claude", &body);
        let began = Instant::now();
        let limits = Limits { timeout: Duration::from_secs(20), max_output: 1024 };
        assert_eq!(run(&bin, Provider::Claude, "s", "p", limits).unwrap_err().code, "too_large");
        assert!(began.elapsed() < Duration::from_secs(5));
        assert_dies(read_pid(&pid_file));
    }

    #[test]
    fn output_over_1_mb_kills_the_process_and_exactly_1_mb_is_fine() {
        let dir = tempfile::tempdir().unwrap();
        let over = stand_in(dir.path(), "claude", "head -c 1048577 /dev/zero; sleep 30");
        let limits = Limits { timeout: Duration::from_secs(20), max_output: MAX_OUTPUT };
        let began = Instant::now();
        assert_eq!(run(&over, Provider::Claude, "s", "p", limits).unwrap_err().code, "too_large");
        assert!(began.elapsed() < Duration::from_secs(5));

        let dir2 = tempfile::tempdir().unwrap();
        let exact = stand_in(dir2.path(), "claude", "head -c 1048576 /dev/zero");
        assert_eq!(run(&exact, Provider::Claude, "s", "p", limits).unwrap().stdout.len(), MAX_OUTPUT);
    }

    #[test]
    fn codex_last_message_over_the_cap_is_too_large() {
        let dir = tempfile::tempdir().unwrap();
        let body = r#"prev=""; for a in "$@"; do [ "$prev" = "--output-last-message" ] && out="$a"; prev="$a"; done
head -c 2048 /dev/zero > "$out""#;
        let bin = stand_in(dir.path(), "codex", body);
        let limits = Limits { timeout: Duration::from_secs(10), max_output: 1024 };
        assert_eq!(run(&bin, Provider::Codex, "s", "p", limits).unwrap_err().code, "too_large");
    }

    // --- temp dir ---

    #[test]
    fn the_run_happens_in_a_fresh_temp_dir_that_is_removed_afterwards() {
        let dir = tempfile::tempdir().unwrap();
        let bin = stand_in(dir.path(), "claude", "cat > /dev/null; pwd; ls -A");
        let out = run(&bin, Provider::Claude, "s", "p", FAST).unwrap();
        let cwd = out.stdout.lines().next().unwrap().to_string();
        assert_eq!(out.stdout.lines().count(), 1, "temp dir was not empty: {}", out.stdout);
        assert!(cwd.contains("dlh-ai-"), "{cwd}");
        assert!(!Path::new(&cwd).exists(), "{cwd} still exists");
    }

    #[test]
    fn the_temp_dir_is_removed_after_a_timeout() {
        let dir = tempfile::tempdir().unwrap();
        let cwd_file = dir.path().join("cwd");
        let bin = stand_in(dir.path(), "claude", &format!("pwd > '{}'; sleep 30", cwd_file.display()));
        assert_eq!(run(&bin, Provider::Claude, "s", "p", SHORT).unwrap_err().code, "timeout");
        let cwd = fs::read_to_string(&cwd_file).unwrap();
        assert!(!Path::new(cwd.trim()).exists(), "{cwd} still exists");
    }

    // --- cancel ---

    #[test]
    fn cancel_kills_the_run() {
        let state = Arc::new(CliState::default());
        let dir = tempfile::tempdir().unwrap();
        let pid_file = dir.path().join("pid");
        let bin = stand_in(dir.path(), "claude", &format!("echo $$ > '{}'; sleep 30", pid_file.display()));
        let guard = state.register("run-1").unwrap();
        let worker = thread::spawn(move || {
            let limits = Limits { timeout: Duration::from_secs(20), max_output: MAX_OUTPUT };
            run_cli(Provider::Claude, &bin, "s", "p", "{}", limits, guard.cancel_flag())
        });
        let pid = read_pid(&pid_file);
        let began = Instant::now();
        state.cancel("run-1");
        assert_eq!(worker.join().unwrap().unwrap_err().code, "cancelled");
        assert!(began.elapsed() < Duration::from_secs(3));
        assert_dies(pid);
        // The guard dropped with the worker, so the id is free again.
        assert!(state.register("run-1").is_ok());
    }

    #[test]
    fn cancel_of_an_unknown_run_is_a_no_op_and_ids_are_unique() {
        let state = Arc::new(CliState::default());
        state.cancel("nope");
        let g = state.register("a").unwrap();
        assert_eq!(state.register("a").err().unwrap().code, "spawn_failed");
        assert!(!g.cancel_flag().load(Ordering::SeqCst));
        state.cancel("a");
        assert!(g.cancel_flag().load(Ordering::SeqCst));
    }

    // --- status ---

    #[test]
    fn status_reports_version_and_sign_in() {
        let dir = tempfile::tempdir().unwrap();
        let bin = stand_in(
            dir.path(),
            "claude",
            r#"case "$1" in --version) echo "2.1.295 (Claude Code)";; auth) [ "$2" = status ] && echo '{"loggedIn": true}';; *) exit 9;; esac"#,
        );
        assert_eq!(
            status_of(Provider::Claude, &bin, FAST),
            CliStatus { installed: true, signed_in: true, version: Some("2.1.295 (Claude Code)".into()) }
        );
    }

    #[test]
    fn claude_signed_out_is_detected_from_exit_code_and_json() {
        let dir = tempfile::tempdir().unwrap();
        let exit1 = stand_in(dir.path(), "claude", r#"[ "$1" = --version ] && echo 2.1.0 && exit 0; echo '{"loggedIn": false}'; exit 1"#);
        assert!(!status_of(Provider::Claude, &exit1, FAST).signed_in);
        let dir2 = tempfile::tempdir().unwrap();
        let exit0 = stand_in(dir2.path(), "claude", r#"[ "$1" = --version ] && echo 2.1.0 && exit 0; echo '{"loggedIn": false}'"#);
        assert!(!status_of(Provider::Claude, &exit0, FAST).signed_in);
        let dir3 = tempfile::tempdir().unwrap();
        let text = stand_in(dir3.path(), "claude", r#"[ "$1" = --version ] && echo 2.1.0 && exit 0; echo 'Logged in'"#);
        assert!(status_of(Provider::Claude, &text, FAST).signed_in);
    }

    #[test]
    fn codex_status_uses_login_status_exit_code() {
        let dir = tempfile::tempdir().unwrap();
        let ok = stand_in(dir.path(), "codex", r#"[ "$1" = --version ] && echo "codex-cli 0.50.0" && exit 0; [ "$1 $2" = "login status" ] && exit 0; exit 1"#);
        assert_eq!(
            status_of(Provider::Codex, &ok, FAST),
            CliStatus { installed: true, signed_in: true, version: Some("codex-cli 0.50.0".into()) }
        );
        let dir2 = tempfile::tempdir().unwrap();
        let out = stand_in(dir2.path(), "codex", r#"[ "$1" = --version ] && echo "codex-cli 0.50.0" && exit 0; exit 1"#);
        assert!(!status_of(Provider::Codex, &out, FAST).signed_in);
    }

    #[test]
    fn a_broken_binary_is_not_installed() {
        let dir = tempfile::tempdir().unwrap();
        let bin = stand_in(dir.path(), "claude", "exit 1");
        assert_eq!(status_of(Provider::Claude, &bin, FAST), CliStatus { installed: false, signed_in: false, version: None });
    }

    #[test]
    fn errors_serialize_as_code_and_message() {
        let e = CliError { code: "timeout", message: "m".into() };
        assert_eq!(serde_json::to_string(&e).unwrap(), r#"{"code":"timeout","message":"m"}"#);
    }
}
