use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;

use tauri::{Manager, State};

struct Host {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
}

fn exchange(host: State<'_, Mutex<Host>>, line: &str) -> Result<String, String> {
    let mut host = host.lock().map_err(|err| err.to_string())?;
    writeln!(host.stdin, "{line}").map_err(|err| err.to_string())?;
    host.stdin.flush().map_err(|err| err.to_string())?;
    let mut response = String::new();
    host.stdout.read_line(&mut response).map_err(|err| err.to_string())?;
    let parsed: serde_json::Value = serde_json::from_str(&response).map_err(|err| err.to_string())?;
    parsed
        .get("html")
        .and_then(|value| value.as_str())
        .map(ToString::to_string)
        .ok_or_else(|| "window host returned no page".to_string())
}

#[tauri::command]
fn render(host: State<'_, Mutex<Host>>) -> Result<String, String> {
    exchange(host, r#"{"cmd":"render"}"#)
}

#[tauri::command]
fn submit(host: State<'_, Mutex<Host>>, body: String) -> Result<String, String> {
    exchange(host, &serde_json::json!({ "cmd": "submit", "body": body }).to_string())
}

fn spawn_host() -> Host {
    let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let mut child = Command::new("node")
        .arg("--no-warnings")
        .arg("src/main.ts")
        .current_dir(directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("node window host");
    let stdin = child.stdin.take().expect("host stdin");
    let stdout = child.stdout.take().expect("host stdout");
    Host {
        child,
        stdin,
        stdout: BufReader::new(stdout),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let host = Mutex::new(spawn_host());
    tauri::Builder::default()
        .manage(host)
        .invoke_handler(tauri::generate_handler![render, submit])
        .build(tauri::generate_context!())
        .expect("error while building sharlie")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(host) = app.try_state::<Mutex<Host>>() {
                    if let Ok(mut host) = host.lock() {
                        let _ = host.child.kill();
                    }
                }
            }
        });
}
