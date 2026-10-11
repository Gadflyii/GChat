use std::{collections::BTreeMap, path::PathBuf, sync::{Arc, Mutex}, time::Duration};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use reqwest::{header::HeaderMap, Method, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::TcpListener, time::Instant};
use tokio_util::sync::CancellationToken;

const VAULT_SERVICE: &str = "GChat Workspace connections";
const RECONNECT_REQUIRED: &str = "Provider credentials expired or registration rejected; reconnect in Settings";

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Provider { Google, Microsoft }

impl Provider {
    pub fn as_str(self) -> &'static str { match self { Self::Google => "google", Self::Microsoft => "microsoft" } }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Access { ReadOnly, ReadWrite }

#[derive(Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub provider: Provider,
    pub client_id: String,
    pub tenant: Option<String>,
    pub has_client_secret: bool,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub provider: Provider,
    pub subject: String,
    pub display_name: String,
    pub email: Option<String>,
    pub services: Vec<String>,
    pub access: Access,
    pub granted_scopes: Vec<String>,
    pub needs_reconnect: bool,
    client_id: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
struct Document {
    configs: BTreeMap<Provider, ProviderConfig>,
    accounts: BTreeMap<String, Account>,
    selected_accounts: BTreeMap<Provider, String>,
}

#[derive(Serialize)]
pub struct ServiceScopes { id: &'static str, read_scopes: Vec<String>, write_scopes: Vec<String> }

#[derive(Serialize)]
pub struct AccountsView {
    pub configs: Vec<ProviderConfig>,
    pub accounts: Vec<Account>,
    pub selected_accounts: BTreeMap<Provider, String>,
    pub services: BTreeMap<Provider, Vec<ServiceScopes>>,
    pub active_flows: Vec<AuthFlow>,
}

#[derive(Deserialize)]
pub struct ConfigureRequest {
    pub provider: Provider,
    pub client_id: String,
    pub tenant: Option<String>,
    pub client_secret: Option<String>,
}

#[derive(Clone, Deserialize)]
pub struct AuthRequest {
    pub provider: Provider,
    pub services: Vec<String>,
    pub access: Access,
    pub account_id: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct AuthFlow {
    pub flow_id: String,
    pub provider: Provider,
    pub status: String,
    pub account_id: Option<String>,
    pub error: Option<String>,
}

struct PendingFlow { view: AuthFlow, cancellation: CancellationToken }
struct CachedToken { value: String, expires: Instant, lease: CancellationToken }
#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
    scope: Option<String>,
    token_type: Option<String>,
}

trait Vault: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<String>, String>;
    fn set(&self, key: &str, value: &str) -> Result<(), String>;
    fn delete(&self, key: &str) -> Result<(), String>;
}
struct NativeVault;
impl Vault for NativeVault {
    fn get(&self, key: &str) -> Result<Option<String>, String> {
        let entry = keyring::Entry::new(VAULT_SERVICE, key).map_err(|_| "Workspace secure storage is unavailable")?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("Workspace secure storage could not be read".into()),
        }
    }
    fn set(&self, key: &str, value: &str) -> Result<(), String> {
        keyring::Entry::new(VAULT_SERVICE, key).and_then(|entry| entry.set_password(value))
            .map_err(|_| "Workspace secure storage could not be updated".into())
    }
    fn delete(&self, key: &str) -> Result<(), String> {
        match keyring::Entry::new(VAULT_SERVICE, key).and_then(|entry| entry.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("Workspace secure storage could not be cleared".into()),
        }
    }
}

pub struct AccountsState {
    path: Mutex<Option<PathBuf>>,
    document: Mutex<Document>,
    tokens: Mutex<BTreeMap<String, CachedToken>>,
    flows: Mutex<BTreeMap<Provider, PendingFlow>>,
    operation: tokio::sync::Mutex<()>,
    vault: Arc<dyn Vault>,
    http: Mutex<Option<reqwest::Client>>,
    #[cfg(test)]
    token_endpoint_override: Option<String>,
}

impl Default for AccountsState {
    fn default() -> Self { Self {
        path: Mutex::new(None), document: Mutex::new(Document::default()), tokens: Mutex::new(BTreeMap::new()),
        flows: Mutex::new(BTreeMap::new()), operation: tokio::sync::Mutex::new(()), vault: Arc::new(NativeVault), http: Mutex::new(None),
        #[cfg(test)]
        token_endpoint_override: None,
    } }
}

