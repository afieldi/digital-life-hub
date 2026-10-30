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

enum Request {
    Line(String),
    /// No complete request line arrived (idle preconnect, early close, timeout).
    Incomplete,
    /// The request line did not end within the size cap.
    TooLong,
}

const MAX_REQUEST: usize = 8192;
const READ_BUDGET: Duration = Duration::from_secs(2);

/// Reads up to the end of the headers (`\r\n\r\n`) so closing the socket never
/// discards unread bytes (which would RST and drop our response). Bounded by
/// `MAX_REQUEST` and a total deadline of `READ_BUDGET`, never past `overall`.
fn read_request(stream: &mut TcpStream, overall: Instant) -> Request {
    if stream.set_nonblocking(false).is_err() {
        return Request::Incomplete;
    }
    let limit = (Instant::now() + READ_BUDGET).min(overall);
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 1024];
    while buf.len() < MAX_REQUEST && !buf.windows(4).any(|w| w == b"\r\n\r\n") {
        let left = limit.saturating_duration_since(Instant::now());
        if left.is_zero() || stream.set_read_timeout(Some(left)).is_err() {
            break;
        }
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
    }
    match buf.iter().position(|&b| b == b'\n') {
        Some(i) => Request::Line(String::from_utf8_lossy(&buf[..i]).trim_end_matches('\r').to_owned()),
        None if buf.len() >= MAX_REQUEST => Request::TooLong,
        None => Request::Incomplete,
    }
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
        let line = match read_request(&mut stream, deadline) {
            Request::Line(l) => l,
            Request::Incomplete => continue,
            Request::TooLong => {
                respond(&mut stream, "400 Bad Request", &page(false));
                return Err("bad_request".into());
            }
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
    /// The pending listener and the generation it was created in.
    listener: Mutex<Option<(TcpListener, u64)>>,
    generation: AtomicU64,
}

/// Returned by `auth_loopback_start`; `attempt` must be passed back to `auth_loopback_wait`.
#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopbackStart {
    pub port: u16,
    pub attempt: u64,
}

impl LoopbackState {
    pub fn start(&self) -> Result<LoopbackStart, String> {
        let listener = bind().map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let mut slot = self.listener.lock().map_err(|e| e.to_string())?;
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        *slot = Some((listener, generation));
        Ok(LoopbackStart { port, attempt: generation })
    }

    #[cfg(test)]
    fn has_pending(&self) -> bool {
        self.listener.lock().unwrap().is_some()
    }

    /// Takes the pending listener only if it belongs to `attempt`.
    fn take(&self, attempt: u64) -> Option<TcpListener> {
        let mut slot = self.listener.lock().ok()?;
        match slot.as_ref() {
            Some((_, g)) if *g == attempt => slot.take().map(|(l, _)| l),
            _ => None,
        }
    }

    pub fn wait(&self, attempt: u64, expected_state: &str, timeout: Duration) -> Result<String, String> {
        let listener = self.take(attempt).ok_or_else(|| "cancelled".to_string())?;
        let deadline = Instant::now() + timeout;
        wait_for_code(listener, expected_state, deadline, &|| {
            self.generation.load(Ordering::SeqCst) != attempt
        })
    }
}

#[tauri::command]
pub fn auth_loopback_start(state: tauri::State<'_, std::sync::Arc<LoopbackState>>) -> Result<LoopbackStart, String> {
    state.start()
}

