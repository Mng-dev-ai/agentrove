use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_push);

/// APNs registration and push-tap routing; a no-op off iOS. Add it after
/// `tauri_plugin_notification` so it can wrap that plugin's notification-center delegate.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("push")
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            _api.register_ios_plugin(init_plugin_push)?;
            Ok(())
        })
        .build()
}