impl AccountsState {
    pub fn initialize(&self, data: PathBuf) -> Result<(), String> {
        let path = data.join("workspace-connections.json");
        let mut known = self.path.lock().map_err(|_| "Workspace account state unavailable")?;
        if known.as_ref() == Some(&path) { return Ok(()); }
        if known.is_some() { return Err("Workspace data folder changed; restart GChat before account operations".into()); }
        let document = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "Workspace account metadata is invalid")?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Document::default(),
            Err(_) => return Err("Workspace account metadata cannot be read".into()),
        };
        *self.document.lock().map_err(|_| "Workspace account state unavailable")? = document;
        *known = Some(path);
        Ok(())
    }

    fn update(&self, change: impl FnOnce(&mut Document) -> Result<(), String>) -> Result<(), String> {
        let known = self.path.lock().map_err(|_| "Workspace account state unavailable")?;
        let path = known.as_ref().ok_or("Workspace accounts not initialized")?;
        let mut document = self.document.lock().map_err(|_| "Workspace account state unavailable")?;
        let mut next = document.clone();
        change(&mut next)?;
        let bytes = serde_json::to_vec_pretty(&next).map_err(|_| "Workspace metadata cannot be encoded")?;
        ginfer_host::service::write_private(path, &bytes)?;
        *document = next;
        Ok(())
    }

    pub fn view(&self) -> Result<AccountsView, String> {
        let document = self.document.lock().map_err(|_| "Workspace account state unavailable")?;
        Ok(AccountsView { configs: document.configs.values().cloned().collect(), accounts: document.accounts.values().cloned().collect(),
            selected_accounts: document.selected_accounts.clone(), services: [Provider::Google, Provider::Microsoft].into_iter().map(|provider| {
                (provider, service_ids(provider).iter().map(|id| ServiceScopes { id, read_scopes: scopes(provider, id, Access::ReadOnly).unwrap(), write_scopes: scopes(provider, id, Access::ReadWrite).unwrap() }).collect())
            }).collect(), active_flows: self.flows.lock().map_err(|_| "Sign-in state unavailable")?.values().filter(|flow| flow.view.status == "waiting").map(|flow| flow.view.clone()).collect() })
    }

    pub fn resolve_account_id(&self, provider: Provider, requested: &str, service: &str, write: bool) -> Result<String, String> {
        let document = self.document.lock().map_err(|_| "Workspace account state unavailable")?;
        let id = if requested.is_empty() { document.selected_accounts.get(&provider).ok_or("Select a Workspace account in Settings")? } else { requested };
        let account = document.accounts.get(id).ok_or("Workspace account is not connected")?;
        let config = document.configs.get(&provider).ok_or("Configure the provider registration in Settings")?;
        if account.provider != provider || account.client_id != config.client_id || account.needs_reconnect { return Err("Reconnect this Workspace account in Settings".into()); }
        if !account.services.iter().any(|known| known == service) || (write && account.access != Access::ReadWrite) || !has_service_scopes(provider, service, if write { Access::ReadWrite } else { Access::ReadOnly }, &account.granted_scopes)? { return Err("This account has not consented to the requested service/access".into()); }
        Ok(id.to_owned())
    }

    pub fn has_account(&self, provider: Provider, service: &str, write: bool) -> Result<bool, String> {
        let ids = self.view()?.accounts.into_iter().filter(|a| a.provider == provider).map(|a| a.id).collect::<Vec<_>>();
        Ok(ids.iter().any(|id| self.resolve_account_id(provider, id, service, write).is_ok()))
    }

    pub fn prepare(&self, name: &str, mut args: Value) -> Result<Value, String> {
        let tool = super::tool(name).ok_or("Unknown Workspace connector tool")?;
        let requested = match args.get("account_id") { None => "", Some(Value::String(id)) => id.as_str(), _ => return Err("account_id must be a string".into()) };
        let id = self.resolve_account_id(super::provider_for(name)?, requested, tool.service, tool.write)?;
        args.as_object_mut().ok_or("Connector arguments must be an object")?.insert("account_id".into(), id.into());
        Ok(args)
    }

    pub fn select(&self, provider: Provider, id: &str) -> Result<AccountsView, String> {
        self.update(|document| {
            if document.accounts.get(id).is_none_or(|account| account.provider != provider) { return Err("Unknown provider account".into()); }
            document.selected_accounts.insert(provider, id.into()); Ok(())
        })?;
        self.view()
    }

    async fn vault_get(&self, key: String) -> Result<Option<String>, String> {
        let vault = self.vault.clone();
        tokio::task::spawn_blocking(move || vault.get(&key)).await.map_err(|_| "Workspace secure storage task failed")?
    }
    async fn vault_set(&self, key: String, value: String) -> Result<(), String> {
        let vault = self.vault.clone();
        tokio::task::spawn_blocking(move || vault.set(&key, &value)).await.map_err(|_| "Workspace secure storage task failed")?
    }
    async fn vault_delete(&self, key: String) -> Result<(), String> {
        let vault = self.vault.clone();
        tokio::task::spawn_blocking(move || vault.delete(&key)).await.map_err(|_| "Workspace secure storage task failed")?
    }

    fn http_client(&self) -> Result<reqwest::Client, String> {
        let mut client = self.http.lock().map_err(|_| "Workspace HTTP client unavailable")?;
        if client.is_none() { *client = Some(reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(30)).build().map_err(|_| "Workspace HTTP client unavailable")?); }
        client.clone().ok_or_else(|| "Workspace HTTP client unavailable".into())
    }

    pub async fn configure(&self, request: ConfigureRequest) -> Result<AccountsView, String> {
        let _operation = self.operation.lock().await;
        if request.client_id.trim().is_empty() { return Err("Provider application client ID is required".into()); }
        let tenant = if request.provider == Provider::Microsoft { Some(validate_tenant(request.tenant.as_deref().filter(|value| !value.trim().is_empty()).unwrap_or("common"))?) } else { None };
        if request.provider == Provider::Microsoft && request.client_secret.as_ref().is_some_and(|secret| !secret.is_empty()) { return Err("Microsoft desktop sign-in uses a public client, not a client secret".into()); }
        let key = format!("{}:registration", request.provider.as_str());
        let previous = self.vault_get(key.clone()).await?;
        let secret = request.client_secret.or_else(|| previous.clone()).filter(|value| !value.is_empty());
        match &secret { Some(value) => self.vault_set(key.clone(), value.clone()).await?, None => self.vault_delete(key.clone()).await? }
        let config = ProviderConfig { provider: request.provider, client_id: request.client_id.trim().into(), tenant, has_client_secret: secret.is_some() };
        let result = self.update(|document| {
            if document.configs.get(&request.provider).is_some_and(|old| old.client_id != config.client_id || old.tenant != config.tenant) {
                for account in document.accounts.values_mut().filter(|account| account.provider == request.provider) { account.needs_reconnect = true; }
            }
            document.configs.insert(request.provider, config); Ok(())
        });
        if let Err(error) = result {
            match previous { Some(value) => self.vault_set(key, value).await?, None => self.vault_delete(key).await? }
            return Err(error);
        }
        self.invalidate_provider(request.provider);
        self.cancel_provider_flow(request.provider);
        self.view()
    }

    fn invalidate_provider(&self, provider: Provider) {
        if let Ok(document) = self.document.lock() { if let Ok(mut tokens) = self.tokens.lock() {
            tokens.retain(|id, token| { let keep = document.accounts.get(id).is_some_and(|a| a.provider != provider); if !keep { token.lease.cancel(); } keep });
        } }
    }

    fn cancel_provider_flow(&self, provider: Provider) {
        if let Ok(mut flows) = self.flows.lock() { if let Some(flow) = flows.get_mut(&provider).filter(|flow| flow.view.status == "waiting") { flow.cancellation.cancel(); flow.view.status = "cancelled".into(); } }
    }

    fn invalidate_account(&self, id: &str) -> Result<(), String> {
        if let Some(token) = self.tokens.lock().map_err(|_| "Workspace token state unavailable")?.remove(id) { token.lease.cancel(); }
        Ok(())
    }

    pub async fn begin_auth(self: &Arc<Self>, mut request: AuthRequest) -> Result<(AuthFlow, String), String> {
        let _operation = self.operation.lock().await;
        request.services.sort(); request.services.dedup();
        if request.services.is_empty() { return Err("Choose at least one Workspace service".into()); }
        let config = self.view()?.configs.into_iter().find(|c| c.provider == request.provider).ok_or("Configure the provider application client ID first")?;
        if let Some(id) = &request.account_id {
            if self.view()?.accounts.iter().all(|account| &account.id != id || account.provider != request.provider) { return Err("Unknown account to reconnect".into()); }
        }
        let requested_scopes = requested_scopes(request.provider, &request.services, request.access)?;
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await.map_err(|_| "Could not bind the local sign-in callback")?;
        let redirect = format!("http://{}:{}/oauth/callback", if request.provider == Provider::Microsoft { "localhost" } else { "127.0.0.1" }, listener.local_addr().map_err(|_| "Local sign-in callback unavailable")?.port());
        let verifier = random_secret(); let state = random_secret();
        let mut url = Url::parse(&authorization_endpoint(&config)?).map_err(|_| "Invalid provider registration")?;
        url.query_pairs_mut().extend_pairs([("client_id", config.client_id.as_str()), ("redirect_uri", &redirect), ("response_type", "code"), ("scope", &requested_scopes.join(" ")), ("state", &state), ("code_challenge", &pkce_challenge(&verifier)), ("code_challenge_method", "S256")]);
        if request.provider == Provider::Google { url.query_pairs_mut().append_pair("access_type", "offline").append_pair("prompt", "consent"); }
        let flow = AuthFlow { flow_id: uuid::Uuid::new_v4().to_string(), provider: request.provider, status: "waiting".into(), account_id: None, error: None };
        let cancellation = CancellationToken::new();
        {
            let mut flows = self.flows.lock().map_err(|_| "Sign-in state unavailable")?;
            if let Some(previous) = flows.insert(request.provider, PendingFlow { view: flow.clone(), cancellation: cancellation.clone() }) { previous.cancellation.cancel(); }
        }
        let accounts = self.clone(); let flow_id = flow.flow_id.clone();
        tokio::spawn(async move {
            let code = tokio::time::timeout(Duration::from_secs(300), callback_code(listener, &state, &cancellation)).await.map_err(|_| "Sign-in timed out; reconnect from Settings".to_string()).and_then(|value| value);
            // Cancellation never drops the vault/metadata transaction. Publish its result
            // under the same owner lock before Cancel or another flow can proceed.
            let _operation = accounts.operation.lock().await;
            let result = match code { Ok(code) => accounts.finish_auth(&config, &request, &redirect, &verifier, &code, requested_scopes, &cancellation).await, Err(error) => Err(error) };
            accounts.publish_auth_result(request.provider, &flow_id, result);
        });
        Ok((flow, url.into()))
    }

    pub fn auth_status(&self, id: &str) -> Result<AuthFlow, String> {
        self.flows.lock().map_err(|_| "Sign-in state unavailable")?.values().find(|flow| flow.view.flow_id == id).map(|flow| flow.view.clone()).ok_or_else(|| "Sign-in attempt is no longer current".into())
    }
    fn publish_auth_result(&self, provider: Provider, id: &str, result: Result<String, String>) {
        if let Ok(mut flows) = self.flows.lock() { if let Some(pending) = flows.get_mut(&provider).filter(|pending| pending.view.flow_id == id && pending.view.status == "waiting") {
            match result {
                Ok(account) => { pending.view.status = "connected".into(); pending.view.account_id = Some(account); }
                Err(_) if pending.cancellation.is_cancelled() => { pending.view.status = "cancelled".into(); }
                Err(error) => { pending.view.status = "failed".into(); pending.view.error = Some(error); }
            }
        } }
    }
    pub async fn cancel_auth(&self, id: &str) -> Result<AuthFlow, String> {
        {
            let flows = self.flows.lock().map_err(|_| "Sign-in state unavailable")?;
            let flow = flows.values().find(|flow| flow.view.flow_id == id).ok_or("Unknown sign-in attempt")?;
            if flow.view.status == "waiting" { flow.cancellation.cancel(); }
        }
        let _operation = self.operation.lock().await;
        let mut flows = self.flows.lock().map_err(|_| "Sign-in state unavailable")?;
        let flow = flows.values_mut().find(|flow| flow.view.flow_id == id).ok_or("Unknown sign-in attempt")?;
        if flow.view.status == "waiting" { flow.cancellation.cancel(); flow.view.status = "cancelled".into(); }
        Ok(flow.view.clone())
    }

    async fn finish_auth(&self, config: &ProviderConfig, request: &AuthRequest, redirect: &str, verifier: &str, code: &str, requested: Vec<String>, cancellation: &CancellationToken) -> Result<String, String> {
        if cancellation.is_cancelled() { return Err("Sign-in cancelled".into()); }
        if self.view()?.configs.iter().all(|current| current.provider != config.provider || current.client_id != config.client_id || current.tenant != config.tenant) { return Err("Provider registration changed; begin sign-in again".into()); }
        let token = self.exchange(config, vec![("grant_type", "authorization_code".into()), ("code", code.into()), ("redirect_uri", redirect.into()), ("code_verifier", verifier.into())], cancellation).await?;
        let granted = token.scope.as_deref().map(|scope| scope.split_whitespace().map(str::to_owned).collect()).unwrap_or(requested);
        let profile_url = match config.provider { Provider::Google => "https://openidconnect.googleapis.com/v1/userinfo", Provider::Microsoft => "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName" };
        let profile = tokio::select! { _ = cancellation.cancelled() => return Err("Sign-in cancelled".into()), result = self.http_client()?.get(profile_url).bearer_auth(&token.access_token).send() => result.map_err(|_| "Could not read the signed-in account identity")? };
        if !profile.status().is_success() { return Err("The provider did not authorize account identity access".into()); }
        let profile: Value = tokio::select! { _ = cancellation.cancelled() => return Err("Sign-in cancelled".into()), result = profile.json() => result.map_err(|_| "Invalid provider account identity")? };
        let subject = profile[match config.provider { Provider::Google => "sub", Provider::Microsoft => "id" }].as_str().filter(|s| !s.is_empty()).ok_or("Provider account identity missing")?.to_owned();
        let existing = self.view()?.accounts.into_iter().find(|account| account.provider == config.provider && account.subject == subject);
        if request.account_id.as_ref().is_some_and(|id| existing.as_ref().is_none_or(|account| &account.id != id)) { return Err("Sign-in returned a different account; the existing account was preserved".into()); }
        let id = existing.as_ref().map(|a| a.id.clone()).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let refresh = match token.refresh_token.clone().filter(|value| !value.is_empty()) { Some(value) => value, None if existing.as_ref().is_some_and(|account| account.client_id == config.client_id) => self.vault_get(format!("account:{id}")).await?.ok_or("Provider did not issue offline access; reconnect and consent again")?, None => return Err("Provider did not issue offline access; reconnect and consent again".into()) };
        let services = request.services.iter().filter(|service| has_service_scopes(config.provider, service, Access::ReadOnly, &granted).unwrap_or(false)).cloned().collect::<Vec<_>>();
        if services.is_empty() { return Err("The provider did not grant any requested service; existing account preserved".into()); }
        let account = Account { id: id.clone(), provider: config.provider, subject,
            display_name: profile[match config.provider { Provider::Google => "name", Provider::Microsoft => "displayName" }].as_str().unwrap_or("Workspace account").to_owned(),
            email: profile[match config.provider { Provider::Google => "email", Provider::Microsoft => "mail" }].as_str().or_else(|| profile["userPrincipalName"].as_str()).map(str::to_owned),
            services, access: request.access, granted_scopes: granted, needs_reconnect: false, client_id: config.client_id.clone() };
        if cancellation.is_cancelled() { return Err("Sign-in cancelled".into()); }
        self.persist_account(account, refresh, token).await?;
        Ok(id)
    }

    async fn persist_account(&self, account: Account, refresh: String, token: TokenResponse) -> Result<(), String> {
        let id = account.id.clone();
        let provider = account.provider;
        let key = format!("account:{id}");
        let previous = self.vault_get(key.clone()).await?;
        self.vault_set(key.clone(), refresh).await?;
        let result = self.update(|document| { document.accounts.insert(id.clone(), account); document.selected_accounts.insert(provider, id.clone()); Ok(()) });
        if let Err(error) = result { match previous { Some(value) => self.vault_set(key, value).await?, None => self.vault_delete(key).await? }; return Err(error); }
        self.invalidate_account(&id)?;
        self.cache_token(&id, token)?;
        Ok(())
    }

    async fn exchange(&self, config: &ProviderConfig, mut form: Vec<(&str, String)>, cancellation: &CancellationToken) -> Result<TokenResponse, String> {
        form.push(("client_id", config.client_id.clone()));
        if config.provider == Provider::Google { if let Some(secret) = self.vault_get("google:registration".into()).await? { form.push(("client_secret", secret)); } }
        let endpoint = token_endpoint(config)?;
        #[cfg(test)]
        let endpoint = self.token_endpoint_override.clone().unwrap_or(endpoint);
        let response = tokio::select! { _ = cancellation.cancelled() => return Err("Workspace request cancelled".into()), response = self.http_client()?.post(endpoint).form(&form).send() => response.map_err(|_| "Provider token connection failed")? };
        let status = response.status();
        let response: Value = tokio::select! { _ = cancellation.cancelled() => return Err("Workspace request cancelled".into()), response = response.json() => response.map_err(|_| "Invalid provider token response")? };
        if !status.is_success() {
            if matches!(response.get("error").and_then(Value::as_str), Some("invalid_grant" | "invalid_client" | "unauthorized_client")) { return Err(RECONNECT_REQUIRED.into()); }
            return Err(format!("Provider token authorization failed (HTTP {})", status.as_u16()));
        }
        let token: TokenResponse = serde_json::from_value(response).map_err(|_| "Invalid provider token response")?;
        if token.access_token.is_empty() || token.expires_in == 0 || token.token_type.as_deref().is_some_and(|kind| !kind.eq_ignore_ascii_case("Bearer")) { return Err("Invalid provider token response".into()); }
        Ok(token)
    }

    fn cache_token(&self, id: &str, token: TokenResponse) -> Result<(), String> {
        let mut tokens = self.tokens.lock().map_err(|_| "Workspace token state unavailable")?;
        let lease = tokens.get(id).map(|token| token.lease.clone()).unwrap_or_default();
        let expires = Instant::now().checked_add(Duration::from_secs(token.expires_in.saturating_sub(30))).ok_or("Invalid provider token expiry")?;
        tokens.insert(id.into(), CachedToken { value: token.access_token, expires, lease });
        Ok(())
    }

    async fn token(&self, id: &str, cancellation: &CancellationToken) -> Result<(String, CancellationToken), String> {
        let _operation = tokio::select! { biased; _ = cancellation.cancelled() => return Err("Workspace request cancelled".into()), operation = self.operation.lock() => operation };
        if let Some(token) = self.tokens.lock().map_err(|_| "Workspace token state unavailable")?.get(id).filter(|token| token.expires > Instant::now() && !token.lease.is_cancelled()) { return Ok((token.value.clone(), token.lease.clone())); }
        let account = self.view()?.accounts.into_iter().find(|account| account.id == id).ok_or("Workspace account disconnected")?;
        let config = self.view()?.configs.into_iter().find(|config| config.provider == account.provider && config.client_id == account.client_id).ok_or("Reconnect this Workspace account")?;
        if account.needs_reconnect { return Err("Reconnect this Workspace account in Settings".into()); }
        let refresh = self.vault_get(format!("account:{id}")).await?.ok_or("Workspace refresh token missing; reconnect in Settings")?;
        let response = self.exchange(&config, vec![("grant_type", "refresh_token".into()), ("refresh_token", refresh)], cancellation).await;
        let token = match response { Ok(token) => token, Err(error) => { if error == RECONNECT_REQUIRED { self.invalidate_account(id)?; self.update(|document| { if let Some(account) = document.accounts.get_mut(id) { account.needs_reconnect = true; } Ok(()) })?; } return Err(error); } };
        if let Some(refresh) = &token.refresh_token { self.vault_set(format!("account:{id}"), refresh.clone()).await?; }
        if let Some(scope) = &token.scope {
            let granted = scope.split_whitespace().map(str::to_owned).collect::<Vec<_>>();
            if granted != account.granted_scopes {
                self.invalidate_account(id)?;
                self.update(|document| { let account = document.accounts.get_mut(id).ok_or("Workspace account disconnected")?; account.services.retain(|service| has_service_scopes(account.provider, service, Access::ReadOnly, &granted).unwrap_or(false)); account.granted_scopes = granted; Ok(()) })?;
            }
        }
        self.cache_token(id, token)?;
        let tokens = self.tokens.lock().map_err(|_| "Workspace token state unavailable")?;
        let token = tokens.get(id).ok_or("Workspace token unavailable")?;
        Ok((token.value.clone(), token.lease.clone()))
    }

    pub async fn request_json(&self, provider: Provider, account_id: &str, service: &str, method: Method, url: &str, body: Option<Value>, cancellation: &CancellationToken) -> Result<Value, String> {
        let headers = HeaderMap::new();
        let body = body.map(|body| serde_json::to_vec(&body).map_err(|_| "Connector request cannot be encoded")).transpose()?;
        let mut headers = headers; if body.is_some() { headers.insert(reqwest::header::CONTENT_TYPE, reqwest::header::HeaderValue::from_static("application/json")); }
        let bytes = self.request_bytes(provider, account_id, service, method, url, headers, body, cancellation).await?;
        if bytes.is_empty() { Ok(Value::Null) } else { serde_json::from_slice(&bytes).map_err(|_| "Provider returned invalid JSON".into()) }
    }

    pub async fn request_bytes(&self, provider: Provider, account_id: &str, service: &str, method: Method, url: &str, headers: HeaderMap, body: Option<Vec<u8>>, cancellation: &CancellationToken) -> Result<Vec<u8>, String> {
        if cancellation.is_cancelled() { return Err("Workspace request cancelled".into()); }
        let url = validate_api_url(provider, url)?;
        let write = is_mutation(provider, &method, &url);
        let id = self.resolve_account_id(provider, account_id, service, write)?;
        if headers.contains_key(reqwest::header::AUTHORIZATION) || headers.contains_key(reqwest::header::COOKIE) || headers.contains_key(reqwest::header::PROXY_AUTHORIZATION) { return Err("Connector adapters cannot provide credential headers".into()); }
        let (token, lease) = self.token(&id, cancellation).await?;
        // Re-check metadata after refresh and before sending on a retained account lease.
        self.resolve_account_id(provider, &id, service, write)?;
        if cancellation.is_cancelled() || lease.is_cancelled() { return Err("Workspace request cancelled or account disconnected".into()); }
        let client = self.http_client()?;
        let mut request = client.request(method.clone(), url.clone()).headers(headers).bearer_auth(token);
        if let Some(body) = body { request = request.body(body); }
        let mut response = tokio::select! { _ = cancellation.cancelled() => return Err("Workspace request cancelled".into()), _ = lease.cancelled() => return Err("Workspace account disconnected".into()), result = request.send() => result.map_err(|_| "Provider API connection failed")? };
        if provider == Provider::Microsoft && method == Method::GET && graph_drive_content(&url) && service == "onedrive" && response.status() == reqwest::StatusCode::FOUND {
            let target = response.headers().get(reqwest::header::LOCATION).and_then(|value| value.to_str().ok()).ok_or("Provider download redirect missing")?;
            let target = validate_download_url(target)?;
            // Graph's storage URL is preauthenticated. Never forward the account bearer.
            response = tokio::select! { _ = cancellation.cancelled() => return Err("Workspace request cancelled".into()), _ = lease.cancelled() => return Err("Workspace account disconnected".into()), result = client.get(target).send() => result.map_err(|_| "Provider download connection failed")? };
        }
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            self.invalidate_account(&id)?;
            return Err("Provider API request failed (HTTP 401); credentials will refresh on the next request".into());
        }
        if !response.status().is_success() { return Err(format!("Provider API request failed (HTTP {})", response.status().as_u16())); }
        tokio::select! { _ = cancellation.cancelled() => Err("Workspace request cancelled".into()), _ = lease.cancelled() => Err("Workspace account disconnected".into()), result = response.bytes() => result.map(|bytes| bytes.to_vec()).map_err(|_| "Provider response could not be read".into()) }
    }

    pub async fn disconnect(&self, provider: Provider, id: &str, revoke: bool) -> Result<AccountsView, String> {
        let _operation = self.operation.lock().await;
        if self.view()?.accounts.iter().all(|account| account.id != id || account.provider != provider) { return Err("Unknown provider account".into()); }
        let key = format!("account:{id}");
        let previous = self.vault_get(key.clone()).await?;
        if revoke {
            if provider == Provider::Microsoft { return Err("Microsoft local disconnect does not revoke tenant consent. Remove this app's consent in your Microsoft account/organization portal, then disconnect locally".into()); }
            let refresh = previous.clone().ok_or("Workspace refresh token missing")?;
            let response = self.http_client()?.post("https://oauth2.googleapis.com/revoke").form(&[("token", refresh)]).send().await.map_err(|_| "Provider revocation connection failed; revocation outcome unknown")?;
            if !response.status().is_success() { return Err("Provider revocation failed; account preserved".into()); }
            // Remote revocation is irreversible. Close local leases before subsequent
            // persistence can fail; a retained metadata row must require reconnection.
            self.invalidate_account(id)?;
            self.update(|document| { if let Some(account) = document.accounts.get_mut(id) { account.needs_reconnect = true; } Ok(()) })?;
        }
        self.vault_delete(key.clone()).await?;
        let removed = self.update(|document| { document.accounts.remove(id); if document.selected_accounts.get(&provider).is_some_and(|selected| selected == id) { document.selected_accounts.remove(&provider); } Ok(()) });
        if let Err(error) = removed {
            if let Some(previous) = previous { self.vault_set(key, previous).await?; }
            return Err(error);
        }
        self.invalidate_account(id)?;
        self.cancel_provider_flow(provider);
        self.view()
    }
}

