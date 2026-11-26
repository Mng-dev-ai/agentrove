use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use base64::Engine;
use reqwest::{redirect, Client, Method, StatusCode, Url};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tauri::State;

const KEYCHAIN_SERVICE: &str = "agentrove";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const UNPAIR_TIMEOUT: Duration = Duration::from_secs(5);
const REFRESH_PATH: &str = "/api/v1/auth/jwt/refresh";

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
        if is_certificate_rejection(&error) {
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

fn is_certificate_rejection(error: &reqwest::Error) -> bool {
    let mut source: Option<&(dyn std::error::Error + 'static)> = Some(error);
    while let Some(current) = source {
        if matches!(
            current.downcast_ref::<rustls::Error>(),
            Some(rustls::Error::InvalidCertificate(_))
        ) {
            return true;
        }
        // io::Error::source() skips the wrapped error itself, and hyper-rustls nests the
        // rustls error two io::Errors deep.
        source = match current.downcast_ref::<std::io::Error>() {
            Some(io_error) => io_error
                .get_ref()
                .map(|inner| inner as &(dyn std::error::Error + 'static)),
            None => current.source(),
        };
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

#[derive(Deserialize)]
struct StoredSession {
    origin: String,
    refresh_token: String,
}

struct PairedSession {
    origin: Url,
    refresh_token: String,
}

impl PairedSession {
    fn decode(secret: &str) -> Result<Self, MachineError> {
        let stored: StoredSession =
            serde_json::from_str(secret).map_err(|_| MachineError::not_paired())?;
        Ok(Self {
            origin: https_origin(&stored.origin).map_err(|_| MachineError::not_paired())?,
            refresh_token: stored.refresh_token,
        })
    }

    fn encode(&self) -> String {
        serde_json::json!({
            "origin": self.origin.as_str(),
            "refresh_token": self.refresh_token,
        })
        .to_string()
    }

    fn endpoint(&self, path: &str) -> Result<Url, MachineError> {
        endpoint(&self.origin, path)
    }
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

struct Request {
    method: Method,
    url: Url,
    timeout: Duration,
    json: Option<serde_json::Value>,
    bearer: Option<String>,
}

trait Reply {
    fn status(&self) -> StatusCode;
    async fn read_json<T: DeserializeOwned>(self) -> Result<T, MachineError>;
}

trait Transport {
    type Reply: Reply;
    async fn send(&self, request: Request) -> Result<Self::Reply, MachineError>;
}

trait SessionStore {
    async fn read(&self, machine_id: &str) -> Result<String, MachineError>;
    async fn write(&self, machine_id: &str, secret: String) -> Result<(), MachineError>;
    async fn delete(&self, machine_id: &str) -> Result<(), MachineError>;
}

impl Reply for reqwest::Response {
    fn status(&self) -> StatusCode {
        reqwest::Response::status(self)
    }

    async fn read_json<T: DeserializeOwned>(self) -> Result<T, MachineError> {
        self.json::<T>()
            .await
            .map_err(|_| MachineError::bad_response())
    }
}

struct HttpTransport;

impl Transport for HttpTransport {
    type Reply = reqwest::Response;

    async fn send(&self, request: Request) -> Result<reqwest::Response, MachineError> {
        let mut builder = http_client()?
            .request(request.method, request.url)
            .timeout(request.timeout);
        if let Some(body) = &request.json {
            builder = builder.json(body);
        }
        if let Some(token) = &request.bearer {
            builder = builder.bearer_auth(token);
        }
        builder.send().await.map_err(MachineError::request)
    }
}

struct Keychain;

impl Keychain {
    fn entry(machine_id: &str) -> Result<keyring::Entry, MachineError> {
        keyring::Entry::new(KEYCHAIN_SERVICE, &format!("machine.{machine_id}"))
            .map_err(MachineError::keychain)
    }

    async fn run<T: Send + 'static>(
        task: impl FnOnce() -> Result<T, MachineError> + Send + 'static,
    ) -> Result<T, MachineError> {
        tauri::async_runtime::spawn_blocking(task)
            .await
            .map_err(|error| {
                MachineError::new("internal", format!("Keychain task failed: {error}"))
            })?
    }
}

impl SessionStore for Keychain {
    async fn read(&self, machine_id: &str) -> Result<String, MachineError> {
        let machine_id = machine_id.to_string();
        Self::run(move || match Self::entry(&machine_id)?.get_password() {
            Ok(secret) => Ok(secret),
            Err(keyring::Error::NoEntry) => Err(MachineError::not_paired()),
            Err(error) => Err(MachineError::keychain(error)),
        })
        .await
    }

    async fn write(&self, machine_id: &str, secret: String) -> Result<(), MachineError> {
        let machine_id = machine_id.to_string();
        Self::run(move || {
            Self::entry(&machine_id)?
                .set_password(&secret)
                .map_err(MachineError::keychain)
        })
        .await
    }

    async fn delete(&self, machine_id: &str) -> Result<(), MachineError> {
        let machine_id = machine_id.to_string();
        Self::run(
            move || match Self::entry(&machine_id)?.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(error) => Err(MachineError::keychain(error)),
            },
        )
        .await
    }
}

async fn read_session(
    store: &impl SessionStore,
    machine_id: &str,
) -> Result<PairedSession, MachineError> {
    PairedSession::decode(&store.read(machine_id).await?)
}

async fn rotate_refresh_token(
    transport: &impl Transport,
    session: &PairedSession,
    timeout: Duration,
) -> Result<TokenResponse, MachineError> {
    let reply = transport
        .send(Request {
            method: Method::POST,
            url: session.endpoint(REFRESH_PATH)?,
            timeout,
            json: Some(serde_json::json!({ "refresh_token": session.refresh_token })),
            bearer: None,
        })
        .await?;
    match reply.status() {
        status if status.is_success() => reply.read_json().await,
        StatusCode::UNAUTHORIZED => Err(MachineError::session_revoked()),
        status => Err(MachineError::status(status)),
    }
}

async fn revoke_refresh_token(transport: &impl Transport, origin: &Url, refresh_token: &str) {
    if let Ok(url) = endpoint(origin, "/api/v1/auth/jwt/logout") {
        let _ = transport
            .send(Request {
                method: Method::POST,
                url,
                timeout: UNPAIR_TIMEOUT,
                json: Some(serde_json::json!({ "refresh_token": refresh_token })),
                bearer: None,
            })
            .await;
    }
}

async fn pair(
    transport: &impl Transport,
    store: &impl SessionStore,
    locks: &MachineLocks,
    machine_id: &str,
    url: &str,
    secret: &str,
    device_name: &str,
) -> Result<PairResult, MachineError> {
    validate_machine_id(machine_id)?;
    let origin = https_origin(url)?;
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

    let lock = locks.for_machine(machine_id);
    let _guard = lock.lock().await;

    let reply = transport
        .send(Request {
            method: Method::POST,
            url: endpoint(&origin, "/api/v1/auth/pair")?,
            timeout: REQUEST_TIMEOUT,
            json: Some(serde_json::json!({ "secret": secret, "device_name": device_name })),
            bearer: None,
        })
        .await?;
    let pair: PairResponse = match reply.status() {
        status if status.is_success() => reply.read_json().await?,
        StatusCode::BAD_REQUEST => {
            return Err(MachineError::new(
                "invalid_link",
                "Invalid or expired pairing link",
            ))
        }
        status => return Err(MachineError::status(status)),
    };
    let expires_at = access_token_expiry(&pair.access_token)?;

    let session = PairedSession {
        origin,
        refresh_token: pair.refresh_token,
    };
    if let Err(error) = store.write(machine_id, session.encode()).await {
        revoke_refresh_token(transport, &session.origin, &session.refresh_token).await;
        return Err(error);
    }

    Ok(PairResult {
        access_token: pair.access_token,
        expires_at,
        device_id: pair.device_id,
        instance_id: pair.instance_id,
    })
}

async fn refresh(
    transport: &impl Transport,
    store: &impl SessionStore,
    locks: &MachineLocks,
    machine_id: &str,
) -> Result<RefreshResult, MachineError> {
    validate_machine_id(machine_id)?;

    let lock = locks.for_machine(machine_id);
    let _guard = lock.lock().await;

    let session = read_session(store, machine_id).await?;
    let tokens = match rotate_refresh_token(transport, &session, REQUEST_TIMEOUT).await {
        Ok(tokens) => tokens,
        Err(error) => {
            if error.code == "session_revoked" {
                store.delete(machine_id).await?;
            }
            return Err(error);
        }
    };
    let expires_at = access_token_expiry(&tokens.access_token)?;
    let rotated = PairedSession {
        origin: session.origin,
        refresh_token: tokens.refresh_token,
    };
    store.write(machine_id, rotated.encode()).await?;

    Ok(RefreshResult {
        access_token: tokens.access_token,
        expires_at,
    })
}

async fn revoke_device(
    transport: &impl Transport,
    store: &impl SessionStore,
    machine_id: &str,
    device_id: &str,
) -> bool {
    let Ok(session) = read_session(store, machine_id).await else {
        return false;
    };
    let tokens = match rotate_refresh_token(transport, &session, UNPAIR_TIMEOUT).await {
        Ok(tokens) => tokens,
        Err(error) => return error.code == "session_revoked",
    };
    let Ok(url) = session.endpoint(&format!("/api/v1/auth/devices/{device_id}")) else {
        return false;
    };
    match transport
        .send(Request {
            method: Method::DELETE,
            url,
            timeout: UNPAIR_TIMEOUT,
            json: None,
            bearer: Some(tokens.access_token),
        })
        .await
    {
        Ok(reply) => reply.status().is_success() || reply.status() == StatusCode::NOT_FOUND,
        Err(_) => false,
    }
}

async fn unpair(
    transport: &impl Transport,
    store: &impl SessionStore,
    locks: &MachineLocks,
    machine_id: &str,
    device_id: &str,
) -> Result<UnpairResult, MachineError> {
    validate_machine_id(machine_id)?;
    validate_device_id(device_id)?;

    let lock = locks.for_machine(machine_id);
    let _guard = lock.lock().await;

    let revoked = revoke_device(transport, store, machine_id, device_id).await;
    store.delete(machine_id).await?;
    Ok(UnpairResult { revoked })
}

async fn forget(
    store: &impl SessionStore,
    locks: &MachineLocks,
    machine_id: &str,
) -> Result<(), MachineError> {
    validate_machine_id(machine_id)?;

    let lock = locks.for_machine(machine_id);
    let _guard = lock.lock().await;

    store.delete(machine_id).await
}

async fn probe(transport: &impl Transport, url: &str) -> Result<(), MachineError> {
    let origin = https_origin(url)?;
    let reply = transport
        .send(Request {
            method: Method::GET,
            url: endpoint(&origin, "/health")?,
            timeout: UNPAIR_TIMEOUT,
            json: None,
            bearer: None,
        })
        .await?;
    if reply.status().is_success() {
        Ok(())
    } else {
        Err(MachineError::status(reply.status()))
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
    pair(
        &HttpTransport,
        &Keychain,
        &locks,
        &machine_id,
        &url,
        &secret,
        &device_name,
    )
    .await
}

#[tauri::command]
pub async fn machine_refresh(
    locks: State<'_, MachineLocks>,
    machine_id: String,
) -> Result<RefreshResult, MachineError> {
    refresh(&HttpTransport, &Keychain, &locks, &machine_id).await
}

#[tauri::command]
pub async fn machine_unpair(
    locks: State<'_, MachineLocks>,
    machine_id: String,
    device_id: String,
) -> Result<UnpairResult, MachineError> {
    unpair(&HttpTransport, &Keychain, &locks, &machine_id, &device_id).await
}

#[tauri::command]
pub async fn machine_forget(
    locks: State<'_, MachineLocks>,
    machine_id: String,
) -> Result<(), MachineError> {
    forget(&Keychain, &locks, &machine_id).await
}

#[tauri::command]
pub async fn machine_probe(url: String) -> Result<(), MachineError> {
    probe(&HttpTransport, &url).await
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::thread::JoinHandle;

    use rustls::pki_types::{CertificateDer, PrivatePkcs8KeyDer};
    use serde_json::{json, Value};

    use super::*;

    const PROTOCOL_FIXTURE: &str = include_str!("../fixtures/machine_vault_protocol.json");
    const ORIGIN: &str = "https://machine.example:8443";
    const UNTRUSTED_TLS_CERT: &[u8] =
        include_bytes!("../fixtures/test_only_untrusted_tls_cert.der");
    const UNTRUSTED_TLS_KEY: &[u8] = include_bytes!("../fixtures/test_only_untrusted_tls_key.der");

    #[derive(Deserialize)]
    struct Fixture {
        paired_setup: Step,
        cases: Vec<Case>,
    }

    #[derive(Deserialize)]
    struct Case {
        name: String,
        #[serde(default)]
        paired: bool,
        steps: Vec<Step>,
    }

    #[derive(Deserialize)]
    struct Step {
        op: String,
        args: HashMap<String, String>,
        #[serde(default)]
        exchanges: Vec<Exchange>,
        expect: Expect,
    }

    #[derive(Clone, Deserialize)]
    struct Exchange {
        request: SentRequest,
        response: Response,
    }

    #[derive(Clone, Debug, PartialEq, Deserialize)]
    struct SentRequest {
        method: String,
        url: String,
        timeout_ms: u128,
        json: Option<Value>,
        bearer: Option<String>,
    }

    #[derive(Clone, Deserialize)]
    #[serde(untagged)]
    enum Response {
        NetworkError {
            #[allow(dead_code)]
            network_error: bool,
        },
        Reply {
            status: u16,
            json: Option<Value>,
            text: Option<String>,
        },
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "snake_case")]
    enum Expect {
        Ok(Value),
        Error(String),
    }

    struct FakeReply {
        status: StatusCode,
        body: String,
    }

    impl Reply for FakeReply {
        fn status(&self) -> StatusCode {
            self.status
        }

        async fn read_json<T: DeserializeOwned>(self) -> Result<T, MachineError> {
            serde_json::from_str(&self.body).map_err(|_| MachineError::bad_response())
        }
    }

    #[derive(Default)]
    struct FakeTransport {
        responses: Mutex<VecDeque<Response>>,
        sent: Mutex<Vec<SentRequest>>,
    }

    impl FakeTransport {
        fn replying(responses: impl IntoIterator<Item = Response>) -> Self {
            Self {
                responses: Mutex::new(responses.into_iter().collect()),
                sent: Mutex::default(),
            }
        }

        fn sent(&self) -> Vec<SentRequest> {
            self.sent.lock().unwrap().clone()
        }
    }

    impl Transport for FakeTransport {
        type Reply = FakeReply;

        async fn send(&self, request: Request) -> Result<FakeReply, MachineError> {
            self.sent.lock().unwrap().push(SentRequest {
                method: request.method.to_string(),
                url: request.url.to_string(),
                timeout_ms: request.timeout.as_millis(),
                json: request.json,
                bearer: request.bearer,
            });
            match self.responses.lock().unwrap().pop_front() {
                Some(Response::Reply { status, json, text }) => Ok(FakeReply {
                    status: StatusCode::from_u16(status).unwrap(),
                    body: json.map_or(text.unwrap_or_default(), |body| body.to_string()),
                }),
                Some(Response::NetworkError { .. }) | None => Err(MachineError::new(
                    "unreachable",
                    "The machine could not be reached",
                )),
            }
        }
    }

    #[derive(Default)]
    struct FakeStore {
        sessions: Mutex<HashMap<String, String>>,
        fail_writes: bool,
    }

    impl SessionStore for FakeStore {
        async fn read(&self, machine_id: &str) -> Result<String, MachineError> {
            self.sessions
                .lock()
                .unwrap()
                .get(machine_id)
                .cloned()
                .ok_or_else(MachineError::not_paired)
        }

        async fn write(&self, machine_id: &str, secret: String) -> Result<(), MachineError> {
            if self.fail_writes {
                return Err(MachineError::keychain(keyring::Error::NoEntry));
            }
            self.sessions
                .lock()
                .unwrap()
                .insert(machine_id.to_string(), secret);
            Ok(())
        }

        async fn delete(&self, machine_id: &str) -> Result<(), MachineError> {
            self.sessions.lock().unwrap().remove(machine_id);
            Ok(())
        }
    }

    #[derive(Default)]
    struct SlowTransport {
        in_flight: Mutex<usize>,
        max_in_flight: Mutex<usize>,
        sent_refresh_tokens: Mutex<Vec<Value>>,
    }

    impl Transport for SlowTransport {
        type Reply = FakeReply;

        async fn send(&self, request: Request) -> Result<FakeReply, MachineError> {
            self.sent_refresh_tokens
                .lock()
                .unwrap()
                .push(request.json.unwrap()["refresh_token"].take());
            {
                let mut in_flight = self.in_flight.lock().unwrap();
                *in_flight += 1;
                let mut max_in_flight = self.max_in_flight.lock().unwrap();
                *max_in_flight = (*max_in_flight).max(*in_flight);
            }
            for _ in 0..10 {
                tokio::task::yield_now().await;
            }
            *self.in_flight.lock().unwrap() -= 1;
            Ok(FakeReply {
                status: StatusCode::OK,
                body: json!({ "access_token": jwt(1_900_000_000), "refresh_token": "rotated" })
                    .to_string(),
            })
        }
    }

    fn jwt(exp: i64) -> String {
        let claims = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(json!({ "exp": exp }).to_string());
        format!("header.{claims}.signature")
    }

    fn stored(origin: &str) -> String {
        serde_json::json!({ "origin": origin, "refresh_token": "refresh" }).to_string()
    }

    fn paired_store(machine_ids: &[&str]) -> FakeStore {
        let store = FakeStore::default();
        for machine_id in machine_ids {
            store
                .sessions
                .lock()
                .unwrap()
                .insert(machine_id.to_string(), stored(ORIGIN));
        }
        store
    }

    async fn run_step(store: &FakeStore, locks: &MachineLocks, step: &Step, label: &str) {
        let transport = FakeTransport::replying(
            step.exchanges
                .iter()
                .map(|exchange| exchange.response.clone()),
        );
        let args = &step.args;
        let result = match step.op.as_str() {
            "pair" => pair(
                &transport,
                store,
                locks,
                &args["machine_id"],
                &args["url"],
                &args["secret"],
                &args["device_name"],
            )
            .await
            .map(|result| json!(result)),
            "refresh" => refresh(&transport, store, locks, &args["machine_id"])
                .await
                .map(|result| json!(result)),
            "unpair" => unpair(
                &transport,
                store,
                locks,
                &args["machine_id"],
                &args["device_id"],
            )
            .await
            .map(|result| json!(result)),
            "forget" => forget(store, locks, &args["machine_id"])
                .await
                .map(|()| Value::Null),
            op => panic!("{label}: unknown fixture op {op}"),
        };
        let expected = match &step.expect {
            Expect::Ok(value) => Ok(value.clone()),
            Expect::Error(code) => Err(code.clone()),
        };
        assert_eq!(
            result.map_err(|error| error.code.to_string()),
            expected,
            "{label}"
        );
        let requests: Vec<SentRequest> = step
            .exchanges
            .iter()
            .map(|exchange| exchange.request.clone())
            .collect();
        assert_eq!(transport.sent(), requests, "{label}");
    }

    #[tokio::test]
    async fn shared_protocol_cases() {
        let fixture: Fixture = serde_json::from_str(PROTOCOL_FIXTURE).unwrap();
        assert!(!fixture.cases.is_empty());
        for case in &fixture.cases {
            let store = FakeStore::default();
            let locks = MachineLocks::default();
            if case.paired {
                let label = format!("{}: paired_setup", case.name);
                run_step(&store, &locks, &fixture.paired_setup, &label).await;
            }
            for (index, step) in case.steps.iter().enumerate() {
                let label = format!("{}: step {} ({})", case.name, index + 1, step.op);
                run_step(&store, &locks, step, &label).await;
            }
        }
    }

    #[tokio::test]
    async fn concurrent_operations_on_one_machine_run_sequentially() {
        let store = paired_store(&["machine-1"]);
        let locks = MachineLocks::default();
        let transport = SlowTransport::default();

        let (first, second) = tokio::join!(
            refresh(&transport, &store, &locks, "machine-1"),
            refresh(&transport, &store, &locks, "machine-1"),
        );

        assert!(first.is_ok() && second.is_ok());
        assert_eq!(*transport.max_in_flight.lock().unwrap(), 1);
        assert_eq!(
            *transport.sent_refresh_tokens.lock().unwrap(),
            ["refresh", "rotated"]
        );
    }

    #[tokio::test]
    async fn operations_on_different_machines_do_not_block_each_other() {
        let store = paired_store(&["machine-1", "machine-2"]);
        let locks = MachineLocks::default();
        let transport = SlowTransport::default();

        let (first, second) = tokio::join!(
            refresh(&transport, &store, &locks, "machine-1"),
            refresh(&transport, &store, &locks, "machine-2"),
        );

        assert!(first.is_ok() && second.is_ok());
        assert_eq!(*transport.max_in_flight.lock().unwrap(), 2);
    }

    #[tokio::test]
    async fn machine_and_device_ids_are_validated_before_anything_is_sent_or_deleted() {
        let store = paired_store(&["machine-1"]);
        let locks = MachineLocks::default();
        let transport = FakeTransport::default();

        let error = pair(
            &transport,
            &store,
            &locks,
            "machine 1",
            ORIGIN,
            "secret",
            "Laptop",
        )
        .await
        .err()
        .unwrap();
        assert_eq!(error.code, "invalid_input");
        let error = refresh(&transport, &store, &locks, "../machine-1")
            .await
            .err()
            .unwrap();
        assert_eq!(error.code, "invalid_input");
        let error = unpair(&transport, &store, &locks, "machine-1", "device/1")
            .await
            .err()
            .unwrap();
        assert_eq!(error.code, "invalid_input");
        let error = forget(&store, &locks, "").await.err().unwrap();
        assert_eq!(error.code, "invalid_input");

        assert_eq!(transport.sent(), []);
        assert!(store.sessions.lock().unwrap().contains_key("machine-1"));
    }

    #[tokio::test]
    async fn pair_revokes_the_new_refresh_token_when_the_session_cannot_be_stored() {
        let store = FakeStore {
            fail_writes: true,
            ..FakeStore::default()
        };
        let transport = FakeTransport::replying([
            Response::Reply {
                status: 200,
                json: Some(json!({
                    "access_token": jwt(1_900_000_000),
                    "refresh_token": "refresh-0",
                    "device_id": "device-1",
                    "instance_id": "instance-1",
                })),
                text: None,
            },
            Response::Reply {
                status: 204,
                json: None,
                text: None,
            },
        ]);

        let error = pair(
            &transport,
            &store,
            &MachineLocks::default(),
            "machine-1",
            ORIGIN,
            "secret",
            "Laptop",
        )
        .await
        .err()
        .unwrap();

        assert_eq!(error.code, "keychain_unavailable");
        assert_eq!(
            transport.sent()[1],
            SentRequest {
                method: "POST".to_string(),
                url: format!("{ORIGIN}/api/v1/auth/jwt/logout"),
                timeout_ms: 5000,
                json: Some(json!({ "refresh_token": "refresh-0" })),
                bearer: None,
            }
        );
    }

    #[tokio::test]
    async fn probe_requires_a_2xx_health_response() {
        let health = SentRequest {
            method: "GET".to_string(),
            url: format!("{ORIGIN}/health"),
            timeout_ms: 5000,
            json: None,
            bearer: None,
        };
        for (status, expected) in [
            (200, Ok(())),
            (204, Ok(())),
            (404, Err("http")),
            (503, Err("http")),
        ] {
            let transport = FakeTransport::replying([Response::Reply {
                status,
                json: None,
                text: None,
            }]);
            let result = probe(&transport, &format!("{ORIGIN}/some/page")).await;
            assert_eq!(result.map_err(|error| error.code), expected, "{status}");
            assert_eq!(transport.sent(), std::slice::from_ref(&health));
        }

        let transport = FakeTransport::default();
        let error = probe(&transport, "http://machine.example")
            .await
            .err()
            .unwrap();
        assert_eq!(error.code, "invalid_input");
        assert_eq!(transport.sent(), []);
    }

    fn serve_once(respond: fn(TcpStream)) -> (String, JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!(
            "https://127.0.0.1:{}",
            listener.local_addr().unwrap().port()
        );
        let server = std::thread::spawn(move || respond(listener.accept().unwrap().0));
        (url, server)
    }

    fn present_untrusted_certificate(mut stream: TcpStream) {
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let config = rustls::ServerConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(
                vec![CertificateDer::from(UNTRUSTED_TLS_CERT)],
                PrivatePkcs8KeyDer::from(UNTRUSTED_TLS_KEY).into(),
            )
            .unwrap();
        let mut connection = rustls::ServerConnection::new(Arc::new(config)).unwrap();
        while connection.is_handshaking() && connection.complete_io(&mut stream).is_ok() {}
    }

    fn answer_in_plain_http(mut stream: TcpStream) {
        let _ = stream.read(&mut [0; 1024]);
        let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n");
    }

    #[tokio::test]
    async fn real_transport_failures_are_tls_only_when_the_certificate_is_rejected() {
        let (url, server) = serve_once(present_untrusted_certificate);
        let error = probe(&HttpTransport, &url).await.err().unwrap();
        assert_eq!(error.code, "tls");
        server.join().unwrap();

        let (url, server) = serve_once(answer_in_plain_http);
        let error = probe(&HttpTransport, &url).await.err().unwrap();
        assert_eq!(error.code, "unreachable");
        server.join().unwrap();

        let error = probe(&HttpTransport, &url).await.err().unwrap();
        assert_eq!(error.code, "unreachable");
    }

    #[test]
    fn refresh_and_unpair_only_target_the_stored_origin() {
        let paired = Url::parse("https://paired.example:8443").unwrap();
        for origin in [
            "https://paired.example:8443",
            "https://paired.example:8443/other/path?next=https://evil.example",
        ] {
            let session = PairedSession::decode(&stored(origin)).unwrap();
            let refresh = session.endpoint(REFRESH_PATH).unwrap();
            let unpair = session
                .endpoint(&format!("/api/v1/auth/devices/{}", "device-1"))
                .unwrap();
            for url in [refresh, unpair] {
                assert_eq!(url.origin(), paired.origin());
            }
            let reloaded = PairedSession::decode(&session.encode()).unwrap();
            assert_eq!(reloaded.origin, session.origin);
        }
    }

    #[test]
    fn stored_session_without_an_https_origin_is_not_paired() {
        for origin in [
            "http://paired.example",
            "https://user:pass@paired.example",
            "paired.example",
        ] {
            let error = PairedSession::decode(&stored(origin)).err().unwrap();
            assert_eq!(error.code, "not_paired");
        }
        let error = PairedSession::decode("legacy-refresh-token").err().unwrap();
        assert_eq!(error.code, "not_paired");
    }
}
