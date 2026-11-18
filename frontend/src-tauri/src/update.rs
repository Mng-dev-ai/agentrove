use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

const UPDATE_STATE_EVENT: &str = "update-state";
const UNKNOWN_TOTAL_EMIT_INTERVAL: Duration = Duration::from_millis(500);

#[derive(Clone, Serialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum UpdateState {
    Idle,
    Available {
        version: String,
    },
    Downloading {
        downloaded_bytes: u64,
        total_bytes: Option<u64>,
    },
    Ready {
        version: String,
    },
    Installing,
    Error {
        message: String,
    },
}

enum Stage {
    Idle,
    Available(Update),
    Downloading {
        downloaded_bytes: u64,
        total_bytes: Option<u64>,
    },
    Ready {
        update: Update,
        bytes: Vec<u8>,
    },
    Installing,
    Error(String),
}

impl Stage {
    fn snapshot(&self) -> UpdateState {
        match self {
            Stage::Idle => UpdateState::Idle,
            Stage::Available(update) => UpdateState::Available {
                version: update.version.clone(),
            },
            Stage::Downloading {
                downloaded_bytes,
                total_bytes,
            } => UpdateState::Downloading {
                downloaded_bytes: *downloaded_bytes,
                total_bytes: *total_bytes,
            },
            Stage::Ready { update, .. } => UpdateState::Ready {
                version: update.version.clone(),
            },
            Stage::Installing => UpdateState::Installing,
            Stage::Error(message) => UpdateState::Error {
                message: message.clone(),
            },
        }
    }

    // A download in flight or finished must survive a webview refresh re-running the check.
    fn accepts_check(&self) -> bool {
        matches!(self, Stage::Idle | Stage::Available(_) | Stage::Error(_))
    }
}

pub struct UpdateLifecycle(Mutex<Stage>);

impl Default for UpdateLifecycle {
    fn default() -> Self {
        Self(Mutex::new(Stage::Idle))
    }
}

fn lock_stage(app: &AppHandle) -> MutexGuard<'_, Stage> {
    app.state::<UpdateLifecycle>()
        .inner()
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn publish(app: &AppHandle, stage: &Stage) -> UpdateState {
    let state = stage.snapshot();
    let _ = app.emit(UPDATE_STATE_EVENT, state.clone());
    state
}

fn set_stage(app: &AppHandle, stage: Stage) {
    let mut guard = lock_stage(app);
    *guard = stage;
    publish(app, &guard);
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<UpdateState, String> {
    {
        let guard = lock_stage(&app);
        if !guard.accepts_check() {
            return Ok(publish(&app, &guard));
        }
    }

    let result = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(error) => Err(error),
    };

    let mut guard = lock_stage(&app);
    if !guard.accepts_check() {
        return Ok(publish(&app, &guard));
    }
    *guard = match result {
        Ok(Some(update)) => Stage::Available(update),
        Ok(None) => Stage::Idle,
        Err(error) if matches!(*guard, Stage::Error(_)) => Stage::Error(error.to_string()),
        Err(error) => return Err(error.to_string()),
    };
    Ok(publish(&app, &guard))
}

#[tauri::command]
pub async fn update_download(app: AppHandle) {
    let update = {
        let mut guard = lock_stage(&app);
        let downloading = Stage::Downloading {
            downloaded_bytes: 0,
            total_bytes: None,
        };
        match std::mem::replace(&mut *guard, downloading) {
            Stage::Available(update) => {
                publish(&app, &guard);
                update
            }
            other => {
                *guard = other;
                return;
            }
        }
    };

    tauri::async_runtime::spawn(async move {
        let mut downloaded_bytes: u64 = 0;
        let mut last_percent: Option<u64> = None;
        let mut last_emit = Instant::now();
        let result = update
            .download(
                |chunk_length, total_bytes| {
                    downloaded_bytes += chunk_length as u64;
                    let due = match total_bytes {
                        Some(total) if total > 0 => {
                            let percent = downloaded_bytes * 100 / total;
                            let changed = last_percent != Some(percent);
                            last_percent = Some(percent);
                            changed
                        }
                        _ => last_emit.elapsed() >= UNKNOWN_TOTAL_EMIT_INTERVAL,
                    };
                    if due {
                        last_emit = Instant::now();
                        set_stage(
                            &app,
                            Stage::Downloading {
                                downloaded_bytes,
                                total_bytes,
                            },
                        );
                    }
                },
                || {},
            )
            .await;

        match result {
            Ok(bytes) => set_stage(&app, Stage::Ready { update, bytes }),
            Err(error) => set_stage(&app, Stage::Error(error.to_string())),
        }
    });
}

#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    let (update, bytes) = {
        let mut guard = lock_stage(&app);
        match std::mem::replace(&mut *guard, Stage::Installing) {
            Stage::Ready { update, bytes } => {
                publish(&app, &guard);
                (update, bytes)
            }
            other => {
                *guard = other;
                return Err("No downloaded update to install".to_string());
            }
        }
    };

    let result = tauri::async_runtime::spawn_blocking(move || update.install(bytes))
        .await
        .map_err(|error| error.to_string())
        .and_then(|installed| installed.map_err(|error| error.to_string()));

    match result {
        Ok(()) => {
            app.request_restart();
            Ok(())
        }
        Err(message) => {
            set_stage(&app, Stage::Error(message.clone()));
            Err(message)
        }
    }
}
