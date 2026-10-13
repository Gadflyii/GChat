//! Assigned Windows 365 PCs through delegated, read-only Microsoft Graph.
use super::accounts::{AccountsState, Provider, ServiceAccount};
use gbot_service::m365::CloudPc;
use reqwest::{Method, Url};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::BTreeSet, future::Future};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const LIST: &str = "https://graph.microsoft.com/v1.0/me/cloudPCs";

pub async fn list(state: &AccountsState, account: &str) -> Result<Vec<CloudPc>, String> {
    require_account(account)?;
    let cancellation = CancellationToken::new();
    collect(|url| {
        let cancellation = &cancellation;
        async move {
            state
                .request_json(
                    ServiceAccount {
                        provider: Provider::Microsoft,
                        account_id: account,
                        service: "cloud_pc",
                    },
                    Method::GET,
                    &url,
                    None,
                    cancellation,
                )
                .await
        }
    })
    .await
}

fn require_account(account: &str) -> Result<(), String> {
    if account.trim().is_empty() {
        Err("Choose a Microsoft work or school account.".into())
    } else {
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphPc {
    id: Uuid,
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    image_display_name: String,
    #[serde(default)]
    service_plan_name: String,
}

async fn collect<F, Fut>(mut get: F) -> Result<Vec<CloudPc>, String>
where
    F: FnMut(String) -> Fut,
    Fut: Future<Output = Result<Value, String>>,
{
    let mut next = Some(LIST.to_owned());
    let mut urls = BTreeSet::new();
    let mut ids = BTreeSet::new();
    let mut pcs = Vec::new();
    while let Some(url) = next {
        let parsed = Url::parse(&url).map_err(|_| "Invalid Microsoft paging address.")?;
        if parsed.origin().ascii_serialization() != "https://graph.microsoft.com"
            || parsed.path() != "/v1.0/me/cloudPCs"
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.fragment().is_some()
            || !urls.insert(url.clone())
        {
            return Err("Invalid Microsoft paging address.".into());
        }
        let reply = get(url).await?;
        let rows: Vec<GraphPc> = serde_json::from_value(reply["value"].clone())
            .map_err(|_| "Invalid Microsoft assigned-PC list.")?;
        for pc in rows {
            if pc.id.is_nil() || !ids.insert(pc.id) {
                return Err("Invalid Microsoft assigned-PC identity.".into());
            }
            pcs.push(CloudPc {
                id: pc.id,
                display_name: pc.display_name,
                image_name: pc.image_display_name,
                plan_name: pc.service_plan_name,
            });
        }
        next = match reply.get("@odata.nextLink") {
            None | Some(Value::Null) => None,
            Some(Value::String(url)) => Some(url.clone()),
            _ => return Err("Invalid Microsoft paging address.".into()),
        };
    }
    Ok(pcs)
}

pub async fn launch(state: &AccountsState, account: &str, pc: Uuid) -> Result<Value, String> {
    require_account(account)?;
    if pc.is_nil() {
        return Err("Choose an assigned Cloud PC.".into());
    }
    let value = state
        .request_json(
            ServiceAccount {
                provider: Provider::Microsoft,
                account_id: account,
                service: "cloud_pc",
            },
            Method::GET,
            &format!("{LIST}/{pc}/retrieveCloudPcLaunchDetail"),
            None,
            &CancellationToken::new(),
        )
        .await?;
    launch_detail(pc, value)
}

fn launch_detail(pc: Uuid, value: Value) -> Result<Value, String> {
    let assigned = value["cloudPcId"]
        .as_str()
        .and_then(|id| Uuid::parse_str(id).ok());
    let url = value["cloudPcLaunchUrl"]
        .as_str()
        .ok_or("Microsoft did not provide a Cloud PC launch address.")?;
    let parsed = Url::parse(url).map_err(|_| "Invalid Microsoft launch address.")?;
    if assigned != Some(pc)
        || parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Invalid Microsoft launch address.".into());
    }
    Ok(json!({"url":url}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn assigned_pages_keep_details_without_claiming_desktop_status() {
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        let mut pages = std::collections::VecDeque::from([
            json!({"value":[{"id":first,"displayName":"Bot PC","imageDisplayName":"Windows 11","servicePlanName":"2vCPU"}],"@odata.nextLink":format!("{LIST}?$skiptoken=next")}),
            json!({"value":[{"id":second}]}),
        ]);
        let pcs = collect(|_| {
            let page = pages.pop_front().unwrap();
            async { Ok(page) }
        })
        .await
        .unwrap();
        assert_eq!(pcs.len(), 2);
        assert_eq!(pcs[0].plan_name, "2vCPU");
        assert_eq!(pcs[1].id, second);
        assert!(collect(|_| async { Ok(json!({"value":[]})) })
            .await
            .unwrap()
            .is_empty());
    }
    #[tokio::test]
    async fn paging_cannot_send_tokens_to_other_origins_or_graph_operations() {
        for next in [
            "https://foreign.test/",
            "https://graph.microsoft.com/v1.0/users",
            LIST,
        ] {
            let mut calls = 0;
            assert!(collect(|_| {
                calls += 1;
                async { Ok(json!({"value":[],"@odata.nextLink":next})) }
            })
            .await
            .is_err());
            assert_eq!(calls, 1);
        }
    }
    #[test]
    fn launch_is_an_ephemeral_https_link_for_the_exact_assigned_pc() {
        let pc = Uuid::new_v4();
        let valid = json!({"cloudPcId":pc,"cloudPcLaunchUrl":"https://windows365.microsoft.com/launch/opaque"});
        assert!(launch_detail(pc, valid.clone()).is_ok());
        assert!(launch_detail(Uuid::new_v4(), valid).is_err());
        for url in [
            "http://windows365.microsoft.com/",
            "https://user:password@windows365.microsoft.com/",
            "ssh://pc/",
        ] {
            assert!(launch_detail(pc, json!({"cloudPcId":pc,"cloudPcLaunchUrl":url})).is_err());
        }
        assert!(require_account("").is_err());
    }
}
