#[cfg(desktop)]
mod desktop;

// Entry point for every platform. Mobile (iOS/Android) calls this through the
// generated `tauri::mobile_entry_point`; desktop calls it from main.rs.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    {
        desktop::run();
    }

    // Mobile has no local backend sidecar — the frontend talks to a remote
    // backend whose URL is baked in at build time (.env.mobile). So we only wire
    // up the plugins that work on mobile and let the webview load the app.
    #[cfg(mobile)]
    {
        tauri::Builder::default()
            .plugin(tauri_plugin_store::Builder::new().build())
            .plugin(tauri_plugin_notification::init())
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_opener::init())
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }
}
