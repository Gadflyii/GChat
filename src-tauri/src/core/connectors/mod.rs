pub mod accounts;
pub mod google;
pub mod microsoft;

pub use accounts::{Access, AccountsState, Provider};
use serde_json::Value;
use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, Manager, Runtime};
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct ConnectorTool {
    pub name: &'static str,
    pub description: &'static str,
    pub service: &'static str,
    pub write: bool,
    pub input_schema: Value,
}

pub struct ConnectedTool {
    pub name: &'static str,
    pub description: String,
    pub service: &'static str,
    pub write: bool,
    pub input_schema: Value,
}

impl From<ConnectorTool> for ConnectedTool {
    fn from(tool: ConnectorTool) -> Self {
        Self { name: tool.name, description: tool.description.into(), service: tool.service, write: tool.write, input_schema: tool.input_schema }
    }
}

pub fn tools() -> &'static [ConnectorTool] {
    static TOOLS: OnceLock<Vec<ConnectorTool>> = OnceLock::new();
    TOOLS.get_or_init(|| google::tools().into_iter().chain(microsoft::tools()).collect())
}

pub fn tool(name: &str) -> Option<&'static ConnectorTool> {
    tools().iter().find(|tool| tool.name == name)
}

pub fn provider_for(name: &str) -> Result<Provider, String> {
    let descriptor = tool(name).ok_or("Unknown Workspace connector tool")?;
    if descriptor.name.starts_with("google.") {
        Ok(Provider::Google)
    } else if descriptor.name.starts_with("microsoft.") {
        Ok(Provider::Microsoft)
    } else {
        Err("Unknown Workspace connector tool".into())
    }
}

pub fn owner<R: Runtime>(app: &AppHandle<R>) -> Result<Arc<AccountsState>, String> {
    if app.try_state::<Arc<AccountsState>>().is_none() {
        app.manage(Arc::new(AccountsState::default()));
    }
    let state = app.try_state::<Arc<AccountsState>>().ok_or("Workspace account owner unavailable")?.inner().clone();
    state.initialize(crate::core::app::commands::get_jan_data_folder_path(app.clone()))?;
    Ok(state)
}

pub fn catalog<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<ConnectedTool>, String> {
    let state = owner(app)?;
    let view = state.view()?;
    let mut catalog = Vec::new();
    for tool in tools() {
        let provider = provider_for(tool.name)?;
        let eligible: Vec<_> = view.accounts.iter().filter(|account| state.resolve_account_id(provider, &account.id, tool.service, tool.write).is_ok()).map(|account| account.id.as_str()).collect();
        if eligible.is_empty() { continue; }
        let mut connected = ConnectedTool::from(tool.clone());
        let grants = view.accounts.iter().filter(|account| eligible.contains(&account.id.as_str())).map(|account| format!("{} ({}, granted scopes: {})", account.id, if account.access == Access::ReadOnly { "read_only" } else { "read_write" }, account.granted_scopes.join(" "))).collect::<Vec<_>>().join("; ");
        connected.description.push_str(&format!(" Connected accounts: {grants}. Selected account: {}. Omitting account_id uses that explicit selection; account and access are checked before approval.", view.selected_accounts.get(&provider).map(String::as_str).unwrap_or("none")));
        catalog.push(connected);
    }
    Ok(catalog)
}

pub fn prepare<R: Runtime>(app: &AppHandle<R>, name: &str, args: Value) -> Result<Value, String> {
    owner(app)?.prepare(name, args)
}

pub async fn execute<R: Runtime>(app: &AppHandle<R>, name: &str, args: Value, cancellation: &CancellationToken) -> Result<Value, String> {
    let state = owner(app)?;
    let args = state.prepare(name, args)?;
    match provider_for(name)? {
        Provider::Google => google::execute(&state, name, &args, cancellation).await,
        Provider::Microsoft => microsoft::execute(&state, name, &args, cancellation).await,
    }
}

#[tauri::command]
pub fn connector_accounts<R: Runtime>(app: AppHandle<R>) -> Result<accounts::AccountsView, String> {
    owner(&app)?.view()
}

#[tauri::command]
pub async fn connector_configure<R: Runtime>(app: AppHandle<R>, request: accounts::ConfigureRequest) -> Result<accounts::AccountsView, String> {
    owner(&app)?.configure(request).await
}

#[tauri::command]
pub async fn connector_begin_auth<R: Runtime>(app: AppHandle<R>, request: accounts::AuthRequest) -> Result<accounts::AuthFlow, String> {
    use tauri_plugin_opener::OpenerExt;
    let state = owner(&app)?;
    let (flow, url) = state.begin_auth(request).await?;
    if app.opener().open_url(url, None::<String>).is_err() {
        state.cancel_auth(&flow.flow_id).await?;
        return Err("Could not open the system browser for sign-in".into());
    }
    Ok(flow)
}

#[tauri::command]
pub fn connector_auth_status<R: Runtime>(app: AppHandle<R>, flow_id: String) -> Result<accounts::AuthFlow, String> {
    owner(&app)?.auth_status(&flow_id)
}

#[tauri::command]
pub async fn connector_cancel_auth<R: Runtime>(app: AppHandle<R>, flow_id: String) -> Result<accounts::AuthFlow, String> {
    owner(&app)?.cancel_auth(&flow_id).await
}

#[tauri::command]
pub fn connector_select_account<R: Runtime>(app: AppHandle<R>, provider: Provider, account_id: String) -> Result<accounts::AccountsView, String> {
    owner(&app)?.select(provider, &account_id)
}

#[tauri::command]
pub async fn connector_disconnect<R: Runtime>(app: AppHandle<R>, provider: Provider, account_id: String, revoke: bool) -> Result<accounts::AccountsView, String> {
    owner(&app)?.disconnect(provider, &account_id, revoke).await
}
