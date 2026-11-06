fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_backend_port",
            "machine_pair",
            "machine_refresh",
            "machine_unpair",
            "machine_forget",
            "machine_probe",
        ]),
    ))
    .expect("failed to run tauri-build");
}
