use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use base64::Engine;
use reqwest::{redirect, Client, StatusCode, Url};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tauri::State;

const KEYCHAIN_SERVICE: &str = "agentrove";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const UNPAIR_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Serialize)]
pub struct MachineError {
    code: &'static str,
    message: String,
}

impl MachineError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn invalid_input(message: &str) -> Self {
        Self::new("invalid_input", message)
    }

    fn keychain(error: keyring::Error) -> Self {
        Self::new(
            "keychain_unavailable",
            format!("The system keychain is unavailable: {error}"),
        )
    }

    fn not_paired() -> Self {
        Self::new("not_paired", "This machine is not paired on this device")
    }

    fn session_revoked() -> Self {
        Self::new(
            "session_revoked",
            "The machine revoked this device's session",
        )
    }

    fn request(error: reqwest::Error) -> Self {
        if is_tls_error(&error) {
            Self::new("tls", "The machine's TLS certificate was rejected")
        } else if error.is_timeout() || error.is_connect() {
            Self::new("unreachable", "The machine could not be reached")
        } else {
            Self::new("unreachable", format!("Request failed: {error}"))
        }
    }

    fn status(status: StatusCode) -> Self {
        Self::new(
            "http",
            format!("The machine responded with HTTP {}", status.as_u16()),
        )
    }

    fn bad_response() -> Self {
        Self::new(
            "bad_response",
            "The machine returned an unexpected response",
        )
    }
}

fn is_tls_error(error: &reqwest::Error) -> bool {
    let mut source: Option<&(dyn std::error::Error + 'static)> = Some(error);
    while let Some(current) = source {
        if current.is::<rustls::Error>() {
            return true;
        }
        if let Some(io_error) = current.downcast_ref::<std::io::Error>() {
            if io_error
                .get_ref()
                .is_some_and(|inner| inner.is::<rustls::Error>())
            {
                return true;
            }
        }
        source = current.source();
    }
    false
}

#[derive(Default)]
pub struct MachineLocks(Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>);

impl MachineLocks {
    fn for_machine(&self, machine_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut locks = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        locks.entry(machine_id.to_string()).or_default().clone()
    }
}

#[derive(Serialize)]
pub struct PairResult {
    access_token: String,
    expires_at: i64,
    device_id: String,
    instance_id: String,
}

#[derive(Serialize)]
pub struct RefreshResult {
    access_token: String,
    expires_at: i64,
}

#[derive(Serialize)]
pub struct UnpairResult {
    revoked: bool,
}

#[derive(Deserialize)]
struct PairResponse {
    access_token: String,
    refresh_token: String,
    device_id: String,
    instance_id: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
}

#[derive(Deserialize)]
struct AccessClaims {
    exp: i64,
}

fn http_client() -> Result<&'static Client, MachineError> {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = Client::builder()
        .https_only(true)
        .redirect(redirect::Policy::none())
        .timeout(REQUEST_TIMEOUT)
        .user_agent(concat!("AgentRove-Desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| {
            MachineError::new("internal", format!("HTTP client init failed: {error}"))
        })?;
    Ok(CLIENT.get_or_init(|| client))
}

fn validate_machine_id(machine_id: &str) -> Result<(), MachineError> {
    let valid = !machine_id.is_empty()
        && machine_id.len() <= 64
        && machine_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if valid {
        Ok(())
    } else {
        Err(MachineError::invalid_input("Invalid machine id"))
    }
}

fn validate_device_id(device_id: &str) -> Result<(), MachineError> {
    let valid = !device_id.is_empty()
        && device_id.len() <= 64
        && device_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-');
    if valid {
        Ok(())
    } else {
        Err(MachineError::invalid_input("Invalid device id"))
    }
}

