#[cfg(desktop)]
mod desktop;

// Shared entry: mobile via tauri::mobile_entry_point; desktop from main.rs.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    {
        desktop::run();
    }

    // Mobile has no local sidecar — remote backend URL is build-time (.env.mobile).
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