fn random_secret() -> String { let mut bytes = [0u8; 32]; rand::thread_rng().fill_bytes(&mut bytes); URL_SAFE_NO_PAD.encode(bytes) }
fn pkce_challenge(verifier: &str) -> String { URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())) }
fn validate_tenant(tenant: &str) -> Result<String, String> {
    if tenant.is_empty() || !tenant.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.') { return Err("Microsoft tenant must be common, organizations, consumers, a tenant UUID or domain".into()); }
    Ok(tenant.into())
}
fn authorization_endpoint(config: &ProviderConfig) -> Result<String, String> { Ok(match config.provider { Provider::Google => "https://accounts.google.com/o/oauth2/v2/auth".into(), Provider::Microsoft => format!("https://login.microsoftonline.com/{}/oauth2/v2.0/authorize", validate_tenant(config.tenant.as_deref().unwrap_or("common"))?) }) }
fn token_endpoint(config: &ProviderConfig) -> Result<String, String> { Ok(match config.provider { Provider::Google => "https://oauth2.googleapis.com/token".into(), Provider::Microsoft => format!("https://login.microsoftonline.com/{}/oauth2/v2.0/token", validate_tenant(config.tenant.as_deref().unwrap_or("common"))?) }) }
fn service_ids(provider: Provider) -> &'static [&'static str] { match provider { Provider::Google => &["gmail","calendar","drive","docs","sheets","slides","people","tasks"], Provider::Microsoft => &["outlook","calendar","contacts","onedrive","sharepoint","teams","todo","onenote","excel"] } }

