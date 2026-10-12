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
        Self {
            name: tool.name,
            description: tool.description.into(),
            service: tool.service,
            write: tool.write,
            input_schema: tool.input_schema,
        }
    }
}

pub fn tools() -> &'static [ConnectorTool] {
    static TOOLS: OnceLock<Vec<ConnectorTool>> = OnceLock::new();
    TOOLS.get_or_init(|| {
        google::tools()
            .into_iter()
            .chain(microsoft::tools())
            .collect()
    })
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
    let state = app
        .try_state::<Arc<AccountsState>>()
        .ok_or("Workspace account owner unavailable")?
        .inner()
        .clone();
    state.initialize(crate::core::app::commands::get_jan_data_folder_path(
        app.clone(),
    ))?;
    Ok(state)
}

pub fn catalog<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<ConnectedTool>, String> {
    let state = owner(app)?;
    catalog_for_accounts(&state, None)
}

fn catalog_for_accounts(
    state: &AccountsState,
    linked: Option<&[String]>,
) -> Result<Vec<ConnectedTool>, String> {
    let view = state.view()?;
    let mut catalog = Vec::new();
    for tool in tools() {
        let provider = provider_for(tool.name)?;
        let eligible: Vec<_> = view
            .accounts
            .iter()
            .filter(|account| {
                if linked.is_some_and(|ids| !ids.contains(&account.id)) {
                    return false;
                }
                state
                    .resolve_account_id(provider, &account.id, tool.service, tool.write)
                    .is_ok()
            })
            .map(|account| account.id.as_str())
            .collect();
        if eligible.is_empty() {
            continue;
        }
        let mut connected = ConnectedTool::from(tool.clone());
        let grants = view
            .accounts
            .iter()
            .filter(|account| eligible.contains(&account.id.as_str()))
            .map(|account| {
                format!(
                    "{} ({}, granted scopes: {})",
                    account.id,
                    if account.access == Access::ReadOnly {
                        "read_only"
                    } else {
                        "read_write"
                    },
                    account.granted_scopes.join(" ")
                )
            })
            .collect::<Vec<_>>()
            .join("; ");
        if linked.is_some() {
            connected.description.push_str(&format!(" This bot's linked accounts: {grants}. Omitting account_id selects the sole eligible linked account; choose account_id explicitly when several are linked. Account and access are checked before approval."));
        } else {
            connected.description.push_str(&format!(" Connected accounts: {grants}. Selected account: {}. Omitting account_id uses that explicit selection; account and access are checked before approval.", view.selected_accounts.get(&provider).map(String::as_str).unwrap_or("none")));
        }
        catalog.push(connected);
    }
    Ok(catalog)
}

fn prepare_linked(
    state: &AccountsState,
    linked: &[String],
    name: &str,
    mut args: Value,
) -> Result<Value, String> {
    let descriptor = tool(name).ok_or("Unknown Workspace connector tool")?;
    let provider = provider_for(name)?;
    let object = args
        .as_object_mut()
        .ok_or("Connector arguments must be an object")?;
    let requested = match object.get("account_id") {
        Some(value) => Some(
            value
                .as_str()
                .filter(|id| !id.is_empty())
                .ok_or("Choose a linked account_id")?
                .to_owned(),
        ),
        None => None,
    };
    let account_id = if let Some(id) = requested {
        if !linked.contains(&id) {
            return Err("This Workspace account is not linked to this bot".into());
        }
        state.resolve_account_id(provider, &id, descriptor.service, descriptor.write)?
    } else {
        let eligible = linked
            .iter()
            .filter_map(|id| {
                state
                    .resolve_account_id(provider, id, descriptor.service, descriptor.write)
                    .ok()
            })
            .collect::<Vec<_>>();
        match eligible.as_slice() {
            [id] => id.clone(),
            [] => return Err("Link an eligible Workspace account to this bot first".into()),
            _ => return Err("Choose account_id from this bot's linked accounts".into()),
        }
    };
    object.insert("account_id".into(), Value::String(account_id));
    state.prepare(name, args)
}