fn https_origin(url: &str) -> Result<Url, MachineError> {
    let parsed = Url::parse(url).map_err(|_| MachineError::invalid_input("Invalid machine URL"))?;
    if parsed.scheme() != "https" {
        return Err(MachineError::invalid_input("Machine URLs must use https"));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() || parsed.host().is_none() {
        return Err(MachineError::invalid_input("Invalid machine URL"));
    }
    Url::parse(&parsed.origin().ascii_serialization())
        .map_err(|_| MachineError::invalid_input("Invalid machine URL"))
}

fn endpoint(origin: &Url, path: &str) -> Result<Url, MachineError> {
    origin
        .join(path)
        .map_err(|_| MachineError::invalid_input("Invalid machine URL"))
}

fn access_token_expiry(token: &str) -> Result<i64, MachineError> {
    let payload = token
        .split('.')
        .nth(1)
        .ok_or_else(MachineError::bad_response)?;
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .map_err(|_| MachineError::bad_response())?;
    let claims: AccessClaims =
        serde_json::from_slice(&decoded).map_err(|_| MachineError::bad_response())?;
    Ok(claims.exp)
}

fn keychain_entry(machine_id: &str) -> Result<keyring::Entry, MachineError> {
    keyring::Entry::new(KEYCHAIN_SERVICE, &format!("machine.{machine_id}"))
        .map_err(MachineError::keychain)
}

async fn run_keychain<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, MachineError> + Send + 'static,
) -> Result<T, MachineError> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| MachineError::new("internal", format!("Keychain task failed: {error}")))?
}

async fn read_refresh_token(machine_id: &str) -> Result<String, MachineError> {
    let machine_id = machine_id.to_string();
    run_keychain(move || match keychain_entry(&machine_id)?.get_password() {
        Ok(token) => Ok(token),
        Err(keyring::Error::NoEntry) => Err(MachineError::not_paired()),
        Err(error) => Err(MachineError::keychain(error)),
    })
    .await
}

async fn store_refresh_token(machine_id: &str, token: String) -> Result<(), MachineError> {
    let machine_id = machine_id.to_string();
    run_keychain(move || {
        keychain_entry(&machine_id)?
            .set_password(&token)
            .map_err(MachineError::keychain)
    })
    .await
}

async fn delete_refresh_token(machine_id: &str) -> Result<(), MachineError> {
    let machine_id = machine_id.to_string();
    run_keychain(
        move || match keychain_entry(&machine_id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(MachineError::keychain(error)),
        },
    )
    .await
}

async fn read_json<T: DeserializeOwned>(response: reqwest::Response) -> Result<T, MachineError> {
    response
        .json::<T>()
        .await
        .map_err(|_| MachineError::bad_response())
}

async fn rotate_refresh_token(
    origin: &Url,
    refresh_token: &str,
    timeout: Duration,
) -> Result<TokenResponse, MachineError> {
    let response = http_client()?
        .post(endpoint(origin, "/api/v1/auth/jwt/refresh")?)
        .timeout(timeout)
        .json(&serde_json::json!({ "refresh_token": refresh_token }))
        .send()
        .await
        .map_err(MachineError::request)?;
    match response.status() {
        status if status.is_success() => read_json(response).await,
        StatusCode::UNAUTHORIZED => Err(MachineError::session_revoked()),
        status => Err(MachineError::status(status)),
    }
}

async fn revoke_refresh_token(origin: &Url, refresh_token: &str) {
    if let (Ok(client), Ok(url)) = (http_client(), endpoint(origin, "/api/v1/auth/jwt/logout")) {
        let _ = client
            .post(url)
            .timeout(UNPAIR_TIMEOUT)
            .json(&serde_json::json!({ "refresh_token": refresh_token }))
            .send()
            .await;
    }
}