fn scopes(provider: Provider, service: &str, access: Access) -> Result<Vec<String>, String> {
    let write = access == Access::ReadWrite;
    let names: Vec<&str> = match (provider, service) {
        (Provider::Google,"gmail") => vec![if write { "https://mail.google.com/" } else { "https://www.googleapis.com/auth/gmail.readonly" }],
        (Provider::Google,"calendar") => vec![if write { "https://www.googleapis.com/auth/calendar" } else { "https://www.googleapis.com/auth/calendar.readonly" }],
        (Provider::Google,"drive") => vec![if write { "https://www.googleapis.com/auth/drive" } else { "https://www.googleapis.com/auth/drive.readonly" }],
        (Provider::Google,"docs") => vec![if write { "https://www.googleapis.com/auth/documents" } else { "https://www.googleapis.com/auth/documents.readonly" }],
        (Provider::Google,"sheets") => vec![if write { "https://www.googleapis.com/auth/spreadsheets" } else { "https://www.googleapis.com/auth/spreadsheets.readonly" }],
        (Provider::Google,"slides") => vec![if write { "https://www.googleapis.com/auth/presentations" } else { "https://www.googleapis.com/auth/presentations.readonly" }],
        (Provider::Google,"people") => vec![if write { "https://www.googleapis.com/auth/contacts" } else { "https://www.googleapis.com/auth/contacts.readonly" }],
        (Provider::Google,"tasks") => vec![if write { "https://www.googleapis.com/auth/tasks" } else { "https://www.googleapis.com/auth/tasks.readonly" }],
        (Provider::Microsoft,"outlook") => if write { vec!["Mail.ReadWrite","Mail.Send"] } else { vec!["Mail.Read"] },
        (Provider::Microsoft,"calendar") => vec![if write { "Calendars.ReadWrite" } else { "Calendars.Read" }],
        (Provider::Microsoft,"contacts") => vec![if write { "Contacts.ReadWrite" } else { "Contacts.Read" }],
        (Provider::Microsoft,"onedrive") => vec![if write { "Files.ReadWrite" } else { "Files.Read" }],
        (Provider::Microsoft,"sharepoint") => vec![if write { "Sites.ReadWrite.All" } else { "Sites.Read.All" }],
        (Provider::Microsoft,"teams") => if write { vec!["Team.ReadBasic.All","Channel.ReadBasic.All","ChannelMessage.Read.All","Chat.Read","OnlineMeetings.ReadWrite","ChannelMessage.Send","ChatMessage.Send"] } else { vec!["Team.ReadBasic.All","Channel.ReadBasic.All","ChannelMessage.Read.All","Chat.Read","OnlineMeetings.Read"] },
        (Provider::Microsoft,"todo") => vec![if write { "Tasks.ReadWrite" } else { "Tasks.Read" }],
        (Provider::Microsoft,"onenote") => vec![if write { "Notes.ReadWrite" } else { "Notes.Read" }],
        (Provider::Microsoft,"excel") => vec!["Files.ReadWrite"],
        _ => return Err("Unknown Workspace service".into()),
    };
    Ok(names.into_iter().map(str::to_owned).collect())
}
fn requested_scopes(provider: Provider, services: &[String], access: Access) -> Result<Vec<String>, String> {
    let mut requested = match provider { Provider::Google => vec!["openid".into(),"email".into(),"profile".into()], Provider::Microsoft => vec!["openid".into(),"offline_access".into(),"User.Read".into()] };
    for service in services { requested.extend(scopes(provider, service, access)?); }
    requested.sort(); requested.dedup(); Ok(requested)
}