/// Bot service callback into the same native account and provider owners as Chat/Code.
pub struct BotConnectorHost<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> BotConnectorHost<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: Runtime> gbot_service::connectors::ConnectorHost for BotConnectorHost<R> {
    fn accounts(
        &self,
    ) -> gbot_service::connectors::ConnectorFuture<
        '_,
        Vec<gbot_service::connectors::ConnectorAccount>,
    > {
        Box::pin(async {
            Ok(owner(&self.app)?
                .view()?
                .accounts
                .into_iter()
                .map(|account| gbot_service::connectors::ConnectorAccount {
                    id: account.id,
                    provider: account.provider.as_str().into(),
                    display_name: account.display_name,
                    email: account.email,
                    services: account.services,
                    access: if account.access == Access::ReadOnly {
                        "read_only"
                    } else {
                        "read_write"
                    }
                    .into(),
                    granted_scopes: account.granted_scopes,
                    needs_reconnect: account.needs_reconnect,
                })
                .collect())
        })
    }

    fn catalog<'a>(
        &'a self,
        linked: &'a [String],
    ) -> gbot_service::connectors::ConnectorFuture<'a, Vec<gbot_service::connectors::ConnectorTool>>
    {
        Box::pin(async move {
            let state = owner(&self.app)?;
            Ok(catalog_for_accounts(&state, Some(linked))?
                .into_iter()
                .map(|tool| gbot_service::connectors::ConnectorTool {
                    name: tool.name.into(),
                    description: tool.description,
                    input_schema: tool.input_schema,
                    write: tool.write,
                })
                .collect())
        })
    }

    fn prepare<'a>(
        &'a self,
        linked: &'a [String],
        name: &'a str,
        arguments: Value,
    ) -> gbot_service::connectors::ConnectorFuture<'a, gbot_service::connectors::PreparedConnector>
    {
        Box::pin(async move {
            let state = owner(&self.app)?;
            let arguments = prepare_linked(&state, linked, name, arguments)?;
            Ok(gbot_service::connectors::PreparedConnector {
                name: name.into(),
                account_id: arguments["account_id"]
                    .as_str()
                    .ok_or("Missing connector account")?
                    .into(),
                arguments,
                write: tool(name).ok_or("Unknown Workspace connector tool")?.write,
            })
        })
    }

    fn execute<'a>(
        &'a self,
        request: &'a gbot_service::connectors::PreparedConnector,
    ) -> gbot_service::connectors::ConnectorFuture<'a, Value> {
        Box::pin(async move {
            let cancellation = CancellationToken::new();
            let _cancel_on_drop = cancellation.clone().drop_guard();
            execute(
                &self.app,
                &request.name,
                request.arguments.clone(),
                &cancellation,
            )
            .await
        })
    }
}

pub fn prepare<R: Runtime>(app: &AppHandle<R>, name: &str, args: Value) -> Result<Value, String> {
    owner(app)?.prepare(name, args)
}

pub async fn execute<R: Runtime>(
    app: &AppHandle<R>,
    name: &str,
    args: Value,
    cancellation: &CancellationToken,
) -> Result<Value, String> {
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
pub async fn connector_configure<R: Runtime>(
    app: AppHandle<R>,
    request: accounts::ConfigureRequest,
) -> Result<accounts::AccountsView, String> {
    owner(&app)?.configure(request).await
}

#[tauri::command]
pub async fn connector_begin_auth<R: Runtime>(
    app: AppHandle<R>,
    request: accounts::AuthRequest,
) -> Result<accounts::AuthFlow, String> {
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
pub fn connector_auth_status<R: Runtime>(
    app: AppHandle<R>,
    flow_id: String,
) -> Result<accounts::AuthFlow, String> {
    owner(&app)?.auth_status(&flow_id)
}

#[tauri::command]
pub async fn connector_cancel_auth<R: Runtime>(
    app: AppHandle<R>,
    flow_id: String,
) -> Result<accounts::AuthFlow, String> {
    owner(&app)?.cancel_auth(&flow_id).await
}

#[tauri::command]
pub fn connector_select_account<R: Runtime>(
    app: AppHandle<R>,
    provider: Provider,
    account_id: String,
) -> Result<accounts::AccountsView, String> {
    owner(&app)?.select(provider, &account_id)
}

#[tauri::command]
pub async fn connector_disconnect<R: Runtime>(
    app: AppHandle<R>,
    provider: Provider,
    account_id: String,
    revoke: bool,
) -> Result<accounts::AccountsView, String> {
    owner(&app)?.disconnect(provider, &account_id, revoke).await
}