#[tauri::command]
pub async fn machine_pair(
    locks: State<'_, MachineLocks>,
    machine_id: String,
    url: String,
    secret: String,
    device_name: String,
) -> Result<PairResult, MachineError> {
    validate_machine_id(&machine_id)?;
    let origin = https_origin(&url)?;
    let secret = secret.trim();
    if secret.is_empty() || secret.len() > 512 || !secret.chars().all(|c| c.is_ascii_graphic()) {
        return Err(MachineError::new(
            "invalid_link",
            "Invalid or expired pairing link",
        ));
    }
    let device_name = device_name.trim();
    if device_name.is_empty() || device_name.chars().count() > 100 {
        return Err(MachineError::invalid_input("Invalid device name"));
    }

    let lock = locks.for_machine(&machine_id);
    let _guard = lock.lock().await;

    let response = http_client()?
        .post(endpoint(&origin, "/api/v1/auth/pair")?)
        .json(&serde_json::json!({ "secret": secret, "device_name": device_name }))
        .send()
        .await
        .map_err(MachineError::request)?;
    let pair: PairResponse = match response.status() {
        status if status.is_success() => read_json(response).await?,
        StatusCode::BAD_REQUEST => {
            return Err(MachineError::new(
                "invalid_link",
                "Invalid or expired pairing link",
            ))
        }
        status => return Err(MachineError::status(status)),
    };
    let expires_at = access_token_expiry(&pair.access_token)?;

    if let Err(error) = store_refresh_token(&machine_id, pair.refresh_token.clone()).await {
        revoke_refresh_token(&origin, &pair.refresh_token).await;
        return Err(error);
    }

    Ok(PairResult {
        access_token: pair.access_token,
        expires_at,
        device_id: pair.device_id,
        instance_id: pair.instance_id,
    })
}

#[tauri::command]
pub async fn machine_refresh(
    locks: State<'_, MachineLocks>,
    machine_id: String,
    url: String,
) -> Result<RefreshResult, MachineError> {
    validate_machine_id(&machine_id)?;
    let origin = https_origin(&url)?;

    let lock = locks.for_machine(&machine_id);
    let _guard = lock.lock().await;

    let refresh_token = read_refresh_token(&machine_id).await?;
    let tokens = match rotate_refresh_token(&origin, &refresh_token, REQUEST_TIMEOUT).await {
        Ok(tokens) => tokens,
        Err(error) => {
            if error.code == "session_revoked" {
                delete_refresh_token(&machine_id).await?;
            }
            return Err(error);
        }
    };
    let expires_at = access_token_expiry(&tokens.access_token)?;
    store_refresh_token(&machine_id, tokens.refresh_token).await?;

    Ok(RefreshResult {
        access_token: tokens.access_token,
        expires_at,
    })
}

async fn revoke_device(origin: &Url, machine_id: &str, device_id: &str) -> bool {
    let refresh_token = match read_refresh_token(machine_id).await {
        Ok(token) => token,
        Err(_) => return false,
    };
    let tokens = match rotate_refresh_token(origin, &refresh_token, UNPAIR_TIMEOUT).await {
        Ok(tokens) => tokens,
        Err(error) => return error.code == "session_revoked",
    };
    let (Ok(client), Ok(url)) = (
        http_client(),
        endpoint(origin, &format!("/api/v1/auth/devices/{device_id}")),
    ) else {
        return false;
    };
    match client
        .delete(url)
        .timeout(UNPAIR_TIMEOUT)
        .bearer_auth(&tokens.access_token)
        .send()
        .await
    {
        Ok(response) => {
            response.status().is_success() || response.status() == StatusCode::NOT_FOUND
        }
        Err(_) => false,
    }
}

#[tauri::command]
pub async fn machine_unpair(
    locks: State<'_, MachineLocks>,
    machine_id: String,
    url: String,
    device_id: String,
) -> Result<UnpairResult, MachineError> {
    validate_machine_id(&machine_id)?;
    let origin = https_origin(&url)?;
    validate_device_id(&device_id)?;

    let lock = locks.for_machine(&machine_id);
    let _guard = lock.lock().await;

    let revoked = revoke_device(&origin, &machine_id, &device_id).await;
    delete_refresh_token(&machine_id).await?;
    Ok(UnpairResult { revoked })
}

#[tauri::command]
pub async fn machine_forget(
    locks: State<'_, MachineLocks>,
    machine_id: String,
) -> Result<(), MachineError> {
    validate_machine_id(&machine_id)?;

    let lock = locks.for_machine(&machine_id);
    let _guard = lock.lock().await;

    delete_refresh_token(&machine_id).await
}

#[tauri::command]
pub async fn machine_probe(url: String) -> Result<(), MachineError> {
    let origin = https_origin(&url)?;
    let response = http_client()?
        .get(endpoint(&origin, "/health")?)
        .timeout(UNPAIR_TIMEOUT)
        .send()
        .await
        .map_err(MachineError::request)?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(MachineError::status(response.status()))
    }
}
