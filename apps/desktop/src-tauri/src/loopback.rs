//! One-time loopback listener that receives the OAuth redirect.
//!
//! Never logs the request line, code or state: they are credentials.

use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use url::Url;

const WAIT_SECS: u64 = 300;
const POLL: Duration = Duration::from_millis(50);

#[derive(Debug, PartialEq, Eq)]
#[allow(clippy::enum_variant_names)] // variant names are fixed by the task interface
pub enum Callback {
    Code(String),
    Error(&'static str),
    NotCallback,
}

/// Interprets the HTTP request line of a loopback request.
pub fn parse_callback(request_line: &str, expected_state: &str) -> Callback {
    let mut parts = request_line.split_whitespace();
    let (Some(method), Some(target)) = (parts.next(), parts.next()) else {
        return Callback::Error("bad_request");
    };
    let Ok(url) = Url::parse(&format!("http://127.0.0.1{target}")) else {
        return Callback::Error("bad_request");
    };
    if url.path() != "/callback" {
        return Callback::NotCallback;
    }
    if method != "GET" {
        return Callback::Error("bad_request");
    }
    let (mut code, mut state, mut error) = (None, None, None);
    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "code" => code = Some(v.into_owned()),
            "state" => state = Some(v.into_owned()),
            "error" => error = Some(v.into_owned()),
            _ => {}
        }
    }
    if state.as_deref() != Some(expected_state) {
        return Callback::Error("state_mismatch");
    }
    if let Some(e) = error {
        return Callback::Error(if e == "access_denied" { "denied" } else { "bad_request" });
    }
    match code {
        Some(c) if !c.is_empty() => Callback::Code(c),
        _ => Callback::Error("bad_request"),
    }
}

/// Binds the one-time listener on the IPv4 loopback address only.
pub fn bind() -> std::io::Result<TcpListener> {
    TcpListener::bind("127.0.0.1:0")
}

fn page(ok: bool) -> String {
    let msg = if ok {
        "Signed in. You can close this tab and go back to Digital Life Hub."
    } else {
        "Sign-in didn't finish. Go back to Digital Life Hub to try again."
    };
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Digital Life Hub</title></head>\
         <body style=\"font-family:system-ui,sans-serif;text-align:center;margin-top:20vh\"><p>{msg}</p></body></html>"
    )
}

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let resp = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}

fn read_request_line(stream: &mut TcpStream) -> Option<String> {
    stream.set_nonblocking(false).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
    let mut buf = Vec::new();
    let mut chunk = [0u8; 512];
    while buf.len() < 8192 && !buf.windows(2).any(|w| w == b"\r\n") && !buf.contains(&b'\n') {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
            Err(_) => break,
        }
    }
    let text = String::from_utf8_lossy(&buf);
    text.lines().next().map(str::to_owned)
}

/// Accepts connections until a callback arrives, `deadline` passes (`"timeout"`)
/// or `cancelled()` turns true (`"cancelled"`). Non-callback requests get a 404.
pub fn wait_for_code(
    listener: TcpListener,
    expected_state: &str,
    deadline: Instant,
    cancelled: &dyn Fn() -> bool,
) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|_| "bad_request".to_string())?;
    loop {
        if cancelled() {
            return Err("cancelled".into());
        }
        if Instant::now() >= deadline {
            return Err("timeout".into());
        }
        let mut stream = match listener.accept() {
            Ok((s, _)) => s,
            Err(e) if e.kind() == ErrorKind::WouldBlock || e.kind() == ErrorKind::Interrupted => {
                thread::sleep(POLL);
                continue;
            }
            Err(_) => {
                thread::sleep(POLL);
                continue;
            }
        };
        let Some(line) = read_request_line(&mut stream) else {
            continue;
        };
        match parse_callback(&line, expected_state) {
            Callback::NotCallback => respond(&mut stream, "404 Not Found", &page(false)),
            Callback::Code(code) => {
                respond(&mut stream, "200 OK", &page(true));
                return Ok(code);
            }
            Callback::Error(e) => {
                respond(&mut stream, "400 Bad Request", &page(false));
                return Err(e.into());
            }
        }
    }
}

/// Managed state: the pending listener and a generation counter. Each
/// `auth_loopback_start` bumps the generation, which cancels any wait that
/// holds an older one.
#[derive(Default)]
pub struct LoopbackState {
    listener: Mutex<Option<TcpListener>>,
    generation: AtomicU64,
}

