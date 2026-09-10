use crate::{
    engine_host::{EngineLaunch, HostProcesses, LaunchOptions},
    engine_inventory::{inspect_artifact, inspect_artifact_set, ArtifactMetadata},
    transport::HostCertificate,
};
use hmac::{Hmac, Mac};
use hyper::{Body, Request, Response, StatusCode};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize)]
pub struct Gpu {
    pub uuid: String,
    pub name: String,
    pub memory_mib: u64,
    #[serde(default)]
    pub compute_capability: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct ModelEntry {
    pub id: Uuid,
    pub path: PathBuf,
    pub metadata: ArtifactMetadata,
    pub artifact_set: bool,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct LaunchRequest {
    pub instance_id: Option<Uuid>,
    #[serde(default)]
    pub qualified_profile_id: Option<String>,
    pub model_id: Uuid,
    pub gpu_uuids: Vec<String>,
    pub max_context: u32,
    pub concurrency: u32,
    #[serde(flatten)]
    pub options: LaunchOptions,
}
#[derive(Serialize, Deserialize)]
pub struct ClientGrant {
    pub name: String,
    pub token_verifier: String,
}
#[derive(Serialize, Deserialize)]
pub struct Persistent {
    #[serde(default)]
    pub management_origin: Option<String>,
    pub host_id: Uuid,
    pub name: String,
    pub certificate: HostCertificate,
    /// Local pairing/control credential; never issued to paired desktop clients.
    pub pairing_admin_token: String,
    pub clients: BTreeMap<Uuid, ClientGrant>,
    pub models: BTreeMap<String, Uuid>,
    pub profiles: BTreeMap<Uuid, LaunchRequest>,
    #[serde(default)]
    pub local_artifacts: Vec<PathBuf>,
}
pub struct Pairing {
    code: String,
    expires: tokio::time::Instant,
    attempts: u32,
}
pub struct Host {
    inference_client: reqwest::Client,
    local_inference: Mutex<BTreeMap<Uuid, crate::local_inference::LocalInference>>,
    pub launch_profiles: RwLock<Vec<crate::launch_profiles::LaunchProfile>>,
    pub profile_error: RwLock<Option<String>>,
    pub downloads: Arc<crate::model_downloads::ModelDownloads>,
    pub data: Mutex<Persistent>,
    pub processes: Mutex<HostProcesses>,
    pub inventory: RwLock<Vec<ModelEntry>>,
    pub inventory_errors: RwLock<Vec<serde_json::Value>>,
    pub gpus: Vec<Gpu>,
    pub boot_id: Uuid,
    pub revision: AtomicU64,
    pub directory: PathBuf,
    pub model_dirs: Vec<PathBuf>,
    pub artifact_sets: Vec<PathBuf>,
    pub pairing: Mutex<Option<Pairing>>,
    lifecycle: Mutex<()>,
    traffic: Arc<std::sync::Mutex<BTreeMap<Uuid, (bool, usize)>>>,
}
struct RequestLease {
    traffic: Arc<std::sync::Mutex<BTreeMap<Uuid, (bool, usize)>>>,
    id: Uuid,
}
struct DrainGuard {
    traffic: Arc<std::sync::Mutex<BTreeMap<Uuid, (bool, usize)>>>,
    id: Uuid,
}
impl Drop for DrainGuard {
    fn drop(&mut self) {
        self.traffic.lock().unwrap().entry(self.id).or_default().0 = false;
    }
}
impl Drop for RequestLease {
    fn drop(&mut self) {
        if let Some((_, count)) = self.traffic.lock().unwrap().get_mut(&self.id) {
            *count -= 1;
        }
    }
}

// Secrets never pass through desktop-visible snapshots or command logs.
fn verifier(token: &str) -> Hmac<Sha256> {
    let mut h = Hmac::<Sha256>::new_from_slice(b"ginfer-host/client-token/v1").unwrap();
    h.update(token.as_bytes());
    h
}

pub fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("state path has no parent")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temporary = parent.join(format!(".{}.tmp", Uuid::new_v4()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| {
        use std::io::Write;
        let mut f = options.open(&temporary).map_err(|e| e.to_string())?;
        f.write_all(bytes).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
        drop(f);
        std::fs::rename(&temporary, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}

impl Host {
    pub async fn open(
        directory: PathBuf,
        name: String,
        engine: PathBuf,
        model_dirs: Vec<PathBuf>,
        artifact_sets: Vec<PathBuf>,
        gpus: Vec<Gpu>,
    ) -> Result<Arc<Self>, String> {
        Self::open_with_model_storage(directory, name, engine, model_dirs, artifact_sets, gpus, None).await
    }

    pub async fn open_with_model_storage(
        directory: PathBuf, name: String, engine: PathBuf, model_dirs: Vec<PathBuf>,
        artifact_sets: Vec<PathBuf>, gpus: Vec<Gpu>, desktop_provider: Option<PathBuf>,
    ) -> Result<Arc<Self>, String> {
        if desktop_provider.as_ref().is_some_and(|provider| !provider.is_absolute() || directory != provider.join("host")) {
            return Err("desktop provider storage must use its dedicated provider/host state directory".into());
        }
        let path = directory.join("host.json");
        let data = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice::<Persistent>(&bytes).map_err(|e| e.to_string())?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Persistent {
                management_origin: None,
                host_id: Uuid::new_v4(),
                name,
                certificate: HostCertificate::generate()?,
                pairing_admin_token: format!(
                    "{}{}",
                    Uuid::new_v4().simple(),
                    Uuid::new_v4().simple()
                ),
                clients: BTreeMap::new(),
                models: BTreeMap::new(),
                profiles: BTreeMap::new(),
                local_artifacts: vec![],
            },
            Err(e) => return Err(e.to_string()),
        };
        write_private(
            &path,
            &serde_json::to_vec(&data).map_err(|e| e.to_string())?,
        )?;
        let processes = HostProcesses::new(
            engine,
            gpus.iter().map(|g| g.uuid.clone()).collect(),
            Duration::from_secs(600),
        )?;
        let downloads = match desktop_provider {
            Some(provider) => crate::model_downloads::ModelDownloads::open_local(
                provider.join("models"), provider.join("model-downloads.json"))?,
            None => crate::model_downloads::ModelDownloads::open(
                directory.join("managed-models"), directory.join("model-downloads.json"))?,
        };
        let host = Arc::new(Self {
            inference_client: reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|e| e.to_string())?,
            local_inference: Mutex::new(BTreeMap::new()),
            launch_profiles: RwLock::new(vec![]),
            profile_error: RwLock::new(None),
            downloads,
            data: Mutex::new(data),
            processes: Mutex::new(processes),
            inventory: RwLock::new(vec![]),
            inventory_errors: RwLock::new(vec![]),
            gpus,
            boot_id: Uuid::new_v4(),
            revision: AtomicU64::new(1),
            directory,
            model_dirs,
            artifact_sets,
            pairing: Mutex::new(None),
            lifecycle: Mutex::new(()),
            traffic: Arc::new(std::sync::Mutex::new(BTreeMap::new())),
        });
        host.scan().await?;
        Ok(host)
    }
    pub async fn save(&self) -> Result<(), String> {
        let data = self.data.lock().await;
        write_private(
            &self.directory.join("host.json"),
            &serde_json::to_vec(&*data).map_err(|e| e.to_string())?,
        )
    }
    pub async fn enable_pairing(&self) -> String {
        let code = format!("{:08}", rand::thread_rng().gen_range(0..100_000_000u32));
        *self.pairing.lock().await = Some(Pairing {
            code: code.clone(),
            expires: tokio::time::Instant::now() + Duration::from_secs(300),
            attempts: 0,
        });
        code
    }
    pub async fn scan(&self) -> Result<(), String> {
        let path = self.directory.join("launch-profiles.json");
        let catalog = tokio::task::spawn_blocking(move || {
            let executable = std::env::current_exe().map_err(|error| error.to_string())?;
            let bundled = executable.parent().ok_or("host executable has no parent")?.join("launch-profiles.json");
            crate::launch_profiles::ProfileCatalog::read_installed(&path, &bundled)
        })
        .await
        .map_err(|e| e.to_string())?;
        let catalog = match (catalog, self.downloads.installed_profiles().await) {
            (Ok(mut profiles), Ok(installed)) => {
                let mut conflict = None;
                for profile in installed {
                    if let Some(existing) = profiles.iter().find(|existing| existing.id == profile.id) {
                        if serde_json::to_value(existing).map_err(|e| e.to_string())?
                            != serde_json::to_value(&profile).map_err(|e| e.to_string())? {
                            conflict = Some(format!("conflicting installed launch profile: {}", profile.id));
                            break;
                        }
                    } else { profiles.push(profile); }
                }
                conflict.map_or(Ok(profiles), Err)
            }
            (Err(error), _) | (_, Err(error)) => Err(error),
        };
        match catalog {
            Ok(profiles) => {
                *self.launch_profiles.write().await = profiles;
                *self.profile_error.write().await = None;
            }
            Err(error) => {
                self.launch_profiles.write().await.clear();
                *self.profile_error.write().await = Some(error);
            }
        }
        let mut roots = self.model_dirs.clone();
        roots.extend(self.data.lock().await.local_artifacts.iter().cloned());
        roots.push(self.downloads.root().to_path_buf());
        let sets = self.artifact_sets.clone();
        let (entries, errors) = tokio::task::spawn_blocking(move || {
            let mut pending: Vec<_> = roots.into_iter().map(|p| (p, false)).chain(sets.into_iter().map(|p|(p,true))).collect();
            let mut found = Vec::new();
            let mut errors = Vec::new();
            while let Some((path, artifact_set)) = pending.pop() {
                let metadata = match std::fs::symlink_metadata(&path) {
                    Ok(m) => m,
                    Err(e) => {
                        errors.push(serde_json::json!({"path":path,"error":e.to_string()}));
                        continue;
                    }
                };
                if metadata.is_symlink() {
                    errors.push(serde_json::json!({"path":path,"error":"symlink inventory roots and entries are not followed; configure the resolved path"}));
                    continue;
                }
                if metadata.is_dir() && !artifact_set {
                    match std::fs::read_dir(&path) {
                        Ok(entries) => {
                            for entry in entries {
                                match entry {
                                    Ok(entry) => pending.push((entry.path(), false)),
                                    Err(e) => errors.push(
                                        serde_json::json!({"path":path,"error":e.to_string()}),
                                    ),
                                }
                            }
                        }
                        Err(e) => {
                            errors.push(serde_json::json!({"path":path,"error":e.to_string()}))
                        }
                    }
                } else if artifact_set || path.extension().and_then(|s| s.to_str()) == Some("ginfer") {
                    let result = if artifact_set {
                        inspect_artifact_set(&path)
                    } else {
                        inspect_artifact(&path).map(|m| vec![m])
                    };
                    match result.and_then(|members| {
                        path.canonicalize()
                            .map(|p| (p, members))
                            .map_err(|e| e.to_string())
                    }) {
                        Ok((path, members)) => {
                            for metadata in members {
                                found.push((path.clone(), metadata, artifact_set));
                            }
                        }
                        Err(e) => errors.push(serde_json::json!({"path":path,"error":e})),
                    }
                }
            }
            (found, errors)
        })
        .await
        .map_err(|e| e.to_string())?;
        let mut data = self.data.lock().await;
        let mut models = BTreeMap::new();
        for (path, metadata, artifact_set) in entries {
            let key = serde_json::to_string(&(&path, artifact_set, metadata.tp_size))
                .map_err(|e| e.to_string())?;
            let id = *data.models.entry(key).or_insert_with(Uuid::new_v4);
            models.insert(
                id,
                ModelEntry {
                    id,
                    path,
                    metadata,
                    artifact_set,
                },
            );
        }
        *self.inventory.write().await = models.into_values().collect();
        *self.inventory_errors.write().await = errors;
        drop(data);
        self.save().await?;
        self.revision.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    pub async fn snapshot(&self) -> serde_json::Value {
        let data = self.data.lock().await;
        let processes = self.processes.lock().await;
        let reserved = processes.reserved_gpus(None);
        let mut available_profiles = vec![];
        for profile in self.launch_profiles.read().await.iter() {
            for model in self
                .inventory
                .read()
                .await
                .iter()
                .filter(|m| profile.matches_model(m))
            {
                available_profiles.push(serde_json::json!({"profile":profile,"model_id":model.id,
                    "gpu_groups":profile.gpu_groups(&self.gpus, &reserved),
                    "compatible_gpu_groups":profile.gpu_groups(&self.gpus, &Default::default())}));
            }
        }
        let mut instances: Vec<_> = processes.instances().map(|i| serde_json::json!({
            "instance_id": i.instance_id, "session_id": i.session_id, "display_name": i.launch.model_id,
            "upstream_model_id": i.launch.model_id, "status": i.status, "last_error": i.last_error,
            "configuration": i.launch, "model_metadata": i.model_metadata,
            "profile": data.profiles.get(&i.instance_id),
        })).collect();
        for (id, profile) in &data.profiles {
            if !processes.instances().any(|i| i.instance_id == *id) {
                instances.push(serde_json::json!({
                    "instance_id":id,"session_id":null,"display_name":profile.model_id.to_string(),
                    "upstream_model_id":"","status":"stopped","last_error":null,
                    "configuration":profile,"profile":profile,"model_metadata":null,
                }));
            }
        }
        serde_json::json!({"protocol_version":1,"host_id":data.host_id,"boot_id":self.boot_id,
            "display_name":data.name,"revision":self.revision.load(Ordering::SeqCst),
            "instances":instances,"gpus":self.gpus,"models":*self.inventory.read().await,
            "inventory_errors":*self.inventory_errors.read().await,
            "launch_profiles":available_profiles,"profile_error":*self.profile_error.read().await,
            "model_management":{"version":1,"downloads":self.downloads.list().await,
                "managed_root":self.downloads.root(),"engine_presets_available":!available_profiles.is_empty()}})
    }
    pub async fn authenticated(&self, request: &Request<Body>) -> bool {
        let Some(token) = request
            .headers()
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
        else {
            return false;
        };
        let data = self.data.lock().await;
        let admin = verifier(&data.pairing_admin_token).finalize().into_bytes();
        if verifier(token).verify_slice(&admin).is_ok() {
            return true;
        }
        let Some((id, _)) = token.split_once('.') else {
            return false;
        };
        let Ok(id) = Uuid::parse_str(id) else {
            return false;
        };
        let Some(grant) = data.clients.get(&id) else {
            return false;
        };
        hex::decode(&grant.token_verifier)
            .ok()
            .is_some_and(|digest| verifier(token).verify_slice(&digest).is_ok())
    }

    async fn local_administrator(&self, request: &Request<Body>) -> bool {
        let Some(token) = request
            .headers()
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
        else {
            return false;
        };
        let data = self.data.lock().await;
        let expected = verifier(&data.pairing_admin_token).finalize().into_bytes();
        verifier(token).verify_slice(&expected).is_ok()
    }
    async fn prepare_launch(&self, request: &LaunchRequest) -> Result<EngineLaunch, String> {
        let model = self
            .inventory
            .read()
            .await
            .iter()
            .find(|m| m.id == request.model_id)
            .cloned()
            .ok_or("model is not installed")?;
        let id = request.instance_id.unwrap_or_else(Uuid::new_v4);
        let metadata = if model.artifact_set {
            inspect_artifact_set(&model.path)?
                .into_iter()
                .find(|m| m.tp_size == model.metadata.tp_size)
                .ok_or("artifact set no longer declares selected degree")?
        } else {
            inspect_artifact(&model.path)?
        };
        if metadata != model.metadata {
            return Err(
                "artifact changed since inventory scan; refresh inventory before loading".into(),
            );
        }
        if let Some(profile_id) = &request.qualified_profile_id {
            let profile = self
                .launch_profiles
                .read()
                .await
                .iter()
                .find(|p| &p.id == profile_id)
                .cloned()
                .ok_or("qualified profile is no longer available; rescan profiles")?;
            if !profile.matches_model(&model)
                || profile.max_context != request.max_context
                || profile.concurrency != request.concurrency
                || serde_json::to_value(&profile.options).map_err(|e| e.to_string())?
                    != serde_json::to_value(&request.options).map_err(|e| e.to_string())?
            {
                return Err("settings no longer match the qualified profile; select it again or use custom settings".into());
            }
            let selected: std::collections::BTreeSet<_> =
                request.gpu_uuids.iter().cloned().collect();
            if selected.len() != request.gpu_uuids.len()
                || !profile
                    .gpu_groups(&self.gpus, &Default::default())
                    .iter()
                    .any(|g| {
                        g.iter().cloned().collect::<std::collections::BTreeSet<_>>() == selected
                    })
            {
                return Err("GPU group is not qualified for this profile".into());
            }
            let path = if model.artifact_set {
                crate::engine_inventory::artifact_set_payload(&model.path, metadata.tp_size)?
            } else {
                model.path.clone()
            };
            tokio::task::spawn_blocking(move || profile.verify_payload(&path))
                .await
                .map_err(|e| e.to_string())??;
        }
        if request.options.draft_tp != 0 && request.options.draft_tp != metadata.draft_tp {
            return Err("draft TP must match the producer-final artifact".into());
        }
        if request.options.spec == "dflash" && metadata.draft_tp == 0 {
            return Err("artifact has no DFlash body".into());
        }
        let qwen = metadata.identity.model_id == "qwen3.8-27b";
        if qwen && request.options.draft_tokens > 7 {
            return Err("Qwen supports at most 7 draft tokens".into());
        }
        let limit = match metadata.identity.model_id.as_str() {
            "qwen3.8-27b" => 262144,
            "muse-glimmer-30b" => 131072,
            _ => return Err("model is not a registered host launch target".into()),
        };
        if request.max_context > limit {
            return Err(format!("context exceeds model maximum of {limit}"));
        }
        let socket = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let port = socket.local_addr().map_err(|e| e.to_string())?.port();
        drop(socket);
        Ok(EngineLaunch {
            instance_id: id,
            artifact: model.path,
            artifact_set: model.artifact_set,
            model_id: format!(
                "{}/{}",
                model.metadata.identity.model_id, model.metadata.identity.weights_id
            ),
            gpu_uuids: request.gpu_uuids.clone(),
            tp: model.metadata.tp_size,
            port,
            max_context: request.max_context,
            concurrency: request.concurrency,
            options: request.options.clone(),
        })
    }
    pub async fn launch(&self, request: LaunchRequest) -> Result<Uuid, String> {
        let _lifecycle = self.lifecycle.lock().await;
        let launch = self.prepare_launch(&request).await?;
        self.start_prepared(request, launch).await
    }
    async fn start_prepared(
        &self,
        mut request: LaunchRequest,
        launch: EngineLaunch,
    ) -> Result<Uuid, String> {
        let id = launch.instance_id;
        self.processes.lock().await.launch(launch)?;
        request.instance_id = Some(id);
        let previous = self.data.lock().await.profiles.insert(id, request);
        if let Err(error) = self.save().await {
            let stopped = self.processes.lock().await.stop(id).await;
            let mut data = self.data.lock().await;
            if let Some(previous) = previous {
                data.profiles.insert(id, previous);
            } else {
                data.profiles.remove(&id);
            }
            self.revision.fetch_add(1, Ordering::SeqCst);
            return Err(match stopped {
                Ok(()) => format!("could not persist launch profile; new process stopped: {error}"),
                Err(stop_error) => format!("could not persist launch profile: {error}; new process could not be stopped: {stop_error}"),
            });
        }
        self.revision.fetch_add(1, Ordering::SeqCst);
        Ok(id)
    }
    async fn stop_instance(&self, id: Uuid, force: bool) -> Result<(), String> {
        self.traffic.lock().unwrap().entry(id).or_default().0 = true;
        let _draining = DrainGuard {
            traffic: self.traffic.clone(),
            id,
        };
        let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
        while !force
            && self
                .traffic
                .lock()
                .unwrap()
                .get(&id)
                .is_some_and(|(_, count)| *count > 0)
        {
            if tokio::time::Instant::now() >= deadline {
                return Err("instance still has active requests; retry after completion or choose force-stop".into());
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let result = self.processes.lock().await.stop(id).await;
        self.revision.fetch_add(1, Ordering::SeqCst);
        result
    }
    pub(crate) async fn inference(
        &self,
        id: Uuid,
        suffix: &str,
        req: &mut Request<Body>,
    ) -> Result<Response<Body>, String> {
        let allowed = match req.method().as_str() {
            "GET" => {
                suffix == "v1/models"
                    || suffix.starts_with("v1/models/")
                    || suffix.starts_with("v1/responses/")
            }
            "POST" => {
                matches!(
                    suffix,
                    "v1/chat/completions"
                        | "v1/chat/completions/count_tokens"
                        | "v1/messages"
                        | "v1/messages/count_tokens"
                        | "v1/responses"
                        | "v1/responses/compact"
                        | "v1/responses/input_tokens"
                ) || (suffix.starts_with("v1/responses/") && suffix.ends_with("/cancel"))
            }
            "DELETE" => suffix
                .strip_prefix("v1/responses/")
                .is_some_and(|id| !id.is_empty() && !id.contains('/')),
            _ => false,
        };
        if !allowed || suffix.contains("..") {
            return Err("unsupported inference route".into());
        }
        let lease = {
            let mut traffic = self.traffic.lock().unwrap();
            let (draining, count) = traffic.entry(id).or_default();
            if *draining {
                return Err("instance is draining".into());
            }
            *count += 1;
            RequestLease {
                traffic: self.traffic.clone(),
                id,
            }
        };
        let (port, key, model, session_id) = self.processes.lock().await.endpoint(id)?;
        if let Some(expected) = req.headers().get("x-ginfer-session-id") {
            if expected.to_str().ok() != Some(session_id.to_string().as_str()) {
                return Err("assigned engine session has changed".into());
            }
        }
        let query = req
            .uri()
            .query()
            .map(|q| format!("?{q}"))
            .unwrap_or_default();
        let mut upstream = self.inference_client
            .request(
                req.method().clone(),
                format!("http://127.0.0.1:{port}/{suffix}{query}"),
            )
            .bearer_auth(key);
        for header in ["accept", "anthropic-version", "anthropic-beta"] {
            if let Some(value) = req.headers().get(header) {
                upstream = upstream.header(header, value);
            }
        }
        if req.method() == hyper::Method::POST {
            let bytes = bounded_body(req, 384 * 1024 * 1024).await?;
            if !bytes.is_empty() {
                let mut body: serde_json::Value =
                    serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
                if !body.is_object() {
                    return Err("inference body must be a JSON object".into());
                }
                body["model"] = model.into();
                upstream = upstream.json(&body);
            }
        }
        let response = upstream.send().await.map_err(|e| e.to_string())?;
        let mut builder = Response::builder().status(response.status());
        for (name, value) in response.headers() {
            if !matches!(
                name.as_str(),
                "connection" | "transfer-encoding" | "content-length" | "keep-alive"
            ) {
                builder = builder.header(name, value);
            }
        }
        let stream = futures_util::stream::try_unfold(
            (response.bytes_stream(), lease),
            |(mut stream, lease)| async move {
                use futures_util::StreamExt;
                match stream.next().await {
                    Some(Ok(bytes)) => Ok(Some((bytes, (stream, lease)))),
                    Some(Err(e)) => Err(e),
                    None => Ok(None),
                }
            },
        );
        builder
            .body(Body::wrap_stream(stream))
            .map_err(|e| e.to_string())
    }
    pub async fn route(
        self: Arc<Self>,
        mut req: Request<Body>,
    ) -> Result<Response<Body>, std::convert::Infallible> {
        let result = self.handle(&mut req).await;
        Ok(result
            .unwrap_or_else(|e| json(StatusCode::BAD_REQUEST, serde_json::json!({"error": e}))))
    }
    async fn handle(self: &Arc<Self>, req: &mut Request<Body>) -> Result<Response<Body>, String> {
        let path = req.uri().path().to_string();
        if req.method() == hyper::Method::GET && path == "/.well-known/ginfer" {
            let data = self.data.lock().await;
            return Ok(json(
                StatusCode::OK,
                serde_json::json!({"protocol_version":1,"host_id":data.host_id,"display_name":data.name}),
            ));
        }
        if req.method() == hyper::Method::POST && path == "/host/v1/pairing" {
            let token = req
                .headers()
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
                .unwrap_or("");
            let data = self.data.lock().await;
            let expected = verifier(&data.pairing_admin_token).finalize().into_bytes();
            if verifier(token).verify_slice(&expected).is_err() {
                return Ok(json(
                    StatusCode::UNAUTHORIZED,
                    serde_json::json!({"error":"local administrator credential required"}),
                ));
            }
            let host_id = data.host_id;
            let fingerprint = data.certificate.fingerprint();
            drop(data);
            let code = self.enable_pairing().await;
            return Ok(json(
                StatusCode::OK,
                serde_json::json!({"host_id":host_id,"certificate_sha256":fingerprint,"code":code,"expires_in_seconds":300}),
            ));
        }
        if req.method() == hyper::Method::POST && path == "/host/v1/pair" {
            let body = body_json(req).await?;
            let code = body
                .get("code")
                .and_then(|v| v.as_str())
                .ok_or("pairing code is required")?;
            let name = body
                .get("client_name")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .ok_or("client name is required")?;
            let mut pairing = self.pairing.lock().await;
            let grant = pairing
                .as_mut()
                .ok_or("pairing is not enabled on this host")?;
            if grant.expires <= tokio::time::Instant::now() || grant.attempts >= 5 {
                return Err("pairing code expired; enable pairing on the host again".into());
            }
            grant.attempts += 1;
            if code != grant.code {
                return Err("incorrect pairing code".into());
            }
            *pairing = None;
            let id = Uuid::new_v4();
            let token = format!(
                "{id}.{}{}",
                Uuid::new_v4().simple(),
                Uuid::new_v4().simple()
            );
            let mut data = self.data.lock().await;
            data.clients.insert(
                id,
                ClientGrant {
                    name: name.into(),
                    token_verifier: hex::encode(verifier(&token).finalize().into_bytes()),
                },
            );
            let host_id = data.host_id;
            drop(data);
            self.save().await?;
            return Ok(json(
                StatusCode::OK,
                serde_json::json!({"host_id":host_id,"client_id":id,"token":token}),
            ));
        }
        if !self.authenticated(req).await {
            return Ok(json(
                StatusCode::UNAUTHORIZED,
                serde_json::json!({"error":"invalid host credential"}),
            ));
        }
        if let Some(tail) = path.strip_prefix("/host/v1/instances/") {
            if let Some((id, operation)) = tail.split_once('/') {
                let id = Uuid::parse_str(id).map_err(|e| e.to_string())?;
                if req.method() == hyper::Method::POST && operation == "local-connection" {
                    if !self.local_administrator(req).await {
                        return Ok(json(
                            StatusCode::FORBIDDEN,
                            serde_json::json!({"error":"local administrator credential required"}),
                        ));
                    }
                    let (_, _, model_id, session_id) = self.processes.lock().await.endpoint(id)?;
                    let mut routes = self.local_inference.lock().await;
                    if !routes
                        .get(&id)
                        .is_some_and(|route| route.session_id == session_id)
                    {
                        routes.insert(
                            id,
                            crate::local_inference::LocalInference::bind(self, id, session_id)?,
                        );
                    }
                    let route = &routes[&id];
                    return Ok(json(
                        StatusCode::OK,
                        serde_json::json!({"instance_id":id,"session_id":session_id,
                        "model_id":model_id,"port":route.port,"api_key":route.api_key}),
                    ));
                }
                if let Some(suffix) = operation.strip_prefix("inference/") {
                    return self.inference(id, suffix, req).await;
                }
                if req.method() == hyper::Method::POST
                    && matches!(operation, "start" | "stop" | "restart" | "reload")
                {
                    let body = body_json(req).await?;
                    let _lifecycle = self.lifecycle.lock().await;
                    if let Some(expected) = body.get("expected_session_id") {
                        let expected: Option<Uuid> = serde_json::from_value(expected.clone())
                            .map_err(|e| format!("invalid expected session: {e}"))?;
                        let current = self.processes.lock().await.instances()
                            .find(|instance| instance.instance_id == id)
                            .map(|instance| instance.session_id);
                        if current != expected {
                            return Ok(json(StatusCode::CONFLICT,
                                serde_json::json!({"error":"assigned engine session has changed"})));
                        }
                    }
                    let force = body.get("force").and_then(|v| v.as_bool()).unwrap_or(false);
                    if matches!(operation, "start" | "restart")
                        && body.get("configuration").is_some()
                    {
                        return Err("start and restart use saved settings; use reload to change configuration".into());
                    }
                    let reload = if operation != "stop" {
                        let mut profile: LaunchRequest =
                            if let Some(config) = body.get("configuration") {
                                serde_json::from_value(config.clone()).map_err(|e| e.to_string())?
                            } else {
                                self.data
                                    .lock()
                                    .await
                                    .profiles
                                    .get(&id)
                                    .cloned()
                                    .ok_or("instance has no saved launch profile")?
                            };
                        profile.instance_id = Some(id);
                        let launch = self.prepare_launch(&profile).await?;
                        self.processes
                            .lock()
                            .await
                            .validate_launch(&launch, operation != "start")?;
                        Some((profile, launch))
                    } else {
                        None
                    };
                    let has_process = self
                        .processes
                        .lock()
                        .await
                        .instances()
                        .any(|i| i.instance_id == id);
                    if has_process && operation != "start" {
                        self.stop_instance(id, force).await?;
                    } else if reload.is_none() && !self.data.lock().await.profiles.contains_key(&id)
                    {
                        return Err("unknown instance".into());
                    }
                    if let Some((profile, launch)) = reload {
                        self.start_prepared(profile, launch).await?;
                    }
                    return Ok(json(StatusCode::OK, self.snapshot().await));
                }
            }
        }
        if req.method() == hyper::Method::DELETE {
            if let Some(id) = path.strip_prefix("/host/v1/clients/") {
                let id = Uuid::parse_str(id).map_err(|e| e.to_string())?;
                self.data.lock().await.clients.remove(&id);
                self.save().await?;
                return Ok(json(StatusCode::OK, serde_json::json!({"revoked":id})));
            }
        }
        match (req.method().as_str(), path.as_str()) {
            ("POST", "/host/v1/local-engine") => {
                if !self.local_administrator(req).await {
                    return Ok(json(StatusCode::FORBIDDEN, serde_json::json!({"error":"local administrator credential required"})));
                }
                let body = body_json(req).await?;
                let executable: PathBuf = serde_json::from_value(body["path"].clone()).map_err(|e| e.to_string())?;
                let _lifecycle = self.lifecycle.lock().await;
                self.processes.lock().await.configure_executable(executable)?;
                Ok(json(StatusCode::OK, serde_json::json!({"ok":true})))
            }
            ("POST", "/host/v1/local-artifacts") => {
                if !self.local_administrator(req).await {
                    return Ok(json(
                        StatusCode::FORBIDDEN,
                        serde_json::json!({"error":"local administrator credential required"}),
                    ));
                }
                #[derive(Deserialize)]
                #[serde(deny_unknown_fields)]
                struct LocalArtifact {
                    path: PathBuf,
                }
                let request: LocalArtifact =
                    serde_json::from_value(body_json(req).await?).map_err(|e| e.to_string())?;
                if !request.path.is_absolute() {
                    return Err("local artifact path must be absolute".into());
                }
                let path = request.path.canonicalize().map_err(|e| e.to_string())?;
                if path.extension().and_then(|s| s.to_str()) != Some("ginfer") {
                    return Err("local registration requires a .ginfer container".into());
                }
                let inspect_path = path.clone();
                tokio::task::spawn_blocking(move || inspect_artifact(&inspect_path))
                    .await
                    .map_err(|e| e.to_string())??;
                let _lifecycle = self.lifecycle.lock().await;
                let added = {
                    let mut data = self.data.lock().await;
                    if data.local_artifacts.contains(&path) {
                        false
                    } else {
                        data.local_artifacts.push(path.clone());
                        true
                    }
                };
                if let Err(error) = self.save().await {
                    if added {
                        self.data
                            .lock()
                            .await
                            .local_artifacts
                            .retain(|p| p != &path);
                    }
                    return Err(error);
                }
                self.scan().await?;
                let entry = self
                    .inventory
                    .read()
                    .await
                    .iter()
                    .find(|m| m.path == path)
                    .cloned()
                    .ok_or("artifact could not be inventoried; inspect host inventory errors")?;
                Ok(json(
                    StatusCode::OK,
                    serde_json::to_value(entry).map_err(|e| e.to_string())?,
                ))
            }
            ("POST", "/host/v1/profile-launch") => {
                #[derive(Deserialize)]
                #[serde(deny_unknown_fields)]
                struct Selection {
                    profile_id: String,
                    model_id: Uuid,
                    gpu_uuids: Vec<String>,
                    instance_id: Option<Uuid>,
                    #[serde(default)]
                    force: bool,
                    #[serde(default)]
                    expected_session_id: Option<Uuid>,
                }
                let body = body_json(req).await?;
                let selection: Selection =
                    serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
                let _lifecycle = self.lifecycle.lock().await;
                if let Some(id) = selection.instance_id {
                    if body.get("expected_session_id").is_some() {
                        let current = self.processes.lock().await.instances()
                            .find(|instance| instance.instance_id == id)
                            .map(|instance| instance.session_id);
                        if current != selection.expected_session_id {
                            return Ok(json(StatusCode::CONFLICT,
                                serde_json::json!({"error":"assigned engine session has changed"})));
                        }
                    }
                    if !self.data.lock().await.profiles.contains_key(&id) {
                        return Err("unknown instance".into());
                    }
                }
                let profile = self
                    .launch_profiles
                    .read()
                    .await
                    .iter()
                    .find(|p| p.id == selection.profile_id)
                    .cloned()
                    .ok_or("unknown qualified profile")?;
                let request = LaunchRequest {
                    instance_id: selection.instance_id,
                    qualified_profile_id: Some(profile.id),
                    model_id: selection.model_id,
                    gpu_uuids: selection.gpu_uuids,
                    max_context: profile.max_context,
                    concurrency: profile.concurrency,
                    options: profile.options,
                };
                let launch = self.prepare_launch(&request).await?;
                self.processes
                    .lock()
                    .await
                    .validate_launch(&launch, selection.instance_id.is_some())?;
                if let Some(id) = selection.instance_id {
                    if self
                        .processes
                        .lock()
                        .await
                        .instances()
                        .any(|i| i.instance_id == id)
                    {
                        self.stop_instance(id, selection.force).await?;
                    }
                }
                let id = self.start_prepared(request, launch).await?;
                Ok(json(StatusCode::OK, serde_json::json!({"instance_id":id})))
            }
            ("POST", "/host/v1/remove-model") => {
                let body = body_json(req).await?;
                let id = body["model_id"]
                    .as_str()
                    .ok_or("model id required")?
                    .parse::<Uuid>()
                    .map_err(|e| e.to_string())?;
                let _lifecycle = self.lifecycle.lock().await;
                let model = self
                    .inventory
                    .read()
                    .await
                    .iter()
                    .find(|m| m.id == id)
                    .cloned()
                    .ok_or("unknown model")?;
                let processes = self.processes.lock().await;
                if processes.instances().any(|i| {
                    i.launch.artifact == model.path
                        && !matches!(
                            i.status,
                            crate::engine_registry::InstanceStatus::Stopped
                                | crate::engine_registry::InstanceStatus::Failed
                        )
                }) {
                    return Err("stop every instance using this package before removing it".into());
                }
                drop(processes);
                self.downloads.remove_installed(&model.path).await?;
                self.data
                    .lock()
                    .await
                    .profiles
                    .retain(|_, p| p.model_id != id);
                self.scan().await?;
                Ok(json(StatusCode::OK, self.snapshot().await))
            }
            ("GET", "/host/v1/downloads") => Ok(json(StatusCode::OK, serde_json::to_value(self.downloads.list().await).map_err(|e| e.to_string())?)),
            ("POST", "/host/v1/downloads") => {
                let release: crate::model_downloads::Release =
                    serde_json::from_value(body_json(req).await?).map_err(|e| e.to_string())?;
                release.validate()?;
                if release.compatible_group(&self.gpus).is_none() {
                    return Err("release has no qualified homogeneous GPU group on this host; compute capability and per-GPU memory must match".into());
                }
                Ok(json(
                    StatusCode::OK,
                    serde_json::to_value(self.downloads.enqueue(release).await?)
                        .map_err(|e| e.to_string())?,
                ))
            }
            ("POST", "/host/v1/download-actions") => {
                let body = body_json(req).await?;
                let id = body["id"]
                    .as_str()
                    .ok_or("download id required")?
                    .parse::<Uuid>()
                    .map_err(|e| e.to_string())?;
                self.downloads
                    .action(
                        id,
                        body["action"].as_str().ok_or("download action required")?,
                    )
                    .await?;
                Ok(json(StatusCode::OK, serde_json::json!({"ok":true})))
            }
            ("GET", "/host/v1/snapshot") => Ok(json(StatusCode::OK, self.snapshot().await)),
            ("POST", "/host/v1/scan") => {
                self.scan().await?;
                Ok(json(StatusCode::OK, self.snapshot().await))
            }
            ("POST", "/host/v1/instances") => {
                let request: LaunchRequest =
                    serde_json::from_value(body_json(req).await?).map_err(|e| e.to_string())?;
                let id = self.launch(request).await?;
                Ok(json(
                    StatusCode::ACCEPTED,
                    serde_json::json!({"instance_id":id}),
                ))
            }
            _ => Ok(json(
                StatusCode::NOT_FOUND,
                serde_json::json!({"error":"unknown host route"}),
            )),
        }
    }
}
pub fn json(status: StatusCode, body: serde_json::Value) -> Response<Body> {
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .header("cache-control", "no-store")
        .body(Body::from(body.to_string()))
        .unwrap()
}
async fn body_json(req: &mut Request<Body>) -> Result<serde_json::Value, String> {
    serde_json::from_slice(&bounded_body(req, 1024 * 1024).await?).map_err(|e| e.to_string())
}

#[cfg(all(test, unix))]
mod lifecycle_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[tokio::test]
    async fn inventory_reports_rejections_and_recovers_on_rescan() {
        let dir = tempfile::tempdir().unwrap();
        let models = dir.path().join("models");
        std::fs::create_dir(&models).unwrap();
        let broken = models.join("broken.ginfer");
        std::fs::write(&broken, b"not an artifact").unwrap();
        let missing = dir.path().join("missing-set.json");
        let host = Host::open(
            dir.path().join("state"),
            "Test".into(),
            std::env::current_exe().unwrap(),
            vec![models],
            vec![missing],
            vec![],
        )
        .await
        .unwrap();
        let snapshot = host.snapshot().await;
        assert_eq!(snapshot["models"].as_array().unwrap().len(), 0);
        assert_eq!(snapshot["inventory_errors"].as_array().unwrap().len(), 2);
        std::fs::remove_file(&broken).unwrap();
        host.scan().await.unwrap();
        let snapshot = host.snapshot().await;
        assert_eq!(snapshot["inventory_errors"].as_array().unwrap().len(), 1);
        assert!(snapshot["inventory_errors"][0]["path"]
            .as_str()
            .unwrap()
            .ends_with("missing-set.json"));
    }

    #[tokio::test]
    async fn invalid_reload_preserves_session_and_restart_preserves_profile() {
        let dir = tempfile::tempdir().unwrap();
        let engine = dir.path().join("engine");
        std::fs::write(&engine, "#!/bin/sh\nexec sleep 60\n").unwrap();
        std::fs::set_permissions(&engine, std::fs::Permissions::from_mode(0o700)).unwrap();
        let models = dir.path().join("models");
        std::fs::create_dir(&models).unwrap();
        let metadata = serde_json::json!({"identity":{"model_id":"muse-glimmer-30b","weights_id":"nvfp4"},"tp_size":1,"draft_tp":0,"objects":[{}]}).to_string();
        let mut artifact = b"NINFER\0\x03".to_vec();
        artifact.extend((metadata.len() as u64).to_le_bytes());
        artifact.extend(metadata.as_bytes());
        artifact.resize(4096, 0);
        std::fs::write(models.join("model.ginfer"), artifact).unwrap();
        let gpus = vec![Gpu {
            uuid: "GPU-test".into(),
            name: "Test".into(),
            memory_mib: 32768,
            compute_capability: Some("12.0".into()),
        }];
        let host = Host::open(
            dir.path().join("state"),
            "Test".into(),
            engine.clone(),
            vec![models.clone()],
            vec![],
            gpus.clone(),
        )
        .await
        .unwrap();
        let profile = LaunchRequest {
            instance_id: None,
            qualified_profile_id: None,
            model_id: host.inventory.read().await[0].id,
            gpu_uuids: vec!["GPU-test".into()],
            max_context: 8192,
            concurrency: 1,
            options: LaunchOptions::default(),
        };
        let id = host.launch(profile.clone()).await.unwrap();
        let before = host.snapshot().await;
        let token = format!("{}.test", Uuid::new_v4());
        let client_id = Uuid::parse_str(token.split_once('.').unwrap().0).unwrap();
        host.data.lock().await.clients.insert(
            client_id,
            ClientGrant {
                name: "Test".into(),
                token_verifier: hex::encode(verifier(&token).finalize().into_bytes()),
            },
        );
        let mut invalid = profile;
        invalid.gpu_uuids = vec!["GPU-missing".into()];
        let req = Request::post(format!("/host/v1/instances/{id}/reload"))
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from(
                serde_json::json!({"configuration":invalid}).to_string(),
            ))
            .unwrap();
        let response = host.clone().route(req).await.unwrap();
        assert!(!response.status().is_success());
        let after = host.snapshot().await;
        assert_eq!(
            before["instances"][0]["session_id"],
            after["instances"][0]["session_id"]
        );
        assert_eq!(after["instances"][0]["status"], "starting");
        let mut session = after["instances"][0]["session_id"].clone();
        for (operation, expected_success, expected_status) in [
            ("start", false, "starting"),
            ("restart", true, "starting"),
            ("stop", true, "stopped"),
            ("start", true, "starting"),
        ] {
            let req = Request::post(format!("/host/v1/instances/{id}/{operation}"))
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from("{}"))
                .unwrap();
            let response = host.clone().route(req).await.unwrap();
            assert_eq!(response.status().is_success(), expected_success);
            let snapshot = host.snapshot().await;
            assert_eq!(snapshot["instances"][0]["status"], expected_status);
            let next = snapshot["instances"][0]["session_id"].clone();
            if expected_success && operation != "stop" {
                assert_ne!(next, session);
            } else {
                assert_eq!(next, session);
            }
            assert_eq!(snapshot["instances"][0]["profile"]["max_context"], 8192);
            session = next;
        }
        for operation in ["stop", "restart", "reload"] {
            let request = Request::post(format!("/host/v1/instances/{id}/{operation}"))
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(serde_json::json!({
                    "expected_session_id":before["instances"][0]["session_id"]
                }).to_string())).unwrap();
            let response = host.clone().route(request).await.unwrap();
            assert_eq!(response.status(), StatusCode::CONFLICT);
            let unchanged = host.snapshot().await;
            assert_eq!(unchanged["instances"][0]["session_id"], session);
            assert_eq!(unchanged["instances"][0]["status"], "starting");
        }
        let mut qualified = crate::launch_profiles::LaunchProfile {
            id: "fixture-c4".into(),
            name: "Synthetic lifecycle fixture".into(),
            platform: std::env::consts::OS.into(),
            identity: host.inventory.read().await[0].metadata.identity.clone(),
            artifact_sha256: {
                use sha2::Digest;
                hex::encode(Sha256::digest(
                    std::fs::read(models.join("model.ginfer")).unwrap(),
                ))
            },
            artifact_bytes: 4096,
            tp: 1,
            draft_tp: 0,
            gpu_name: "Test".into(),
            compute_capability: "12.0".into(),
            vram_tier_gib: 32,
            min_memory_mib_per_gpu: 32000,
            max_context: 8192,
            concurrency: 4,
            options: LaunchOptions {
                kv_arena_bytes: Some(4096),
                ..LaunchOptions::default()
            },
            qualification: crate::launch_profiles::Qualification {
                tier: crate::launch_profiles::QualificationTier::FullContextTested,
                calculation: None,
                smoke_requests: None,
                evidence: "synthetic fixture only".into(),
                engine_revision: "fixture".into(),
                free_bytes_per_gpu: Some(crate::launch_profiles::HEADROOM_BYTES),
                full_context_requests: 4,
            },
        };
        qualified.validate().unwrap();
        host.launch_profiles.write().await.push(qualified.clone());
        let selection = serde_json::json!({"profile_id":qualified.id,"model_id":host.inventory.read().await[0].id,
            "gpu_uuids":["GPU-test"],"instance_id":id});
        let mut stale_selection = selection.clone();
        stale_selection["expected_session_id"] = before["instances"][0]["session_id"].clone();
        let stale = Request::post("/host/v1/profile-launch")
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from(stale_selection.to_string())).unwrap();
        assert_eq!(host.clone().route(stale).await.unwrap().status(), StatusCode::CONFLICT);
        assert_eq!(host.snapshot().await["instances"][0]["session_id"], session);
        let switch = || {
            Request::post("/host/v1/profile-launch")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(selection.to_string()))
                .unwrap()
        };
        assert!(host
            .clone()
            .route(switch())
            .await
            .unwrap()
            .status()
            .is_success());
        let snapshot = host.snapshot().await;
        assert_eq!(snapshot["instances"][0]["profile"]["concurrency"], 4);
        assert_eq!(
            snapshot["instances"][0]["profile"]["qualified_profile_id"],
            "fixture-c4"
        );
        assert_ne!(snapshot["instances"][0]["session_id"], session);
        session = snapshot["instances"][0]["session_id"].clone();
        qualified.artifact_sha256 = "0".repeat(64);
        *host.launch_profiles.write().await = vec![qualified];
        assert!(!host
            .clone()
            .route(switch())
            .await
            .unwrap()
            .status()
            .is_success());
        assert_eq!(host.snapshot().await["instances"][0]["session_id"], session);
        let current = host.snapshot().await;
        let engine_port = current["instances"][0]["configuration"]["port"]
            .as_u64()
            .unwrap() as u16;
        let public_model = current["instances"][0]["upstream_model_id"]
            .as_str()
            .unwrap()
            .to_string();
        let upstream = hyper::Server::bind(&([127, 0, 0, 1], engine_port).into()).serve(
            hyper::service::make_service_fn(move |_| {
                let model = public_model.clone();
                async move {
                    Ok::<_, std::convert::Infallible>(hyper::service::service_fn(
                        move |request: Request<Body>| {
                            let model = model.clone();
                            async move {
                                Ok::<_, std::convert::Infallible>(json(
                                    StatusCode::OK,
                                    if request.uri().path() == "/v1/models" {
                                        serde_json::json!({"data":[{"id":model}]})
                                    } else {
                                        serde_json::json!({"fixture":"forwarded"})
                                    },
                                ))
                            }
                        },
                    ))
                }
            }),
        );
        let upstream = tokio::spawn(upstream);
        host.processes.lock().await.refresh().await.unwrap();
        let denied = Request::post(format!("/host/v1/instances/{id}/local-connection"))
            .header("authorization", format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            host.clone().route(denied).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
        let administrator = host.data.lock().await.pairing_admin_token.clone();
        let request = Request::post(format!("/host/v1/instances/{id}/local-connection"))
            .header("authorization", format!("Bearer {administrator}"))
            .body(Body::empty())
            .unwrap();
        let response = host.clone().route(request).await.unwrap();
        assert!(response.status().is_success());
        let connection: serde_json::Value =
            serde_json::from_slice(&hyper::body::to_bytes(response.into_body()).await.unwrap())
                .unwrap();
        let api_key = connection["api_key"].as_str().unwrap();
        assert_ne!(api_key, administrator);
        assert!(!host.snapshot().await.to_string().contains(api_key));
        let base = format!("http://127.0.0.1:{}", connection["port"]);
        let client = reqwest::Client::new();
        assert_eq!(
            client
                .get(format!("{base}/v1/models"))
                .send()
                .await
                .unwrap()
                .status(),
            401
        );
        let result = client
            .post(format!("{base}/v1/chat/completions"))
            .bearer_auth(api_key)
            .json(&serde_json::json!({"model":"client-alias","messages":[]}))
            .send()
            .await
            .unwrap();
        assert_eq!(result.status(), 200);
        assert_eq!(
            result.json::<serde_json::Value>().await.unwrap()["fixture"],
            "forwarded"
        );
        host.processes.lock().await.shutdown().await.unwrap();
        assert_eq!(
            client
                .get(format!("{base}/health"))
                .send()
                .await
                .unwrap()
                .status(),
            503
        );
        upstream.abort();
        let restored = Host::open(
            dir.path().join("state"),
            "Test".into(),
            engine,
            vec![models],
            vec![],
            gpus,
        )
        .await
        .unwrap();
        let snapshot = restored.snapshot().await;
        assert_eq!(snapshot["instances"][0]["instance_id"], id.to_string());
        assert_eq!(snapshot["instances"][0]["status"], "stopped");
        assert!(snapshot["instances"][0]["session_id"].is_null());
        assert_eq!(snapshot["instances"][0]["profile"]["max_context"], 8192);
        serde_json::from_value::<crate::engine_registry::HostSnapshot>(snapshot).unwrap();
    }
}
async fn bounded_body(req: &mut Request<Body>, limit: usize) -> Result<Vec<u8>, String> {
    use hyper::body::HttpBody;
    let mut bytes = Vec::new();
    while let Some(chunk) = req.body_mut().data().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        if bytes.len() + chunk.len() > limit {
            return Err("request exceeds host body limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
