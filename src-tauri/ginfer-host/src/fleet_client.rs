//! One fleet authority and read-only cached reports shared by desktop clients.
use crate::{
    client::Client,
    fleet::{AuthorityLocator, FleetOperation, FleetSnapshot, FleetUpdate, FleetView},
};
use serde::Serialize;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Clone, Serialize)]
pub struct FleetCatalog {
    pub authority: Option<AuthorityLocator>,
    pub snapshot: Option<FleetSnapshot>,
    pub client_id: Option<Uuid>,
    pub connected: bool,
    pub error: Option<String>,
    pub warnings: Vec<String>,
}

pub struct FleetClient {
    client: Arc<Client>,
}

impl FleetClient {
    pub fn new(client: Arc<Client>) -> Self {
        Self { client }
    }

    async fn request(
        &self,
        host_id: Uuid,
        method: reqwest::Method,
        path: &str,
        body: Option<&serde_json::Value>,
    ) -> Result<serde_json::Value, String> {
        tokio::time::timeout(
            std::time::Duration::from_secs(10),
            self.client.request_json(host_id, method, path, body),
        )
        .await
        .map_err(|_| "Fleet coordinator did not respond".to_owned())?
    }

    /// Discover published locators only when no authority was already selected.
    /// An unreachable selected authority never causes a local election.
    pub async fn read(&self) -> Result<FleetCatalog, String> {
        let mut registered = self.client.registered().await?;
        let mut authority = self.client.fleet_authority().await?;
        let mut discovery_error = None;
        if authority.is_none() {
            let views = futures_util::future::join_all(registered.iter().map(|host| {
                self.request(host.host_id, reqwest::Method::GET, "/host/v1/fleet", None)
            }))
            .await;
            for view in views {
                let view = match view.and_then(|value| {
                    serde_json::from_value::<FleetView>(value).map_err(|error| error.to_string())
                }) {
                    Ok(view) => view,
                    Err(error) => {
                        discovery_error = Some(error);
                        continue;
                    }
                };
                let published = match view {
                    FleetView::Coordinator { fleet } => Some(fleet.authority),
                    FleetView::Member { authority } => Some(authority),
                    FleetView::Unconfigured => None,
                };
                if let Some(published) = published {
                    published.validate()?;
                    if authority.as_ref().is_some_and(|known: &AuthorityLocator| {
                        known.host_id != published.host_id
                            || known.certificate_sha256 != published.certificate_sha256
                    }) {
                        return Err("Paired hosts publish different fleet coordinators. Select the intended coordinator explicitly.".into());
                    }
                    authority = Some(published);
                }
            }
            if let Some(locator) = &authority {
                authority = Some(
                    self.client
                        .adopt_fleet_authority_if_unconfigured(locator.clone())
                        .await?,
                );
                registered = self.client.registered().await?;
            }
        }
        let mut enrollment_error = None;
        if let Some(locator) = &authority {
            if !registered
                .iter()
                .any(|host| host.host_id == locator.host_id)
            {
                match self
                    .client
                    .pair_locator(locator, "Shared GInfer applications")
                    .await
                {
                    Ok(_) => registered = self.client.registered().await?,
                    Err(error) => {
                        enrollment_error = Some(format!(
                            "Cannot enroll the published fleet coordinator: {error}"
                        ))
                    }
                }
            }
        }
        let client_id = authority.as_ref().and_then(|locator| {
            registered
                .iter()
                .find(|host| {
                    host.host_id == locator.host_id
                        && host.certificate_sha256 == locator.certificate_sha256
                })
                .map(|host| host.client_id)
        });
        let cached = self.client.cached_fleet().await?.filter(|snapshot| {
            authority.as_ref().is_some_and(|locator| {
                snapshot.authority.host_id == locator.host_id
                    && snapshot.authority.certificate_sha256 == locator.certificate_sha256
            })
        });
        let mut report = FleetCatalog {
            authority,
            snapshot: cached,
            client_id,
            connected: false,
            error: None,
            warnings: Vec::new(),
        };
        let Some(locator) = &report.authority else {
            report.error = discovery_error;
            return Ok(report);
        };
        if client_id.is_none() {
            report.error = enrollment_error.or_else(|| {
                Some(
                    "Pair the fleet coordinator to access its work pools and client assignment."
                        .into(),
                )
            });
            return Ok(report);
        }
        let response = self
            .request(
                locator.host_id,
                reqwest::Method::GET,
                "/host/v1/fleet",
                None,
            )
            .await;
        let response = response.and_then(|value| {
            serde_json::from_value::<FleetView>(value)
                .map_err(|error| format!("Invalid fleet response: {error}"))
        });
        match response {
            Ok(FleetView::Coordinator { fleet }) if fleet.authority.host_id == locator.host_id
                && fleet.authority.certificate_sha256 == locator.certificate_sha256 => {
                fleet.validate()?;
                if report.snapshot.as_ref().is_some_and(|cached| fleet.revision < cached.revision
                    || (fleet.revision == cached.revision && fleet != *cached)) {
                    report.error = Some("Fleet coordinator returned an older revision; refresh its durable state before running pooled work.".into());
                } else {
                    if !self.client.refresh_fleet_authority(locator, fleet.authority.clone()).await? {
                        return Err("Fleet coordinator selection changed while loading its catalog; refresh to use the selected coordinator.".into());
                    }
                    report.authority = Some(fleet.authority.clone());
                    self.client.save_fleet_snapshot(fleet.clone()).await?;
                    report.warnings=self.sync_membership(&fleet,&registered).await;
                    report.snapshot = Some(fleet);
                    report.connected = true;
                }
            }
            Ok(_) => report.error = Some("The selected host no longer publishes this fleet coordinator. Review the coordinator explicitly.".into()),
            Err(error) => report.error = Some(error),
        }
        Ok(report)
    }

