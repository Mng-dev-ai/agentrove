use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use libc;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSWindow, NSWindowButton};
use rand::Rng;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

#[tauri::command]
fn get_backend_port(state: tauri::State<'_, Arc<OnceLock<Result<u16, String>>>>) -> Result<u16, String> {
    loop {
        if let Some(result) = state.get() {
            return result.clone();
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn data_dir() -> std::path::PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("com.agentrove.app")
}

fn ensure_secret_key(data_dir: &std::path::Path) -> String {
    fs::create_dir_all(data_dir).ok();
    let key_path = data_dir.join(".secret_key");
    if let Ok(key) = fs::read_to_string(&key_path) {
        let key = key.trim().to_string();
        if key.len() >= 32 {
            return key;
        }
    }
    let mut rng = rand::rng();
    let key: String = (0..32)
        .map(|_| format!("{:02x}", rng.random_range(0u8..=255)))
        .collect();
    fs::write(&key_path, &key).ok();
    key
}

fn resolve_backend_binary(app_handle: &tauri::AppHandle) -> std::path::PathBuf {
    #[cfg(debug_assertions)]
    {
        let dev_binary = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("backend-sidecar")
            .join("agentrove-backend");
        if dev_binary.exists() {
            return dev_binary;
        }
    }

    let resource_dir = app_handle
        .path()
        .resource_dir()
        .expect("failed to resolve resource dir");

    let binary = resource_dir
        .join("_up_")
        .join("backend-sidecar")
        .join("agentrove-backend");
    if binary.exists() {
        return binary;
    }

    let direct = resource_dir.join("backend-sidecar").join("agentrove-backend");
    if direct.exists() {
        return direct;
    }

    panic!(
        "Backend binary not found at {:?} or {:?}",
        binary, direct
    );
}

fn pick_available_port() -> u16 {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("failed to bind ephemeral port");
    listener.local_addr().unwrap().port()
}

fn backend_ready(port: u16) -> bool {
    let mut stream = match TcpStream::connect(("127.0.0.1", port)) {
        Ok(stream) => stream,
        Err(_) => return false,
    };
    let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
    let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
    let request =
        b"GET /api/v1/readyz HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    if stream.write_all(request).is_err() {
        return false;
    }
    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return false;
    }
    response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200")
}

fn terminate_backend_process(backend: &Arc<Mutex<Option<Child>>>) {
    if let Ok(mut guard) = backend.lock() {
        if let Some(ref mut child) = *guard {
            let pid = child.id() as libc::pid_t;
            unsafe {
                libc::kill(-pid, libc::SIGKILL);
            }
            let _ = child.wait();
        }
        *guard = None;
    }
}

fn pipe_output<R: Read + Send + 'static>(stream: R, is_err: bool) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines().flatten() {
            if is_err {
                eprintln!("[backend] {}", line);
            } else {
                println!("[backend] {}", line);
            }
        }
    });
}

fn spawn_backend(
    app_handle: &tauri::AppHandle,
    data_dir: &std::path::Path,
    secret_key: &str,
    port: u16,
) -> Child {
    let backend_bin = resolve_backend_binary(app_handle);
    let mut backend_path = std::env::var("PATH").unwrap_or_default();
    if let Some(home) = dirs::home_dir() {
        // OpenCode lives in ~/.opencode/bin; Tauri gives the backend an explicit PATH.
        backend_path.push_str(&format!(":{}/.opencode/bin", home.display()));
        backend_path.push_str(&format!(":{}/.local/bin", home.display()));
    }
    backend_path.push_str(":/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin");

    let db_path = data_dir.join("agentrove.db").to_string_lossy().to_string();
    let mut command = Command::new(&backend_bin);
    command
        .env("SECRET_KEY", secret_key)
        .env("BASE_URL", format!("http://127.0.0.1:{port}"))
        .env("DATABASE_URL", format!("sqlite+aiosqlite:///{db_path}"))
        .env("PATH", backend_path)
        .env(
            "STORAGE_PATH",
            data_dir.join("storage").to_string_lossy().to_string(),
        )
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    unsafe {
        command.pre_exec(|| {
            if libc::setpgid(0, 0) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }

    let mut child = command.spawn().expect("failed to spawn backend process");

    if let Some(stdout) = child.stdout.take() {
        pipe_output(stdout, false);
    }
    if let Some(stderr) = child.stderr.take() {
        pipe_output(stderr, true);
    }

    child
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Agentrove", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Agentrove", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Agentrove")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

pub fn run() {
    let data_dir = data_dir();
    let secret_key = ensure_secret_key(&data_dir);
    let port = pick_available_port();
    let backend_port: Arc<OnceLock<Result<u16, String>>> = Arc::new(OnceLock::new());
    let backend_process: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
    let backend_for_exit = backend_process.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(backend_port.clone())
        .invoke_handler(tauri::generate_handler![get_backend_port])
        .on_window_event(|window, event| {
            // Close = hide to tray; real exit is tray Quit (app.exit bypasses this).
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(move |app| {
            // Keep a titled overlay bar so minimize works (borderless can't on macOS);
            // hide native traffic lights — frontend draws custom ones.
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(ns_window) = window.ns_window() {
                    unsafe {
                        let ns_window = &*(ns_window as *const NSWindow);
                        for kind in [
                            NSWindowButton::CloseButton,
                            NSWindowButton::MiniaturizeButton,
                            NSWindowButton::ZoomButton,
                        ] {
                            if let Some(button) = ns_window.standardWindowButton(kind) {
                                button.setHidden(true);
                            }
                        }
                    }
                }
            }

            build_tray(app)?;

            let child = spawn_backend(app.handle(), &data_dir, &secret_key, port);
            *backend_process.lock().unwrap() = Some(child);

            let port_ref = backend_port.clone();
            std::thread::spawn(move || {
                for _ in 0..60 {
                    std::thread::sleep(Duration::from_millis(500));
                    if backend_ready(port) {
                        let _ = port_ref.set(Ok(port));
                        return;
                    }
                }
                eprintln!("[backend] readyz timeout");
                let _ = port_ref.set(Err(
                    "Backend failed readiness checks within startup timeout".to_string(),
                ));
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(move |_app, event| {
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                terminate_backend_process(&backend_for_exit);
            }
        });
}