fn has_service_scopes(provider: Provider, service: &str, access: Access, granted: &[String]) -> Result<bool, String> {
    let granted = granted.iter().map(|scope| {
        if provider == Provider::Microsoft { scope.strip_prefix("https://graph.microsoft.com/").unwrap_or(scope).to_ascii_lowercase() } else { scope.clone() }
    }).collect::<Vec<_>>();
    Ok(scopes(provider, service, access)?.iter().all(|required| {
        let required = if provider == Provider::Microsoft { required.to_ascii_lowercase() } else { required.clone() };
        if granted.contains(&required) { return true; }
        match provider {
            Provider::Google => {
                if required == "https://www.googleapis.com/auth/gmail.readonly" { return granted.iter().any(|scope| matches!(scope.as_str(), "https://mail.google.com/" | "https://www.googleapis.com/auth/gmail.modify")); }
                if let Some(write) = required.strip_suffix(".readonly") { if granted.iter().any(|scope| scope == write) { return true; } }
                matches!(service, "docs" | "sheets" | "slides") && (granted.iter().any(|scope| scope == "https://www.googleapis.com/auth/drive") || (access == Access::ReadOnly && granted.iter().any(|scope| scope == "https://www.googleapis.com/auth/drive.readonly")))
            }
            Provider::Microsoft => {
                let write = required.replace(".read", ".readwrite");
                granted.contains(&write) || (matches!(required.as_str(), "files.read" | "files.readwrite") && (granted.contains(&format!("{required}.all")) || (required == "files.read" && granted.contains(&"files.readwrite.all".into()))))
            }
        }
    }))
}