    pub async fn configure(
        &self,
        member_host_id: Uuid,
        authority: AuthorityLocator,
    ) -> Result<(), String> {
        authority.validate()?;
        let registered = self.client.registered().await?;
        if !registered.iter().any(|host| {
            host.host_id == authority.host_id
                && host.certificate_sha256 == authority.certificate_sha256
        }) {
            self.client
                .pair_locator(&authority, "Shared GInfer applications")
                .await?;
        }
        let view: FleetView = serde_json::from_value(
            self.request(
                authority.host_id,
                reqwest::Method::GET,
                "/host/v1/fleet",
                None,
            )
            .await?,
        )
        .map_err(|error| error.to_string())?;
        let authority=match view {
            FleetView::Unconfigured=>{
                self.request(authority.host_id,reqwest::Method::POST,"/host/v1/fleet/authority",
                    Some(&serde_json::json!({"authority":authority}))).await?;
                authority
            }
            FleetView::Coordinator {fleet} if fleet.authority.host_id==authority.host_id
                && fleet.authority.certificate_sha256==authority.certificate_sha256=>{
                if member_host_id == authority.host_id && fleet.authority != authority {
                    self.request(authority.host_id,reqwest::Method::POST,"/host/v1/fleet/authority",
                        Some(&serde_json::json!({"authority":authority}))).await?;
                    authority
                } else {
                    fleet.authority
                }
            },
            _=>return Err("The chosen host already belongs to a different coordinator. Use its published fleet or review the authority explicitly.".into()),
        };
        if member_host_id != authority.host_id {
            self.publish_member_locator(member_host_id, &authority)
                .await?;
        }
        self.client.set_fleet_authority(authority).await
    }

    async fn publish_member_locator(
        &self,
        member_host_id: Uuid,
        authority: &AuthorityLocator,
    ) -> Result<(), String> {
        self.request(
            member_host_id,
            reqwest::Method::POST,
            "/host/v1/fleet/authority",
            Some(&serde_json::json!({"authority":authority})),
        )
        .await?;
        Ok(())
    }

    async fn sync_membership(
        &self,
        fleet: &FleetSnapshot,
        registered: &[crate::client::SavedHost],
    ) -> Vec<String> {
        let mut warnings:Vec<_>=fleet.members.iter().filter(|member|member.host.host_id!=fleet.authority.host_id &&
            !registered.iter().any(|host|host.host_id==member.host.host_id && host.certificate_sha256==member.host.certificate_sha256))
            .map(|member|format!("{}: membership report pending; this host is not paired with these applications.",member.display_name)).collect();
        warnings.extend(futures_util::future::join_all(registered.iter().filter(|host|host.host_id!=fleet.authority.host_id).map(|host|async move {
            let result=async {
                let published:FleetView=serde_json::from_value(self.request(host.host_id,reqwest::Method::GET,
                    "/host/v1/fleet",None).await?).map_err(|error|error.to_string())?;
                let enrolled=fleet.members.iter().any(|member|member.host.host_id==host.host_id);
                match published {
                    FleetView::Unconfigured if enrolled=>self.publish_member_locator(host.host_id,&fleet.authority).await?,
                    view if view.authority().is_some_and(|known|known.host_id==fleet.authority.host_id && known.certificate_sha256==fleet.authority.certificate_sha256)=>{
                        if view.authority() != Some(&fleet.authority) {
                            self.publish_member_locator(host.host_id,&fleet.authority).await?;
                        }
                    },
                    _ if enrolled=>return Err("This enrolled host publishes a different coordinator; review its fleet membership explicitly.".into()),
                    _=>return Ok::<(),String>(()),
                }
                let body=serde_json::to_value(fleet.membership(host.host_id)?).map_err(|error|error.to_string())?;
                self.request(host.host_id,reqwest::Method::POST,"/host/v1/fleet/membership",Some(&body)).await?;
                Ok(())
            }.await;
            result.err().map(|error|format!("{}: membership report is stale: {error}",host.name))
        })).await.into_iter().flatten());
        warnings
    }

