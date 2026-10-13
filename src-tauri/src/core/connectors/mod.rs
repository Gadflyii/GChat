pub mod accounts;
mod cloud_pc;
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

async fn native<R: Runtime>(
    app: &AppHandle<R>,
    operation: &str,
    arguments: Value,
) -> Result<Value, String> {
    app.state::<super::gbot::GbotState>()
        .call(
            app,
            &format!("/v1/native/connectors/{operation}"),
            arguments,
        )
        .await
}

pub async fn catalog<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<ConnectedTool>, String> {
    if app.state::<super::gbot::GbotState>().is_stopped().await {
        return Ok(Vec::new());
    }
    let catalog: Vec<gbot_service::connectors::ConnectorTool> =
        serde_json::from_value(native(app, "catalog", Value::Null).await?)
            .map_err(|_| "Invalid native connector catalog")?;
    catalog
        .into_iter()
        .map(|connected| {
            let descriptor = tool(&connected.name).ok_or(
                "Unknown native connector tool; restart Gbot service after upgrading GChat",
            )?;
            Ok(ConnectedTool {
                description: connected.description,
                ..ConnectedTool::from(descriptor.clone())
            })
        })
        .collect()
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

/// One native account/provider owner shared by Gbot and GChat clients.
struct NativeOperation {
    client_id: uuid::Uuid,
    cancellation: CancellationToken,
    started: bool,
}

#[derive(Default)]
struct NativeOperations {
    requests: std::collections::BTreeMap<uuid::Uuid, NativeOperation>,
    disconnected_clients: std::collections::BTreeSet<uuid::Uuid>,
}

pub struct BotConnectorHost {
    state: Arc<AccountsState>,
    stopping: std::sync::atomic::AtomicBool,
    operations: std::sync::Mutex<NativeOperations>,
}

impl BotConnectorHost {
    pub fn open(root: std::path::PathBuf) -> Result<Self, String> {
        let state = Arc::new(AccountsState::default());
        state.initialize(root)?;
        Ok(Self {
            state,
            stopping: std::sync::atomic::AtomicBool::new(false),
            operations: std::sync::Mutex::new(NativeOperations::default()),
        })
    }
}

impl gbot_service::connectors::ConnectorHost for BotConnectorHost {
    fn close(&self) -> gbot_service::connectors::ConnectorFuture<'_, ()> {
        Box::pin(async {
            self.stopping
                .store(true, std::sync::atomic::Ordering::Release);
            let operations = std::mem::take(
                &mut self
                    .operations
                    .lock()
                    .map_err(|_| "Connector operations unavailable")?
                    .requests,
            );
            for operation in operations.into_values() {
                operation.cancellation.cancel();
            }
            for flow in self.state.view()?.active_flows {
                let _ = self.state.cancel_auth(&flow.flow_id).await;
            }
            Ok(())
        })
    }
    fn native_operation<'a>(
        &'a self,
        operation: &'a str,
        arguments: Value,
    ) -> gbot_service::connectors::ConnectorFuture<'a, Value> {
        Box::pin(async move {
            if self.stopping.load(std::sync::atomic::Ordering::Acquire) {
                return Err("Native connector service is stopping".into());
            }
            fn encode(value: impl serde::Serialize) -> Result<Value, String> {
                serde_json::to_value(value).map_err(|_| "Invalid native connector result".into())
            }
            fn decode<T: serde::de::DeserializeOwned>(value: Value) -> Result<T, String> {
                serde_json::from_value(value).map_err(|_| "Invalid native connector request".into())
            }
            fn text<'a>(value: &'a Value, field: &str) -> Result<&'a str, String> {
                value[field]
                    .as_str()
                    .ok_or_else(|| format!("Missing connector {field}"))
            }
            match operation {
                "accounts" => encode(self.state.view()?),
                "cloud_pc_list" => {
                    encode(cloud_pc::list(&self.state, text(&arguments, "account_id")?).await?)
                }
                "cloud_pc_launch" => {
                    cloud_pc::launch(
                        &self.state,
                        text(&arguments, "account_id")?,
                        decode(arguments["cloud_pc_id"].clone())?,
                    )
                    .await
                }

                "configure" => encode(self.state.configure(decode(arguments)?).await?),
                "begin_auth" => {
                    let (flow, url) = self.state.begin_auth(decode(arguments)?).await?;
                    Ok(serde_json::json!({"flow": flow, "url": url}))
                }
                "auth_status" => encode(self.state.auth_status(text(&arguments, "flow_id")?)?),
                "cancel_auth" => {
                    encode(self.state.cancel_auth(text(&arguments, "flow_id")?).await?)
                }
                "select_account" => encode(self.state.select(
                    decode(arguments["provider"].clone())?,
                    text(&arguments, "account_id")?,
                )?),
                "disconnect" => encode(
                    self.state
                        .disconnect(
                            decode(arguments["provider"].clone())?,
                            text(&arguments, "account_id")?,
                            arguments["revoke"]
                                .as_bool()
                                .ok_or("Missing revoke policy")?,
                        )
                        .await?,
                ),
                "catalog" => encode(
                    catalog_for_accounts(&self.state, None)?
                        .into_iter()
                        .map(|tool| gbot_service::connectors::ConnectorTool {
                            name: tool.name.into(),
                            description: tool.description,
                            input_schema: tool.input_schema,
                            write: tool.write,
                        })
                        .collect::<Vec<_>>(),
                ),
                "prepare" => self
                    .state
                    .prepare(text(&arguments, "name")?, arguments["arguments"].clone()),
                "register" => {
                    let id = uuid::Uuid::parse_str(text(&arguments, "request_id")?)
                        .map_err(|_| "Invalid connector request identity")?;
                    let mut operations = self
                        .operations
                        .lock()
                        .map_err(|_| "Connector operations unavailable")?;
                    let client_id = uuid::Uuid::parse_str(text(&arguments, "client_id")?)
                        .map_err(|_| "Invalid connector client identity")?;
                    if operations.disconnected_clients.contains(&client_id) {
                        return Err("Connector client disconnected".into());
                    }
                    if operations.requests.contains_key(&id) {
                        return Err("Connector request is already registered".into());
                    }
                    operations.requests.insert(
                        id,
                        NativeOperation {
                            client_id,
                            cancellation: CancellationToken::new(),
                            started: false,
                        },
                    );
                    Ok(Value::Null)
                }
                "execute" => {
                    let id = uuid::Uuid::parse_str(text(&arguments, "request_id")?)
                        .map_err(|_| "Invalid connector request identity")?;
                    let name = text(&arguments, "name")?;
                    let cancellation = {
                        let mut operations = self
                            .operations
                            .lock()
                            .map_err(|_| "Connector operations unavailable")?;
                        let operation = operations
                            .requests
                            .get_mut(&id)
                            .ok_or("Register the connector request before executing")?;
                        if operation.started {
                            return Err("Connector request is already executing".into());
                        }
                        operation.started = true;
                        operation.cancellation.clone()
                    };
                    let result = if cancellation.is_cancelled() {
                        Err("Connector operation cancelled".into())
                    } else {
                        execute_native(
                            &self.state,
                            name,
                            arguments["arguments"].clone(),
                            &cancellation,
                        )
                        .await
                    };
                    self.operations
                        .lock()
                        .map_err(|_| "Connector operations unavailable")?
                        .requests
                        .remove(&id);
                    result
                }
                "client_disconnected" => {
                    let client_id = uuid::Uuid::parse_str(text(&arguments, "client_id")?)
                        .map_err(|_| "Invalid connector client identity")?;
                    let mut operations = self
                        .operations
                        .lock()
                        .map_err(|_| "Connector operations unavailable")?;
                    operations.disconnected_clients.insert(client_id);
                    for operation in operations.requests.values() {
                        if operation.client_id == client_id {
                            operation.cancellation.cancel();
                        }
                    }
                    Ok(Value::Null)
                }
                "cancel" => {
                    let id = uuid::Uuid::parse_str(text(&arguments, "request_id")?)
                        .map_err(|_| "Invalid connector request identity")?;
                    if let Some(operation) = self
                        .operations
                        .lock()
                        .map_err(|_| "Connector operations unavailable")?
                        .requests
                        .get(&id)
                    {
                        operation.cancellation.cancel();
                    }
                    Ok(Value::Null)
                }
                _ => Err("Unsupported native connector operation".into()),
            }
        })
    }

    fn accounts(
        &self,
    ) -> gbot_service::connectors::ConnectorFuture<
        '_,
        Vec<gbot_service::connectors::ConnectorAccount>,
    > {
        Box::pin(async {
            Ok(self
                .state
                .clone()
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
            let state = self.state.clone();
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
            let state = self.state.clone();
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
            execute_native(
                &self.state,
                &request.name,
                request.arguments.clone(),
                &cancellation,
            )
            .await
        })
    }
}