fn graph_drive_content(url: &Url) -> bool {
    let parts = url.path().split('/').collect::<Vec<_>>();
    matches!(parts.as_slice(), ["", "v1.0", "drives", drive, "items", item, "content"] if !drive.is_empty() && !item.is_empty())
        || matches!(parts.as_slice(), ["", "v1.0", "drives", drive, "root", "content"] if !drive.is_empty())
}

fn validate_api_url(provider: Provider, raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|_| "Invalid provider API URL")?;
    let allowed = match provider { Provider::Google => matches!(url.host_str(), Some("www.googleapis.com" | "gmail.googleapis.com" | "calendar.googleapis.com" | "drive.googleapis.com" | "docs.googleapis.com" | "sheets.googleapis.com" | "slides.googleapis.com" | "people.googleapis.com" | "tasks.googleapis.com")), Provider::Microsoft => url.host_str() == Some("graph.microsoft.com") };
    if !allowed || url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() || url.port_or_known_default() != Some(443) { return Err("Authenticated requests require an approved provider API origin".into()); }
    Ok(url)
}
fn validate_download_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|_| "Invalid provider download URL")?;
    let host = url.host_str().ok_or("Provider download host missing")?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() || url.port_or_known_default() != Some(443) || url.fragment().is_some() || ![".sharepoint.com",".1drv.com",".onedrive.com"].iter().any(|suffix| host.ends_with(suffix)) { return Err("Provider download redirected outside Microsoft storage".into()); }
    Ok(url)
}
fn is_mutation(provider: Provider, method: &Method, url: &Url) -> bool {
    if *method == Method::GET || *method == Method::HEAD { return false; }
    if *method == Method::POST && ((provider == Provider::Google && url.host_str() == Some("www.googleapis.com") && url.path() == "/calendar/v3/freeBusy") || (provider == Provider::Microsoft && url.path() == "/v1.0/me/calendar/getSchedule")) { return false; }
    true
}