    async fn send_update(
        &self,
        authority: &AuthorityLocator,
        update: FleetUpdate,
    ) -> Result<FleetSnapshot, String> {
        let fleet: FleetSnapshot = serde_json::from_value(
            self.request(
                authority.host_id,
                reqwest::Method::POST,
                "/host/v1/fleet/update",
                Some(&serde_json::to_value(update).map_err(|error| error.to_string())?),
            )
            .await?,
        )
        .map_err(|error| format!("Invalid fleet update response: {error}"))?;
        fleet.validate()?;
        if fleet.authority.host_id != authority.host_id
            || fleet.authority.certificate_sha256 != authority.certificate_sha256
        {
            return Err("Fleet update returned a different coordinator".into());
        }
        self.client.save_fleet_snapshot(fleet.clone()).await?;
        Ok(fleet)
    }

    async fn join(
        &self,
        authority: &AuthorityLocator,
        member: crate::fleet::FleetMember,
        revision: u64,
    ) -> Result<FleetSnapshot, String> {
        let registered = self.client.registered().await?;
        if !registered.iter().any(|host| {
            host.host_id == member.host.host_id
                && host.certificate_sha256 == member.host.certificate_sha256
        }) {
            return Err(
                "Pair this member with its exact certificate before joining the fleet.".into(),
            );
        }
        if member.host.host_id != authority.host_id {
            let published: FleetView = serde_json::from_value(
                self.request(
                    member.host.host_id,
                    reqwest::Method::GET,
                    "/host/v1/fleet",
                    None,
                )
                .await?,
            )
            .map_err(|error| error.to_string())?;
            if published.authority().is_some_and(|known| {
                known.host_id != authority.host_id
                    || known.certificate_sha256 != authority.certificate_sha256
            }) {
                return Err("The member belongs to a different fleet coordinator. Review its configuration explicitly before joining.".into());
            }
        }
        let host_id = member.host.host_id;
        let fleet = self
            .send_update(
                authority,
                FleetUpdate {
                    expected_revision: revision,
                    operation: FleetOperation::EnrollMember { member },
                },
            )
            .await?;
        if host_id != authority.host_id {
            // Membership is already committed. Delivery is reported/retried by
            // sync_membership, rather than misreporting this canonical edit.
            let _ = self.publish_member_locator(host_id, authority).await;
        }
        Ok(fleet)
    }

    pub async fn update(&self, mut update: FleetUpdate) -> Result<FleetSnapshot, String> {
        let report = self.read().await?;
        if !report.connected {
            return Err(report.error.unwrap_or_else(|| {
                "Select and connect to a fleet coordinator before editing work pools.".into()
            }));
        }
        let authority = report.authority.ok_or("Fleet coordinator is missing")?;
        let mut snapshot = report.snapshot.ok_or("Fleet snapshot is missing")?;
        // Joining selected pool members is part of this one reviewed mutation.
        // Check the original CAS before consuming any intermediate revisions.
        if let FleetOperation::SavePool { pool } = &update.operation {
            let missing: Vec<_> = pool
                .members
                .iter()
                .map(|member| member.instance.host_id)
                .filter(|host| {
                    !snapshot
                        .members
                        .iter()
                        .any(|member| member.host.host_id == *host)
                })
                .collect::<std::collections::BTreeSet<_>>()
                .into_iter()
                .collect();
            if !missing.is_empty() && update.expected_revision != snapshot.revision {
                return Err(format!("Fleet revision conflict: current revision is {}. Refresh and review before saving.",snapshot.revision));
            }
            let registered = self.client.registered().await?;
            for host_id in missing {
                let host = registered
                    .iter()
                    .find(|host| host.host_id == host_id)
                    .ok_or("Pair the selected pool member before saving")?;
                snapshot = self
                    .join(
                        &authority,
                        crate::fleet::FleetMember {
                            host: AuthorityLocator {
                                host_id,
                                origins: vec![host.base_url.clone()],
                                certificate_sha256: host.certificate_sha256.clone(),
                            },
                            display_name: host.name.clone(),
                        },
                        snapshot.revision,
                    )
                    .await?;
                update.expected_revision = snapshot.revision;
            }
        }
        let fleet = match update.operation {
            FleetOperation::EnrollMember { member } => {
                self.join(&authority, member, update.expected_revision)
                    .await?
            }
            operation => {
                self.send_update(
                    &authority,
                    FleetUpdate {
                        expected_revision: update.expected_revision,
                        operation,
                    },
                )
                .await?
            }
        };
        // Canonical success stands even when an offline member's derived report
        // cannot be refreshed. The next read reports and retries these warnings.
        let _ = self
            .sync_membership(&fleet, &self.client.registered().await?)
            .await;
        Ok(fleet)
    }
}