pub async fn prepare<R: Runtime>(
    app: &AppHandle<R>,
    name: &str,
    args: Value,
) -> Result<Value, String> {
    native(
        app,
        "prepare",
        serde_json::json!({"name":name,"arguments":args}),
    )
    .await
}

async fn execute_native(
    state: &AccountsState,
    name: &str,
    args: Value,
    cancellation: &CancellationToken,
) -> Result<Value, String> {
    let args = state.prepare(name, args)?;
    match provider_for(name)? {
        Provider::Google => google::execute(state, name, &args, cancellation).await,
        Provider::Microsoft => microsoft::execute(state, name, &args, cancellation).await,
    }
}

struct CancelConnector {
    client: super::gbot::Client,
    id: String,
}
impl Drop for CancelConnector {
    fn drop(&mut self) {
        let client = self.client.clone();
        let id = self.id.clone();
        tauri::async_runtime::spawn(async move {
            let _ = client
                .call(
                    "/v1/native/connectors/cancel",
                    serde_json::json!({"request_id":id}),
                )
                .await;
        });
    }
}

pub async fn execute<R: Runtime>(
    app: &AppHandle<R>,
    name: &str,
    args: Value,
    cancellation: &CancellationToken,
) -> Result<Value, String> {
    let client = app.state::<super::gbot::GbotState>().client(app).await?;
    let id = uuid::Uuid::new_v4().to_string();
    client
        .call(
            "/v1/native/connectors/register",
            serde_json::json!({"request_id":id,"client_id": app.state::<crate::core::gbot::GbotState>().connector_client_id()}),
        )
        .await?;
    // Registration before dispatch makes cancellation safe even when it precedes execute.
    // Dropping the caller sends cancellation directly to this service, without launching one.
    let _cancel_on_drop = CancelConnector {
        client: client.clone(),
        id: id.clone(),
    };
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => {
            let _ = client.call("/v1/native/connectors/cancel", serde_json::json!({"request_id":id})).await;
            Err("Connector operation cancelled".into())
        },
        result = client.call("/v1/native/connectors/execute", serde_json::json!({"request_id":id,"name":name,"arguments":args})) => result,
    }
}

