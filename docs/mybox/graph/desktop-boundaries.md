# Desktop Boundaries

| File | Type |
| --- | --- |
| frontend/src-tauri/Cargo.toml | desktop.tauri |
| frontend/src-tauri/build.rs | desktop.tauri |
| frontend/src-tauri/capabilities/default.json | desktop.tauri |
| frontend/src-tauri/src/main.rs | desktop.tauri |
| frontend/src-tauri/tauri.conf.json | desktop.tauri |

Host-provider boundary:

| File | Purpose |
| --- | --- |
| backend/app/services/sandbox_providers/host_provider.py | local host sandbox provider |
| backend/app/services/sandbox_providers/docker_provider.py | Docker sandbox provider |
| backend/app/services/sandbox.py | sandbox service facade |
