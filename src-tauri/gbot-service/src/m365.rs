//! Saved assigned-PC setup; desktop qualification belongs to the connection adapter.
use crate::{connectors::ConnectorHost, store::Store};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{path::PathBuf, sync::Arc};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct CloudPc {
    pub id: Uuid,
    pub display_name: String,
    pub image_name: String,
    pub plan_name: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Route {
    BrokeredClient,
    GuestWorker,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SetupRecord {
    pub id: Uuid,
    pub name: String,
    pub account_id: String,
    pub cloud_pc: CloudPc,
    pub route: Route,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveSetup {
    pub id: Uuid,
    pub name: String,
    pub account_id: String,
    pub cloud_pc_id: Uuid,
    pub route: Route,
    pub dedicated: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AccountRequest {
    pub account_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetupId {
    pub id: Uuid,
}

pub struct M365Setup {
    store: Arc<Store>,
    operations: Arc<Mutex<()>>,
    accounts: Arc<dyn ConnectorHost>,
}

impl M365Setup {
    pub async fn open(root: PathBuf, accounts: Arc<dyn ConnectorHost>) -> Result<Self, String> {
        Ok(Self {
            store: Arc::new(
                Store::open(root.join("m365-setup.json"))
                    .await
                    .map_err(|e| e.to_string())?,
            ),
            operations: Arc::new(Mutex::new(())),
            accounts,
        })
    }

    pub async fn status(&self) -> Result<Vec<SetupRecord>, String> {
        let _guard = self.operations.lock().await;
        self.load().await
    }

    pub async fn accounts(&self) -> Result<serde_json::Value, String> {
        let view = self
            .accounts
            .native_operation("accounts", json!({}))
            .await?;
        let microsoft = |key: &str| -> Vec<serde_json::Value> {
            view[key]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|item| item["provider"] == "microsoft")
                .cloned()
                .collect()
        };
        let services: Vec<_> = view["services"]["microsoft"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|item| item["id"] == "cloud_pc")
            .cloned()
            .collect();
        Ok(
            json!({"configs":microsoft("configs"),"accounts":microsoft("accounts"),"active_flows":[],"selected_accounts":{},"services":{"google":[],"microsoft":services}}),
        )
    }

    async fn load(&self) -> Result<Vec<SetupRecord>, String> {
        let records: Vec<SetupRecord> = self
            .store
            .load()
            .await
            .map_err(|e| e.to_string())?
            .unwrap_or_default();
        let mut seen = std::collections::BTreeSet::new();
        if records.iter().any(|r| {
            r.id.is_nil()
                || r.cloud_pc.id.is_nil()
                || r.name.trim().is_empty()
                || r.account_id.trim().is_empty()
                || !seen.insert(r.id)
        }) {
            return Err("Saved Cloud PC setup is invalid.".into());
        }
        Ok(records)
    }

    pub async fn assigned(&self, account_id: &str) -> Result<Vec<CloudPc>, String> {
        if account_id.trim().is_empty() {
            return Err("Choose a Microsoft work or school account.".into());
        }
        let value = self
            .accounts
            .native_operation("cloud_pc_list", json!({"account_id":account_id}))
            .await?;
        serde_json::from_value(value).map_err(|_| "Invalid assigned Cloud PC response.".into())
    }

    pub async fn save(self: &Arc<Self>, input: SaveSetup) -> Result<SetupRecord, String> {
        if input.id.is_nil() || input.name.trim().is_empty() || !input.dedicated {
            return Err("Name the bot and confirm this Cloud PC is dedicated to it.".into());
        }
        let cloud_pc = self
            .assigned(&input.account_id)
            .await?
            .into_iter()
            .find(|pc| pc.id == input.cloud_pc_id)
            .ok_or("This Cloud PC is no longer assigned to the chosen account.")?;
        let record = SetupRecord {
            id: input.id,
            name: input.name.trim().into(),
            account_id: input.account_id,
            cloud_pc,
            route: input.route,
        };
        let owner = self.clone();
        tokio::spawn(async move {
            let _guard = owner.operations.lock().await;
            let mut records = owner.load().await?;
            records.retain(|r| r.id != record.id);
            records.push(record.clone());
            owner
                .store
                .save(&records)
                .await
                .map_err(|e| e.to_string())?;
            Ok(record)
        })
        .await
        .map_err(|_| "Cloud PC setup save was interrupted. Reopen setup to check it.")?
    }

    pub async fn launch(&self, id: Uuid) -> Result<serde_json::Value, String> {
        let record = self
            .status()
            .await?
            .into_iter()
            .find(|r| r.id == id)
            .ok_or("Cloud PC setup not found.")?;
        self.accounts
            .native_operation(
                "cloud_pc_launch",
                json!({"account_id":record.account_id,"cloud_pc_id":record.cloud_pc.id}),
            )
            .await
    }

    pub async fn remove(self: &Arc<Self>, id: Uuid) -> Result<(), String> {
        let owner = self.clone();
        tokio::spawn(async move {
            let _guard = owner.operations.lock().await;
            let mut records = owner.load().await?;
            records.retain(|r| r.id != id);
            owner.store.save(&records).await.map_err(|e| e.to_string())
        })
        .await
        .map_err(|_| "Cloud PC setup removal was interrupted. Reopen setup to check it.")?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connectors::{ConnectorAccount, ConnectorFuture, ConnectorTool, PreparedConnector};

    struct Accounts {
        assigned: std::sync::atomic::AtomicBool,
        pc: Uuid,
    }
    impl ConnectorHost for Accounts {
        fn accounts<'a>(&'a self) -> ConnectorFuture<'a, Vec<ConnectorAccount>> {
            Box::pin(async { Ok(vec![]) })
        }
        fn catalog<'a>(&'a self, _: &'a [String]) -> ConnectorFuture<'a, Vec<ConnectorTool>> {
            Box::pin(async { Ok(vec![]) })
        }
        fn prepare<'a>(
            &'a self,
            _: &'a [String],
            _: &'a str,
            _: serde_json::Value,
        ) -> ConnectorFuture<'a, PreparedConnector> {
            Box::pin(async { Err("Not a bot tool".into()) })
        }
        fn execute<'a>(
            &'a self,
            _: &'a PreparedConnector,
        ) -> ConnectorFuture<'a, serde_json::Value> {
            Box::pin(async { Err("Not a bot tool".into()) })
        }
        fn native_operation<'a>(
            &'a self,
            operation: &'a str,
            args: serde_json::Value,
        ) -> ConnectorFuture<'a, serde_json::Value> {
            Box::pin(async move {
                if operation == "accounts" {
                    return Ok(
                        json!({"configs":[{"provider":"microsoft","client_id":"registered"},{"provider":"google"}],"accounts":[{"provider":"microsoft","id":"explicit-account"},{"provider":"google","id":"other"}],"active_flows":[{"secret":"not remote metadata"}],"selected_accounts":{"google":"other"},"services":{"microsoft":[{"id":"cloud_pc"},{"id":"outlook"}]}}),
                    );
                }
                if args["account_id"] != "explicit-account" {
                    return Err("Account permission unavailable".into());
                }
                match operation {
                    "cloud_pc_list" => Ok(
                        if self.assigned.load(std::sync::atomic::Ordering::Acquire) {
                            json!([CloudPc {
                                id: self.pc,
                                display_name: "Bot PC".into(),
                                image_name: "Windows 11".into(),
                                plan_name: "2vCPU".into()
                            }])
                        } else {
                            json!([])
                        },
                    ),
                    "cloud_pc_launch" => {
                        if self.assigned.load(std::sync::atomic::Ordering::Acquire) {
                            Ok(json!({"url":"https://windows365.microsoft.com/launch/temporary"}))
                        } else {
                            Err("Cloud PC is no longer assigned".into())
                        }
                    }
                    _ => Err("Unsupported".into()),
                }
            })
        }
    }

    fn input(pc: Uuid) -> SaveSetup {
        SaveSetup {
            id: Uuid::new_v4(),
            name: "My bot".into(),
            account_id: "explicit-account".into(),
            cloud_pc_id: pc,
            route: Route::GuestWorker,
            dedicated: true,
        }
    }

    #[tokio::test]
    async fn remote_setup_metadata_comes_from_service_accounts_without_auth_flows() {
        let root = tempfile::tempdir().unwrap();
        let setup = M365Setup::open(
            root.path().into(),
            Arc::new(Accounts {
                assigned: true.into(),
                pc: Uuid::new_v4(),
            }),
        )
        .await
        .unwrap();
        let view = setup.accounts().await.unwrap();
        assert_eq!(
            view["accounts"],
            json!([{"provider":"microsoft","id":"explicit-account"}])
        );
        assert_eq!(
            view["configs"],
            json!([{"provider":"microsoft","client_id":"registered"}])
        );
        assert_eq!(view["services"]["microsoft"], json!([{"id":"cloud_pc"}]));
        assert_eq!(view["active_flows"], json!([]));
        assert_eq!(view["selected_accounts"], json!({}));
    }

    #[tokio::test]
    async fn saved_selection_resumes_without_secrets_or_ready_claim_and_removal_keeps_account() {
        let root = tempfile::tempdir().unwrap();
        let accounts = Arc::new(Accounts {
            assigned: true.into(),
            pc: Uuid::new_v4(),
        });
        let setup = Arc::new(
            M365Setup::open(root.path().into(), accounts.clone())
                .await
                .unwrap(),
        );
        let record = setup.save(input(accounts.pc)).await.unwrap();
        assert!(setup.launch(record.id).await.unwrap()["url"]
            .as_str()
            .unwrap()
            .contains("temporary"));
        drop(setup);
        let setup = Arc::new(
            M365Setup::open(root.path().into(), accounts.clone())
                .await
                .unwrap(),
        );
        let restored = setup.status().await.unwrap();
        assert_eq!(restored[0].cloud_pc.id, accounts.pc);
        assert_eq!(restored[0].route, Route::GuestWorker);
        let disk = std::fs::read_to_string(root.path().join("m365-setup.json")).unwrap();
        assert!(!disk.contains("temporary") && !disk.contains("ready") && !disk.contains("token"));
        setup.remove(record.id).await.unwrap();
        assert!(setup.status().await.unwrap().is_empty());
        assert_eq!(setup.assigned("explicit-account").await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn assignment_and_explicit_consent_are_rechecked_before_save_and_launch() {
        let root = tempfile::tempdir().unwrap();
        let accounts = Arc::new(Accounts {
            assigned: true.into(),
            pc: Uuid::new_v4(),
        });
        let setup = Arc::new(
            M365Setup::open(root.path().into(), accounts.clone())
                .await
                .unwrap(),
        );
        assert!(setup.assigned("").await.is_err());
        assert!(setup.assigned("another-account").await.is_err());
        let mut request = input(accounts.pc);
        request.dedicated = false;
        assert!(setup.save(request).await.is_err());
        let saved = setup.save(input(accounts.pc)).await.unwrap();
        accounts
            .assigned
            .store(false, std::sync::atomic::Ordering::Release);
        assert!(setup.save(input(accounts.pc)).await.is_err());
        assert!(setup.launch(saved.id).await.is_err());
        assert_eq!(setup.status().await.unwrap().len(), 1);
    }
}