#[tauri::command]
pub async fn connector_accounts<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    native(&app, "accounts", Value::Null).await
}

#[tauri::command]
pub async fn connector_configure<R: Runtime>(
    app: AppHandle<R>,
    request: Value,
) -> Result<Value, String> {
    native(&app, "configure", request).await
}

#[tauri::command]
pub async fn connector_begin_auth<R: Runtime>(
    app: AppHandle<R>,
    request: Value,
) -> Result<Value, String> {
    use tauri_plugin_opener::OpenerExt;
    let result = native(&app, "begin_auth", request).await?;
    let url = result["url"]
        .as_str()
        .ok_or("Invalid connector sign-in URL")?;
    if app.opener().open_url(url, None::<String>).is_err() {
        let _ = native(
            &app,
            "cancel_auth",
            serde_json::json!({"flow_id":result["flow"]["flow_id"]}),
        )
        .await;
        return Err("Could not open the system browser for sign-in".into());
    }
    Ok(result["flow"].clone())
}

#[tauri::command]
pub async fn connector_auth_status<R: Runtime>(
    app: AppHandle<R>,
    flow_id: String,
) -> Result<Value, String> {
    native(&app, "auth_status", serde_json::json!({"flow_id":flow_id})).await
}

#[tauri::command]
pub async fn connector_cancel_auth<R: Runtime>(
    app: AppHandle<R>,
    flow_id: String,
) -> Result<Value, String> {
    native(&app, "cancel_auth", serde_json::json!({"flow_id":flow_id})).await
}

#[tauri::command]
pub async fn connector_select_account<R: Runtime>(
    app: AppHandle<R>,
    provider: Provider,
    account_id: String,
) -> Result<Value, String> {
    native(
        &app,
        "select_account",
        serde_json::json!({"provider":provider,"account_id":account_id}),
    )
    .await
}

#[tauri::command]
pub async fn connector_disconnect<R: Runtime>(
    app: AppHandle<R>,
    provider: Provider,
    account_id: String,
    revoke: bool,
) -> Result<Value, String> {
    native(
        &app,
        "disconnect",
        serde_json::json!({"provider":provider,"account_id":account_id,"revoke":revoke}),
    )
    .await
}