async fn callback_code(listener: TcpListener, expected: &str, cancellation: &CancellationToken) -> Result<String, String> {
    loop {
        let (mut stream, peer) = tokio::select! { _ = cancellation.cancelled() => return Err("Sign-in cancelled".into()), accepted = listener.accept() => accepted.map_err(|_| "Sign-in callback unavailable")? };
        if !peer.ip().is_loopback() { continue; }
        let mut request = Vec::new();
        loop {
            let mut buffer = [0u8; 1024];
            let count = tokio::select! { _ = cancellation.cancelled() => return Err("Sign-in cancelled".into()), read = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut buffer)) => read.map_err(|_| "Sign-in callback timed out")?.map_err(|_| "Sign-in callback could not be read")? };
            if count == 0 { break; } request.extend_from_slice(&buffer[..count]);
            if request.windows(4).any(|part| part == b"\r\n\r\n") || request.len() > 16384 { break; }
        }
        let first = std::str::from_utf8(&request).ok().and_then(|request| request.lines().next()).unwrap_or("");
        let parsed = first.strip_prefix("GET ").and_then(|first| first.split_whitespace().next()).and_then(|path| Url::parse(&format!("http://127.0.0.1{path}")).ok());
        let parsed = match parsed { Some(url) if url.path() == "/oauth/callback" && url.query_pairs().filter(|(key,_)| key == "state").count() == 1 && url.query_pairs().any(|(key,value)| key == "state" && value == expected) => url, _ => { let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await; continue; } };
        let message = b"Sign-in received. Return to GChat to see the result.";
        let reply = format!("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", message.len());
        let _ = stream.write_all(reply.as_bytes()).await; let _ = stream.write_all(message).await;
        if parsed.query_pairs().any(|(key,_)| key == "error") { return Err("Provider sign-in was denied or cancelled".into()); }
        let codes = parsed.query_pairs().filter(|(key,_)| key == "code").map(|(_,value)| value.into_owned()).collect::<Vec<_>>();
        if codes.len() != 1 || codes[0].is_empty() { return Err("Provider authorization code missing".into()); }
        return Ok(codes[0].clone());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Condvar;

    #[derive(Default)]
    struct MemoryVault {
        values: Mutex<BTreeMap<String, String>>,
        gate: Mutex<Option<Arc<VaultGate>>>,
    }
    #[derive(Default)]
    struct VaultGate {
        entered: tokio::sync::Notify,
        released: Mutex<bool>,
        wake: Condvar,
    }
    impl Vault for MemoryVault {
        fn get(&self, key: &str) -> Result<Option<String>, String> { Ok(self.values.lock().unwrap().get(key).cloned()) }
        fn set(&self, key: &str, value: &str) -> Result<(), String> {
            let gate = self.gate.lock().unwrap().clone();
            if let Some(gate) = gate {
                gate.entered.notify_one();
                let (released, _) = gate.wake.wait_timeout_while(gate.released.lock().unwrap(), Duration::from_secs(10), |released| !*released).unwrap();
                if !*released { return Err("Fixture vault gate timed out".into()); }
            }
            self.values.lock().unwrap().insert(key.into(), value.into()); Ok(())
        }
        fn delete(&self, key: &str) -> Result<(), String> { self.values.lock().unwrap().remove(key); Ok(()) }
    }
    fn fixture() -> (tempfile::TempDir, Arc<AccountsState>, Arc<MemoryVault>) {
        let directory = tempfile::tempdir().unwrap();
        let vault = Arc::new(MemoryVault::default());
        let state = Arc::new(AccountsState { vault: vault.clone(), ..AccountsState::default() });
        state.initialize(directory.path().into()).unwrap();
        state.update(|document| { document.configs.insert(Provider::Google, ProviderConfig { provider: Provider::Google, client_id: "fixture-public-client".into(), tenant: None, has_client_secret: false }); Ok(()) }).unwrap();
        (directory, state, vault)
    }
    fn account(id: &str, access: Access) -> Account {
        Account { id: id.into(), provider: Provider::Google, subject: format!("subject-{id}"), display_name: "Fixture account".into(), email: None,
            services: vec!["calendar".into()], access, granted_scopes: scopes(Provider::Google, "calendar", access).unwrap(), needs_reconnect: false, client_id: "fixture-public-client".into() }
    }
    fn token() -> TokenResponse { TokenResponse { access_token: "fixture-access".into(), refresh_token: None, expires_in: 3600, scope: None, token_type: Some("Bearer".into()) } }
    fn break_metadata_write(directory: &tempfile::TempDir) {
        let path = directory.path().join("workspace-connections.json");
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(path).unwrap();
    }

    #[test]
    fn pkce_matches_rfc7636_s256_vector() {
        assert_eq!(pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[tokio::test]
    async fn selected_account_is_frozen_and_partial_consent_blocks_writes() {
        let (_directory, state, _vault) = fixture();
        state.persist_account(account("first", Access::ReadWrite), "first-refresh".into(), token()).await.unwrap();
        let prepared = state.prepare("google.calendar.list", json!({"calendar_id":"primary"})).unwrap();
        state.persist_account(account("second", Access::ReadOnly), "second-refresh".into(), token()).await.unwrap();
        assert_eq!(state.prepare("google.calendar.list", prepared).unwrap()["account_id"], "first");
        state.update(|document| { let account = document.accounts.get_mut("first").unwrap(); account.granted_scopes = scopes(Provider::Google, "calendar", Access::ReadOnly).unwrap(); Ok(()) }).unwrap();
        assert!(state.resolve_account_id(Provider::Google, "first", "calendar", false).is_ok());
        assert!(state.resolve_account_id(Provider::Google, "first", "calendar", true).is_err());
        assert!(state.prepare("google.calendar.list", json!({"account_id":42})).is_err());
        assert!(state.resolve_account_id(Provider::Microsoft, "first", "calendar", false).is_err());
    }

    #[tokio::test]
    async fn failed_account_commit_restores_existing_refresh_and_removes_new_record() {
        let (directory, state, vault) = fixture();
        state.persist_account(account("first", Access::ReadOnly), "old-refresh".into(), token()).await.unwrap();
        break_metadata_write(&directory);
        assert!(state.persist_account(account("first", Access::ReadWrite), "new-refresh".into(), token()).await.is_err());
        assert_eq!(vault.get("account:first").unwrap().as_deref(), Some("old-refresh"));
        assert_eq!(state.view().unwrap().accounts[0].access, Access::ReadOnly);
        assert!(state.persist_account(account("new", Access::ReadOnly), "new-refresh".into(), token()).await.is_err());
        assert!(vault.get("account:new").unwrap().is_none());
        assert_eq!(state.view().unwrap().accounts.len(), 1);
    }

    #[tokio::test]
    async fn disconnect_write_failure_preserves_refresh_selection_and_active_lease() {
        let (directory, state, vault) = fixture();
        state.persist_account(account("first", Access::ReadOnly), "old-refresh".into(), token()).await.unwrap();
        let lease = state.tokens.lock().unwrap()["first"].lease.clone();
        break_metadata_write(&directory);
        assert!(state.disconnect(Provider::Google, "first", false).await.is_err());
        assert_eq!(vault.get("account:first").unwrap().as_deref(), Some("old-refresh"));
        assert_eq!(state.view().unwrap().selected_accounts[&Provider::Google], "first");
        assert!(!lease.is_cancelled());
    }

    #[tokio::test]
    async fn disconnect_cancels_account_lease_and_removes_default() {
        let (_directory, state, vault) = fixture();
        state.persist_account(account("first", Access::ReadOnly), "old-refresh".into(), token()).await.unwrap();
        let lease = state.tokens.lock().unwrap()["first"].lease.clone();
        let view = state.disconnect(Provider::Google, "first", false).await.unwrap();
        assert!(view.accounts.is_empty());
        assert!(!view.selected_accounts.contains_key(&Provider::Google));
        assert!(vault.get("account:first").unwrap().is_none());
        assert!(lease.is_cancelled());
    }

    #[tokio::test]
    async fn cancel_racing_admitted_vault_commit_reports_connected_after_durable_commit() {
        let (_directory, state, vault) = fixture();
        let cancellation = CancellationToken::new();
        state.flows.lock().unwrap().insert(Provider::Google, PendingFlow { view: AuthFlow { flow_id: "flow".into(), provider: Provider::Google, status: "waiting".into(), account_id: None, error: None }, cancellation: cancellation.clone() });
        let gate = Arc::new(VaultGate::default());
        *vault.gate.lock().unwrap() = Some(gate.clone());
        let worker_state = state.clone();
        let worker = tokio::spawn(async move {
            let _operation = worker_state.operation.lock().await;
            let result = worker_state.persist_account(account("first", Access::ReadOnly), "refresh".into(), token()).await.map(|_| "first".into());
            worker_state.publish_auth_result(Provider::Google, "flow", result);
        });
        tokio::time::timeout(Duration::from_secs(5), gate.entered.notified()).await.unwrap();
        let cancel_state = state.clone();
        let cancel = tokio::spawn(async move { cancel_state.cancel_auth("flow").await.unwrap() });
        tokio::time::timeout(Duration::from_secs(5), cancellation.cancelled()).await.unwrap();
        *gate.released.lock().unwrap() = true;
        gate.wake.notify_all();
        worker.await.unwrap();
        assert_eq!(cancel.await.unwrap().status, "connected");
        assert_eq!(state.auth_status("flow").unwrap().account_id.as_deref(), Some("first"));
        assert_eq!(vault.get("account:first").unwrap().as_deref(), Some("refresh"));
        let persisted: Document = serde_json::from_slice(&std::fs::read(state.path.lock().unwrap().as_ref().unwrap()).unwrap()).unwrap();
        assert!(persisted.accounts.contains_key("first"));
    }

    #[tokio::test]
    async fn refresh_rotates_credentials_and_scopes_without_treating_rate_limit_as_revocation() {
        let (_directory, mut state, vault) = fixture();
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        Arc::get_mut(&mut state).unwrap().token_endpoint_override = Some(format!("http://{}/token", listener.local_addr().unwrap()));
        let server = tokio::spawn(async move {
            for (status, body) in [
                (429, json!({"error":"temporarily_unavailable"})),
                (200, json!({"access_token":"rotated-access","refresh_token":"rotated-refresh","expires_in":3600,"token_type":"Bearer","scope":"https://www.googleapis.com/auth/calendar.readonly"})),
                (400, json!({"error":"invalid_grant","error_description":"not exposed"})),
            ] {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                loop {
                    let mut buffer = [0u8; 1024];
                    let count = stream.read(&mut buffer).await.unwrap();
                    assert!(count > 0);
                    request.extend_from_slice(&buffer[..count]);
                    if let Some(end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&request[..end]);
                        let length = headers.lines().find_map(|line| line.to_ascii_lowercase().strip_prefix("content-length:").and_then(|length| length.trim().parse::<usize>().ok())).unwrap_or(0);
                        if request.len() >= end + 4 + length { break; }
                    }
                }
                let body = body.to_string();
                let response = format!("HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                stream.write_all(response.as_bytes()).await.unwrap();
            }
        });
        state.persist_account(account("first", Access::ReadWrite), "original-refresh".into(), token()).await.unwrap();
        let original_lease = state.tokens.lock().unwrap()["first"].lease.clone();
        state.tokens.lock().unwrap().get_mut("first").unwrap().expires = Instant::now();
        let cancellation = CancellationToken::new();
        assert!(state.token("first", &cancellation).await.unwrap_err().contains("429"));
        assert!(!state.view().unwrap().accounts[0].needs_reconnect);
        assert_eq!(vault.get("account:first").unwrap().as_deref(), Some("original-refresh"));
        let (access, lease) = state.token("first", &cancellation).await.unwrap();
        assert_eq!(access, "rotated-access");
        assert!(original_lease.is_cancelled());
        assert!(state.resolve_account_id(Provider::Google, "first", "calendar", false).is_ok());
        assert!(state.resolve_account_id(Provider::Google, "first", "calendar", true).is_err());
        assert_eq!(vault.get("account:first").unwrap().as_deref(), Some("rotated-refresh"));
        state.tokens.lock().unwrap().get_mut("first").unwrap().expires = Instant::now();
        assert_eq!(state.token("first", &cancellation).await.unwrap_err(), RECONNECT_REQUIRED);
        assert!(lease.is_cancelled());
        assert!(state.view().unwrap().accounts[0].needs_reconnect);
        server.await.unwrap();
    }

    #[tokio::test]
    async fn loopback_callback_rejects_wrong_state_and_accepts_bound_code() {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let cancellation = CancellationToken::new();
        let worker = tokio::spawn(async move { callback_code(listener, "bound-state", &cancellation).await.unwrap() });
        let mut wrong = tokio::net::TcpStream::connect(address).await.unwrap();
        wrong.write_all(b"GET /oauth/callback?state=foreign&code=wrong HTTP/1.1\r\nHost: localhost\r\n\r\n").await.unwrap();
        let mut response = Vec::new(); wrong.read_to_end(&mut response).await.unwrap();
        assert!(response.starts_with(b"HTTP/1.1 400"));
        let mut correct = tokio::net::TcpStream::connect(address).await.unwrap();
        correct.write_all(b"GET /oauth/callback?state=bound-state&code=right HTTP/1.1\r\nHost: localhost\r\n\r\n").await.unwrap();
        assert_eq!(tokio::time::timeout(Duration::from_secs(5), worker).await.unwrap().unwrap(), "right");
    }

    #[test]
    fn readonly_post_queries_and_storage_redirects_are_operation_bound() {
        let freebusy = validate_api_url(Provider::Google, "https://www.googleapis.com/calendar/v3/freeBusy").unwrap();
        assert!(!is_mutation(Provider::Google, &Method::POST, &freebusy));
        assert!(is_mutation(Provider::Google, &Method::DELETE, &freebusy));
        let schedule = validate_api_url(Provider::Microsoft, "https://graph.microsoft.com/v1.0/me/calendar/getSchedule").unwrap();
        assert!(!is_mutation(Provider::Microsoft, &Method::POST, &schedule));
        assert!(is_mutation(Provider::Microsoft, &Method::POST, &Url::parse("https://graph.microsoft.com/v1.0/me/messages").unwrap()));
        assert!(graph_drive_content(&Url::parse("https://graph.microsoft.com/v1.0/drives/drive/items/item/content").unwrap()));
        assert!(!graph_drive_content(&Url::parse("https://graph.microsoft.com/v1.0/me/messages/item/content").unwrap()));
        assert!(validate_api_url(Provider::Microsoft, "https://graph.microsoft.com.evil.test/v1.0/me").is_err());
        assert!(validate_api_url(Provider::Google, "https://token@www.googleapis.com/drive/v3/files").is_err());
        assert!(validate_download_url("https://tenant.sharepoint.com/content?opaque=credential").is_ok());
        assert!(validate_download_url("https://tenant.sharepoint.com.evil.test/content").is_err());
        assert!(validate_download_url("http://tenant.sharepoint.com/content").is_err());
        assert!(has_service_scopes(Provider::Microsoft, "calendar", Access::ReadOnly, &["https://graph.microsoft.com/Calendars.ReadWrite".into()]).unwrap());
        assert!(!has_service_scopes(Provider::Microsoft, "outlook", Access::ReadWrite, &["Mail.ReadWrite".into()]).unwrap());
    }
}