#[tauri::command]
pub async fn auth_loopback_wait(
    state: tauri::State<'_, std::sync::Arc<LoopbackState>>,
    attempt: u64,
    expected_state: String,
) -> Result<String, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state.wait(attempt, &expected_state, Duration::from_secs(WAIT_SECS))
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
        let a1 = state.start().unwrap().attempt;
        let s2 = state.clone();
        let waiter = thread::spawn(move || s2.wait(a1, "s", Duration::from_secs(60)));
        // Deterministic: the slot is empty once the waiter has taken its listener.
        let spin_until = Instant::now() + Duration::from_secs(10);
        while state.has_pending() {
            assert!(Instant::now() < spin_until, "waiter never took its listener");
            thread::yield_now();
        }
        let began = Instant::now();
        state.start().unwrap();
        assert_eq!(waiter.join().unwrap(), Err("cancelled".to_string()));
        assert!(began.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn large_headers_still_get_the_full_response() {
        // Unread request bytes at close make the OS send RST, which can drop the
        // response; repeat to make that visible.
        for _ in 0..20 {
            let listener = bind().unwrap();
            let port = listener.local_addr().unwrap().port();
            let client = thread::spawn(move || {
                let padding = "x".repeat(1900);
                let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
                s.write_all(format!("GET /callback?code=c&state=s HTTP/1.1\r\nCookie: {padding}\r\n\r\n").as_bytes()).unwrap();
                // A slow reader: any RST from the server lands before we read.
                thread::sleep(Duration::from_millis(100));
                let mut out = String::new();
                let _ = s.read_to_string(&mut out);
                out
            });
            let got = wait_for_code(listener, "s", Instant::now() + Duration::from_secs(10), &|| false);
            assert_eq!(got, Ok("c".to_string()));
            let resp = client.join().unwrap();
            assert!(resp.starts_with("HTTP/1.1 200"), "got: {resp:?}");
            assert!(resp.contains("Signed in."));
        }
    }

    #[test]
    fn unterminated_oversized_line_is_bad_request() {
        let listener = bind().unwrap();
        let port = listener.local_addr().unwrap().port();
        let client = thread::spawn(move || {
            let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
            let _ = s.write_all("A".repeat(9000).as_bytes());
            let mut out = String::new();
            let _ = s.read_to_string(&mut out);
        });
        let got = wait_for_code(listener, "s", Instant::now() + Duration::from_secs(10), &|| false);
        assert_eq!(got, Err("bad_request".to_string()));
        client.join().unwrap();
    }

    #[test]
    fn silent_connection_is_ignored() {
        let listener = bind().unwrap();
        let port = listener.local_addr().unwrap().port();
        let _idle = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let client = thread::spawn(move || send(port, "GET /callback?code=c&state=s HTTP/1.1"));
        let got = wait_for_code(listener, "s", Instant::now() + Duration::from_secs(10), &|| false);
        assert_eq!(got, Ok("c".to_string()));
        client.join().unwrap();
    }

    #[test]
    fn two_starts_leave_the_second_listener_waitable() {
        let state = Arc::new(LoopbackState::default());
        let p1 = state.start().unwrap().port;
        let LoopbackStart { port: p2, attempt: a2 } = state.start().unwrap();
        assert!(TcpStream::connect(("127.0.0.1", p1)).is_err());
        let client = thread::spawn(move || send(p2, "GET /callback?code=c&state=s HTTP/1.1"));
        assert_eq!(state.wait(a2, "s", Duration::from_secs(10)), Ok("c".to_string()));
        client.join().unwrap();
    }

    #[test]
    fn stale_attempt_wait_is_cancelled_and_newest_still_works() {
        let state = LoopbackState::default();
        let a1 = state.start().unwrap().attempt;
        let LoopbackStart { port: p2, attempt: a2 } = state.start().unwrap();
        // Stale wait: cancelled at once (short timeout so a bug fails, not hangs).
        let began = Instant::now();
        assert_eq!(state.wait(a1, "s1", Duration::from_millis(300)), Err("cancelled".to_string()));
        assert!(began.elapsed() < Duration::from_millis(200));
        let client = thread::spawn(move || send(p2, "GET /callback?code=c2&state=s2 HTTP/1.1"));
        assert_eq!(state.wait(a2, "s2", Duration::from_secs(10)), Ok("c2".to_string()));
        client.join().unwrap();
    }

    #[test]
    fn wait_without_start_is_cancelled() {
        let state = LoopbackState::default();
        assert_eq!(state.wait(1, "s", Duration::from_secs(1)), Err("cancelled".to_string()));
    }
}