impl LoopbackState {
    pub fn start(&self) -> Result<u16, String> {
        let listener = bind().map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let mut slot = self.listener.lock().map_err(|e| e.to_string())?;
        self.generation.fetch_add(1, Ordering::SeqCst);
        *slot = Some(listener);
        Ok(port)
    }

    /// Takes the pending listener with its generation. `None` if there is none.
    fn take(&self) -> Option<(TcpListener, u64)> {
        let mut slot = self.listener.lock().ok()?;
        let l = slot.take()?;
        Some((l, self.generation.load(Ordering::SeqCst)))
    }

    pub fn wait(&self, expected_state: &str, timeout: Duration) -> Result<String, String> {
        let (listener, generation) = self.take().ok_or_else(|| "cancelled".to_string())?;
        let deadline = Instant::now() + timeout;
        wait_for_code(listener, expected_state, deadline, &|| {
            self.generation.load(Ordering::SeqCst) != generation
        })
    }
}

#[tauri::command]
pub fn auth_loopback_start(state: tauri::State<'_, std::sync::Arc<LoopbackState>>) -> Result<u16, String> {
    state.start()
}

#[tauri::command]
pub async fn auth_loopback_wait(
    state: tauri::State<'_, std::sync::Arc<LoopbackState>>,
    expected_state: String,
) -> Result<String, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state.wait(&expected_state, Duration::from_secs(WAIT_SECS))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn code_with_matching_state() {
        assert_eq!(parse_callback("GET /callback?code=abc&state=s1 HTTP/1.1", "s1"), Callback::Code("abc".into()));
    }
    #[test]
    fn percent_encoded_code_is_decoded() {
        assert_eq!(parse_callback("GET /callback?code=4%2F0Ab&state=s1 HTTP/1.1", "s1"), Callback::Code("4/0Ab".into()));
    }
    #[test]
    fn state_mismatch() {
        assert_eq!(parse_callback("GET /callback?code=abc&state=zz HTTP/1.1", "s1"), Callback::Error("state_mismatch"));
    }
    #[test]
    fn user_denied() {
        assert_eq!(parse_callback("GET /callback?error=access_denied&state=s1 HTTP/1.1", "s1"), Callback::Error("denied"));
    }
    #[test]
    fn favicon_is_ignored() {
        assert_eq!(parse_callback("GET /favicon.ico HTTP/1.1", "s1"), Callback::NotCallback);
    }
    #[test]
    fn garbage_is_bad_request() {
        assert_eq!(parse_callback("POST /callback HTTP/1.1", "s1"), Callback::Error("bad_request"));
        assert_eq!(parse_callback("", "s1"), Callback::Error("bad_request"));
    }

    fn send(port: u16, line: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.write_all(format!("{line}\r\nHost: x\r\n\r\n").as_bytes()).unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out);
        out
    }

    #[test]
    fn listener_round_trip() {
        let listener = bind().unwrap();
        assert!(listener.local_addr().unwrap().ip().is_loopback());
        let port = listener.local_addr().unwrap().port();
        let client = thread::spawn(move || {
            let fav = send(port, "GET /favicon.ico HTTP/1.1");
            let ok = send(port, "GET /callback?code=c&state=s HTTP/1.1");
            (fav, ok)
        });
        let got = wait_for_code(listener, "s", Instant::now() + Duration::from_secs(10), &|| false);
        assert_eq!(got, Ok("c".to_string()));
        let (fav, ok) = client.join().unwrap();
        assert!(fav.starts_with("HTTP/1.1 404"));
        assert!(ok.starts_with("HTTP/1.1 200") && ok.contains("<title>Digital Life Hub</title>"));
    }

    #[test]
    fn times_out() {
        let listener = bind().unwrap();
        let got = wait_for_code(listener, "s", Instant::now() + Duration::from_millis(150), &|| false);
        assert_eq!(got, Err("timeout".to_string()));
    }

    #[test]
    fn second_start_cancels_inflight_wait() {
        let state = Arc::new(LoopbackState::default());
        state.start().unwrap();
        let s2 = state.clone();
        let waiter = thread::spawn(move || s2.wait("s", Duration::from_secs(60)));
        thread::sleep(Duration::from_millis(200));
        let began = Instant::now();
        state.start().unwrap();
        assert_eq!(waiter.join().unwrap(), Err("cancelled".to_string()));
        assert!(began.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn wait_without_start_is_cancelled() {
        let state = LoopbackState::default();
        assert_eq!(state.wait("s", Duration::from_secs(1)), Err("cancelled".to_string()));
    }
}
